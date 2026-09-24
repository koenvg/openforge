//! Authenticated installation-scoped Session Daemon client.
//! Blocking calls belong on the Sidecar's blocking pool, never its async executor.
mod host;
mod maintenance;
pub use maintenance::MaintenanceClient;
mod operation_window;
mod operations;
mod output;
mod recovery;
pub mod releases;
mod replacement;
mod retirement_upgrade;
pub mod runtime;
use openforge_session_protocol::*;
use runtime::{check_peer, io_error, RuntimeDirectory};
use std::os::fd::AsRawFd;
use std::os::unix::{net::UnixStream, process::CommandExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Client {
    socket: PathBuf,
    credentials: Credentials,
    controller: Controller,
    operation_window: operation_window::SharedWindow,
}

impl Client {
    /// Connects to the installation's daemon, launching it detached if absent.
    /// # Errors
    /// Refuses unsafe discovery, incompatible daemons and failed startup.
    pub fn launch(executable: &Path, root: &Path) -> Result<Self, Error> {
        Self::launch_with_timeout(executable, root, Duration::from_secs(5))
    }

    /// Connects to the installation's daemon, allowing a bounded startup wait.
    /// # Errors
    /// Refuses unsafe discovery, incompatible daemons and failed startup.
    pub fn launch_with_timeout(
        executable: &Path,
        root: &Path,
        startup_timeout: Duration,
    ) -> Result<Self, Error> {
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
        // Keep the staged lease until the detached daemon has claimed ownership.
        // Reattachment above intentionally does not need the replaced app bundle.
        let staged = match executable.parent() {
            Some(source)
                if source
                    .file_name()
                    .is_some_and(|name| name == "session-runtime") =>
            {
                let store = releases::ReleaseStore::open(&runtime)?;
                let release = store.stage(source)?;
                // Keep launch intent across a launcher crash or incomplete restart.
                // Explicit completion may release this pin only after daemon exit.
                store.retain(&release, &format!("session-{}", release.id()))?;
                Some(release)
            }
            _ => None,
        };
        let launch_path = staged.as_ref().map(|release| release.executable());
        let mut command = std::process::Command::new(launch_path.as_deref().unwrap_or(executable));
        command
            .arg(root)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(runtime.log()?)
            .stderr(runtime.log()?);
        let launch_fd = launch.as_raw_fd();
        command.env("OPENFORGE_DAEMON_LAUNCH_FD", launch_fd.to_string());
        // SAFETY: setsid is async-signal-safe and uses no Rust state in the child.
        unsafe {
            command.pre_exec(move || {
                // Keep singleton launch authority in the child even if this launcher exits.
                let flags = libc::fcntl(launch_fd, libc::F_GETFD);
                if flags == -1
                    || libc::fcntl(launch_fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == -1
                {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().map_err(io_error)?;
        let deadline = Instant::now() + startup_timeout;
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
            operation_window: Default::default(),
        })
    }

    pub fn controller(&self) -> &Controller {
        &self.controller
    }
    pub fn with_controller(&self, controller: Controller) -> Self {
        Self {
            operation_window: if controller == self.controller {
                Arc::clone(&self.operation_window)
            } else {
                Default::default()
            },
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
    // A malformed reply is not a definitive server rejection. The request may already
    // have executed; do not let callers acknowledge it based on inventory alone.
    // A reply on another version comes from a daemon that refused this frame before dispatch.
    read_frame::<_, Result<Response, Error>>(&mut stream).map_err(|error| match error {
        Error::Transport(_) | Error::Version => error,
        _ => Error::OutcomeUnknown,
    })?
}
