//! Kernel-held identity of the spawning host. EOF and a caller-provided PID are not exit proof.
#[cfg(target_os = "macos")]
mod platform {
    use std::{
        io,
        os::fd::{AsRawFd, FromRawFd, OwnedFd},
        time::{Duration, Instant},
    };

    pub struct HostExit {
        queue: OwnedFd,
        parent: u32,
    }

    impl HostExit {
        pub fn watch() -> Result<Self, String> {
            // SAFETY: getppid and kqueue have no pointer arguments.
            let parent = unsafe { libc::getppid() };
            if parent <= 1 {
                return Err("updater must be spawned by its live host".into());
            }
            let fd = unsafe { libc::kqueue() };
            if fd < 0 {
                return Err(io::Error::last_os_error().to_string());
            }
            // SAFETY: kqueue returned a new owned descriptor.
            let queue = unsafe { OwnedFd::from_raw_fd(fd) };
            // SAFETY: fd is live and F_SETFD takes an integer flag.
            if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                return Err(io::Error::last_os_error().to_string());
            }
            let change = libc::kevent {
                ident: usize::try_from(parent).map_err(|_| "invalid host pid")?,
                filter: libc::EVFILT_PROC,
                flags: libc::EV_ADD | libc::EV_ONESHOT,
                fflags: libc::NOTE_EXIT,
                data: 0,
                udata: std::ptr::null_mut(),
            };
            // SAFETY: change points to one initialized event; no output buffer is requested.
            if unsafe { libc::kevent(fd, &change, 1, std::ptr::null_mut(), 0, std::ptr::null()) }
                < 0
            {
                return Err(io::Error::last_os_error().to_string());
            }
            // SAFETY: getppid has no pointer arguments. Refuse a host lost during registration.
            if unsafe { libc::getppid() } != parent {
                return Err("host exited before handoff".into());
            }
            Ok(Self {
                queue,
                parent: parent.try_into().map_err(|_| "invalid host pid")?,
            })
        }

        pub fn parent_pid(&self) -> Result<u32, String> {
            // A copied parent PID is not caller authority after this helper is orphaned.
            // SAFETY: getppid has no arguments or memory preconditions.
            let current = unsafe { libc::getppid() };
            if u32::try_from(current).ok() != Some(self.parent) {
                return Err("handoff host is no longer this helper's parent".into());
            }
            Ok(self.parent)
        }

        pub fn wait(&self) -> Result<(), String> {
            self.wait_until(Some(Instant::now() + Duration::from_secs(120)))
        }

        pub fn wait_forever(&self) -> Result<(), String> {
            self.wait_until(None)
        }

        fn wait_until(&self, deadline: Option<Instant>) -> Result<(), String> {
            loop {
                let timeout = deadline
                    .map(|deadline| -> Result<_, String> {
                        let remaining = deadline
                            .checked_duration_since(Instant::now())
                            .ok_or("host exit deadline exceeded")?;
                        Ok(libc::timespec {
                            tv_sec: remaining
                                .as_secs()
                                .try_into()
                                .map_err(|_| "invalid deadline")?,
                            tv_nsec: remaining.subsec_nanos().into(),
                        })
                    })
                    .transpose()?;
                // SAFETY: a zeroed kevent is valid writable output storage.
                let mut event: libc::kevent = unsafe { std::mem::zeroed() };
                // SAFETY: queue is owned, event/timeout point to valid storage and no changes are submitted.
                let count = unsafe {
                    libc::kevent(
                        self.queue.as_raw_fd(),
                        std::ptr::null(),
                        0,
                        &mut event,
                        1,
                        timeout
                            .as_ref()
                            .map_or(std::ptr::null(), std::ptr::from_ref),
                    )
                };
                if count < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    return Err(error.to_string());
                }
                if count == 1
                    && event.flags & libc::EV_ERROR == 0
                    && event.fflags & libc::NOTE_EXIT != 0
                {
                    return Ok(());
                }
                return Err("host exit was not observed".into());
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub struct HostExit;
    impl HostExit {
        pub fn parent_pid(&self) -> Result<u32, String> {
            Err("updater handoff requires macOS".into())
        }
        pub fn watch() -> Result<Self, String> {
            Err("updater handoff requires macOS".into())
        }
        pub fn wait(&self) -> Result<(), String> {
            Err("updater handoff requires macOS".into())
        }
        pub fn wait_forever(&self) -> Result<(), String> {
            Err("updater handoff requires macOS".into())
        }
    }
}

pub(crate) use platform::HostExit;

static GUARDED_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Whether this process installed a kernel-observed parent-exit guard.
#[must_use]
pub fn parent_exit_guard_armed() -> bool {
    GUARDED_PID.load(std::sync::atomic::Ordering::Acquire) == std::process::id()
}

/// Stop an owned Sidecar when its actual app exits, without invoking
/// Quit cleanup. Neither Rust destructors nor C exit handlers may stop sessions.
/// # Errors
/// Requires a live macOS parent, kernel exit observation and an owned watcher thread.
pub fn exit_with_host() -> Result<(), String> {
    let host = HostExit::watch()?;
    std::thread::Builder::new()
        .name("sidecar-host-exit".into())
        .spawn(move || {
            let status = i32::from(host.wait_forever().is_err());
            // SAFETY: terminate only this process, deliberately bypassing Quit handlers.
            unsafe { libc::_exit(status) }
        })
        .map(|_| GUARDED_PID.store(std::process::id(), std::sync::atomic::Ordering::Release))
        .map_err(|error| error.to_string())
}
