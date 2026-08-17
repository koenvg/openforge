#[cfg(unix)]
pub(super) fn send_terminate_signal(pid: u32) -> Result<(), String> {
    let raw_pid = i32::try_from(pid).map_err(|_| format!("invalid pid: {pid}"))?;
    let result = unsafe {
        // SAFETY: sending a signal to a PID obtained from `tokio::process::Child::id`.
        libc::kill(raw_pid, libc::SIGTERM)
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
pub(super) fn send_terminate_signal(pid: u32) -> Result<(), String> {
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status()
        .map_err(|error| format!("failed to terminate process {pid}: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| format!("taskkill failed for PID {pid}"))
}

#[cfg(unix)]
pub(super) fn force_kill_process(pid: u32) -> Result<(), String> {
    let raw_pid = i32::try_from(pid).map_err(|_| format!("invalid pid: {pid}"))?;
    let result = unsafe {
        // SAFETY: sending a signal to a PID obtained from `tokio::process::Child::id`.
        libc::kill(raw_pid, libc::SIGKILL)
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
pub(super) fn force_kill_process(pid: u32) -> Result<(), String> {
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status()
        .map_err(|error| format!("failed to force kill process {pid}: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| format!("taskkill /F failed for PID {pid}"))
}

#[cfg(unix)]
pub(super) fn exit_status_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;

    status.signal()
}

#[cfg(not(unix))]
pub(super) fn exit_status_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    #[test]
    fn rejects_process_ids_outside_the_platform_signal_range() {
        let invalid_pid = u32::MAX;

        assert_eq!(
            send_terminate_signal(invalid_pid),
            Err(format!("invalid pid: {invalid_pid}"))
        );
        assert_eq!(
            force_kill_process(invalid_pid),
            Err(format!("invalid pid: {invalid_pid}"))
        );
    }

    #[test]
    fn extracts_the_terminating_signal_from_an_exit_status() {
        let status = std::process::ExitStatus::from_raw(libc::SIGTERM);

        assert_eq!(exit_status_signal(&status), Some(libc::SIGTERM));
    }
}
