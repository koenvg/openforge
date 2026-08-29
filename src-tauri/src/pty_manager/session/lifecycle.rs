mod buffer_snapshot;
mod diagnostics;
mod process_cleanup;

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex as StdMutex, Weak};

use log::warn;
use tokio::sync::Mutex;

use crate::terminal_model::TerminalModelSession;

use super::super::events::SharedRingBuffer;
use super::super::managed_process::ManagedProcessIdentity;
use super::super::ordered_writer::OrderedPtyWriter;
use super::super::pids::terminate_and_remove_managed_process;
use super::super::{PtyError, PtyManager};
use super::{ManagedRecovery, SessionOperation, SessionTarget, TerminalSessions};

#[cfg(test)]
pub(in super::super) use diagnostics::frozen_seconds;

pub(in super::super) type PtySessions = Arc<Mutex<HashMap<String, PtySession>>>;
pub(in super::super) type LastOutputTimes = Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>;
pub(in super::super) type PtyOutputBuffers = Arc<Mutex<HashMap<String, SharedRingBuffer>>>;
pub(in super::super) type AgentSpawnGenerations = Arc<Mutex<HashMap<String, u64>>>;

type LifecycleLockEntries = HashMap<String, Weak<Mutex<()>>>;

/// Keeps only weak map entries so the last operation or session owner evicts its key.
/// The synchronous registry mutex makes last-lease eviction atomic with lock lookup.
#[derive(Clone, Debug, Default)]
pub(in super::super) struct LifecycleLockRegistry {
    entries: Arc<StdMutex<LifecycleLockEntries>>,
}

impl LifecycleLockRegistry {
    pub(in super::super) fn lock_for(&self, session_key: &str) -> LifecycleLockLease {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let lifecycle_lock = entries
            .get(session_key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let lifecycle_lock = Arc::new(Mutex::new(()));
                entries.insert(session_key.to_string(), Arc::downgrade(&lifecycle_lock));
                lifecycle_lock
            });

        LifecycleLockLease {
            session_key: session_key.to_string(),
            lifecycle_lock,
            registry: self.clone(),
        }
    }

    #[cfg(test)]
    pub(in super::super) fn contains_key(&self, session_key: &str) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(session_key)
    }
}

#[derive(Clone, Debug)]
pub(in super::super) struct LifecycleLockLease {
    session_key: String,
    lifecycle_lock: Arc<Mutex<()>>,
    registry: LifecycleLockRegistry,
}

impl std::ops::Deref for LifecycleLockLease {
    type Target = Mutex<()>;

    fn deref(&self) -> &Self::Target {
        &self.lifecycle_lock
    }
}

impl Drop for LifecycleLockLease {
    fn drop(&mut self) {
        let mut entries = self
            .registry
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let lifecycle_lock = Arc::downgrade(&self.lifecycle_lock);
        let is_current_lock = entries
            .get(&self.session_key)
            .is_some_and(|current| current.ptr_eq(&lifecycle_lock));

        if is_current_lock && Arc::strong_count(&self.lifecycle_lock) == 1 {
            entries.remove(&self.session_key);
        }
    }
}

pub(in super::super) static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

pub(in super::super) enum PtySessionKind {
    Agent,
    Shell { task_id: String },
}

impl PtySessionKind {
    fn is_shell_for_task(&self, task_id: &str) -> bool {
        matches!(self, Self::Shell { task_id: shell_task_id } if shell_task_id == task_id)
    }

    fn task_id_for_session_key<'a>(&'a self, session_key: &'a str) -> &'a str {
        match self {
            Self::Agent => session_key,
            Self::Shell { task_id } => task_id,
        }
    }

    fn diagnostic_kind(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Shell { .. } => "shell",
        }
    }
}

pub(in super::super) struct PtySession {
    #[allow(dead_code)]
    pub(in super::super) child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    pub(in super::super) master: Arc<StdMutex<Box<dyn portable_pty::MasterPty + Send>>>,
    pub(in super::super) writer: Arc<OrderedPtyWriter>,
    pub(in super::super) instance_id: u64,
    pub(in super::super) kind: PtySessionKind,
    pub(in super::super) pid_file_name: String,
    pub(in super::super) terminal_model: Option<Arc<TerminalModelSession>>,
    pub(in super::super) managed_process: ManagedProcessIdentity,
}

pub(in super::super) enum PassiveExitOutcome {
    IgnoredStale,
    Finalized { process_succeeded: bool },
    CleanupFailed,
}

impl TerminalSessions {
    pub(in super::super) async fn finalize_exit(
        &self,
        session_key: &str,
        instance_id: u64,
        lifecycle_lock: &tokio::sync::Mutex<()>,
        pid_file: &std::path::Path,
        remove_output_buffer: bool,
    ) -> PassiveExitOutcome {
        if let Some(emit_exit) = self.finish_cleaning_exit(session_key, instance_id).await {
            return if emit_exit {
                PassiveExitOutcome::Finalized {
                    process_succeeded: false,
                }
            } else {
                PassiveExitOutcome::IgnoredStale
            };
        }
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let removed_session = {
            let mut sessions = self.sessions.lock().await;
            let matches_instance = sessions
                .get(session_key)
                .is_some_and(|session| session.instance_id == instance_id);
            matches_instance
                .then(|| sessions.remove(session_key))
                .flatten()
        };

        let Some(mut session) = removed_session else {
            return match self.finish_cleaning_exit(session_key, instance_id).await {
                Some(true) => PassiveExitOutcome::Finalized {
                    process_succeeded: false,
                },
                Some(false) | None => PassiveExitOutcome::IgnoredStale,
            };
        };
        if let Err(error) = terminate_and_remove_managed_process(
            &session.managed_process,
            pid_file,
            &format!("PTY EOF cleanup for {session_key}"),
        )
        .await
        {
            warn!("[PTY] Failed to finalize process tree for {session_key}: {error}");
            self.retain_managed_recovery(
                session_key,
                ManagedRecovery {
                    recovery_key: session_key.to_string(),
                    session,
                },
            )
            .await;
            self.last_output.lock().await.remove(session_key);
            if remove_output_buffer {
                self.output_buffers.lock().await.remove(session_key);
            }
            let mut attachment_hubs = self.attachment_hubs.lock().await;
            if attachment_hubs
                .get(session_key)
                .is_some_and(|hub| hub.instance_id() == instance_id)
            {
                attachment_hubs.remove(session_key);
            }
            return PassiveExitOutcome::CleanupFailed;
        }
        let process_succeeded = session
            .child
            .try_wait()
            .ok()
            .flatten()
            .is_some_and(|status| status.success());

        self.last_output.lock().await.remove(session_key);
        if remove_output_buffer {
            self.output_buffers.lock().await.remove(session_key);
        }
        let mut attachment_hubs = self.attachment_hubs.lock().await;
        if attachment_hubs
            .get(session_key)
            .is_some_and(|hub| hub.instance_id() == instance_id)
        {
            attachment_hubs.remove(session_key);
        }
        drop(attachment_hubs);
        PassiveExitOutcome::Finalized { process_succeeded }
    }
}

impl PtyManager {
    pub(in super::super) async fn lifecycle_lock_for(
        &self,
        session_key: &str,
    ) -> LifecycleLockLease {
        self.terminal_sessions.lifecycle_locks.lock_for(session_key)
    }

    pub async fn write_pty(&self, session_key: &str, data: &[u8]) -> Result<(), PtyError> {
        self.terminal_sessions
            .operate(
                SessionTarget::Current(session_key),
                SessionOperation::Write(data),
            )
            .await
            .map_err(|failure| failure.into_pty_error())?;

        Ok(())
    }

    /// Resizes the PTY for the given session key.
    ///
    /// # Arguments
    /// * `session_key` - Stable identifier for the current terminal session
    /// * `cols` - New terminal width in columns
    /// * `rows` - New terminal height in rows
    pub async fn resize_pty(
        &self,
        session_key: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), PtyError> {
        self.terminal_sessions
            .operate(
                SessionTarget::Current(session_key),
                SessionOperation::Resize {
                    columns: cols,
                    rows,
                },
            )
            .await
            .map_err(|failure| failure.into_pty_error())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lifecycle_lock_is_evicted_after_last_reference_drops() {
        let manager = PtyManager::new();
        let lifecycle_lock = manager.lifecycle_lock_for("finished-session").await;

        assert!(manager.lifecycle_locks.contains_key("finished-session"));

        drop(lifecycle_lock);

        assert!(!manager.lifecycle_locks.contains_key("finished-session"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn lifecycle_lock_stays_shared_while_a_waiting_operation_references_it() {
        let manager = PtyManager::new();
        let lifecycle_lock = manager.lifecycle_lock_for("contended-session").await;
        let lifecycle_guard = lifecycle_lock.lock().await;
        let (referenced_tx, referenced_rx) = tokio::sync::oneshot::channel();
        let (acquired_tx, acquired_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();

        let waiting_manager = manager.clone();
        let waiting_operation = tokio::spawn(async move {
            let lifecycle_lock = waiting_manager
                .lifecycle_lock_for("contended-session")
                .await;
            referenced_tx
                .send(())
                .expect("test should observe the waiting lock reference");
            let _lifecycle_guard = lifecycle_lock.lock().await;
            acquired_tx
                .send(())
                .expect("test should observe the acquired lifecycle lock");
            release_rx
                .await
                .expect("test should release the waiting operation");
        });

        referenced_rx
            .await
            .expect("waiting operation should reference the lifecycle lock");
        drop(lifecycle_guard);
        drop(lifecycle_lock);
        acquired_rx
            .await
            .expect("waiting operation should acquire the lifecycle lock");

        let concurrent_lock = manager.lifecycle_lock_for("contended-session").await;
        assert!(
            concurrent_lock.try_lock().is_err(),
            "a concurrent operation must reuse the mutex held by the waiting operation"
        );

        release_tx
            .send(())
            .expect("waiting operation should still be running");
        waiting_operation
            .await
            .expect("waiting operation should finish");
        drop(concurrent_lock);

        assert!(!manager.lifecycle_locks.contains_key("contended-session"));
    }
}
