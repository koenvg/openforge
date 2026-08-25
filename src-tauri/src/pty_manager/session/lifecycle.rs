use super::super::authority::{QueryResponseOwner, TerminalAuthorityContract};
use crate::terminal_model::ShadowTerminalSession;
use log::{error, info};
use portable_pty::PtySize;
use std::collections::{HashMap, HashSet};
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use tokio::sync::Mutex;

use super::super::events::SharedRingBuffer;
use super::super::managed_process::{
    terminate_managed_process_tree_with_root_reaper, ManagedProcessIdentity, RootReapMode,
};
use super::super::ordered_writer::OrderedPtyWriter;
use super::super::pids::{
    terminate_and_remove_managed_process, write_managed_process_identity,
    MANAGED_PROCESS_TERM_TIMEOUT,
};
use super::super::{PtyBufferState, PtyError, PtyManager, PtyProcessDiagnosticSession};

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

// ============================================================================
// PTY Session
// ============================================================================

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
    pub(in super::super) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(in super::super) writer: OrderedPtyWriter,
    pub(in super::super) instance_id: u64,
    pub(in super::super) authority: TerminalAuthorityContract,
    pub(in super::super) kind: PtySessionKind,
    pub(in super::super) pid_file_name: String,
    pub(in super::super) shadow_model: Option<ShadowTerminalSession>,
    pub(in super::super) managed_process: ManagedProcessIdentity,
}

impl PtyManager {
    pub(super) async fn terminate_session_process(
        &self,
        session_key: &str,
        session: &mut PtySession,
    ) -> Result<(), PtyError> {
        let pid_file = self.get_pid_dir()?.join(&session.pid_file_name);
        terminate_and_remove_managed_process(
            &session.managed_process,
            &pid_file,
            &format!("PTY cleanup for {session_key}"),
        )
        .await?;
        let _ = session.child.try_wait();
        Ok(())
    }

    pub(super) async fn terminate_unregistered_session(
        &self,
        session_key: &str,
        session: &mut PtySession,
    ) -> Result<(), PtyError> {
        terminate_managed_process_tree_with_root_reaper(
            &session.managed_process,
            MANAGED_PROCESS_TERM_TIMEOUT,
            |mode| match mode {
                RootReapMode::Poll => {
                    let _ = session.child.try_wait();
                }
                RootReapMode::Wait => {
                    let _ = session.child.wait();
                }
            },
        )
        .await
        .map_err(|error| {
            PtyError::CleanupFailed(format!(
                "unregistered PTY cleanup for {session_key}: {error}"
            ))
        })?;
        Ok(())
    }

    pub(super) async fn terminate_or_retain_unregistered_session(
        &self,
        session_key: &str,
        mut session: PtySession,
    ) -> Result<(), PtyError> {
        if let Err(error) = self
            .terminate_unregistered_session(session_key, &mut session)
            .await
        {
            if let Err(preservation_error) = self
                .retain_failed_unregistered_cleanup(session_key, session)
                .await
            {
                return Err(PtyError::CleanupFailed(format!(
                    "{error}; {preservation_error}"
                )));
            }
            return Err(error);
        }

        Ok(())
    }
    pub(super) async fn retain_failed_unregistered_cleanup(
        &self,
        base_key: &str,
        mut session: PtySession,
    ) -> Result<(), PtyError> {
        let recovery_key = format!("{base_key}-cleanup-{}", session.instance_id);
        let recovery_pid_file_name = format!("{recovery_key}-pty.pid");
        let metadata_error = match self.get_pid_dir() {
            Ok(pid_dir) => std::fs::create_dir_all(&pid_dir)
                .and_then(|_| {
                    write_managed_process_identity(
                        &pid_dir.join(&recovery_pid_file_name),
                        &session.managed_process,
                    )
                    .map_err(io::Error::other)
                })
                .err()
                .map(|error| error.to_string()),
            Err(error) => Some(error.to_string()),
        };
        if let Some(error) = &metadata_error {
            error!(
                "Failed to preserve recovery metadata for {}: {}",
                recovery_key, error
            );
        }

        session.pid_file_name = recovery_pid_file_name;
        self.sessions
            .lock()
            .await
            .insert(recovery_key.clone(), session);

        if let Some(error) = metadata_error {
            return Err(PtyError::CleanupFailed(format!(
                "failed to preserve recovery metadata for {recovery_key}: {error}"
            )));
        }

        Ok(())
    }

    pub(in super::super) async fn lifecycle_lock_for(
        &self,
        session_key: &str,
    ) -> LifecycleLockLease {
        self.lifecycle_locks.lock_for(session_key)
    }

    pub(super) async fn clear_session_tracking(&self, session_key: &str) {
        self.last_output.lock().await.remove(session_key);
        self.output_buffers.lock().await.remove(session_key);
        self.attachment_hubs.lock().await.remove(session_key);
    }

    pub async fn write_pty(&self, task_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().await;

        let session = sessions
            .get_mut(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        session
            .writer
            .write_user_input(task_id, session.instance_id, data)
            .map_err(|error| PtyError::WriteFailed(error.to_string()))?;

        Ok(())
    }

    pub async fn write_terminal_query_response(
        &self,
        session_key: &str,
        instance_id: u64,
        data: &[u8],
    ) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(session_key)
            .ok_or_else(|| PtyError::ProcessNotFound(session_key.to_string()))?;
        if session.authority.query_response_owner != QueryResponseOwner::Xterm {
            return Err(PtyError::WriteFailed(
                "xterm is not the terminal query-response authority".to_string(),
            ));
        }
        if session.instance_id != instance_id {
            return Err(PtyError::WriteFailed(format!(
                "stale PTY instance {instance_id} for {session_key}; current instance is {}",
                session.instance_id
            )));
        }

        session
            .writer
            .write_xterm_query_response(session_key, instance_id, data)
            .map_err(|error| PtyError::WriteFailed(error.to_string()))
    }

    /// Resizes the PTY for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `cols` - New terminal width in columns
    /// * `rows` - New terminal height in rows
    pub async fn resize_pty(&self, task_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        session
            .master
            .resize(size)
            .map_err(|e| PtyError::IoError(io::Error::other(e.to_string())))?;

        if let Some(shadow_model) = &session.shadow_model {
            shadow_model.resize(cols, rows);
        }
        Ok(())
    }

    /// Stops a completed Agent Session PTY while retaining its replay buffer.
    pub async fn reclaim_agent_pty(&self, task_id: &str) -> Result<(), PtyError> {
        self.agent_spawn_generations.lock().await.remove(task_id);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let session = self.sessions.lock().await.remove(task_id);
        let Some(mut session) = session else {
            return Ok(());
        };
        if !matches!(session.kind, PtySessionKind::Agent) {
            self.sessions
                .lock()
                .await
                .insert(task_id.to_string(), session);
            return Err(PtyError::ProcessNotFound(task_id.to_string()));
        }

        info!(
            "Reclaiming completed Agent Session PTY for task {}",
            task_id
        );
        if let Err(error) = self.terminate_session_process(task_id, &mut session).await {
            self.sessions
                .lock()
                .await
                .entry(task_id.to_string())
                .or_insert(session);
            return Err(error);
        }
        self.last_output.lock().await.remove(task_id);
        info!("Completed Agent Session PTY for task {} reclaimed", task_id);
        Ok(())
    }

    /// Kills the PTY process for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn kill_pty(&self, task_id: &str) -> Result<(), PtyError> {
        self.agent_spawn_generations.lock().await.remove(task_id);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let session = self.sessions.lock().await.remove(task_id);
        if let Some(mut session) = session {
            info!("Killing PTY for task {}", task_id);
            if let Err(error) = self.terminate_session_process(task_id, &mut session).await {
                self.sessions
                    .lock()
                    .await
                    .entry(task_id.to_string())
                    .or_insert(session);
                return Err(error);
            }
            info!("PTY for task {} killed", task_id);
        }
        self.clear_session_tracking(task_id).await;

        Ok(())
    }

    pub async fn kill_shells_for_task(&self, task_id: &str) -> Result<(), PtyError> {
        let mut keys_to_kill: HashSet<String> = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_key, session)| session.kind.is_shell_for_task(task_id))
                .map(|(key, _session)| key.clone())
                .collect()
        };
        keys_to_kill.extend(
            self.pending_shell_spawns
                .iter()
                .filter(|entry| entry.value().0.as_str() == task_id)
                .map(|entry| entry.key().clone()),
        );

        let mut failures = Vec::new();
        for key in keys_to_kill {
            self.agent_spawn_generations.lock().await.remove(&key);
            let lifecycle_lock = self.lifecycle_lock_for(&key).await;
            let _lifecycle_guard = lifecycle_lock.lock().await;
            let session = self.sessions.lock().await.remove(&key);
            let Some(mut session) = session else {
                continue;
            };
            info!("Killing shell PTY for key {}", key);
            if let Err(error) = self.terminate_session_process(&key, &mut session).await {
                self.sessions
                    .lock()
                    .await
                    .entry(key.clone())
                    .or_insert(session);
                failures.push(error.to_string());
                continue;
            }
            self.clear_session_tracking(&key).await;
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(PtyError::CleanupFailed(failures.join("; ")))
        }
    }

    /// Kills all running PTY processes
    pub async fn kill_all(&self) {
        let mut session_keys: HashSet<String> =
            self.sessions.lock().await.keys().cloned().collect();
        session_keys.extend(
            self.pending_shell_spawns
                .iter()
                .map(|entry| entry.key().clone()),
        );
        session_keys.extend(self.agent_spawn_generations.lock().await.keys().cloned());

        let cleanup_results =
            futures::future::join_all(session_keys.into_iter().map(|session_key| {
                let manager = self.clone();
                async move {
                    let result = manager.kill_pty(&session_key).await;
                    (session_key, result)
                }
            }))
            .await;

        for (session_key, result) in cleanup_results {
            if let Err(error) = result {
                error!("Failed to kill PTY for task {}: {}", session_key, error);
            }
        }
    }

    pub async fn interrupt_claude(&self, task_id: &str) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let pid = session
            .child
            .process_id()
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        unsafe {
            libc::kill(pid as i32, libc::SIGINT);
        }

        Ok(())
    }

    pub async fn check_claude_frozen(&self, task_id: &str) -> Option<u64> {
        let pid = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(task_id)?;
            session.child.process_id()?
        };

        let is_alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        if !is_alive {
            return None;
        }

        let times = self.last_output.lock().await;
        let last_output_ms = times.get(task_id)?.load(Ordering::Relaxed);

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;

        frozen_seconds(last_output_ms, now_ms)
    }

    /// Returns the keys of all active PTY sessions.
    pub async fn get_session_keys(&self) -> Vec<String> {
        let sessions = self.sessions.lock().await;
        sessions.keys().cloned().collect()
    }

    /// Returns a read-only snapshot of live PTY roots for diagnostics.
    pub async fn process_diagnostic_sessions(&self) -> Vec<PtyProcessDiagnosticSession> {
        let sessions = self.sessions.lock().await;
        let mut diagnostics: Vec<PtyProcessDiagnosticSession> = sessions
            .iter()
            .map(|(session_key, session)| PtyProcessDiagnosticSession {
                session_key: session_key.clone(),
                task_id: session
                    .kind
                    .task_id_for_session_key(session_key)
                    .to_string(),
                session_kind: session.kind.diagnostic_kind().to_string(),
                pid: session.child.process_id(),
                pty_instance_id: session.instance_id,
                pid_file_name: session.pid_file_name.clone(),
            })
            .collect();
        diagnostics.sort_by(|left, right| {
            left.task_id
                .cmp(&right.task_id)
                .then_with(|| left.session_key.cmp(&right.session_key))
                .then_with(|| left.pty_instance_id.cmp(&right.pty_instance_id))
        });
        diagnostics
    }

    pub async fn pty_buffer_state(&self, task_id: &str) -> PtyBufferState {
        let instance_id = self
            .sessions
            .lock()
            .await
            .get(task_id)
            .map(|session| session.instance_id);
        PtyBufferState {
            buffer: self.get_pty_buffer(task_id).await,
            is_live: instance_id.is_some(),
            instance_id,
        }
    }

    pub async fn get_pty_buffer(&self, task_id: &str) -> Option<String> {
        let buffers = self.output_buffers.lock().await;
        let buffer = buffers.get(task_id)?;
        let buf = buffer.lock().unwrap();
        let content = buf.snapshot();
        if content.is_empty() {
            None
        } else {
            Some(content)
        }
    }
}

// ============================================================================
// Freeze Detection
// ============================================================================

pub(in super::super) fn frozen_seconds(last_output_ms: u64, now_ms: u64) -> Option<u64> {
    if last_output_ms == 0 {
        return None;
    }
    let elapsed_secs = now_ms.saturating_sub(last_output_ms) / 1000;
    if elapsed_secs >= 15 {
        Some(elapsed_secs)
    } else {
        None
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
