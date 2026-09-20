//! Explicit local recovery. Never launches a host or consults provider history.
use crate::Client;
use openforge_session_protocol::Error;
use std::time::{Duration, Instant};

impl Client {
    /// Terminates only PTYs from this authenticated controller's inventory.
    ///
    /// # Errors
    /// Stale or expired authority requires explicit reconnection. Transport errors
    /// leave cleanup incomplete; they never trigger process-name or PID cleanup.
    pub fn terminate_owned_sessions(&self, timeout: Duration) -> Result<(), Error> {
        for session in self.inventory()?.sessions {
            if session.exit_code.is_none() {
                self.terminate(
                    &format!("recovery-quit-{}", session.pty.instance),
                    &session.pty,
                )?;
            }
        }
        let deadline = Instant::now() + timeout;
        loop {
            match self.shutdown_empty() {
                Ok(()) => return Ok(()),
                Err(Error::InvalidRequest) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(error),
            }
        }
    }
}
