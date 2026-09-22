//! Isolated macOS adapter. Raw descriptors deliberately have no Drop owner until
//! readiness: a controlled initialization failure must be able to reexec fallback.
use super::Result;
use serde::{Deserialize, Serialize};
use std::ffi::CString;
use std::io;

#[derive(Serialize, Deserialize)]
pub(super) struct Pty {
    pub pid: libc::pid_t,
    pub fd: libc::c_int,
    pub reaped: bool,
    pub status: libc::c_int,
}

// The teardown boundary stays in this experiment; tests inject syscall failures here.
trait TeardownOps {
    fn waitpid(
        &mut self,
        pid: libc::pid_t,
        status: &mut libc::c_int,
        flags: libc::c_int,
    ) -> io::Result<libc::pid_t>;
    fn kill(&mut self, pid: libc::pid_t) -> io::Result<()>;
    fn close(&mut self, fd: libc::c_int) -> io::Result<()>;
}

struct Syscalls;

impl TeardownOps for Syscalls {
    fn waitpid(
        &mut self,
        pid: libc::pid_t,
        status: &mut libc::c_int,
        flags: libc::c_int,
    ) -> io::Result<libc::pid_t> {
        // SAFETY: waitpid checks direct child parenthood and writes to valid status storage.
        let result = unsafe { libc::waitpid(pid, status, flags) };
        if result < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(result)
        }
    }

    fn kill(&mut self, pid: libc::pid_t) -> io::Result<()> {
        // SAFETY: the preceding non-reaping waitpid verified our direct child.
        if unsafe { libc::kill(pid, libc::SIGTERM) } < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn close(&mut self, fd: libc::c_int) -> io::Result<()> {
        // SAFETY: normal teardown closes our sole PTY master, never during handoff.
        if unsafe { libc::close(fd) } < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

impl Pty {
    pub fn spawn(fixture: &str) -> Result<Self> {
        let executable = CString::new(fixture)?;
        let mut master = -1;
        let mut slave = -1;
        let mut size = libc::winsize {
            ws_row: 4,
            ws_col: 20,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: output descriptors and size reference valid local storage.
        if unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        } != 0
        {
            return Err(io::Error::last_os_error().into());
        }
        // SAFETY: this experiment is single-threaded; child only invokes libc before exec.
        let pid = unsafe { libc::fork() };
        if pid == 0 {
            // SAFETY: descriptors come from openpty; all child paths exec or _exit.
            unsafe {
                if libc::setsid() < 0 || libc::ioctl(slave, libc::TIOCSCTTY as libc::c_ulong, 0) < 0
                {
                    libc::_exit(126);
                }
                for fd in 0..3 {
                    if libc::dup2(slave, fd) < 0 {
                        libc::_exit(126);
                    }
                }
                for fd in 3..libc::getdtablesize() {
                    libc::close(fd);
                }
                libc::execl(
                    executable.as_ptr(),
                    executable.as_ptr(),
                    std::ptr::null::<libc::c_char>(),
                );
                libc::_exit(127);
            }
        }
        // SAFETY: slave belongs exclusively to this parent after fork.
        unsafe {
            libc::close(slave);
        }
        if pid < 0 {
            let error = io::Error::last_os_error();
            // SAFETY: no child exists; master is exclusively ours.
            unsafe {
                libc::close(master);
            }
            return Err(error.into());
        }
        Ok(Self {
            pid,
            fd: master,
            reaped: false,
            status: 0,
        })
    }

    pub fn read(&self) -> Result<Vec<u8>> {
        let mut poll = libc::pollfd {
            fd: self.fd,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one initialized pollfd is supplied for this owned master.
        let ready = unsafe { libc::poll(&mut poll, 1, 100) };
        if ready < 0 {
            return Err(io::Error::last_os_error().into());
        }
        if ready == 0 {
            return Ok(Vec::new());
        }
        let mut bytes = vec![0; 4096];
        // SAFETY: buffer length is its initialized capacity; descriptor is retained.
        let length = unsafe { libc::read(self.fd, bytes.as_mut_ptr().cast(), bytes.len()) };
        if length < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EIO) {
                return Ok(Vec::new());
            }
            return Err(error.into());
        }
        bytes.truncate(length as usize);
        Ok(bytes)
    }

    pub fn geometry(&self) -> Result<libc::winsize> {
        let mut size = libc::winsize {
            ws_row: 0,
            ws_col: 0,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: valid mutable winsize storage and an inherited PTY master.
        if unsafe { libc::ioctl(self.fd, libc::TIOCGWINSZ, &mut size) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(size)
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let size = libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: valid winsize storage and the owned master descriptor.
        if unsafe { libc::ioctl(self.fd, libc::TIOCSWINSZ, &size) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }

    pub fn reap(&mut self) -> Result<()> {
        self.reap_with(&mut Syscalls)?;
        Ok(())
    }

    fn reap_with(&mut self, ops: &mut impl TeardownOps) -> io::Result<()> {
        if self.reaped {
            return Ok(());
        }
        let result = ops.waitpid(self.pid, &mut self.status, libc::WNOHANG)?;
        if result != 0 && result != self.pid {
            return Err(io::Error::other(format!(
                "waitpid returned unexpected child {result}"
            )));
        }
        self.reaped = result == self.pid;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        self.stop_with(&mut Syscalls)
    }

    fn stop_with(&mut self, ops: &mut impl TeardownOps) -> Result<()> {
        let mut errors = Vec::new();
        let probed = match self.reap_with(ops) {
            Ok(()) => true,
            Err(error) => {
                errors.push(format!("waitpid probe: {error}"));
                false
            }
        };
        if probed && !self.reaped {
            if let Err(error) = ops.kill(self.pid) {
                errors.push(format!("kill: {error}"));
            }
        }
        if let Err(error) = ops.close(self.fd) {
            errors.push(format!("close: {error}"));
        }
        if probed && !self.reaped {
            loop {
                match ops.waitpid(self.pid, &mut self.status, 0) {
                    Ok(result) if result == self.pid => {
                        self.reaped = true;
                        break;
                    }
                    Ok(result) => {
                        errors.push(format!("waitpid returned unexpected child {result}"));
                        break;
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        errors.push(format!("waitpid: {error}"));
                        break;
                    }
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; ").into())
        }
    }
}

pub(super) fn write(fd: libc::c_int, mut bytes: &[u8]) -> Result<()> {
    while !bytes.is_empty() {
        // SAFETY: slice is valid; descriptor belongs to this experiment.
        let length = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
        if length < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
            continue;
        }
        if length <= 0 {
            return Err(io::Error::last_os_error().into());
        }
        bytes = &bytes[length as usize..];
    }
    Ok(())
}

pub(super) fn allowlist(master: libc::c_int, checkpoint: libc::c_int) -> Result<()> {
    // SAFETY: getdtablesize has no memory arguments; fcntl validates each number.
    for fd in 3..unsafe { libc::getdtablesize() } {
        // SAFETY: these fcntl operations use integer flags, not pointers.
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFD);
            if flags < 0 {
                continue;
            }
            let flags = if fd == master || fd == checkpoint {
                flags & !libc::FD_CLOEXEC
            } else {
                flags | libc::FD_CLOEXEC
            };
            if libc::fcntl(fd, libc::F_SETFD, flags) < 0 {
                return Err(io::Error::last_os_error().into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct Faults {
        waits: VecDeque<io::Result<libc::pid_t>>,
        kill: io::Result<()>,
        close: io::Result<()>,
        calls: Vec<&'static str>,
    }

    impl Faults {
        fn new(waits: Vec<io::Result<libc::pid_t>>) -> Self {
            Self {
                waits: waits.into(),
                kill: Ok(()),
                close: Ok(()),
                calls: Vec::new(),
            }
        }
    }

    impl TeardownOps for Faults {
        fn waitpid(
            &mut self,
            _: libc::pid_t,
            _: &mut libc::c_int,
            flags: libc::c_int,
        ) -> io::Result<libc::pid_t> {
            self.calls.push(if flags == libc::WNOHANG {
                "probe"
            } else {
                "wait"
            });
            self.waits.pop_front().expect("unexpected waitpid")
        }

        fn kill(&mut self, _: libc::pid_t) -> io::Result<()> {
            self.calls.push("kill");
            std::mem::replace(&mut self.kill, Ok(()))
        }

        fn close(&mut self, _: libc::c_int) -> io::Result<()> {
            self.calls.push("close");
            std::mem::replace(&mut self.close, Ok(()))
        }
    }

    fn pty() -> Pty {
        Pty {
            pid: 42,
            fd: 7,
            reaped: false,
            status: 0,
        }
    }

    #[test]
    fn kill_failure_is_reported_after_close_and_reap() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![Ok(0), Ok(42)]);
        faults.kill = Err(io::Error::from_raw_os_error(libc::EPERM));
        let error = pty.stop_with(&mut faults).unwrap_err();
        assert!(error.to_string().contains("kill"), "{error}");
        assert_eq!(faults.calls, ["probe", "kill", "close", "wait"]);
        assert!(pty.reaped);
    }

    #[test]
    fn close_failure_is_reported_after_reap() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![Ok(0), Ok(42)]);
        faults.close = Err(io::Error::from_raw_os_error(libc::EBADF));
        let error = pty.stop_with(&mut faults).unwrap_err();
        assert!(error.to_string().contains("close"), "{error}");
        assert_eq!(faults.calls, ["probe", "kill", "close", "wait"]);
        assert!(pty.reaped);
    }

    #[test]
    fn non_interrupted_wait_failure_does_not_claim_reaping() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![
            Ok(0),
            Err(io::Error::from_raw_os_error(libc::EINTR)),
            Err(io::Error::from_raw_os_error(libc::ECHILD)),
        ]);
        let error = pty.stop_with(&mut faults).unwrap_err();
        assert!(error.to_string().contains("waitpid"), "{error}");
        assert_eq!(faults.calls, ["probe", "kill", "close", "wait", "wait"]);
        assert!(!pty.reaped);
    }

    #[test]
    fn interrupted_wait_retries_until_child_is_reaped() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![
            Ok(0),
            Err(io::Error::from_raw_os_error(libc::EINTR)),
            Ok(42),
        ]);
        pty.stop_with(&mut faults).unwrap();
        assert_eq!(faults.calls, ["probe", "kill", "close", "wait", "wait"]);
        assert!(pty.reaped);
    }

    #[test]
    fn failed_initial_probe_closes_master_without_signaling_unverified_pid() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![Err(io::Error::from_raw_os_error(libc::ECHILD))]);
        let error = pty.stop_with(&mut faults).unwrap_err();
        assert!(error.to_string().contains("waitpid"), "{error}");
        assert_eq!(faults.calls, ["probe", "close"]);
        assert!(!pty.reaped);
    }

    #[test]
    fn multiple_teardown_failures_are_all_reported() {
        let mut pty = pty();
        let mut faults = Faults::new(vec![Ok(0), Err(io::Error::from_raw_os_error(libc::ECHILD))]);
        faults.kill = Err(io::Error::from_raw_os_error(libc::EPERM));
        faults.close = Err(io::Error::from_raw_os_error(libc::EBADF));
        let error = pty.stop_with(&mut faults).unwrap_err().to_string();
        for step in ["kill:", "close:", "waitpid:"] {
            assert!(error.contains(step), "missing {step}: {error}");
        }
        assert!(!pty.reaped);
    }

    #[test]
    fn already_reaped_child_only_closes_master() {
        let mut pty = pty();
        pty.reaped = true;
        let mut faults = Faults::new(vec![]);
        pty.stop_with(&mut faults).unwrap();
        assert_eq!(faults.calls, ["close"]);
        assert!(pty.reaped);
    }
}
