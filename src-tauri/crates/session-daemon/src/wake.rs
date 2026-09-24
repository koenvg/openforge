//! Self-pipe wakeups for threads that block in poll(2) instead of sleeping.
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub(crate) struct Wake {
    read: OwnedFd,
    write: OwnedFd,
}

impl Wake {
    pub fn new() -> std::io::Result<Self> {
        let mut fds = [0; 2];
        // SAFETY: fds is a writable two-element array.
        if unsafe { libc::pipe(fds.as_mut_ptr()) } < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: pipe returned two new descriptors owned only by this value.
        let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
        for fd in [read.as_raw_fd(), write.as_raw_fd()] {
            set_flag(fd, libc::F_GETFD, libc::F_SETFD, libc::FD_CLOEXEC)?;
            set_flag(fd, libc::F_GETFL, libc::F_SETFL, libc::O_NONBLOCK)?;
        }
        Ok(Self { read, write })
    }

    pub fn notify(&self) {
        notify_fd(self.write.as_raw_fd());
    }

    pub fn fd(&self) -> RawFd {
        self.read.as_raw_fd()
    }

    pub fn drain(&self) {
        let mut buffer = [0u8; 64];
        // SAFETY: buffer is writable for its full length; the fd is nonblocking.
        while unsafe { libc::read(self.fd(), buffer.as_mut_ptr().cast(), buffer.len()) } > 0 {}
    }
}

fn set_flag(fd: RawFd, get: i32, set: i32, flag: i32) -> std::io::Result<()> {
    // SAFETY: fd is a live descriptor; fcntl only changes its flags.
    let flags = unsafe { libc::fcntl(fd, get) };
    // SAFETY: as above.
    if flags < 0 || unsafe { libc::fcntl(fd, set, flags | flag) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn notify_fd(fd: RawFd) {
    // A full pipe already guarantees a pending wakeup, so EAGAIN is success.
    // SAFETY: writes one byte from a live stack value; async-signal-safe.
    unsafe { libc::write(fd, [1u8].as_ptr().cast(), 1) };
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Readiness {
    pub readable: bool,
    pub writable: bool,
    pub woken: bool,
}

pub(crate) fn wait(
    fd: RawFd,
    writable: bool,
    wake: &Wake,
    deadline: Option<Instant>,
) -> std::io::Result<Readiness> {
    let mut interest = libc::POLLIN;
    if writable {
        interest |= libc::POLLOUT;
    }
    let mut fds = [
        libc::pollfd {
            fd,
            events: interest,
            revents: 0,
        },
        libc::pollfd {
            fd: wake.fd(),
            events: libc::POLLIN,
            revents: 0,
        },
    ];
    loop {
        let timeout = deadline.map_or(-1, |deadline| {
            let remaining = deadline.saturating_duration_since(Instant::now());
            // Round up so that a sub-millisecond remainder does not spin at zero.
            (remaining + Duration::from_micros(999))
                .as_millis()
                .min(i32::MAX as u128) as i32
        });
        // SAFETY: fds is a valid array of two pollfd values for the duration of the call.
        let result = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout) };
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        let hangup = libc::POLLHUP | libc::POLLERR | libc::POLLNVAL;
        return Ok(Readiness {
            readable: fds[0].revents & (libc::POLLIN | hangup) != 0,
            writable: fds[0].revents & libc::POLLOUT != 0,
            woken: fds[1].revents != 0,
        });
    }
}

static CHILD_EXIT_FD: AtomicI32 = AtomicI32::new(-1);

pub(crate) fn daemon() -> &'static Wake {
    static DAEMON: OnceLock<Wake> = OnceLock::new();
    DAEMON.get_or_init(|| Wake::new().expect("daemon wake pipe"))
}

extern "C" fn on_child_exit(_: libc::c_int) {
    let fd = CHILD_EXIT_FD.load(Ordering::Relaxed);
    if fd >= 0 {
        // The interrupted thread may be about to read errno from its own failed call.
        // SAFETY: errno is thread-local and always valid to read and write.
        unsafe {
            let saved = *errno();
            notify_fd(fd);
            *errno() = saved;
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn errno() -> *mut libc::c_int {
    libc::__error()
}

#[cfg(not(target_os = "macos"))]
unsafe fn errno() -> *mut libc::c_int {
    libc::__errno_location()
}

pub(crate) fn watch_child_exits() -> std::io::Result<()> {
    CHILD_EXIT_FD.store(daemon().write.as_raw_fd(), Ordering::Relaxed);
    // SAFETY: the handler only performs an async-signal-safe write to a static fd.
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = on_child_exit as extern "C" fn(libc::c_int) as usize;
        action.sa_flags = libc::SA_RESTART | libc::SA_NOCLDSTOP;
        libc::sigemptyset(&mut action.sa_mask);
        if libc::sigaction(libc::SIGCHLD, &action, std::ptr::null_mut()) < 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notify_interrupts_an_unbounded_wait() {
        let (idle, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let wake = std::sync::Arc::new(Wake::new().unwrap());
        let notifier = std::sync::Arc::clone(&wake);
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            notifier.notify();
        });
        let ready = wait(idle.as_raw_fd(), false, &wake, None).unwrap();
        thread.join().unwrap();
        assert_eq!(
            ready,
            Readiness {
                readable: false,
                writable: false,
                woken: true
            }
        );
    }

    #[test]
    fn drain_clears_pending_notifications() {
        let (idle, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let wake = Wake::new().unwrap();
        wake.notify();
        wake.notify();
        wake.drain();
        let deadline = Instant::now() + Duration::from_millis(10);
        let ready = wait(idle.as_raw_fd(), false, &wake, Some(deadline)).unwrap();
        assert!(!ready.woken);
    }

    #[test]
    fn child_exit_wakes_the_daemon() {
        watch_child_exits().unwrap();
        daemon().drain();
        let (idle, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        std::process::Command::new("/usr/bin/true")
            .status()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let ready = wait(idle.as_raw_fd(), false, daemon(), Some(deadline)).unwrap();
        assert!(ready.woken);
    }
}
