use std::{
    fs::File,
    io::{self, Read},
    os::fd::AsRawFd,
    time::{Duration, Instant},
};

/// Bounds a whole frame, including a peer that sends only part of a JSON line.
pub(crate) struct HandoffInput {
    deadline: Instant,
    source: Option<File>,
}

impl HandoffInput {
    pub fn new() -> Self {
        Self::with_timeout(Duration::from_secs(120))
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            deadline: Instant::now() + timeout,
            source: None,
        }
    }

    pub fn from_file(source: File, timeout: Duration) -> Self {
        Self {
            deadline: Instant::now() + timeout,
            source: Some(source),
        }
    }
}

impl Read for HandoffInput {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let fd = self
            .source
            .as_ref()
            .map_or(libc::STDIN_FILENO, AsRawFd::as_raw_fd);
        loop {
            let remaining = self
                .deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::TimedOut, "handoff frame deadline exceeded")
                })?;
            let timeout = i32::try_from(remaining.as_millis()).unwrap_or(i32::MAX);
            let mut poll = libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: poll points to one initialized pollfd and timeout is bounded.
            let ready = unsafe { libc::poll(&mut poll, 1, timeout) };
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            if ready == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "handoff frame deadline exceeded",
                ));
            }
            // SAFETY: buffer is writable; fd is owned by this reader or is protocol-owned stdin.
            let count = unsafe { libc::read(fd, buffer.as_mut_ptr().cast(), buffer.len()) };
            if count >= 0 {
                return usize::try_from(count).map_err(io::Error::other);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}
