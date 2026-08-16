use std::{collections::HashMap, sync::Mutex};

/// Process-lifetime secret cache. The mutex stays held across a platform operation so
/// concurrent cache misses collapse into one Keychain request.
#[derive(Debug, Default)]
pub(super) struct ProcessSecretCache {
    values: Mutex<HashMap<String, Option<String>>>,
}

impl ProcessSecretCache {
    pub(super) fn get_or_read(
        &self,
        key: &str,
        read: impl FnOnce() -> Result<Option<String>, String>,
    ) -> Result<Option<String>, String> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| "Secret cache lock was poisoned".to_string())?;
        if let Some(value) = values.get(key) {
            return Ok(value.clone());
        }

        let value = read()?;
        values.insert(key.to_string(), value.clone());
        Ok(value)
    }

    pub(super) fn set_if_changed<E>(
        &self,
        key: &str,
        value: &str,
        write: impl FnOnce() -> Result<(), E>,
    ) -> Result<(), E>
    where
        E: From<String>,
    {
        let mut values = self
            .values
            .lock()
            .map_err(|_| E::from("Secret cache lock was poisoned".to_string()))?;
        if values
            .get(key)
            .is_some_and(|cached| cached.as_deref() == Some(value))
        {
            return Ok(());
        }

        if let Err(error) = write() {
            values.remove(key);
            return Err(error);
        }
        values.insert(key.to_string(), Some(value.to_string()));
        Ok(())
    }

    pub(super) fn delete_if_present(
        &self,
        key: &str,
        delete: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| "Secret cache lock was poisoned".to_string())?;
        if values.get(key).is_some_and(Option::is_none) {
            return Ok(());
        }

        if let Err(error) = delete() {
            values.remove(key);
            return Err(error);
        }
        values.insert(key.to_string(), None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Barrier,
        },
        time::Duration,
    };

    #[test]
    fn reads_each_secret_once() {
        let cache = ProcessSecretCache::default();
        let reads = AtomicUsize::new(0);

        let first = cache
            .get_or_read("github_token", || {
                reads.fetch_add(1, Ordering::SeqCst);
                Ok(Some("ghp_cached".to_string()))
            })
            .expect("first read should succeed");
        let second = cache
            .get_or_read("github_token", || {
                reads.fetch_add(1, Ordering::SeqCst);
                Ok(Some("ghp_changed".to_string()))
            })
            .expect("cached read should succeed");

        assert_eq!(first.as_deref(), Some("ghp_cached"));
        assert_eq!(second.as_deref(), Some("ghp_cached"));
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn retries_secret_reads_after_a_failure() {
        let cache = ProcessSecretCache::default();
        let reads = AtomicUsize::new(0);

        let failed = cache.get_or_read("github_token", || {
            reads.fetch_add(1, Ordering::SeqCst);
            Err("Keychain was locked".to_string())
        });
        let retried = cache
            .get_or_read("github_token", || {
                reads.fetch_add(1, Ordering::SeqCst);
                Ok(Some("ghp_retried".to_string()))
            })
            .expect("retry should succeed");

        assert_eq!(failed, Err("Keychain was locked".to_string()));
        assert_eq!(retried.as_deref(), Some("ghp_retried"));
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn skips_unchanged_secret_writes() {
        let cache = ProcessSecretCache::default();
        cache
            .get_or_read("github_token", || Ok(Some("ghp_cached".to_string())))
            .expect("initial read should succeed");
        let writes = AtomicUsize::new(0);

        cache
            .set_if_changed("github_token", "ghp_cached", || {
                writes.fetch_add(1, Ordering::SeqCst);
                Ok::<(), String>(())
            })
            .expect("unchanged write should succeed");

        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn skips_deleting_an_absent_secret() {
        let cache = ProcessSecretCache::default();
        cache
            .get_or_read("github_token", || Ok(None))
            .expect("missing read should succeed");
        let deletes = AtomicUsize::new(0);

        cache
            .delete_if_present("github_token", || {
                deletes.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .expect("redundant delete should succeed");

        assert_eq!(deletes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn reloads_after_a_failed_secret_write() {
        let cache = ProcessSecretCache::default();
        cache
            .get_or_read("github_token", || Ok(Some("ghp_old".to_string())))
            .expect("initial read should succeed");

        let write_result = cache.set_if_changed("github_token", "ghp_new", || {
            Err("Keychain write outcome is unknown".to_string())
        });
        let reloaded = cache
            .get_or_read("github_token", || {
                Ok(Some("ghp_keychain_value".to_string()))
            })
            .expect("read after failed write should retry Keychain");

        assert_eq!(
            write_result,
            Err("Keychain write outcome is unknown".to_string())
        );
        assert_eq!(reloaded.as_deref(), Some("ghp_keychain_value"));
    }

    #[test]
    fn reloads_after_a_failed_secret_delete() {
        let cache = ProcessSecretCache::default();
        cache
            .get_or_read("github_token", || Ok(Some("ghp_old".to_string())))
            .expect("initial read should succeed");

        let delete_result = cache.delete_if_present("github_token", || {
            Err("Keychain delete outcome is unknown".to_string())
        });
        let reloaded = cache
            .get_or_read("github_token", || Ok(None))
            .expect("read after failed delete should retry Keychain");

        assert_eq!(
            delete_result,
            Err("Keychain delete outcome is unknown".to_string())
        );
        assert_eq!(reloaded, None);
    }

    #[test]
    fn concurrent_misses_share_one_secret_read() {
        let cache = Arc::new(ProcessSecretCache::default());
        let reads = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(3));
        let threads = (0..2)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let reads = Arc::clone(&reads);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    cache.get_or_read("github_token", || {
                        reads.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(25));
                        Ok(Some("ghp_shared".to_string()))
                    })
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        for thread in threads {
            let value = thread
                .join()
                .expect("cache reader thread")
                .expect("secret read should succeed");
            assert_eq!(value.as_deref(), Some("ghp_shared"));
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }
}
