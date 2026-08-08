use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

#[cfg(target_os = "macos")]
mod macos_keychain;

const KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5);
const INTERACTIVE_KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5 * 60);
pub(crate) const COMPANION_HOST_IDENTITY_SECRET: &str = "companion_host_identity";
const SECRET_STORE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

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
    macos_keychain::get_secret(key, cancellation, timeout)
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

pub(crate) fn set_companion_host_identity_with_cancellation(
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if value.is_empty() {
        if cancellation.is_cancelled() {
            return Err(SecretStoreWriteError::NotCommitted(
                "Secret store operation was cancelled".to_string(),
            ));
        }
        return delete_secret(COMPANION_HOST_IDENTITY_SECRET)
            .map_err(SecretStoreWriteError::NotCommitted);
    }
    with_serialized_keychain_access_cancellable(cancellation, || {
        set_companion_host_identity_cancellable_unlocked(value, cancellation)
    })
}

#[cfg(target_os = "macos")]
fn set_companion_host_identity_cancellable_unlocked(
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    macos_keychain::set_companion_host_identity_with_cancellation(value, cancellation)
}
#[cfg(not(target_os = "macos"))]
fn set_companion_host_identity_cancellable_unlocked(
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if cancellation.is_cancelled() {
        return Err(SecretStoreWriteError::NotCommitted(
            "Secret store operation was cancelled".to_string(),
        ));
    }
    set_secret_unlocked(COMPANION_HOST_IDENTITY_SECRET, value)
        .map_err(SecretStoreWriteError::NotCommitted)
}

pub(crate) fn run_keychain_write_helper_if_requested() -> Option<i32> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
    #[cfg(target_os = "macos")]
    {
        macos_keychain::run_write_helper_if_requested()
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
}
