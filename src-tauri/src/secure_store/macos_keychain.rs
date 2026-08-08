//! macOS Keychain subprocess supervision and write-helper protocol.

use super::{
    service_name, set_secret_unlocked, SecretStoreCancellation, SecretStoreWriteError,
    COMPANION_HOST_IDENTITY_SECRET, INTERACTIVE_KEYCHAIN_READ_TIMEOUT,
};
use std::{
    io::{self, Read, Write},
    os::fd::AsRawFd,
    process::{Child, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

const KEYCHAIN_PROCESS_GRACEFUL_TERMINATION_TIMEOUT: Duration = Duration::from_millis(500);
const KEYCHAIN_PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
const KEYCHAIN_PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_KEYCHAIN_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_KEYCHAIN_HELPER_INPUT_BYTES: u64 = 1024 * 1024;
const KEYCHAIN_WRITE_HELPER_ARG: &str = "--openforge-keychain-write-helper";

pub(super) fn get_secret(
    key: &str,
    cancellation: &SecretStoreCancellation,
    timeout: Duration,
) -> Result<Option<String>, String> {
    let output = run_command_with_timeout_cancellable(
        "/usr/bin/security",
        &[
            "find-generic-password",
            "-w",
            "-s",
            service_name(),
            "-a",
            key,
        ],
        timeout,
        cancellation,
    )?;
    decode_security_find_result(
        key,
        output.status.success(),
        output.status.code(),
        &output.stdout,
    )
}

#[cfg(test)]
fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    run_command_with_timeout_cancellable(
        program,
        args,
        timeout,
        &SecretStoreCancellation::default(),
    )
}

fn run_command_with_timeout_cancellable(
    program: &str,
    args: &[&str],
    timeout: Duration,
    cancellation: &SecretStoreCancellation,
) -> Result<std::process::Output, String> {
    run_command_with_timeout_observing(program, args, timeout, cancellation, |_| {})
}

fn run_command_with_timeout_observing(
    program: &str,
    args: &[&str],
    timeout: Duration,
    cancellation: &SecretStoreCancellation,
    on_spawn: impl FnOnce(u32),
) -> Result<std::process::Output, String> {
    if cancellation.is_cancelled() {
        return Err("Cancelled reading secret from macOS Keychain".to_string());
    }
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start macOS Keychain reader: {error}"))?;
    on_spawn(child.id());
    let deadline = Instant::now() + timeout;
    let mut stdout_pipe = match child.stdout.take() {
        Some(pipe) => pipe,
        None => {
            let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
            return Err(format!(
                "macOS Keychain reader output was unavailable{cleanup_suffix}"
            ));
        }
    };
    if let Err(error) = set_nonblocking(&stdout_pipe) {
        let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
        return Err(format!("{error}{cleanup_suffix}"));
    }

    let mut status = None;
    let mut stdout = Vec::new();
    loop {
        if cancellation.is_cancelled() {
            let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
            return Err(format!(
                "Cancelled reading secret from macOS Keychain{cleanup_suffix}"
            ));
        }
        let stdout_closed =
            match read_available_keychain_stdout(&mut stdout_pipe, &mut stdout, deadline) {
                Ok(KeychainStdoutRead::Closed) => true,
                Ok(KeychainStdoutRead::Pending) => false,
                Ok(KeychainStdoutRead::DeadlineExceeded) => {
                    let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
                    return Err(format!(
                        "Timed out reading secret from macOS Keychain after {}s{cleanup_suffix}",
                        timeout.as_secs_f64()
                    ));
                }
                Err(error) => {
                    let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
                    return Err(format!("{error}{cleanup_suffix}"));
                }
            };

        if status.is_none() {
            match child.try_wait() {
                Ok(observed_status) => status = observed_status,
                Err(error) => {
                    let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
                    return Err(format!(
                        "Failed to wait for macOS Keychain reader: {error}{cleanup_suffix}"
                    ));
                }
            }
        }

        if let Some(status) = status {
            if stdout_closed {
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr: Vec::new(),
                });
            }
        }

        if Instant::now() >= deadline {
            let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
            return Err(format!(
                "Timed out reading secret from macOS Keychain after {}s{cleanup_suffix}",
                timeout.as_secs_f64()
            ));
        }
        std::thread::sleep(KEYCHAIN_PROCESS_POLL_INTERVAL);
    }
}

fn set_nonblocking(stdout: &ChildStdout) -> Result<(), String> {
    let descriptor = stdout.as_raw_fd();
    // SAFETY: `descriptor` is owned by the live `ChildStdout`; F_GETFL only reads its flags.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags == -1 {
        return Err(format!(
            "Failed to inspect macOS Keychain output pipe: {}",
            io::Error::last_os_error()
        ));
    }
    // SAFETY: `descriptor` remains valid for this call and preserves all existing flags.
    if unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(format!(
            "Failed to make macOS Keychain output nonblocking: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

enum KeychainStdoutRead {
    Closed,
    Pending,
    DeadlineExceeded,
}

fn read_available_keychain_stdout(
    stdout_pipe: &mut ChildStdout,
    stdout: &mut Vec<u8>,
    deadline: Instant,
) -> Result<KeychainStdoutRead, String> {
    read_available_keychain_stdout_with_clock(stdout_pipe, stdout, deadline, Instant::now)
}

fn read_available_keychain_stdout_with_clock(
    reader: &mut impl Read,
    stdout: &mut Vec<u8>,
    deadline: Instant,
    mut now: impl FnMut() -> Instant,
) -> Result<KeychainStdoutRead, String> {
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        if now() >= deadline {
            return Ok(KeychainStdoutRead::DeadlineExceeded);
        }
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(KeychainStdoutRead::Closed),
            Ok(read) => {
                stdout.extend_from_slice(&buffer[..read]);
                if now() >= deadline {
                    return Ok(KeychainStdoutRead::DeadlineExceeded);
                }
                if stdout.len() > MAX_KEYCHAIN_OUTPUT_BYTES {
                    return Err("macOS Keychain output exceeded the safe size limit".to_string());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                return Ok(KeychainStdoutRead::Pending);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                return Err(format!("Failed to read macOS Keychain output: {error}"));
            }
        }
    }
}

fn keychain_cleanup_suffix(cleanup: Result<(), String>) -> String {
    cleanup
        .err()
        .map(|error| format!("; cleanup failed: {error}"))
        .unwrap_or_default()
}

fn terminate_and_reap(child: &mut Child) -> Result<(), String> {
    let cleanup_deadline = Instant::now() + KEYCHAIN_PROCESS_CLEANUP_TIMEOUT;

    // `try_wait` both observes and reaps an exited child. Raw signaling is safe only
    // after `Ok(None)` proves this handle still owns an unreaped child process.
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                if Instant::now() >= cleanup_deadline {
                    return Err(
                        "timed out inspecting macOS Keychain helper before termination".to_string(),
                    );
                }
            }
            Err(error) if error.raw_os_error() == Some(libc::ECHILD) => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "failed to inspect macOS Keychain helper before termination: {error}"
                ));
            }
        }
    }

    let child_pid = libc::pid_t::try_from(child.id())
        .map_err(|_| "macOS Keychain helper PID was out of range".to_string())?;
    // SAFETY: `try_wait` returned `Ok(None)`. If the child exits before this call,
    // its PID stays reserved as a zombie until this handle successfully reaps it.
    let terminate_result = unsafe { libc::kill(child_pid, libc::SIGTERM) };
    if terminate_result == -1 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!(
                "failed to terminate macOS Keychain helper gracefully: {error}"
            ));
        }
    }

    let graceful_deadline = Instant::now() + KEYCHAIN_PROCESS_GRACEFUL_TERMINATION_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                if Instant::now() >= graceful_deadline {
                    break;
                }
                std::thread::sleep(KEYCHAIN_PROCESS_POLL_INTERVAL);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                if Instant::now() >= cleanup_deadline {
                    return Err(
                        "timed out reaping interrupted macOS Keychain helper after graceful termination"
                            .to_string(),
                    );
                }
            }
            Err(error) if error.raw_os_error() == Some(libc::ECHILD) => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "failed to reap macOS Keychain helper after graceful termination: {error}"
                ));
            }
        }
    }

    match child.kill() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to force-terminate macOS Keychain helper: {error}"
            ));
        }
    }

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                if Instant::now() >= cleanup_deadline {
                    return Err("timed out reaping macOS Keychain helper".to_string());
                }
                std::thread::sleep(KEYCHAIN_PROCESS_POLL_INTERVAL);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                if Instant::now() >= cleanup_deadline {
                    return Err(
                        "timed out reaping interrupted macOS Keychain helper after forced termination"
                            .to_string(),
                    );
                }
            }
            Err(error) if error.raw_os_error() == Some(libc::ECHILD) => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "failed to reap macOS Keychain helper after forced termination: {error}"
                ));
            }
        }
    }
}

fn decode_security_find_result(
    key: &str,
    success: bool,
    status_code: Option<i32>,
    stdout: &[u8],
) -> Result<Option<String>, String> {
    if success {
        let value = std::str::from_utf8(stdout)
            .map_err(|error| format!("Secret '{key}' is not valid UTF-8: {error}"))?;
        let value = value.strip_suffix('\n').unwrap_or(value);
        return Ok(Some(value.to_string()));
    }
    if status_code == Some(44) {
        return Ok(None);
    }

    Err(format!(
        "Failed to get secret '{key}' from macOS Keychain (status {})",
        status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
    ))
}

pub(super) fn set_companion_host_identity_with_cancellation(
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if value.len() as u64 > MAX_KEYCHAIN_HELPER_INPUT_BYTES {
        return Err(SecretStoreWriteError::NotCommitted(
            "Secret exceeded the safe Keychain helper input limit".to_string(),
        ));
    }
    let executable = std::env::current_exe().map_err(|error| {
        SecretStoreWriteError::NotCommitted(format!(
            "Failed to locate macOS Keychain helper: {error}"
        ))
    })?;
    let mut child = Command::new(executable)
        .arg(KEYCHAIN_WRITE_HELPER_ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            SecretStoreWriteError::NotCommitted(format!(
                "Failed to start macOS Keychain writer: {error}"
            ))
        })?;
    let Some(mut stdin) = child.stdin.take() else {
        let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
        return Err(SecretStoreWriteError::NotCommitted(format!(
            "macOS Keychain writer input was unavailable{cleanup_suffix}"
        )));
    };
    if let Err(error) = stdin.write_all(value.as_bytes()) {
        drop(stdin);
        let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
        return Err(SecretStoreWriteError::CommitUnknown(format!(
            "Failed to send secret to macOS Keychain writer: {error}{cleanup_suffix}"
        )));
    }
    drop(stdin);

    let deadline = Instant::now() + INTERACTIVE_KEYCHAIN_READ_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(SecretStoreWriteError::CommitUnknown(format!(
                    "Failed to store secret in macOS Keychain (status {})",
                    status
                        .code()
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                )));
            }
            Ok(None) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
                return Err(SecretStoreWriteError::CommitUnknown(format!(
                    "Failed to wait for macOS Keychain writer: {error}{cleanup_suffix}"
                )));
            }
        }
        if cancellation.is_cancelled() {
            let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
            return Err(SecretStoreWriteError::CommitUnknown(format!(
                "Cancelled writing secret to macOS Keychain{cleanup_suffix}"
            )));
        }
        if Instant::now() >= deadline {
            let cleanup_suffix = keychain_cleanup_suffix(terminate_and_reap(&mut child));
            return Err(SecretStoreWriteError::CommitUnknown(format!(
                "Timed out writing secret to macOS Keychain after {}s{cleanup_suffix}",
                INTERACTIVE_KEYCHAIN_READ_TIMEOUT.as_secs_f64()
            )));
        }
        std::thread::sleep(KEYCHAIN_PROCESS_POLL_INTERVAL);
    }
}

fn keychain_write_helper_requested(args: impl IntoIterator<Item = String>) -> Result<bool, ()> {
    let mut args = args.into_iter();
    let _executable = args.next();
    if args.next().as_deref() != Some(KEYCHAIN_WRITE_HELPER_ARG) {
        return Ok(false);
    }
    if args.next().is_some() {
        return Err(());
    }
    Ok(true)
}

pub(super) fn run_write_helper_if_requested() -> Option<i32> {
    match keychain_write_helper_requested(std::env::args()) {
        Ok(false) => return None,
        Err(()) => return Some(2),
        Ok(true) => {}
    }
    let mut value = Vec::new();
    let read_result = std::io::stdin()
        .take(MAX_KEYCHAIN_HELPER_INPUT_BYTES + 1)
        .read_to_end(&mut value);
    let result = read_result
        .map_err(|_| ())
        .and_then(|_| {
            if value.len() as u64 > MAX_KEYCHAIN_HELPER_INPUT_BYTES {
                return Err(());
            }
            String::from_utf8(value).map_err(|_| ())
        })
        .and_then(|value| {
            set_secret_unlocked(COMPANION_HOST_IDENTITY_SECRET, &value).map_err(|_| ())
        });
    Some(if result.is_ok() { 0 } else { 1 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_store::KEYCHAIN_READ_TIMEOUT;
    use std::sync::mpsc;

    #[test]
    fn security_cli_result_preserves_secret_bytes_and_handles_missing_items() {
        let found = decode_security_find_result(
            "companion_host_identity",
            true,
            Some(0),
            b"identity-json\r\n",
        )
        .expect("successful security output");
        assert_eq!(found, Some("identity-json\r".to_string()));

        let missing = decode_security_find_result("missing", false, Some(44), b"")
            .expect("missing Keychain item");
        assert_eq!(missing, None);
    }

    #[test]
    fn security_cli_failure_diagnostics_do_not_include_command_output() {
        let output = run_command_with_timeout(
            "/bin/sh",
            &[
                "-c",
                "printf 'secret from stdout'; printf 'secret from stderr' >&2; exit 7",
            ],
            Duration::from_secs(1),
        )
        .expect("failed command should still return its status");
        assert_eq!(output.stdout, b"secret from stdout");
        assert!(output.stderr.is_empty());

        let error = decode_security_find_result(
            "companion_host_identity",
            output.status.success(),
            output.status.code(),
            &output.stdout,
        )
        .expect_err("failed security command");

        assert_eq!(
            error,
            "Failed to get secret 'companion_host_identity' from macOS Keychain (status 7)"
        );
        assert!(!error.contains("secret from stdout"));
        assert!(!error.contains("secret from stderr"));
    }

    #[test]
    fn security_cli_output_read_obeys_deadline_after_parent_exit() {
        let started_at = std::time::Instant::now();
        let error = run_command_with_timeout(
            "/bin/sh",
            &["-c", "(exec /bin/sleep 0.3) & exit 0"],
            Duration::from_millis(100),
        )
        .expect_err("inherited output pipe must not escape the deadline");

        assert_eq!(
            error,
            "Timed out reading secret from macOS Keychain after 0.1s"
        );
        assert!(started_at.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn keychain_stdout_drain_stops_at_deadline_while_data_remains_readable() {
        let started_at = std::time::Instant::now();
        let deadline = started_at + Duration::from_secs(1);
        let after_deadline = deadline + Duration::from_secs(1);
        let mut clock_checks = 0;
        let mut reader = std::io::Cursor::new(vec![0_u8; 16 * 1024]);
        let mut stdout = Vec::new();

        let state =
            read_available_keychain_stdout_with_clock(&mut reader, &mut stdout, deadline, || {
                clock_checks += 1;
                if clock_checks == 1 {
                    started_at
                } else {
                    after_deadline
                }
            })
            .expect("drain result");

        assert!(matches!(state, KeychainStdoutRead::DeadlineExceeded));
        assert_eq!(stdout.len(), 8 * 1024);
        assert_eq!(reader.position(), (8 * 1024) as u64);
    }

    #[test]
    fn security_cli_timeout_terminates_a_stuck_reader() {
        let started_at = std::time::Instant::now();
        let mut child_pid = None;
        let error = run_command_with_timeout_observing(
            "/bin/sleep",
            &["30"],
            Duration::from_millis(100),
            &SecretStoreCancellation::default(),
            |pid| child_pid = Some(pid),
        )
        .expect_err("stuck reader must time out");

        assert_eq!(
            error,
            "Timed out reading secret from macOS Keychain after 0.1s"
        );
        assert!(started_at.elapsed() < Duration::from_secs(1));
        let process_probe = std::process::Command::new("/bin/kill")
            .args(["-0", &child_pid.expect("stuck reader PID").to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("probe stuck reader process");
        assert!(!process_probe.success(), "timed-out reader was not reaped");
    }

    #[test]
    fn security_cli_timeout_force_kills_and_reaps_a_term_ignoring_helper() {
        let started_at = std::time::Instant::now();
        let error = run_command_with_timeout(
            "/bin/sh",
            &["-c", "trap '' TERM; exec /bin/sleep 30"],
            Duration::from_millis(100),
        )
        .expect_err("TERM-ignoring helper must time out");

        assert_eq!(
            error,
            "Timed out reading secret from macOS Keychain after 0.1s"
        );
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "forced helper cleanup must stay inside the cleanup budget"
        );
    }

    #[test]
    fn security_cli_cancellation_terminates_and_reaps_the_helper() {
        let cancellation = SecretStoreCancellation::default();
        let helper_cancellation = cancellation.clone();
        let (spawned_tx, spawned_rx) = mpsc::channel();
        let started_at = std::time::Instant::now();
        let helper = std::thread::spawn(move || {
            run_command_with_timeout_observing(
                "/bin/sleep",
                &["30"],
                Duration::from_secs(30),
                &helper_cancellation,
                |pid| spawned_tx.send(pid).expect("helper PID receiver"),
            )
        });
        spawned_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Keychain helper must start");

        cancellation.cancel();
        let error = helper
            .join()
            .expect("Keychain helper thread")
            .expect_err("cancelled helper must not succeed");

        assert_eq!(error, "Cancelled reading secret from macOS Keychain");
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "cancellation must not consume the interactive authorization budget"
        );
    }

    #[test]
    fn keychain_write_helper_rejects_account_override() {
        let requested = keychain_write_helper_requested(
            ["openforge", KEYCHAIN_WRITE_HELPER_ARG].map(str::to_string),
        );
        assert_eq!(requested, Ok(true));

        let overridden = keychain_write_helper_requested(
            ["openforge", KEYCHAIN_WRITE_HELPER_ARG, "github_token"].map(str::to_string),
        );
        assert_eq!(overridden, Err(()));
    }

    #[test]
    fn keychain_read_budget_allows_interactive_authorization() {
        assert!(
            INTERACTIVE_KEYCHAIN_READ_TIMEOUT >= Duration::from_secs(60),
            "interactive Keychain approval must not retain the old five-second budget"
        );
        assert_eq!(
            KEYCHAIN_READ_TIMEOUT,
            Duration::from_secs(5),
            "ordinary secret reads must keep the bounded non-interactive policy"
        );
    }

    #[test]
    fn security_cli_timeout_requests_graceful_helper_termination() {
        let marker = std::env::temp_dir().join(format!(
            "openforge-keychain-helper-terminated-{}",
            uuid::Uuid::new_v4()
        ));
        let script = format!(
            "trap 'printf terminated > {} ; exit 0' TERM; while :; do sleep 0.02; done",
            marker.display()
        );

        let error =
            run_command_with_timeout("/bin/sh", &["-c", &script], Duration::from_millis(100))
                .expect_err("stuck helper must time out");

        assert!(error.starts_with("Timed out reading secret from macOS Keychain"));
        assert_eq!(
            std::fs::read_to_string(&marker).ok().as_deref(),
            Some("terminated"),
            "Keychain helper must receive graceful termination before any forced kill"
        );
        let _ = std::fs::remove_file(marker);
    }
}
