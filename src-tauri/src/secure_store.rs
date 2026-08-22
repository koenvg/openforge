use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

mod cache;
#[cfg(target_os = "macos")]
mod macos_keychain;

use cache::ProcessSecretCache;

const INTERACTIVE_KEYCHAIN_READ_TIMEOUT: Duration = Duration::from_secs(5 * 60);
pub(crate) const COMPANION_HOST_IDENTITY_SECRET: &str = "companion_host_identity";
const SECRET_STORE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(10);

fn process_secret_cache() -> &'static ProcessSecretCache {
    static PROCESS_SECRET_CACHE: OnceLock<ProcessSecretCache> = OnceLock::new();
    PROCESS_SECRET_CACHE.get_or_init(ProcessSecretCache::default)
}

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

fn async_keychain_access_lock() -> &'static Arc<tokio::sync::Mutex<()>> {
    static ASYNC_KEYCHAIN_ACCESS_LOCK: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
    ASYNC_KEYCHAIN_ACCESS_LOCK.get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
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
    with_serialized_keychain_access_cancellable_with_wait(cancellation, access, || {
        std::thread::sleep(SECRET_STORE_LOCK_POLL_INTERVAL);
    })
}

fn with_serialized_keychain_access_cancellable_with_wait<T, E>(
    cancellation: &SecretStoreCancellation,
    access: impl FnOnce() -> Result<T, E>,
    mut wait: impl FnMut(),
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
            Err(std::sync::TryLockError::WouldBlock) => wait(),
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

async fn spawn_blocking_secret_store_operation<T, F>(
    operation_name: &'static str,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let admission_guard = Arc::clone(async_keychain_access_lock()).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _admission_guard = admission_guard;
        operation()
    })
    .await
    .map_err(|error| format!("{operation_name} task failed: {error}"))?
}

pub async fn get_secret_async(key: &str) -> Result<Option<String>, String> {
    let key = key.to_string();
    spawn_blocking_secret_store_operation("Secret read", move || get_secret(&key)).await
}

pub async fn set_secret_async(key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return delete_secret_async(key).await;
    }
    let key = key.to_string();
    let value = value.to_string();
    spawn_blocking_secret_store_operation("Secret write", move || set_secret(&key, &value)).await
}

pub async fn delete_secret_async(key: &str) -> Result<(), String> {
    let key = key.to_string();
    spawn_blocking_secret_store_operation("Secret deletion", move || delete_secret(&key)).await
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    with_serialized_keychain_access(|| {
        process_secret_cache().get_or_read(key, || get_secret_native_unlocked(key))
    })
}

pub(crate) fn get_secret_with_cancellation(
    key: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<Option<String>, String> {
    with_serialized_keychain_access_cancellable(cancellation, || {
        process_secret_cache()
            .get_or_read(key, || get_secret_cancellable_unlocked(key, cancellation))
    })
}

#[cfg(target_os = "macos")]
fn get_secret_cancellable_unlocked(
    key: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<Option<String>, String> {
    macos_keychain::get_secret(key, cancellation, INTERACTIVE_KEYCHAIN_READ_TIMEOUT)
}

#[cfg(not(target_os = "macos"))]
fn get_secret_cancellable_unlocked(
    key: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<Option<String>, String> {
    if cancellation.is_cancelled() {
        return Err("Secret read was cancelled".to_string());
    }
    let result = get_secret_native_unlocked(key);
    if cancellation.is_cancelled() {
        return Err("Secret read was cancelled".to_string());
    }
    result
}

fn get_secret_native_unlocked(key: &str) -> Result<Option<String>, String> {
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
    with_serialized_keychain_access(|| {
        process_secret_cache().set_if_changed(key, value, || set_secret_unlocked(key, value))
    })
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
        process_secret_cache().set_if_changed(COMPANION_HOST_IDENTITY_SECRET, value, || {
            set_companion_host_identity_cancellable_unlocked(value, cancellation)
        })
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

pub(crate) fn run_keychain_helper_if_requested() -> Option<i32> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
    #[cfg(target_os = "macos")]
    {
        macos_keychain::run_helper_if_requested()
    }
}

fn delete_secret_unlocked(key: &str) -> Result<(), String> {
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
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    with_serialized_keychain_access(|| {
        process_secret_cache().delete_if_present(key, || delete_secret_unlocked(key))
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
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (retry_tx, retry_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = with_serialized_keychain_access_cancellable_with_wait(
                &worker_cancellation,
                || Ok::<(), String>(()),
                || {
                    waiting_tx.send(()).expect("report Keychain lock wait");
                    retry_rx.recv().expect("resume Keychain lock retry");
                },
            );
            result_tx.send(result).expect("report cancellation result");
        });

        let waiting = waiting_rx.recv_timeout(Duration::from_secs(5));
        cancellation.cancel();
        let retry = retry_tx.send(());
        let result = result_rx.recv_timeout(Duration::from_secs(5));
        drop(guard);
        let worker_result = worker.join();

        waiting.expect("worker must encounter the held Keychain lock");
        retry.expect("resume cancelled lock retry");
        worker_result.expect("cancellable Keychain lock worker");

        assert_eq!(
            result.expect("cancelled lock retry must finish without acquiring the held lock"),
            Err("Secret store operation was cancelled".to_string())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn blocking_secret_store_work_runs_off_the_tokio_worker() {
        let tokio_worker = std::thread::current().id();

        let credential_worker = spawn_blocking_secret_store_operation("test secret read", || {
            Ok::<_, String>(std::thread::current().id())
        })
        .await
        .expect("secret-store operation should succeed");

        assert_ne!(credential_worker, tokio_worker);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn async_secret_store_admission_is_held_until_blocking_work_finishes() {
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let operation = tokio::spawn(spawn_blocking_secret_store_operation(
            "test secret access",
            move || {
                let _ = started_tx.send(());
                release_rx.recv().expect("release blocking operation");
                Ok::<(), String>(())
            },
        ));

        started_rx.await.expect("blocking operation should start");

        let next_operation =
            spawn_blocking_secret_store_operation("next test secret access", || {
                Ok::<(), String>(())
            });
        tokio::pin!(next_operation);
        assert!(
            futures::poll!(next_operation.as_mut()).is_pending(),
            "async admission must remain held by blocking work"
        );

        release_tx.send(()).expect("release blocking operation");
        operation
            .await
            .expect("secret-store task should join")
            .expect("secret-store operation should succeed");

        next_operation
            .await
            .expect("async admission should be released after blocking work");
    }
}
