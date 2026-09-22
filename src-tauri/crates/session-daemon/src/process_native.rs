//! Rebuild wrappers around this process's inherited PTY masters and direct children.
//! Inactive wrappers deliberately do not own the primary descriptor: failed initialization
//! must leave it available for exec back into the retained image.
use openforge_session_protocol::Error;
use portable_pty::{Child, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::os::{
    fd::{FromRawFd, RawFd},
    unix::fs::MetadataExt,
};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Descriptor {
    pub fd: RawFd,
    device: u64,
    inode: u64,
    special_device: u64,
}
impl Descriptor {
    fn capture(fd: RawFd) -> Result<Self, Error> {
        if fd < 3 {
            return Err(Error::InvalidRequest);
        }
        let metadata = duplicate(fd)?.metadata().map_err(error)?;
        // SAFETY: fd is a live, borrowed descriptor; fcntl only reads its status flags.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0
            || flags & libc::O_NONBLOCK == 0
            || metadata.mode() & (libc::S_IFMT as u32) != libc::S_IFCHR as u32
        {
            return Err(Error::UnsupportedReplacement);
        }
        let mut size = libc::winsize {
            ws_row: 0,
            ws_col: 0,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: size is a writable winsize and fd remains borrowed for this call.
        if unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, &mut size) } < 0 {
            return Err(error(std::io::Error::last_os_error()));
        }
        // Winsize is mutable kernel state, not identity: a live child can change it
        // while owner threads are quiesced. Do not reject or overwrite that change.
        Ok(Self {
            fd,
            device: metadata.dev(),
            inode: metadata.ino(),
            special_device: metadata.rdev(),
        })
    }
}

pub(crate) enum Master {
    Spawned(Box<dyn MasterPty + Send>),
    Inherited { fd: RawFd, active: bool },
}
impl Master {
    pub fn checkpoint(&self) -> Result<Descriptor, Error> {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return Err(Error::UnsupportedReplacement);
        }
        let fd = match self {
            Self::Spawned(master) => master.as_raw_fd().ok_or(Error::UnsupportedReplacement)?,
            Self::Inherited { fd, .. } => *fd,
        };
        Descriptor::capture(fd)
    }
    pub fn restore(descriptor: &Descriptor) -> Result<Self, Error> {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return Err(Error::UnsupportedReplacement);
        }
        if Descriptor::capture(descriptor.fd)? != *descriptor {
            return Err(Error::InvalidRequest);
        }
        Ok(Self::Inherited {
            fd: descriptor.fd,
            active: false,
        })
    }
    /// # Safety
    /// The previous image's owning wrapper must no longer exist; activate exactly once.
    pub unsafe fn activate(&mut self) {
        if let Self::Inherited { active, .. } = self {
            *active = true;
        }
    }
    pub fn resize(&self, size: PtySize) -> Result<(), Error> {
        match self {
            Self::Spawned(master) => master.resize(size).map_err(error),
            Self::Inherited { fd, .. } => {
                let size = libc::winsize {
                    ws_row: size.rows,
                    ws_col: size.cols,
                    ws_xpixel: size.pixel_width,
                    ws_ypixel: size.pixel_height,
                };
                // SAFETY: size is a valid winsize and this wrapper retains fd until teardown.
                if unsafe { libc::ioctl(*fd, libc::TIOCSWINSZ, &size) } < 0 {
                    Err(error(std::io::Error::last_os_error()))
                } else {
                    Ok(())
                }
            }
        }
    }
}
impl Drop for Master {
    fn drop(&mut self) {
        if let Self::Inherited { fd, active: true } = self {
            // SAFETY: successful activation transfers ownership of this one inherited fd
            // to this wrapper. No other wrapper may be activated for the same descriptor.
            if unsafe { libc::close(*fd) } < 0 {
                eprintln!("retained PTY descriptor cleanup failed");
            }
        }
    }
}

pub(crate) fn duplicate(fd: RawFd) -> Result<std::fs::File, Error> {
    // SAFETY: fcntl accepts an integer descriptor and rejects invalid ones. It creates
    // a distinct CLOEXEC fd atomically; no Rust borrow is formed from untrusted input.
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 3) };
    if duplicate < 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    // SAFETY: this successful fcntl returned a newly owned descriptor.
    Ok(unsafe { std::fs::File::from_raw_fd(duplicate) })
}

pub(crate) enum ChildHandle {
    Spawned(Box<dyn Child + Send + Sync>),
    Inherited { pid: i32, exit: Option<u32> },
}
impl ChildHandle {
    pub fn try_wait(&mut self) -> Result<Option<u32>, Error> {
        match self {
            Self::Spawned(child) => child
                .try_wait()
                .map(|status| status.map(|status| status.exit_code()))
                .map_err(error),
            Self::Inherited { pid, exit } => {
                if exit.is_none() {
                    *exit = wait(*pid, libc::WNOHANG)?;
                }
                Ok(*exit)
            }
        }
    }
    pub fn wait(&mut self) -> Result<u32, Error> {
        match self {
            Self::Spawned(child) => child.wait().map(|status| status.exit_code()).map_err(error),
            Self::Inherited { pid, exit } => {
                if exit.is_none() {
                    *exit = wait(*pid, 0)?;
                }
                exit.ok_or(Error::OutcomeUnknown)
            }
        }
    }
}
fn wait(pid: i32, flags: i32) -> Result<Option<u32>, Error> {
    if pid <= 1 {
        return Err(Error::InvalidRequest);
    }
    loop {
        let mut status = 0;
        // SAFETY: status is writable; pid names one retained direct child, never a group.
        let result = unsafe { libc::waitpid(pid, &mut status, flags) };
        if result == 0 {
            return Ok(None);
        }
        if result < 0 {
            let failure = std::io::Error::last_os_error();
            if failure.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error(failure));
        }
        if !libc::WIFEXITED(status) && !libc::WIFSIGNALED(status) {
            return Err(Error::OutcomeUnknown);
        }
        use std::os::unix::process::ExitStatusExt;
        let status = portable_pty::ExitStatus::from(std::process::ExitStatus::from_raw(status));
        return Ok(Some(status.exit_code()));
    }
}
fn error(error: impl std::fmt::Display) -> Error {
    Error::Host(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn live_winsize_changes_are_not_descriptor_identity_changes() {
        let pair = portable_pty::native_pty_system()
            .openpty(PtySize::default())
            .unwrap();
        let saved = descriptor(&*pair.master);
        pair.master
            .resize(PtySize {
                rows: 25,
                cols: 90,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        assert!(
            Master::restore(&saved).is_ok(),
            "a live child may resize its tty while the owner is quiesced"
        );
        assert_eq!(pair.master.get_size().unwrap().cols, 90);
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn retained_masters_reject_cross_binding_and_survive_last_slave_close() {
        let system = portable_pty::native_pty_system();
        let first = system.openpty(PtySize::default()).unwrap();
        let second = system.openpty(PtySize::default()).unwrap();
        let original = descriptor(&*first.master);
        descriptor(&*second.master);
        let mut crossed = original.clone();
        crossed.fd = second.master.as_raw_fd().unwrap();
        assert!(
            Master::restore(&crossed).is_err(),
            "different PTYs must not share an identity"
        );
        drop(first.slave);
        assert!(
            Master::restore(&original).is_ok(),
            "a child exit must not invalidate the retained master"
        );
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn descriptor(master: &dyn MasterPty) -> Descriptor {
        let fd = master.as_raw_fd().unwrap();
        // SAFETY: master owns fd throughout both flag operations.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        assert!(flags >= 0);
        // SAFETY: status flags change without transferring ownership.
        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) },
            0
        );
        Descriptor::capture(fd).unwrap()
    }

    #[test]
    fn inherited_child_keeps_the_original_signal_exit_representation() {
        struct TestChild {
            process: std::process::Child,
            reaped: bool,
        }
        impl Drop for TestChild {
            fn drop(&mut self) {
                if !self.reaped {
                    let _ = self.process.kill();
                }
                // The inherited handle may already have consumed the exit status.
                let _ = self.process.wait();
            }
        }

        let mut child = TestChild {
            process: std::process::Command::new("/bin/sh")
                .args(["-c", "kill -TERM $$"])
                .spawn()
                .unwrap(),
            reaped: false,
        };
        let mut retained = ChildHandle::Inherited {
            pid: child.process.id() as i32,
            exit: None,
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let code = loop {
            if let Some(code) = retained.try_wait().unwrap() {
                child.reaped = true;
                break code;
            }
            if std::time::Instant::now() >= deadline {
                panic!("test-owned child failed to exit");
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        };
        let expected =
            portable_pty::ExitStatus::from(std::process::ExitStatus::from_raw(libc::SIGTERM))
                .exit_code();
        assert_eq!(code, expected);
        assert_eq!(retained.wait().unwrap(), expected);
    }
}
