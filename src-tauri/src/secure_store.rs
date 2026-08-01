use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

#[cfg(target_os = "macos")]
use std::{
    io::{self, Read, Write},
    os::fd::AsRawFd,
    process::{Child, ChildStdout, Command, Stdio},
    time::Instant,
};

const KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5);
const INTERACTIVE_KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5 * 60);
#[cfg(target_os = "macos")]
const KEYCHAIN_PROCESS_GRACEFUL_TERMINATION_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(target_os = "macos")]
const KEYCHAIN_PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
const SECRET_STORE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(target_os = "macos")]
const KEYCHAIN_PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(target_os = "macos")]
const MAX_KEYCHAIN_OUTPUT_BYTES: usize = 1024 * 1024;
#[cfg(target_os = "macos")]
const MAX_KEYCHAIN_HELPER_INPUT_BYTES: u64 = 1024 * 1024;
#[cfg(target_os = "macos")]
const KEYCHAIN_WRITE_HELPER_ARG: &str = "--openforge-keychain-write-helper";

#[derive(Clone, Debug, Default)]
pub(crate) struct SecretStoreCancellation {
    cancelled: Arc<AtomicBool>,
}

impl SecretStoreCancellation {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug)]
pub(crate) enum SecretStoreWriteError {
    NotCommitted(String),
    CommitUnknown(String),
}

impl SecretStoreWriteError {
    pub(crate) fn commit_unknown(&self) -> bool {
        matches!(self, Self::CommitUnknown(_))
    }
}

impl From<String> for SecretStoreWriteError {
    fn from(error: String) -> Self {
        Self::NotCommitted(error)
    }
}

impl std::fmt::Display for SecretStoreWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotCommitted(error) | Self::CommitUnknown(error) => formatter.write_str(error),
        }
    }
}

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

fn with_serialized_keychain_access_cancellable<T, E>(
    cancellation: &SecretStoreCancellation,
    access: impl FnOnce() -> Result<T, E>,
) -> Result<T, E>
where
    E: From<String>,
{
    loop {
        if cancellation.is_cancelled() {
            return Err(E::from("Secret store operation was cancelled".to_string()));
        }
        match keychain_access_lock().try_lock() {
            Ok(_guard) => return access(),
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(SECRET_STORE_LOCK_POLL_INTERVAL);
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err(E::from("Keychain access lock was poisoned".to_string()));
            }
        }
    }
}

fn service_name() -> &'static str {
    crate::data_identity::keychain_service_name()
}

pub fn is_secret(key: &str) -> bool {
    crate::data_identity::is_secret_account(key)
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let cancellation = SecretStoreCancellation::default();
    with_serialized_keychain_access(|| {
        get_secret_unlocked(key, &cancellation, KEYCHAIN_READ_TIMEOUT)
    })
}

pub(crate) fn get_secret_with_cancellation(
    key: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<Option<String>, String> {
    with_serialized_keychain_access_cancellable(cancellation, || {
        get_secret_unlocked(key, cancellation, INTERACTIVE_KEYCHAIN_READ_TIMEOUT)
    })
}

#[cfg(target_os = "macos")]
fn get_secret_unlocked(
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

#[cfg(not(target_os = "macos"))]
fn get_secret_unlocked(
    key: &str,
    cancellation: &SecretStoreCancellation,
    _timeout: Duration,
) -> Result<Option<String>, String> {
    if cancellation.is_cancelled() {
        return Err("Secret read was cancelled".to_string());
    }
    let entry = keyring::Entry::new(service_name(), key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    let result = match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "Failed to get secret '{}' from keychain: {}",
            key, e
        )),
    };
    if cancellation.is_cancelled() {
        return Err("Secret read was cancelled".to_string());
    }
    result
}

#[cfg(all(target_os = "macos", test))]
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

#[cfg(target_os = "macos")]
fn run_command_with_timeout_cancellable(
    program: &str,
    args: &[&str],
    timeout: Duration,
    cancellation: &SecretStoreCancellation,
) -> Result<std::process::Output, String> {
    run_command_with_timeout_observing(program, args, timeout, cancellation, |_| {})
}

#[cfg(target_os = "macos")]
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

fn set_secret_unlocked(key: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service_name(), key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to store secret '{}' in keychain: {}", key, e))
}

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return delete_secret(key);
    }
    with_serialized_keychain_access(|| set_secret_unlocked(key, value))
}

pub(crate) fn set_secret_with_cancellation(
    key: &str,
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if value.is_empty() {
        if cancellation.is_cancelled() {
            return Err(SecretStoreWriteError::NotCommitted(
                "Secret store operation was cancelled".to_string(),
            ));
        }
        return delete_secret(key).map_err(SecretStoreWriteError::NotCommitted);
    }
    with_serialized_keychain_access_cancellable(cancellation, || {
        set_secret_cancellable_unlocked(key, value, cancellation)
    })
}

#[cfg(target_os = "macos")]
fn set_secret_cancellable_unlocked(
    key: &str,
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
        .arg(key)
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

#[cfg(not(target_os = "macos"))]
fn set_secret_cancellable_unlocked(
    key: &str,
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if cancellation.is_cancelled() {
        return Err(SecretStoreWriteError::NotCommitted(
            "Secret store operation was cancelled".to_string(),
        ));
    }
    set_secret_unlocked(key, value).map_err(SecretStoreWriteError::NotCommitted)
}

pub(crate) fn run_keychain_write_helper_if_requested() -> Option<i32> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
    #[cfg(target_os = "macos")]
    {
        let mut args = std::env::args();
        let _executable = args.next();
        if args.next().as_deref() != Some(KEYCHAIN_WRITE_HELPER_ARG) {
            return None;
        }
        let Some(key) = args.next() else {
            return Some(2);
        };
        if args.next().is_some() {
            return Some(2);
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
            .and_then(|value| set_secret_unlocked(&key, &value).map_err(|_| ()));
        Some(if result.is_ok() { 0 } else { 1 })
    }
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

    #[test]
    fn cancellable_keychain_access_does_not_wait_for_an_unrelated_lock_holder() {
        let guard = keychain_access_lock()
            .lock()
            .expect("Keychain access test lock");
        let cancellation = SecretStoreCancellation::default();
        let worker_cancellation = cancellation.clone();
        let worker = std::thread::spawn(move || {
            with_serialized_keychain_access_cancellable(&worker_cancellation, || {
                Ok::<(), String>(())
            })
        });
        std::thread::sleep(Duration::from_millis(25));

        let started_at = std::time::Instant::now();
        cancellation.cancel();
        let result = worker.join().expect("cancellable Keychain lock worker");

        assert_eq!(
            result.expect_err("lock wait must be cancelled"),
            "Secret store operation was cancelled"
        );
        assert!(started_at.elapsed() < Duration::from_millis(100));
        drop(guard);
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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
