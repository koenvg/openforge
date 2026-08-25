use std::path::Path;

use super::authority::QueryResponseOwner;
use super::PtyError;

mod lifecycle;
mod provider_adapter;
mod spawn;

#[cfg(test)]
pub(super) use lifecycle::{frozen_seconds, PtySession, NEXT_INSTANCE_ID};
pub(super) use lifecycle::{
    AgentSpawnGenerations, LastOutputTimes, LifecycleLockLease, LifecycleLockRegistry,
    PtyOutputBuffers, PtySessions,
};
pub(super) use lifecycle::{PassiveExitOutcome, PtySessionKind};

#[derive(Clone)]
pub(super) struct TerminalSessions {
    sessions: PtySessions,
    last_output: LastOutputTimes,
    output_buffers: PtyOutputBuffers,
    attachment_hubs: super::attachment::PtyAttachmentHubs,
    agent_spawn_generations: AgentSpawnGenerations,
    lifecycle_locks: LifecycleLockRegistry,
    pending_shell_spawns: std::sync::Arc<dashmap::DashMap<String, (String, u64)>>,
    managed_recoveries:
        std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, Vec<ManagedRecovery>>>>,
    cleaning_sessions: std::sync::Arc<
        tokio::sync::Mutex<std::collections::HashMap<(String, u64), CleaningSession>>,
    >,
    pending_exit_dispositions:
        std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<(String, u64), bool>>>,
    #[cfg(test)]
    resize_start_gate: std::sync::Arc<std::sync::Mutex<Option<super::ResizeStartGate>>>,
}

pub(super) struct ManagedRecovery {
    pub(super) recovery_key: String,
    pub(super) session: lifecycle::PtySession,
}

pub(super) struct CleaningSession {
    pub(super) task_id: String,
    pub(super) session_kind: String,
    pub(super) pid: Option<u32>,
    pub(super) instance_id: u64,
    pub(super) pid_file_name: String,
}

#[cfg(test)]
pub(super) struct TerminalSessionTestHandles {
    pub(super) sessions: PtySessions,
    pub(super) last_output: LastOutputTimes,
    pub(super) output_buffers: PtyOutputBuffers,
    pub(super) attachment_hubs: super::attachment::PtyAttachmentHubs,
    pub(super) agent_spawn_generations: AgentSpawnGenerations,
    pub(super) lifecycle_locks: LifecycleLockRegistry,
    pub(super) pending_shell_spawns: std::sync::Arc<dashmap::DashMap<String, (String, u64)>>,
}

pub(super) enum SessionTarget<'a> {
    Current(&'a str),
    Exact {
        session_key: &'a str,
        instance_id: u64,
    },
}

impl SessionTarget<'_> {
    fn session_key(&self) -> &str {
        match self {
            Self::Current(session_key) | Self::Exact { session_key, .. } => session_key,
        }
    }
}

pub(super) enum SessionOperation<'a> {
    Write(&'a [u8]),
    WriteAttachment(&'a [u8]),
    WriteQueryResponse(&'a [u8]),
    Resize { columns: u16, rows: u16 },
    ResizeAttachment { columns: u16, rows: u16 },
}

pub(super) enum TerminalSessionFailure {
    Missing { session_key: String },
    Stale { session_key: String },
    Write(String),
    Resize(String),
}

impl TerminalSessionFailure {
    pub(super) fn into_pty_error(self) -> PtyError {
        match self {
            Self::Missing { session_key } | Self::Stale { session_key } => {
                PtyError::ProcessNotFound(session_key)
            }
            Self::Write(message) => PtyError::WriteFailed(message),
            Self::Resize(message) => PtyError::IoError(std::io::Error::other(message)),
        }
    }
}

impl TerminalSessions {
    pub(super) fn new() -> Self {
        Self {
            sessions: std::sync::Arc::new(
                tokio::sync::Mutex::new(std::collections::HashMap::new()),
            ),
            last_output: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            output_buffers: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            attachment_hubs: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            agent_spawn_generations: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            lifecycle_locks: LifecycleLockRegistry::default(),
            pending_shell_spawns: std::sync::Arc::new(dashmap::DashMap::new()),
            managed_recoveries: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            cleaning_sessions: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            pending_exit_dispositions: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            #[cfg(test)]
            resize_start_gate: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    #[cfg(test)]
    pub(super) fn test_handles(&self) -> TerminalSessionTestHandles {
        TerminalSessionTestHandles {
            sessions: std::sync::Arc::clone(&self.sessions),
            last_output: std::sync::Arc::clone(&self.last_output),
            output_buffers: std::sync::Arc::clone(&self.output_buffers),
            attachment_hubs: std::sync::Arc::clone(&self.attachment_hubs),
            agent_spawn_generations: std::sync::Arc::clone(&self.agent_spawn_generations),
            lifecycle_locks: self.lifecycle_locks.clone(),
            pending_shell_spawns: std::sync::Arc::clone(&self.pending_shell_spawns),
        }
    }

    #[cfg(test)]
    pub(super) fn set_resize_start_gate(&self, gate: super::ResizeStartGate) {
        *self
            .resize_start_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(gate);
    }

    #[cfg(test)]
    fn pause_before_resize(&self) {
        let gate = self
            .resize_start_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(gate) = gate {
            let _ = gate.reached_tx.send(());
            let _ = gate.release_rx.recv();
        }
    }

    pub(super) async fn ensure_no_managed_recovery(
        &self,
        session_key: &str,
    ) -> Result<(), PtyError> {
        let recoveries = self.managed_recoveries.lock().await;
        if recoveries
            .get(session_key)
            .is_some_and(|entries| !entries.is_empty())
        {
            return Err(PtyError::CleanupFailed(format!(
                "managed cleanup is still pending for {session_key}",
            )));
        }
        Ok(())
    }

    pub(super) async fn retain_managed_recovery(
        &self,
        session_key: &str,
        recovery: ManagedRecovery,
    ) {
        self.managed_recoveries
            .lock()
            .await
            .entry(session_key.to_string())
            .or_default()
            .push(recovery);
    }

    pub(super) async fn take_managed_recoveries(&self, session_key: &str) -> Vec<ManagedRecovery> {
        self.managed_recoveries
            .lock()
            .await
            .remove(session_key)
            .unwrap_or_default()
    }

    pub(super) async fn restore_managed_recovery(
        &self,
        session_key: &str,
        recovery: ManagedRecovery,
    ) {
        self.retain_managed_recovery(session_key, recovery).await;
    }

    pub(super) async fn begin_cleaning(
        &self,
        session_key: &str,
        session: &lifecycle::PtySession,
        emit_exit: bool,
    ) {
        let (task_id, session_kind) = match &session.kind {
            PtySessionKind::Agent => (session_key.to_string(), "agent".to_string()),
            PtySessionKind::Shell { task_id } => (task_id.clone(), "shell".to_string()),
        };
        self.cleaning_sessions.lock().await.insert(
            (session_key.to_string(), session.instance_id),
            CleaningSession {
                task_id,
                session_kind,
                pid: session.child.process_id(),
                instance_id: session.instance_id,
                pid_file_name: session.pid_file_name.clone(),
            },
        );
        self.pending_exit_dispositions
            .lock()
            .await
            .insert((session_key.to_string(), session.instance_id), emit_exit);
    }

    pub(super) async fn finish_cleaning_exit(
        &self,
        session_key: &str,
        instance_id: u64,
    ) -> Option<bool> {
        let identity = (session_key.to_string(), instance_id);
        let emit_exit = self
            .pending_exit_dispositions
            .lock()
            .await
            .remove(&identity);
        emit_exit
    }

    pub(super) async fn complete_cleaning(&self, session_key: &str, instance_id: u64) {
        self.cleaning_sessions
            .lock()
            .await
            .remove(&(session_key.to_string(), instance_id));
    }

    pub(super) async fn managed_recovery_keys(&self) -> Vec<String> {
        self.managed_recoveries
            .lock()
            .await
            .keys()
            .cloned()
            .collect()
    }

    pub(super) async fn shell_recovery_keys_for_task(&self, task_id: &str) -> Vec<String> {
        self.managed_recoveries
            .lock()
            .await
            .iter()
            .filter(|(_session_key, recoveries)| {
                recoveries.iter().any(|recovery| {
                    matches!(
                        &recovery.session.kind,
                        PtySessionKind::Shell {
                            task_id: recovery_task_id
                        } if recovery_task_id == task_id
                    )
                })
            })
            .map(|(session_key, _recoveries)| session_key.clone())
            .collect()
    }

    #[cfg(test)]
    pub(super) async fn take_managed_recovery_for_test(
        &self,
        session_key: &str,
        instance_id: u64,
    ) -> Option<lifecycle::PtySession> {
        let mut recoveries = self.managed_recoveries.lock().await;
        let entries = recoveries.get_mut(session_key)?;
        let position = entries
            .iter()
            .position(|recovery| recovery.session.instance_id == instance_id)?;
        let recovery = entries.remove(position);
        if entries.is_empty() {
            recoveries.remove(session_key);
        }
        Some(recovery.session)
    }

    pub(super) async fn is_current(&self, session_key: &str, instance_id: u64) -> bool {
        self.sessions
            .lock()
            .await
            .get(session_key)
            .is_some_and(|session| session.instance_id == instance_id)
    }

    pub(super) async fn accepts_passive_output(&self, session_key: &str, instance_id: u64) -> bool {
        if self.is_current(session_key, instance_id).await {
            return true;
        }
        self.pending_exit_dispositions
            .lock()
            .await
            .get(&(session_key.to_string(), instance_id))
            .copied()
            .unwrap_or(false)
    }

    pub(super) async fn operate(
        &self,
        target: SessionTarget<'_>,
        operation: SessionOperation<'_>,
    ) -> Result<(), TerminalSessionFailure> {
        let session_key = target.session_key();
        let (writer, master, terminal_model, instance_id) = {
            let sessions = self.sessions.lock().await;
            let session =
                sessions
                    .get(session_key)
                    .ok_or_else(|| TerminalSessionFailure::Missing {
                        session_key: session_key.to_string(),
                    })?;
            let is_query_response = matches!(&operation, SessionOperation::WriteQueryResponse(_));
            if is_query_response
                && session.authority.query_response_owner != QueryResponseOwner::Xterm
            {
                return Err(TerminalSessionFailure::Write(
                    "xterm is not the terminal query-response authority".to_string(),
                ));
            }
            let requested_instance_id = match &target {
                SessionTarget::Current(_) => None,
                SessionTarget::Exact { instance_id, .. } => Some(*instance_id),
            };
            if let Some(requested_instance_id) = requested_instance_id {
                if requested_instance_id != session.instance_id {
                    if is_query_response {
                        return Err(TerminalSessionFailure::Write(format!(
                            "stale PTY instance {requested_instance_id} for {session_key}; current instance is {}",
                            session.instance_id
                        )));
                    }
                    return Err(TerminalSessionFailure::Stale {
                        session_key: session_key.to_string(),
                    });
                }
            }
            let owner_is_stale = matches!(
                &operation,
                SessionOperation::WriteAttachment(_) | SessionOperation::ResizeAttachment { .. }
            ) && !matches!(session.kind, PtySessionKind::Agent);
            if owner_is_stale {
                return Err(TerminalSessionFailure::Stale {
                    session_key: session_key.to_string(),
                });
            }
            (
                std::sync::Arc::clone(&session.writer),
                std::sync::Arc::clone(&session.master),
                session.terminal_model.as_ref().map(std::sync::Arc::clone),
                session.instance_id,
            )
        };

        match operation {
            SessionOperation::Write(data) | SessionOperation::WriteAttachment(data) => writer
                .write_user_input(session_key, instance_id, data)
                .map_err(|error| TerminalSessionFailure::Write(error.to_string())),
            SessionOperation::WriteQueryResponse(data) => writer
                .write_xterm_query_response(session_key, instance_id, data)
                .map_err(|error| TerminalSessionFailure::Write(error.to_string())),
            SessionOperation::Resize { columns, rows }
            | SessionOperation::ResizeAttachment { columns, rows } => {
                let size = portable_pty::PtySize {
                    rows,
                    cols: columns,
                    pixel_width: 0,
                    pixel_height: 0,
                };
                #[cfg(test)]
                self.pause_before_resize();
                master
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .resize(size)
                    .map_err(|error| TerminalSessionFailure::Resize(error.to_string()))?;
                if let Some(terminal_model) = terminal_model {
                    terminal_model.resize(columns, rows);
                }
                Ok(())
            }
        }
    }

    pub(super) async fn agent_terminal_available(&self, session_key: &str) -> bool {
        let lifecycle_lock = self.lifecycle_locks.lock_for(session_key);
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let instance_id = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_key).and_then(|session| {
                matches!(session.kind, PtySessionKind::Agent).then_some(session.instance_id)
            })
        };
        let Some(instance_id) = instance_id else {
            return false;
        };
        self.attachment_hubs
            .lock()
            .await
            .get(session_key)
            .is_some_and(|hub| hub.instance_id() == instance_id)
    }

    pub(super) async fn attach_agent_terminal(
        &self,
        session_key: &str,
    ) -> Result<
        super::attachment::AgentTerminalAttachment,
        super::attachment::AgentTerminalAttachmentError,
    > {
        let lifecycle_lock = self.lifecycle_locks.lock_for(session_key);
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let instance_id = {
            let sessions = self.sessions.lock().await;
            let session = sessions
                .get(session_key)
                .ok_or(super::attachment::AgentTerminalAttachmentError::NoActiveAgentTerminal)?;
            if !matches!(session.kind, PtySessionKind::Agent) {
                return Err(super::attachment::AgentTerminalAttachmentError::NoActiveAgentTerminal);
            }
            session.instance_id
        };
        let hub = self
            .attachment_hubs
            .lock()
            .await
            .get(session_key)
            .filter(|hub| hub.instance_id() == instance_id)
            .cloned()
            .ok_or(super::attachment::AgentTerminalAttachmentError::NoActiveAgentTerminal)?;
        let (replay, events, protocol_error_pending) = hub.attach_with_status();
        Ok(super::attachment::AgentTerminalAttachment::new(
            session_key.to_string(),
            instance_id,
            replay,
            protocol_error_pending,
            events,
            self.clone(),
        ))
    }
}

impl Default for TerminalSessions {
    fn default() -> Self {
        Self::new()
    }
}

fn invalid_workspace_cwd(cwd: &Path, reason: impl ToString) -> PtyError {
    PtyError::InvalidWorkspaceCwd {
        path: cwd.display().to_string(),
        reason: reason.to_string(),
    }
}
