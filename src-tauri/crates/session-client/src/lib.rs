//! Authenticated installation-scoped Session Daemon client.
//! Blocking calls belong on the Sidecar's blocking pool, never its async executor.
mod host;
mod operations;
mod output;
mod recovery;
mod replacement;
pub mod runtime;
use openforge_session_protocol::*;
use runtime::{check_peer, io_error, RuntimeDirectory};
use std::os::unix::{net::UnixStream, process::CommandExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Client {
    socket: PathBuf,
    credentials: Credentials,
    controller: Controller,
}

impl Client {
    /// Connects to the installation's daemon, launching it detached if absent.
    /// # Errors
    /// Refuses unsafe discovery, incompatible daemons and failed startup.
    pub fn launch(executable: &Path, root: &Path) -> Result<Self, Error> {
        let runtime = match std::fs::symlink_metadata(root.join("session-v1")) {
            Ok(_) => RuntimeDirectory::open_existing(root)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                RuntimeDirectory::open(root)?
            }
            Err(error) => return Err(io_error(error)),
        };
        if runtime.socket_path().try_exists().map_err(io_error)? {
            runtime.check_socket()?;
            match Self::connect(root) {
                Ok(client) => return Ok(client),
                Err(Error::Transport(_)) => {}
                Err(error) => return Err(error),
            }
        }
        let launch = runtime.claim_launch()?;
        // A live owner can be temporarily unreachable during exec or startup.
        // Only the daemon's lifetime lock can establish that no owner exists.
        drop(runtime.claim()?);
        let mut command = std::process::Command::new(executable);
        command
            .arg(root)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(runtime.log()?)
            .stderr(runtime.log()?);
        // SAFETY: setsid is async-signal-safe and uses no Rust state in the child.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().map_err(io_error)?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(client) = Self::connect(root) {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(client);
            }
            if let Some(status) = child.try_wait().map_err(io_error)? {
                return Self::connect(root)
                    .map_err(|_| Error::Transport(format!("daemon startup failed: {status}")));
            }
            if Instant::now() >= deadline {
                // Readiness bounds the caller's wait, not the PTY owner's lifetime.
                std::thread::spawn(move || {
                    let _ = child.wait();
                    drop(launch);
                });
                return Err(Error::Transport(
                    "daemon startup timed out; retry attachment without launching a host".into(),
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Acquires a new controller generation without creating a process.
    /// # Errors
    /// Refuses unsafe runtime metadata and incompatible or unauthenticated peers.
    pub fn connect(root: &Path) -> Result<Self, Error> {
        let runtime = RuntimeDirectory::open_existing(root)?;
        runtime.check_socket()?;
        let credentials = runtime.credentials().clone();
        let response = exchange(
            &runtime.socket_path(),
            &credentials,
            Command::Connect {
                installation: credentials.installation.clone(),
            },
        )?;
        let Response::Inventory(inventory) = response else {
            return Err(Error::InvalidRequest);
        };
        if inventory.controller.installation != credentials.installation {
            return Err(Error::ForeignInstallation);
        }
        Ok(Self {
            socket: runtime.socket_path(),
            credentials,
            controller: inventory.controller,
        })
    }

    pub fn controller(&self) -> &Controller {
        &self.controller
    }
    pub fn with_controller(&self, controller: Controller) -> Self {
        Self {
            controller,
            ..self.clone()
        }
    }

    /// # Errors
    /// Returns stale-controller errors rather than silently taking control again.
    pub fn inventory(&self) -> Result<Inventory, Error> {
        match self.request(Command::Inventory {
            controller: self.controller.clone(),
        })? {
            Response::Inventory(inventory) => Ok(inventory),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// Stops only this empty daemon lifetime. Live sessions must first be stopped explicitly.
    /// # Errors
    /// Refuses stale controllers and daemons with live sessions.
    pub fn shutdown_empty(&self) -> Result<(), Error> {
        match self.request(Command::ShutdownEmpty {
            controller: self.controller.clone(),
        })? {
            Response::Done => Ok(()),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// Replaces the private domain endpoint for this controller generation.
    /// # Errors
    /// Refuses stale controllers or invalid endpoints. Never retries registration.
    pub fn register_sidecar(&self, endpoint: Option<SidecarEndpoint>) -> Result<(), Error> {
        match self.request(Command::RegisterSidecar {
            controller: self.controller.clone(),
            endpoint,
        })? {
            Response::Done => Ok(()),
            _ => Err(Error::InvalidRequest),
        }
    }

    fn request(&self, command: Command) -> Result<Response, Error> {
        exchange(&self.socket, &self.credentials, command)
    }
}

fn exchange(socket: &Path, credentials: &Credentials, command: Command) -> Result<Response, Error> {
    let mut stream = UnixStream::connect(socket).map_err(io_error)?;
    check_peer(&stream)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(io_error)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(io_error)?;
    write_frame(
        &mut stream,
        &Envelope {
            version: VERSION,
            body: Request {
                token: credentials.token.clone(),
                command,
            },
        },
    )?;
    read_frame::<_, Result<Response, Error>>(&mut stream)?
}
