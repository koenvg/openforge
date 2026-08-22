use std::sync::{Arc, Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;
use tokio::task::JoinHandle;

#[derive(Debug, Default)]
struct Activity {
    active_users: usize,
    generation: u64,
    clearing: bool,
}

/// Keeps an expensive resource warm between uses, then drops it after an idle timeout.
pub(crate) struct IdleResource<T> {
    value: RwLock<Option<T>>,
    activity: Mutex<Activity>,
    activity_changed: Condvar,
    reaper_changed: tokio::sync::Notify,
    idle_timeout: Duration,
}

impl<T> IdleResource<T> {
    pub(crate) fn new(idle_timeout: Duration) -> Self {
        Self {
            value: RwLock::new(None),
            activity: Mutex::new(Activity::default()),
            activity_changed: Condvar::new(),
            reaper_changed: tokio::sync::Notify::new(),
            idle_timeout,
        }
    }

    #[cfg(test)]
    pub(crate) fn acquire_or_try_init<E>(
        &self,
        initialize: impl FnOnce() -> Result<T, E>,
    ) -> Result<IdleResourceGuard<'_, T>, E> {
        self.acquire_or_try_replace(|_| true, initialize)
    }

    pub(crate) fn acquire_or_try_replace<E>(
        &self,
        should_reuse: impl Fn(&T) -> bool,
        initialize: impl FnOnce() -> Result<T, E>,
    ) -> Result<IdleResourceGuard<'_, T>, E> {
        self.begin_use();

        let value = self
            .value
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if value.as_ref().is_some_and(&should_reuse) {
            return Ok(IdleResourceGuard { owner: self, value });
        }
        drop(value);

        let mut value = self
            .value
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let needs_initialization = value
            .as_ref()
            .map(|loaded| !should_reuse(loaded))
            .unwrap_or(true);
        if needs_initialization {
            match initialize() {
                Ok(initialized) => *value = Some(initialized),
                Err(error) => {
                    drop(value);
                    self.finish_use();
                    return Err(error);
                }
            }
        }
        let value = RwLockWriteGuard::downgrade(value);
        Ok(IdleResourceGuard { owner: self, value })
    }

    pub(crate) fn clear(&self) -> bool {
        let activity = self.lock_activity();
        let mut activity = self
            .activity_changed
            .wait_while(activity, |state| state.clearing)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        activity.clearing = true;
        activity = self
            .activity_changed
            .wait_while(activity, |state| state.active_users > 0)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drop(activity);

        self.remove_value(|| {})
    }

    pub(crate) fn is_loaded(&self) -> bool {
        self.value
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }

    pub(crate) fn start_idle_reaper(
        self: &Arc<Self>,
        on_unload: impl Fn() + Send + Sync + 'static,
    ) -> JoinHandle<()>
    where
        T: Send + Sync + 'static,
    {
        let resource = Arc::clone(self);
        tokio::spawn(async move {
            resource.run_idle_reaper(on_unload).await;
        })
    }

    fn begin_use(&self) {
        let activity = self.lock_activity();
        let mut activity = self
            .activity_changed
            .wait_while(activity, |state| state.clearing)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        activity.active_users += 1;
        activity.generation = activity.generation.wrapping_add(1);
        drop(activity);
        self.reaper_changed.notify_one();
    }

    fn finish_use(&self) {
        let mut activity = self.lock_activity();
        debug_assert!(activity.active_users > 0);
        activity.active_users = activity.active_users.saturating_sub(1);
        activity.generation = activity.generation.wrapping_add(1);
        if activity.active_users == 0 {
            self.activity_changed.notify_all();
        }
        drop(activity);
        self.reaper_changed.notify_one();
    }

    fn finish_clear(&self) {
        let mut activity = self.lock_activity();
        activity.clearing = false;
        activity.generation = activity.generation.wrapping_add(1);
        self.activity_changed.notify_all();
        drop(activity);
        self.reaper_changed.notify_one();
    }

    fn remove_value(&self, on_remove: impl FnOnce()) -> bool {
        let removed = self
            .value
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
            .is_some();
        if removed {
            on_remove();
        }
        self.finish_clear();
        removed
    }

    fn idle_generation(&self) -> Option<u64> {
        let activity = self.lock_activity();
        if activity.active_users > 0 || activity.clearing || !self.is_loaded() {
            None
        } else {
            Some(activity.generation)
        }
    }

    fn unload_idle_generation(&self, expected_generation: u64, on_unload: impl Fn()) -> bool {
        let mut activity = self.lock_activity();
        if activity.active_users > 0
            || activity.clearing
            || activity.generation != expected_generation
        {
            return false;
        }
        activity.clearing = true;
        drop(activity);

        self.remove_value(on_unload)
    }

    async fn run_idle_reaper(&self, on_unload: impl Fn()) {
        loop {
            let changed = self.reaper_changed.notified();
            tokio::pin!(changed);

            let Some(generation) = self.idle_generation() else {
                changed.await;
                continue;
            };

            tokio::select! {
                _ = tokio::time::sleep(self.idle_timeout) => {
                    self.unload_idle_generation(generation, &on_unload);
                }
                _ = &mut changed => {}
            }
        }
    }

    fn lock_activity(&self) -> MutexGuard<'_, Activity> {
        self.activity
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) struct IdleResourceGuard<'a, T> {
    owner: &'a IdleResource<T>,
    value: RwLockReadGuard<'a, Option<T>>,
}

impl<T> IdleResourceGuard<'_, T> {
    pub(crate) fn get(&self) -> Option<&T> {
        self.value.as_ref()
    }
}

impl<T> Drop for IdleResourceGuard<'_, T> {
    fn drop(&mut self) {
        self.owner.finish_use();
    }
}

#[cfg(test)]
mod tests {
    use super::IdleResource;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Barrier,
    };
    use std::time::Duration;

    #[tokio::test]
    async fn consecutive_requests_stay_warm_then_reload_after_idle_timeout() {
        let loads = AtomicUsize::new(0);
        let resource = Arc::new(IdleResource::new(Duration::from_millis(20)));
        let reaper = resource.start_idle_reaper(|| {});

        for _ in 0..2 {
            let value = resource
                .acquire_or_try_init(|| {
                    loads.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, ()>("model")
                })
                .expect("load model");
            assert_eq!(value.get(), Some(&"model"));
        }

        assert_eq!(loads.load(Ordering::SeqCst), 1);
        tokio::time::timeout(Duration::from_secs(2), async {
            while resource.is_loaded() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("idle model should unload");

        let value = resource
            .acquire_or_try_init(|| {
                loads.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>("model")
            })
            .expect("reload model");
        assert_eq!(value.get(), Some(&"model"));
        assert_eq!(loads.load(Ordering::SeqCst), 2);

        reaper.abort();
    }

    #[test]
    fn requests_for_the_same_selection_can_overlap() {
        let resource = Arc::new(IdleResource::new(Duration::from_secs(60)));
        let first_request = resource
            .acquire_or_try_init(|| Ok::<_, ()>("model"))
            .expect("load model");
        let second_resource = Arc::clone(&resource);
        let (acquired_tx, acquired_rx) = mpsc::channel();

        let second_request = std::thread::spawn(move || {
            let value = second_resource
                .acquire_or_try_init(|| Ok::<_, ()>("unexpected reload"))
                .expect("reuse model");
            acquired_tx
                .send(value.get().copied())
                .expect("report second acquisition");
        });

        assert_eq!(
            acquired_rx.recv_timeout(Duration::from_millis(200)),
            Ok(Some("model"))
        );
        drop(first_request);
        second_request.join().expect("second request");
    }

    #[test]
    fn selection_change_during_load_replaces_stale_resource() {
        let resource: Arc<IdleResource<(&str, &str)>> =
            Arc::new(IdleResource::new(Duration::from_secs(60)));
        let load_started = Arc::new(Barrier::new(2));
        let finish_load = Arc::new(Barrier::new(2));

        let first_resource = Arc::clone(&resource);
        let first_load_started = Arc::clone(&load_started);
        let first_finish_load = Arc::clone(&finish_load);
        let first_request = std::thread::spawn(move || {
            let value = first_resource
                .acquire_or_try_replace(
                    |loaded| loaded.0 == "small",
                    || {
                        first_load_started.wait();
                        first_finish_load.wait();
                        Ok::<_, ()>(("small", "small context"))
                    },
                )
                .expect("load small model");
            assert_eq!(value.get().map(|loaded| loaded.1), Some("small context"));
        });

        load_started.wait();
        let second_resource = Arc::clone(&resource);
        let second_request = std::thread::spawn(move || {
            let value = second_resource
                .acquire_or_try_replace(
                    |loaded| loaded.0 == "large",
                    || Ok::<_, ()>(("large", "large context")),
                )
                .expect("load newly selected large model");
            assert_eq!(value.get().map(|loaded| loaded.1), Some("large context"));
        });

        finish_load.wait();
        first_request.join().expect("first request");
        second_request.join().expect("second request");

        let value = resource
            .acquire_or_try_replace(
                |loaded| loaded.0 == "large",
                || Ok::<_, ()>(("unexpected", "unexpected context")),
            )
            .expect("reuse large model");
        assert_eq!(value.get().map(|loaded| loaded.1), Some("large context"));
    }

    #[tokio::test]
    async fn active_request_prevents_idle_unload() {
        let resource = Arc::new(IdleResource::new(Duration::from_millis(20)));
        let reaper = resource.start_idle_reaper(|| {});
        let value = resource
            .acquire_or_try_init(|| Ok::<_, ()>("model"))
            .expect("load model");

        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(resource.is_loaded());

        drop(value);
        tokio::time::timeout(Duration::from_secs(2), async {
            while resource.is_loaded() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("model should unload after the active request finishes");

        reaper.abort();
    }
}
