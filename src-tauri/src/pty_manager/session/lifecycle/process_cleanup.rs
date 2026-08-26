use std::collections::HashSet;
use std::io;

use log::{error, info, warn};

use super::super::super::managed_process::{
    terminate_managed_process_tree_with_root_reaper, RootReapMode,
};
use super::super::super::pids::{
    terminate_and_remove_managed_process, write_managed_process_identity,
    MANAGED_PROCESS_TERM_TIMEOUT,
};
use super::super::super::{PtyError, PtyManager};
use super::super::ManagedRecovery;
use super::{PtySession, PtySessionKind};

impl PtyManager {
    pub(in super::super) async fn terminate_session_process(
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

    pub(in super::super) async fn terminate_current_session_process(
        &self,
        session_key: &str,
        session: &mut PtySession,
        emit_exit: bool,
    ) -> Result<(), PtyError> {
        self.terminal_sessions
            .begin_cleaning(session_key, session, emit_exit)
            .await;
        let instance_id = session.instance_id;
        let result = self.terminate_session_process(session_key, session).await;
        self.terminal_sessions
            .complete_cleaning(session_key, instance_id)
            .await;
        result
    }

    pub(in super::super) async fn retain_failed_current_cleanup(
        &self,
        session_key: &str,
        session: PtySession,
    ) {
        self.terminal_sessions
            .retain_managed_recovery(
                session_key,
                ManagedRecovery {
                    recovery_key: session_key.to_string(),
                    session,
                },
            )
            .await;
    }

    pub(in super::super) async fn terminate_unregistered_session(
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

    pub(in super::super) async fn terminate_or_retain_unregistered_session(
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

    pub(in super::super) async fn retain_failed_unregistered_cleanup(
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
        self.terminal_sessions
            .retain_managed_recovery(
                base_key,
                ManagedRecovery {
                    recovery_key: recovery_key.clone(),
                    session,
                },
            )
            .await;

        if let Some(error) = metadata_error {
            return Err(PtyError::CleanupFailed(format!(
                "failed to preserve recovery metadata for {recovery_key}: {error}"
            )));
        }

        Ok(())
    }

    async fn terminate_managed_recoveries(&self, session_key: &str) -> Result<(), PtyError> {
        let recoveries = self
            .terminal_sessions
            .take_managed_recoveries(session_key)
            .await;
        let mut failures = Vec::new();
        for mut recovery in recoveries {
            if let Err(error) = self
                .terminate_session_process(&recovery.recovery_key, &mut recovery.session)
                .await
            {
                failures.push(error.to_string());
                self.terminal_sessions
                    .restore_managed_recovery(session_key, recovery)
                    .await;
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(PtyError::CleanupFailed(failures.join("; ")))
        }
    }

    pub(in super::super) async fn clear_session_tracking(&self, session_key: &str) {
        self.terminal_sessions
            .last_output
            .lock()
            .await
            .remove(session_key);
        self.terminal_sessions
            .output_buffers
            .lock()
            .await
            .remove(session_key);
        self.terminal_sessions
            .attachment_hubs
            .lock()
            .await
            .remove(session_key);
    }

    /// Stops a completed Agent Session PTY while retaining its replay buffer.
    pub async fn reclaim_agent_pty(&self, task_id: &str) -> Result<(), PtyError> {
        self.terminal_sessions
            .agent_spawn_generations
            .lock()
            .await
            .remove(task_id);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let session = self.terminal_sessions.sessions.lock().await.remove(task_id);
        let Some(mut session) = session else {
            return Ok(());
        };
        if !matches!(session.kind, PtySessionKind::Agent) {
            self.terminal_sessions
                .sessions
                .lock()
                .await
                .insert(task_id.to_string(), session);
            return Err(PtyError::ProcessNotFound(task_id.to_string()));
        }

        info!(
            "Reclaiming completed Agent Session PTY for task {}",
            task_id
        );
        if let Err(error) = self
            .terminate_current_session_process(task_id, &mut session, true)
            .await
        {
            self.retain_failed_current_cleanup(task_id, session).await;
            return Err(error);
        }
        self.terminal_sessions
            .last_output
            .lock()
            .await
            .remove(task_id);
        info!("Completed Agent Session PTY for task {} reclaimed", task_id);
        Ok(())
    }

    pub(in super::super) async fn terminate_failed_terminal_model(
        &self,
        session_key: &str,
        instance_id: u64,
    ) -> Result<(), PtyError> {
        let lifecycle_lock = self.lifecycle_lock_for(session_key).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let session = {
            let mut sessions = self.terminal_sessions.sessions.lock().await;
            let is_affected_session = sessions
                .get(session_key)
                .is_some_and(|session| session.instance_id == instance_id);
            is_affected_session
                .then(|| sessions.remove(session_key))
                .flatten()
        };
        let Some(mut session) = session else {
            return Ok(());
        };

        warn!(
            "[terminal-model] key={} instance={} terminating PTY after authoritative model failure",
            session_key, instance_id
        );
        if let Err(error) = self
            .terminate_current_session_process(session_key, &mut session, true)
            .await
        {
            self.retain_failed_current_cleanup(session_key, session)
                .await;
            return Err(error);
        }
        self.clear_session_tracking(session_key).await;
        Ok(())
    }

    /// Kills the PTY process for the given session key.
    ///
    /// # Arguments
    /// * `session_key` - Stable identifier for the current terminal session
    pub async fn kill_pty(&self, session_key: &str) -> Result<(), PtyError> {
        self.terminal_sessions
            .agent_spawn_generations
            .lock()
            .await
            .remove(session_key);
        let lifecycle_lock = self.lifecycle_lock_for(session_key).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let session = self
            .terminal_sessions
            .sessions
            .lock()
            .await
            .remove(session_key);
        if let Some(mut session) = session {
            info!("Killing PTY for session {}", session_key);
            if let Err(error) = self
                .terminate_current_session_process(session_key, &mut session, true)
                .await
            {
                self.retain_failed_current_cleanup(session_key, session)
                    .await;
                return Err(error);
            }
            info!("PTY for session {} killed", session_key);
        }
        self.terminate_managed_recoveries(session_key).await?;
        self.clear_session_tracking(session_key).await;

        Ok(())
    }

    pub async fn kill_shells_for_task(&self, task_id: &str) -> Result<(), PtyError> {
        let mut keys_to_kill: HashSet<String> = {
            let sessions = self.terminal_sessions.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_key, session)| session.kind.is_shell_for_task(task_id))
                .map(|(key, _session)| key.clone())
                .collect()
        };
        keys_to_kill.extend(
            self.terminal_sessions
                .pending_shell_spawns
                .iter()
                .filter(|entry| entry.value().0.as_str() == task_id)
                .map(|entry| entry.key().clone()),
        );
        keys_to_kill.extend(
            self.terminal_sessions
                .shell_recovery_keys_for_task(task_id)
                .await,
        );

        let mut failures = Vec::new();
        for key in keys_to_kill {
            if let Err(error) = self.kill_pty(&key).await {
                failures.push(error.to_string());
            }
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(PtyError::CleanupFailed(failures.join("; ")))
        }
    }

    /// Kills all running PTY processes
    pub async fn kill_all(&self) {
        let mut session_keys: HashSet<String> = self
            .terminal_sessions
            .sessions
            .lock()
            .await
            .keys()
            .cloned()
            .collect();
        session_keys.extend(
            self.terminal_sessions
                .pending_shell_spawns
                .iter()
                .map(|entry| entry.key().clone()),
        );
        session_keys.extend(
            self.terminal_sessions
                .agent_spawn_generations
                .lock()
                .await
                .keys()
                .cloned(),
        );
        session_keys.extend(self.terminal_sessions.managed_recovery_keys().await);

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
}
