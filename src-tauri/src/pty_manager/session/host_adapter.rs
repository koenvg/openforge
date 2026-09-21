//! Existing Sidecar adapter. Reuses registration, terminal authority, ordered writes
//! and verified process cleanup; never runs provider preparation or domain operations.

mod output;

use super::provider_adapter::AgentPtyProviderAdapter;
use super::{SessionOperation, SessionTarget, TerminalSessionFailure};
use crate::app_events::{AppEventBus, RuntimeEventPublisher};
use crate::pty_manager::host::*;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext, TerminalSessionLifecycleState};

#[derive(Clone)]
struct ExistingBackend {
    manager: PtyManager,
    events: AppEventBus,
}

impl PtyManager {
    /// Use the same installation namespace and runtime event bus for every handle.
    /// This returns a client to this manager, not another process owner.
    pub(crate) fn host(
        &self,
        installation: InstallationId,
        events: AppEventBus,
    ) -> impl PtyHost + Clone {
        InProcessHost::new(
            ExistingBackend {
                manager: self.clone(),
                events,
            },
            installation,
            std::sync::Arc::clone(&self.host_state),
        )
    }
}

impl HostBackend for ExistingBackend {
    async fn set_terminal_color_profile(
        &self,
        profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        *self
            .manager
            .terminal_color_profile
            .write()
            .map_err(|_| HostError::OutcomeUnknown)? = profile;
        self.manager
            .terminal_sessions
            .update_color_profile(profile)
            .await
            .map_err(HostError::Backend)
    }

    async fn inventory(&self) -> Result<Vec<BackendSession>, HostError> {
        self.manager
            .process_diagnostic_sessions()
            .await
            .into_iter()
            .map(|session| {
                Ok(BackendSession {
                    instance: PtyInstanceId::new(session.pty_instance_id)?,
                    session_key: session.session_key,
                    state: match session.lifecycle_state {
                        TerminalSessionLifecycleState::Live => HostedSessionState::Live,
                        TerminalSessionLifecycleState::Cleaning => HostedSessionState::Cleaning,
                        TerminalSessionLifecycleState::ManagedRecovery => {
                            HostedSessionState::ManagedRecovery
                        }
                    },
                })
            })
            .collect()
    }

    async fn spawn_prepared(&self, request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        let context = PtySpawnContext {
            task_id: request.owner.task_id(),
            cwd: &request.command.cwd,
            cols: request.columns,
            rows: request.rows,
            event_publisher: RuntimeEventPublisher::new(None, Some(self.events.sender())),
        };
        let instance = match &request.owner {
            TerminalOwner::Agent { .. } => {
                self.manager
                    .spawn_agent_pty(
                        PreparedAgent(&request.command),
                        context,
                        request.image_protocol,
                    )
                    .await
            }
            TerminalOwner::Shell { index, .. } => {
                let mut command = portable_pty::CommandBuilder::new(&request.command.program);
                command.args(&request.command.args);
                for (key, value) in &request.command.env {
                    command.env(key, value);
                }
                self.manager
                    .spawn_shell_pty_with_command(context, *index, request.image_protocol, command)
                    .await
            }
        }
        .map_err(backend_error)?;
        Ok(PtyInstanceId::new(instance)?)
    }

    async fn terminate_exact(&self, target: &HostedSession) -> Result<(), HostError> {
        let manager = &self.manager;
        let key = &target.session_key;
        let lifecycle_lock = manager.lifecycle_lock_for(key).await;
        let _guard = lifecycle_lock.lock().await;
        let session = {
            let mut sessions = manager.terminal_sessions.sessions.lock().await;
            match sessions.get(key) {
                Some(session) if session.instance_id != target.pty.instance.value() => {
                    return Err(HostError::StalePty)
                }
                None if target.state == HostedSessionState::Exited => return Ok(()),
                None => return Err(HostError::StalePty),
                Some(_) => sessions.remove(key),
            }
        };
        if let Some(mut session) = session {
            if let Err(error) = manager
                .terminate_current_session_process(key, &mut session, true)
                .await
            {
                manager.retain_failed_current_cleanup(key, session).await;
                return Err(backend_error(error));
            }
            manager.clear_session_tracking(key, true).await;
        }
        Ok(())
    }

    async fn attach(&self, target: &HostedSession) -> Result<BackendAttachment, HostError> {
        let lifecycle_lock = self.manager.lifecycle_lock_for(&target.session_key).await;
        let _guard = lifecycle_lock.lock().await;
        let output = output::ExistingOutput::subscribe(&self.events, target)?;
        let state = self.manager.pty_buffer_state(&target.session_key).await;
        if state.instance_id != Some(target.pty.instance.value()) {
            return Err(HostError::StalePty);
        }
        let snapshot = state.snapshot.ok_or(HostError::RecoveryUnavailable)?;
        Ok(BackendAttachment {
            snapshot,
            output: Box::new(output),
        })
    }

    async fn operate(&self, target: &HostedSession, action: &IoAction) -> Result<(), HostError> {
        let operation = match action {
            IoAction::Write(data) => SessionOperation::Write(data),
            IoAction::Resize { columns, rows } => SessionOperation::Resize {
                columns: *columns,
                rows: *rows,
            },
        };
        self.manager
            .terminal_sessions
            .operate(
                SessionTarget::Exact {
                    session_key: &target.session_key,
                    instance_id: target.pty.instance.value(),
                },
                operation,
            )
            .await
            .map_err(|failure| match failure {
                TerminalSessionFailure::Missing { .. } | TerminalSessionFailure::Stale { .. } => {
                    HostError::StalePty
                }
                other => backend_error(other.into_pty_error()),
            })
    }
}

fn backend_error(error: PtyError) -> HostError {
    HostError::Backend(error.to_string())
}

struct PreparedAgent<'a>(&'a PreparedCommand);
impl AgentPtyProviderAdapter for PreparedAgent<'_> {
    fn label(&self) -> &'static str {
        "prepared agent"
    }
    fn command_name(&self) -> &str {
        &self.0.program
    }
    fn command_args(&self) -> Vec<String> {
        self.0.args.clone()
    }
    fn prepare(&mut self, _cwd: &std::path::Path) -> Result<(), PtyError> {
        Ok(())
    }
    fn extra_env(
        &self,
        _task_id: &str,
        _instance_id: u64,
    ) -> std::collections::HashMap<String, String> {
        self.0.env.clone().into_iter().collect()
    }
    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{task_id}-pty.pid")
    }
}
