//! Filesystem and peer checks shared by launcher and daemon. No process-name discovery.
use openforge_session_protocol::{Credentials, Error};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

pub struct RuntimeDirectory {
    path: PathBuf,
    credentials: Credentials,
}

impl RuntimeDirectory {
    /// Reopens metadata for a retained owner, without claiming its lock or creating
    /// directories/credentials. The caller must already hold the ownership descriptor.
    ///
    /// # Errors
    /// Refuses missing, unsafe, changed, or incompatible credentials.
    pub fn reopen(root: &Path, expected: &Credentials) -> Result<Self, Error> {
        let metadata = fs::symlink_metadata(root).map_err(io_error)?;
        if !metadata.is_dir() || metadata.uid() != uid() || metadata.mode() & 0o022 != 0 {
            return Err(Error::Unauthorized);
        }
        let path = fs::canonicalize(root).map_err(io_error)?.join("session-v1");
        check_private(&path, true)?;
        let credential_path = path.join("credentials.json");
        check_private(&credential_path, false)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&credential_path)
            .map_err(io_error)?;
        let metadata = file.metadata().map_err(io_error)?;
        if !metadata.is_file()
            || metadata.uid() != uid()
            || metadata.mode() & 0o077 != 0
            || metadata.len() > 4096
        {
            return Err(Error::Unauthorized);
        }
        let mut bytes = Vec::new();
        file.take(4097).read_to_end(&mut bytes).map_err(io_error)?;
        if bytes.len() > 4096 {
            return Err(Error::Capacity);
        }
        let credentials: Credentials =
            serde_json::from_slice(&bytes).map_err(|_| Error::Unauthorized)?;
        if uuid::Uuid::parse_str(credentials.installation.as_str()).is_err()
            || credentials.token.len() != 64
            || !credentials
                .token
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || credentials.installation != expected.installation
            || credentials.token != expected.token
        {
            return Err(Error::Unauthorized);
        }
        Ok(Self { path, credentials })
    }

    /// Opens a private runtime under an existing installation data directory.
    ///
    /// # Errors
    /// Refuses symlinks, foreign ownership, writable installation roots and unsafe files.
    pub fn open(root: &Path) -> Result<Self, Error> {
        Self::open_with_creation(root, true)
    }

    /// Opens existing authentication without manufacturing replacement credentials.
    /// # Errors
    /// Refuses missing or unsafe runtime metadata. Reauthentication must use the
    /// installation's existing credentials, never infer ownership from a PID.
    pub fn open_existing(root: &Path) -> Result<Self, Error> {
        Self::open_with_creation(root, false)
    }

    fn open_with_creation(root: &Path, create: bool) -> Result<Self, Error> {
        let metadata = fs::symlink_metadata(root).map_err(io_error)?;
        if !metadata.is_dir() || metadata.uid() != uid() || metadata.mode() & 0o022 != 0 {
            return Err(Error::Unauthorized);
        }
        let path = fs::canonicalize(root).map_err(io_error)?.join("session-v1");
        if create {
            match DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(io_error(error)),
            }
        }
        check_private(&path, true)?;
        let _setup = if create {
            let setup = private_file(&path.join("setup.lock"))?;
            setup.lock().map_err(io_error)?;
            Some(setup)
        } else {
            None
        };
        let credential_path = path.join("credentials.json");
        if create && !credential_path.try_exists().map_err(io_error)? {
            let credentials = Credentials {
                installation: openforge_session_host::InstallationId::parse(
                    uuid::Uuid::new_v4().to_string(),
                )
                .map_err(|_| Error::InvalidRequest)?,
                token: format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                ),
            };
            let temporary = path.join(format!("credentials-{}.tmp", uuid::Uuid::new_v4()));
            let mut file = private_file(&temporary)?;
            serde_json::to_writer(&mut file, &credentials).map_err(|_| Error::InvalidRequest)?;
            file.sync_all().map_err(io_error)?;
            fs::rename(temporary, &credential_path).map_err(io_error)?;
        }
        check_private(&credential_path, false)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&credential_path)
            .map_err(io_error)?;
        let mut bytes = Vec::new();
        file.take(4097).read_to_end(&mut bytes).map_err(io_error)?;
        if bytes.len() > 4096 {
            return Err(Error::Capacity);
        }
        let credentials: Credentials =
            serde_json::from_slice(&bytes).map_err(|_| Error::Unauthorized)?;
        if uuid::Uuid::parse_str(credentials.installation.as_str()).is_err()
            || credentials.token.len() != 64
            || !credentials.token.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(Error::Unauthorized);
        }
        Ok(Self { path, credentials })
    }

    pub fn credentials(&self) -> &Credentials {
        &self.credentials
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn socket_path(&self) -> PathBuf {
        self.path.join("control.sock")
    }

    /// Locks singleton ownership until the returned file is dropped.
    /// # Errors
    /// Fails rather than taking over a running daemon or an unsafe lock file.
    pub fn claim(&self) -> Result<File, Error> {
        let file = private_file(&self.path.join("daemon.lock"))?;
        file.try_lock().map_err(|_| Error::AlreadyRunning)?;
        Ok(file)
    }
    /// Serializes launch attempts while a spawned image has not become ready.
    /// # Errors
    /// Refuses unsafe metadata or another in-progress launch.
    pub fn claim_launch(&self) -> Result<File, Error> {
        let file = private_file(&self.path.join("launch.lock"))?;
        file.try_lock().map_err(|_| Error::AlreadyRunning)?;
        Ok(file)
    }

    /// Releases inherited launch authority after the caller holds daemon ownership.
    /// # Errors
    /// Rejects descriptors that do not identify this runtime's private launch lock.
    /// # Safety
    /// Call only during single-threaded daemon startup. Any descriptor named by
    /// OPENFORGE_DAEMON_LAUNCH_FD must be inherited and have no Rust owner.
    pub unsafe fn release_launch_guard(&self) -> Result<(), Error> {
        use std::os::fd::{BorrowedFd, FromRawFd};
        let Some(value) = std::env::var_os("OPENFORGE_DAEMON_LAUNCH_FD") else {
            return Ok(());
        };
        let fd: i32 = value
            .to_str()
            .and_then(|value| value.parse().ok())
            .filter(|fd| *fd >= 3)
            .ok_or(Error::Unauthorized)?;
        // SAFETY: fcntl inspects an integer descriptor without dereferencing memory.
        if unsafe { libc::fcntl(fd, libc::F_GETFD) } == -1 {
            return Err(Error::Unauthorized);
        }
        let duplicate = {
            // SAFETY: the dedicated inherited descriptor was checked and stays open for this borrow.
            let borrowed = unsafe { BorrowedFd::borrow_raw(fd) };
            File::from(borrowed.try_clone_to_owned().map_err(io_error)?)
        };
        let metadata = duplicate.metadata().map_err(io_error)?;
        let path = self.path.join("launch.lock");
        check_private(&path, false)?;
        let expected = fs::symlink_metadata(path).map_err(io_error)?;
        if metadata.dev() != expected.dev() || metadata.ino() != expected.ino() {
            return Err(Error::Unauthorized);
        }
        // SAFETY: the launcher passed this dedicated descriptor; no Rust owner exists in this image.
        drop(unsafe { File::from_raw_fd(fd) });
        std::env::remove_var("OPENFORGE_DAEMON_LAUNCH_FD");
        Ok(())
    }

    /// # Errors
    /// Refuses sockets not owned by this user in the private runtime.
    pub fn check_socket(&self) -> Result<(), Error> {
        let metadata = fs::symlink_metadata(self.socket_path()).map_err(io_error)?;
        if !metadata.file_type().is_socket()
            || metadata.uid() != uid()
            || metadata.mode() & 0o777 != 0o600
        {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    /// # Errors
    /// Refuses unsafe log files. The daemon, not its parent, owns these descriptors.
    pub fn log(&self) -> Result<File, Error> {
        let path = self.path.join("daemon.log");
        let file = private_file(&path)?;
        // Logs contain only startup/failure categories, never credentials or shell data.
        if file.metadata().map_err(io_error)?.len() > 1024 * 1024 {
            file.set_len(0).map_err(io_error)?;
        }
        OpenOptions::new()
            .append(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(io_error)
    }
}

fn check_private(path: &Path, directory: bool) -> Result<(), Error> {
    let m = fs::symlink_metadata(path).map_err(io_error)?;
    let valid_type = if directory {
        m.is_dir()
    } else {
        m.is_file() && m.nlink() == 1
    };
    if !valid_type || m.uid() != uid() || m.mode() & 0o777 != if directory { 0o700 } else { 0o600 }
    {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn private_file(path: &Path) -> Result<File, Error> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(io_error)?;
    check_private(path, false)?;
    Ok(file)
}

fn uid() -> u32 {
    // SAFETY: geteuid has no pointer arguments or preconditions.
    unsafe { libc::geteuid() }
}

/// Verifies the local socket peer independently of discovery metadata.
/// # Errors
/// Rejects foreign users and unsupported peer credential queries.
pub fn check_peer(stream: &UnixStream) -> Result<(), Error> {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        let mut user = 0;
        let mut group = 0;
        // SAFETY: the descriptor is live and both output pointers are valid.
        if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut user, &mut group) } != 0
            || user != uid()
        {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let mut cred = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: the descriptor and output buffer/length pointers are valid.
        let result = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut size,
            )
        };
        if result != 0 || cred.uid != uid() {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}

pub fn io_error(error: std::io::Error) -> Error {
    Error::Transport(error.to_string())
}

#[cfg(test)]
#[path = "runtime_checkpoint_tests.rs"]
mod checkpoint_tests;
