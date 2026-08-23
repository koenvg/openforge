use crate::db;
use crate::pty_manager::PtyManager;
use log::{info, warn};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;

pub(crate) const COMPLETED_SESSION_IDLE_TIMEOUT_CONFIG_KEY: &str =
    "completed_session_idle_timeout_seconds";
const DEFAULT_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS: u64 = 600;
const MIN_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS: u64 = 1;
const MAX_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS: u64 = 7 * 24 * 60 * 60;

pub(crate) type CompletedSessionFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub(crate) trait CompletedSessionRuntime: Send + Sync {
    fn snapshot<'a>(&'a self, task_id: &'a str) -> CompletedSessionFuture<'a, Option<String>>;
    fn reclaim<'a>(&'a self, task_id: &'a str) -> CompletedSessionFuture<'a, Result<(), String>>;
}

struct PtyCompletedSessionRuntime {
    manager: PtyManager,
}

impl CompletedSessionRuntime for PtyCompletedSessionRuntime {
    fn snapshot<'a>(&'a self, task_id: &'a str) -> CompletedSessionFuture<'a, Option<String>> {
        Box::pin(async move { self.manager.get_pty_buffer(task_id).await })
    }

    fn reclaim<'a>(&'a self, task_id: &'a str) -> CompletedSessionFuture<'a, Result<(), String>> {
        Box::pin(async move {
            self.manager
                .reclaim_agent_pty(task_id)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

struct ScheduledReclaim {
    generation: u64,
    task: JoinHandle<()>,
}

#[derive(Clone)]
pub(crate) struct CompletedSessionReaper {
    db: Arc<Mutex<db::Database>>,
    runtime: Arc<dyn CompletedSessionRuntime>,
    idle_timeout_override: Option<Duration>,
    scheduled: Arc<tokio::sync::Mutex<HashMap<String, ScheduledReclaim>>>,
    operation_locks: Arc<tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    next_generation: Arc<AtomicU64>,
}

impl CompletedSessionReaper {
    pub(crate) fn new(db: Arc<Mutex<db::Database>>, manager: PtyManager) -> Self {
        Self::with_runtime(db, Arc::new(PtyCompletedSessionRuntime { manager }), None)
    }

    fn with_runtime(
        db: Arc<Mutex<db::Database>>,
        runtime: Arc<dyn CompletedSessionRuntime>,
        idle_timeout_override: Option<Duration>,
    ) -> Self {
        Self {
            db,
            runtime,
            idle_timeout_override,
            scheduled: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            operation_locks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    #[cfg(test)]
    fn with_idle_timeout<R>(
        db: Arc<Mutex<db::Database>>,
        runtime: Arc<R>,
        idle_timeout: Duration,
    ) -> Self
    where
        R: CompletedSessionRuntime + 'static,
    {
        Self::with_runtime(db, runtime, Some(idle_timeout))
    }

    pub(crate) async fn completed(&self, task_id: &str) {
        let operation_lock = self.operation_lock_for(task_id).await;
        let _operation_guard = operation_lock.lock().await;
        self.cancel_scheduled(task_id).await;
        self.persist_replay_if_completed(task_id).await;
        if self.task_keeps_agent_session_live(task_id) {
            return;
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let idle_timeout = self.idle_timeout();
        let task_id_owned = task_id.to_string();
        let reaper = self.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(idle_timeout).await;
            reaper.reclaim_if_current(task_id_owned, generation).await;
        });
        self.scheduled
            .lock()
            .await
            .insert(task_id.to_string(), ScheduledReclaim { generation, task });
    }

    pub(crate) async fn active(&self, task_id: &str) {
        let operation_lock = self.operation_lock_for(task_id).await;
        let _operation_guard = operation_lock.lock().await;
        self.cancel_scheduled(task_id).await;
    }

    async fn reclaim_if_current(&self, task_id: String, generation: u64) {
        let operation_lock = self.operation_lock_for(&task_id).await;
        let _operation_guard = operation_lock.lock().await;
        let is_current = {
            let mut scheduled = self.scheduled.lock().await;
            if scheduled
                .get(&task_id)
                .is_some_and(|scheduled| scheduled.generation == generation)
            {
                scheduled.remove(&task_id);
                true
            } else {
                false
            }
        };
        if !is_current {
            return;
        }

        if self.task_keeps_agent_session_live(&task_id) {
            return;
        }

        if !self.persist_replay_if_completed(&task_id).await {
            return;
        }

        match self.runtime.reclaim(&task_id).await {
            Ok(()) => info!(
                "[completed_session_reaper] Reclaimed completed Agent Session PTY for task {}",
                task_id
            ),
            Err(error) => warn!(
                "[completed_session_reaper] Failed to reclaim Agent Session PTY for task {}: {}",
                task_id, error
            ),
        }
    }

    fn task_keeps_agent_session_live(&self, task_id: &str) -> bool {
        let db = match self.db.lock() {
            Ok(db) => db,
            Err(error) => {
                warn!(
                    "[completed_session_reaper] Database lock failed while checking Task {}: {}",
                    task_id, error
                );
                return true;
            }
        };

        match db.get_task(task_id) {
            Ok(Some(task)) => task.status == "doing",
            Ok(None) => false,
            Err(error) => {
                warn!(
                    "[completed_session_reaper] Failed to load Task {} before PTY reclaim: {}",
                    task_id, error
                );
                true
            }
        }
    }

    async fn persist_replay_if_completed(&self, task_id: &str) -> bool {
        let replay = self.runtime.snapshot(task_id).await.unwrap_or_default();
        let persisted = match self.db.lock() {
            Ok(db) => db.save_completed_agent_terminal_replay(task_id, &replay),
            Err(error) => {
                warn!(
                    "[completed_session_reaper] Database lock failed for task {}: {}",
                    task_id, error
                );
                return false;
            }
        };
        match persisted {
            Ok(persisted) => persisted,
            Err(error) => {
                warn!(
                    "[completed_session_reaper] Failed to persist replay for task {}: {}",
                    task_id, error
                );
                false
            }
        }
    }

    async fn operation_lock_for(&self, task_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.operation_locks.lock().await;
        Arc::clone(
            locks
                .entry(task_id.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    async fn cancel_scheduled(&self, task_id: &str) {
        if let Some(scheduled) = self.scheduled.lock().await.remove(task_id) {
            scheduled.task.abort();
        }
    }

    fn idle_timeout(&self) -> Duration {
        if let Some(idle_timeout) = self.idle_timeout_override {
            return idle_timeout;
        }
        let configured = self
            .db
            .lock()
            .ok()
            .and_then(|db| {
                db.get_config(COMPLETED_SESSION_IDLE_TIMEOUT_CONFIG_KEY)
                    .ok()
            })
            .flatten()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS)
            .clamp(
                MIN_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS,
                MAX_COMPLETED_SESSION_IDLE_TIMEOUT_SECONDS,
            );
        Duration::from_secs(configured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct RecordingRuntime {
        reclaimed: Mutex<Vec<String>>,
    }

    impl CompletedSessionRuntime for RecordingRuntime {
        fn snapshot<'a>(&'a self, _task_id: &'a str) -> CompletedSessionFuture<'a, Option<String>> {
            Box::pin(async { Some("completed output\n".to_string()) })
        }

        fn reclaim<'a>(
            &'a self,
            task_id: &'a str,
        ) -> CompletedSessionFuture<'a, Result<(), String>> {
            Box::pin(async move {
                self.reclaimed
                    .lock()
                    .expect("recording runtime lock")
                    .push(task_id.to_string());
                Ok(())
            })
        }
    }

    fn completed_session_fixture(
        name: &str,
    ) -> (Arc<Mutex<db::Database>>, String, tempfile::TempDir) {
        let (database, temp_dir) = crate::db::test_helpers::make_test_db(name);
        let project = database
            .create_project("Idle Project", "/tmp/idle-project")
            .expect("create project");
        let task = database
            .create_task("Wait for follow-up", "doing", Some(&project.id), None, None)
            .expect("create task");
        database
            .create_agent_session(
                "session-idle",
                &task.id,
                None,
                "implementing",
                "completed",
                "pi",
            )
            .expect("create Agent Session");
        (Arc::new(Mutex::new(database)), task.id, temp_dir)
    }

    #[test]
    fn idle_timeout_uses_the_configured_global_value() {
        let (database, _temp_dir, path) = completed_session_fixture("completed_session_config");
        database
            .lock()
            .expect("database lock")
            .set_config(COMPLETED_SESSION_IDLE_TIMEOUT_CONFIG_KEY, "42")
            .expect("set idle timeout");
        let runtime = Arc::new(RecordingRuntime::default());
        let reaper = CompletedSessionReaper::with_runtime(Arc::clone(&database), runtime, None);

        assert_eq!(reaper.idle_timeout(), Duration::from_secs(42));

        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn completed_session_for_doing_task_remains_attachable_after_idle_timeout() {
        let (database, task_id, path) = completed_session_fixture("completed_session_doing_task");
        let runtime = Arc::new(RecordingRuntime::default());
        let reaper = CompletedSessionReaper::with_idle_timeout(
            Arc::clone(&database),
            Arc::clone(&runtime),
            Duration::from_millis(20),
        );

        reaper.completed(&task_id).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        assert!(
            runtime
                .reclaimed
                .lock()
                .expect("recording runtime lock")
                .is_empty(),
            "a doing Task must keep its completed Agent Session PTY attachable"
        );

        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn doing_task_completed_session_remains_available_to_companion_terminal() {
        let (database, task_id, path) =
            completed_session_fixture("completed_session_companion_attachment");
        database
            .lock()
            .expect("database lock")
            .save_completed_agent_terminal_replay(&task_id, "captured output")
            .expect("seed captured replay");
        let manager = PtyManager::new();
        let temp_dir = tempfile::tempdir().expect("temp directory");
        manager
            .spawn_companion_test_agent_pty(&task_id, temp_dir.path(), "sleep 5")
            .await
            .expect("spawn Agent Session PTY");
        let reaper = CompletedSessionReaper::with_runtime(
            Arc::clone(&database),
            Arc::new(PtyCompletedSessionRuntime {
                manager: manager.clone(),
            }),
            Some(Duration::from_millis(20)),
        );

        reaper.completed(&task_id).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task_id)
                .expect("load captured replay")
                .as_deref(),
            Some("captured output")
        );

        assert!(manager.agent_terminal_available(&task_id).await);
        manager
            .attach_agent_terminal(&task_id)
            .await
            .expect("attach Companion Terminal");

        manager.kill_pty(&task_id).await.expect("stop Agent PTY");
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn completed_session_for_done_task_is_reclaimed_after_its_idle_timeout() {
        let (database, task_id, path) = completed_session_fixture("completed_session_idle_reaper");
        let runtime = Arc::new(RecordingRuntime::default());
        let reaper = CompletedSessionReaper::with_idle_timeout(
            Arc::clone(&database),
            Arc::clone(&runtime),
            Duration::from_millis(20),
        );

        database
            .lock()
            .expect("database lock")
            .update_task_status(&task_id, "done")
            .expect("complete Task");

        reaper.completed(&task_id).await;
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if runtime
                    .reclaimed
                    .lock()
                    .expect("recording runtime lock")
                    .as_slice()
                    == [task_id.as_str()]
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("idle cleanup deadline");

        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task_id)
                .expect("load replay")
                .as_deref(),
            Some("completed output\n")
        );

        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn completion_persists_replay_before_idle_cleanup() {
        let (database, task_id, path) = completed_session_fixture("completed_session_replay");
        let runtime = Arc::new(RecordingRuntime::default());
        let reaper = CompletedSessionReaper::with_idle_timeout(
            Arc::clone(&database),
            Arc::clone(&runtime),
            Duration::from_secs(60),
        );

        database
            .lock()
            .expect("database lock")
            .update_task_status(&task_id, "done")
            .expect("complete Task");

        reaper.completed(&task_id).await;

        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task_id)
                .expect("load replay")
                .as_deref(),
            Some("completed output\n")
        );
        assert!(
            runtime
                .reclaimed
                .lock()
                .expect("recording runtime lock")
                .is_empty(),
            "completion must retain the PTY during the idle window"
        );

        reaper.active(&task_id).await;
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn renewed_activity_cancels_completed_session_cleanup() {
        let (database, task_id, path) = completed_session_fixture("completed_session_reactivated");
        let runtime = Arc::new(RecordingRuntime::default());
        let reaper = CompletedSessionReaper::with_idle_timeout(
            Arc::clone(&database),
            Arc::clone(&runtime),
            Duration::from_millis(20),
        );

        database
            .lock()
            .expect("database lock")
            .update_task_status(&task_id, "done")
            .expect("complete Task");

        reaper.completed(&task_id).await;
        {
            let db = database.lock().expect("database lock");
            db.update_agent_session("session-idle", "implementing", "running", None, None)
                .expect("reactivate Agent Session");
            db.update_task_status(&task_id, "doing")
                .expect("reactivate Task");
        }
        reaper.active(&task_id).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        assert!(
            runtime
                .reclaimed
                .lock()
                .expect("recording runtime lock")
                .is_empty(),
            "reactivated Agent Session must keep its PTY"
        );
        assert_eq!(
            database
                .lock()
                .expect("database lock")
                .get_latest_agent_terminal_replay(&task_id)
                .expect("load replay"),
            Some("completed output\n".to_string())
        );

        drop(database);
        let _ = std::fs::remove_file(path);
    }
}
