//! Spawn-generation arbitration and replacement of existing sessions.

use log::info;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::super::super::{PtyError, PtyManager};
use super::super::lifecycle::LifecycleLockLease;

static NEXT_SPAWN_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy)]
pub(super) struct AgentSpawnToken {
    pub(super) generation: u64,
    pub(super) label: &'static str,
}

impl AgentSpawnToken {
    pub(super) fn stale_error(&self, task_id: &str, stage: &str) -> PtyError {
        PtyError::SpawnFailed(format!(
            "{} PTY for task {} was replaced {stage}",
            self.label, task_id
        ))
    }
}

pub(super) struct ShellSpawnToken {
    pub(super) session_key: String,
    pub(super) generation: u64,
}

impl ShellSpawnToken {
    pub(super) fn stale_error(&self, task_id: &str, stage: &str) -> PtyError {
        PtyError::SpawnFailed(format!("shell PTY for task {task_id} was {stage}"))
    }
}

pub(super) struct PendingShellSpawn {
    pending: Arc<dashmap::DashMap<String, (String, u64)>>,
    session_key: String,
    generation: u64,
}

impl PendingShellSpawn {
    fn register(manager: &PtyManager, session_key: &str, task_id: &str, generation: u64) -> Self {
        manager
            .terminal_sessions
            .pending_shell_spawns
            .insert(session_key.to_string(), (task_id.to_string(), generation));
        Self {
            pending: Arc::clone(&manager.terminal_sessions.pending_shell_spawns),
            session_key: session_key.to_string(),
            generation,
        }
    }
}

impl Drop for PendingShellSpawn {
    fn drop(&mut self) {
        self.pending
            .remove_if(&self.session_key, |_, value| value.1 == self.generation);
    }
}

impl PtyManager {
    pub(super) async fn is_current_spawn(&self, session_key: &str, generation: u64) -> bool {
        let generations = self.terminal_sessions.agent_spawn_generations.lock().await;
        generations
            .get(session_key)
            .map(|current| *current == generation)
            .unwrap_or(false)
    }

    async fn is_current_agent_session(&self, task_id: &str, instance_id: u64) -> bool {
        let sessions = self.terminal_sessions.sessions.lock().await;
        sessions
            .get(task_id)
            .map(|session| session.instance_id == instance_id)
            .unwrap_or(false)
    }

    pub(super) async fn is_current_agent_spawn_and_session(
        &self,
        task_id: &str,
        generation: u64,
        instance_id: u64,
    ) -> bool {
        self.is_current_spawn(task_id, generation).await
            && self.is_current_agent_session(task_id, instance_id).await
    }

    pub(super) async fn require_current_agent_spawn_and_session(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
        instance_id: u64,
        stage: &str,
    ) -> Result<(), PtyError> {
        if self
            .is_current_agent_spawn_and_session(task_id, token.generation, instance_id)
            .await
        {
            Ok(())
        } else {
            Err(token.stale_error(task_id, stage))
        }
    }

    pub(super) async fn begin_agent_spawn(
        &self,
        task_id: &str,
        label: &'static str,
    ) -> (AgentSpawnToken, LifecycleLockLease) {
        let token = AgentSpawnToken {
            generation: NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed),
            label,
        };
        self.terminal_sessions
            .agent_spawn_generations
            .lock()
            .await
            .insert(task_id.to_string(), token.generation);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        (token, lifecycle_lock)
    }

    pub(super) async fn finish_agent_spawn(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
    ) -> Result<(), PtyError> {
        let mut generations = self.terminal_sessions.agent_spawn_generations.lock().await;
        if generations.get(task_id) == Some(&token.generation) {
            generations.remove(task_id);
            Ok(())
        } else {
            Err(token.stale_error(task_id, "before setup finished"))
        }
    }

    pub(super) async fn replace_existing_agent_session(
        &self,
        task_id: &str,
        label: &str,
    ) -> Result<(), PtyError> {
        let Some(mut old_session) = self.terminal_sessions.sessions.lock().await.remove(task_id)
        else {
            return Ok(());
        };

        info!(
            "[PTY] Replacing existing {} PTY for task {}",
            label, task_id
        );
        if let Err(error) = self
            .terminate_current_session_process(task_id, &mut old_session, false)
            .await
        {
            self.retain_failed_current_cleanup(task_id, old_session)
                .await;
            return Err(error);
        }
        self.clear_session_tracking(task_id).await;
        Ok(())
    }

    #[cfg(test)]
    async fn pause_after_shell_spawn_became_pending(&self) {
        let gate = self
            .shell_spawn_pending_gate
            .lock()
            .expect("shell spawn pending gate lock should not be poisoned")
            .take();
        if let Some(gate) = gate {
            gate.reached_tx
                .send(())
                .expect("test should observe pending shell spawn");
            gate.release_rx
                .await
                .expect("test should release pending shell spawn");
        }
    }

    pub(super) async fn begin_shell_spawn(
        &self,
        session_key: &str,
        task_id: &str,
    ) -> (ShellSpawnToken, PendingShellSpawn, LifecycleLockLease) {
        let token = ShellSpawnToken {
            session_key: session_key.to_string(),
            generation: NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed),
        };
        let pending_spawn = {
            let mut generations = self.terminal_sessions.agent_spawn_generations.lock().await;
            let pending_spawn =
                PendingShellSpawn::register(self, session_key, task_id, token.generation);
            generations.insert(token.session_key.clone(), token.generation);
            pending_spawn
        };
        #[cfg(test)]
        self.pause_after_shell_spawn_became_pending().await;
        let lifecycle_lock = self.lifecycle_lock_for(session_key).await;
        (token, pending_spawn, lifecycle_lock)
    }

    pub(super) async fn finish_shell_spawn(&self, token: &ShellSpawnToken) {
        let mut generations = self.terminal_sessions.agent_spawn_generations.lock().await;
        if generations.get(&token.session_key) == Some(&token.generation) {
            generations.remove(&token.session_key);
        }
    }

    pub(super) async fn replace_existing_shell_session(
        &self,
        session_key: &str,
        task_id: &str,
    ) -> Result<(), PtyError> {
        let Some(mut old_session) = self
            .terminal_sessions
            .sessions
            .lock()
            .await
            .remove(session_key)
        else {
            return Ok(());
        };

        info!("[PTY] Replacing existing shell PTY for task {task_id}");
        if let Err(error) = self
            .terminate_current_session_process(session_key, &mut old_session, false)
            .await
        {
            self.retain_failed_current_cleanup(session_key, old_session)
                .await;
            return Err(error);
        }
        self.clear_session_tracking(session_key).await;
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/arbitration.rs"]
mod tests;
