use std::sync::{Mutex, OnceLock};

#[cfg(target_os = "macos")]
use std::{
    io::{self, Read},
    os::fd::AsRawFd,
    process::{Child, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
const KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(target_os = "macos")]
const KEYCHAIN_PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
#[cfg(target_os = "macos")]
const KEYCHAIN_PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(target_os = "macos")]
const MAX_KEYCHAIN_OUTPUT_BYTES: usize = 1024 * 1024;

fn keychain_access_lock() -> &'static Mutex<()> {
    static KEYCHAIN_ACCESS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    KEYCHAIN_ACCESS_LOCK.get_or_init(|| Mutex::new(()))
}

fn with_serialized_keychain_access<T>(
    access: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = keychain_access_lock()
        .lock()
        .map_err(|_| "Keychain access lock was poisoned".to_string())?;
    access()
}

fn service_name() -> &'static str {
    crate::data_identity::keychain_service_name()
}

pub fn is_secret(key: &str) -> bool {
    crate::data_identity::is_secret_account(key)
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    with_serialized_keychain_access(|| get_secret_unlocked(key))
}

#[cfg(target_os = "macos")]
fn get_secret_unlocked(key: &str) -> Result<Option<String>, String> {
    let output = run_command_with_timeout(
        "/usr/bin/security",
        &[
            "find-generic-password",
            "-w",
            "-s",
            service_name(),
            "-a",
            key,
        ],
        KEYCHAIN_READ_TIMEOUT,
    )?;
    decode_security_find_result(
        key,
        output.status.success(),
        output.status.code(),
        &output.stdout,
    )
}

#[cfg(not(target_os = "macos"))]
fn get_secret_unlocked(key: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(service_name(), key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "Failed to get secret '{}' from keychain: {}",
            key, e
        )),
    }
}

#[cfg(target_os = "macos")]
fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    run_command_with_timeout_observing(program, args, timeout, |_| {})
}

#[cfg(target_os = "macos")]
fn run_command_with_timeout_observing(
    program: &str,
    args: &[&str],
    timeout: Duration,
    on_spawn: impl FnOnce(u32),
) -> Result<std::process::Output, String> {
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

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
enum KeychainStdoutRead {
    Closed,
    Pending,
    DeadlineExceeded,
}

#[cfg(target_os = "macos")]
fn read_available_keychain_stdout(
    stdout_pipe: &mut ChildStdout,
    stdout: &mut Vec<u8>,
    deadline: Instant,
) -> Result<KeychainStdoutRead, String> {
    read_available_keychain_stdout_with_clock(stdout_pipe, stdout, deadline, Instant::now)
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn keychain_cleanup_suffix(cleanup: Result<(), String>) -> String {
    cleanup
        .err()
        .map(|error| format!("; cleanup failed: {error}"))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn terminate_and_reap(child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + KEYCHAIN_PROCESS_CLEANUP_TIMEOUT;
    loop {
        match child.kill() {
            Ok(()) => break,
            Err(error) if error.kind() == io::ErrorKind::InvalidInput => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                if Instant::now() >= deadline {
                    return Err(format!(
                        "timed out terminating macOS Keychain reader: {error}"
                    ));
                }
            }
            Err(error) => {
                return Err(format!(
                    "failed to terminate macOS Keychain reader: {error}"
                ));
            }
        }
    }

    loop {
        let wait_error = match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => None,
            Err(error) => Some(error),
        };
        if Instant::now() >= deadline {
            return Err(match wait_error {
                Some(error) => {
                    format!("timed out reaping macOS Keychain reader after wait error: {error}")
                }
                None => "timed out reaping macOS Keychain reader".to_string(),
            });
        }
        std::thread::sleep(KEYCHAIN_PROCESS_POLL_INTERVAL);
    }
}

#[cfg(target_os = "macos")]
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

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return delete_secret(key);
    }
    with_serialized_keychain_access(|| {
        let entry = keyring::Entry::new(service_name(), key)
            .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
        entry
            .set_password(value)
            .map_err(|e| format!("Failed to store secret '{}' in keychain: {}", key, e))
    })
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    with_serialized_keychain_access(|| {
        let entry = keyring::Entry::new(service_name(), key)
            .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!(
                "Failed to delete secret '{}' from keychain: {}",
                key, e
            )),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::time::Duration;

    fn test_key(suffix: &str) -> String {
        format!("test_openforge_{}_pid{}", suffix, std::process::id())
    }

    fn keychain_test_mutex() -> &'static Mutex<()> {
        static KEYCHAIN_TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
        KEYCHAIN_TEST_MUTEX.get_or_init(|| Mutex::new(()))
    }

    fn run_keychain_test<T>(test: impl FnOnce() -> T) -> T {
        let _guard = keychain_test_mutex()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        test()
    }

    fn keychain_available() -> bool {
        static KEYCHAIN_AVAILABLE: OnceLock<bool> = OnceLock::new();
        let available = *KEYCHAIN_AVAILABLE.get_or_init(|| {
            let key = format!(
                "{}_thread_{:?}",
                test_key("probe"),
                std::thread::current().id()
            );
            let (tx, rx) = mpsc::channel();

            std::thread::spawn(move || {
                let result = set_secret(&key, "probe").and_then(|()| get_secret(&key));
                let _ = delete_secret(&key);
                let available = matches!(result, Ok(Some(ref value)) if value == "probe");
                let _ = tx.send(available);
            });

            rx.recv_timeout(Duration::from_secs(7)).unwrap_or(false)
        });
        assert!(
            available || std::env::var_os("OPENFORGE_REQUIRE_KEYCHAIN_TESTS").is_none(),
            "platform Keychain integration is required but unavailable"
        );
        available
    }

    #[test]
    fn test_service_name_is_dev_in_debug_mode() {
        assert_eq!(service_name(), "openforge-dev");
    }

    #[test]
    fn test_is_secret() {
        assert!(is_secret("github_token"));
        assert!(!is_secret("companion_host_identity"));
        assert!(!is_secret("github_username"));
        assert!(!is_secret("external_base_url"));
        assert!(!is_secret("external_username"));
        assert!(!is_secret(""));
    }

    #[test]
    fn test_set_and_get_secret() {
        run_keychain_test(|| {
            if !keychain_available() {
                return;
            }

            let key = test_key("set_get");
            let _ = delete_secret(&key);

            set_secret(&key, "super_secret_value_abc123").expect("set_secret should succeed");
            let retrieved = get_secret(&key).expect("get_secret should succeed");
            assert_eq!(retrieved, Some("super_secret_value_abc123".to_string()));

            delete_secret(&key).expect("cleanup should succeed");
        });
    }

    #[test]
    fn test_get_nonexistent_secret() {
        run_keychain_test(|| {
            if !keychain_available() {
                return;
            }

            let key = test_key("nonexistent");
            let _ = delete_secret(&key);

            let result = get_secret(&key).expect("get_secret should succeed for nonexistent key");
            assert_eq!(result, None);
        });
    }

    #[test]
    fn test_delete_secret() {
        run_keychain_test(|| {
            if !keychain_available() {
                return;
            }

            let key = test_key("delete");
            set_secret(&key, "value_to_delete").expect("set_secret should succeed");

            let retrieved = get_secret(&key).expect("get_secret should succeed");
            assert!(retrieved.is_some());

            delete_secret(&key).expect("delete_secret should succeed");

            let retrieved = get_secret(&key).expect("get_secret should succeed after delete");
            assert_eq!(retrieved, None);
        });
    }

    #[test]
    fn test_set_empty_deletes() {
        run_keychain_test(|| {
            if !keychain_available() {
                return;
            }

            let key = test_key("empty_deletes");
            set_secret(&key, "initial_value").expect("set_secret should succeed");

            set_secret(&key, "").expect("set_secret with empty should succeed");

            let retrieved = get_secret(&key).expect("get_secret should succeed after empty set");
            assert_eq!(retrieved, None);

            let _ = delete_secret(&key);
        });
    }

    #[test]
    fn test_delete_nonexistent_is_ok() {
        run_keychain_test(|| {
            if !keychain_available() {
                return;
            }

            let key = test_key("delete_nonexistent");
            let _ = delete_secret(&key);

            let result = delete_secret(&key);
            assert!(
                result.is_ok(),
                "delete_secret on nonexistent key should be Ok, got: {:?}",
                result
            );
        });
    }

    #[test]
    fn keychain_access_is_serialized_across_threads() {
        let active = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let max_active = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let threads = (0..2)
            .map(|_| {
                let active = std::sync::Arc::clone(&active);
                let max_active = std::sync::Arc::clone(&max_active);
                let barrier = std::sync::Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    with_serialized_keychain_access(|| {
                        let current = active.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                        max_active.fetch_max(current, std::sync::atomic::Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(25));
                        active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(())
                    })
                    .expect("serialized keychain access");
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        for thread in threads {
            thread.join().expect("keychain test thread");
        }

        assert_eq!(max_active.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
    #[test]
    fn security_cli_timeout_terminates_a_stuck_reader() {
        let started_at = std::time::Instant::now();
        let mut child_pid = None;
        let error = run_command_with_timeout_observing(
            "/bin/sleep",
            &["30"],
            Duration::from_millis(100),
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
}
