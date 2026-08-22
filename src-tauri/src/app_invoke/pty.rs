use super::pty_payload::{PtyResizePayload, PtySpawnShellPayload, PtyTaskPayload, PtyWritePayload};
use super::*;
use serde::Serialize;

const MAX_AGENT_FOLLOW_UP_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFollowUpReceipt {
    task_id: String,
    session_id: String,
    disposition: &'static str,
}

fn follow_up_disposition(status: &str) -> Option<&'static str> {
    match status {
        "completed" => Some("delivered"),
        "running" | "paused" => Some("queued"),
        _ => None,
    }
}

fn terminal_follow_up_input(message: &str) -> Vec<u8> {
    let sanitized: String = message
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .collect();
    let mut input = Vec::with_capacity(sanitized.len() + 13);
    input.extend_from_slice(b"\x1b[200~");
    input.extend_from_slice(sanitized.as_bytes());
    input.extend_from_slice(b"\x1b[201~\r");
    input
}

type AgentFollowUpFuture<'a, T> =
    std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

#[derive(Debug)]
enum AgentFollowUpRuntimeError {
    Missing,
    Failed(String),
}

#[derive(Debug)]
struct AgentFollowUpResumeRequest {
    task_id: String,
    message: String,
    session: crate::db::AgentSessionRow,
    workspace_path: std::path::PathBuf,
    agent: Option<String>,
    permission_mode: Option<String>,
}

trait AgentFollowUpRuntime: Send + Sync {
    fn write<'a>(
        &'a self,
        task_id: &'a str,
        input: &'a [u8],
    ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>>;
    fn resume<'a>(
        &'a self,
        request: AgentFollowUpResumeRequest,
    ) -> AgentFollowUpFuture<'a, Result<crate::providers::ProviderSessionResult, String>>;
    fn stop<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, ()>;
}

struct NativeAgentFollowUpRuntime<'a> {
    state: &'a AppState,
    pty_manager: &'a crate::pty_manager::PtyManager,
}

impl AgentFollowUpRuntime for NativeAgentFollowUpRuntime<'_> {
    fn write<'a>(
        &'a self,
        task_id: &'a str,
        input: &'a [u8],
    ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>> {
        Box::pin(async move {
            self.pty_manager
                .write_pty(task_id, input)
                .await
                .map_err(|error| match error {
                    crate::pty_manager::PtyError::ProcessNotFound(_) => {
                        AgentFollowUpRuntimeError::Missing
                    }
                    other => AgentFollowUpRuntimeError::Failed(other.to_string()),
                })
        })
    }

    fn resume<'a>(
        &'a self,
        request: AgentFollowUpResumeRequest,
    ) -> AgentFollowUpFuture<'a, Result<crate::providers::ProviderSessionResult, String>> {
        Box::pin(async move {
            let provider = crate::providers::Provider::from_name(
                &request.session.provider,
                self.pty_manager.clone(),
            )?;
            let start_context = crate::providers::ProviderStartContext::new(
                self.state.app.clone(),
                self.state.app_event_tx.clone(),
            );
            provider
                .resume(
                    &request.task_id,
                    &request.session,
                    &request.workspace_path,
                    Some(&request.message),
                    request.agent.as_deref(),
                    request.permission_mode.as_deref(),
                    None,
                    &start_context,
                )
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn stop<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, ()> {
        Box::pin(async move {
            let _ = self.pty_manager.kill_pty(task_id).await;
        })
    }
}

async fn deliver_agent_follow_up<R: AgentFollowUpRuntime + ?Sized>(
    state: &AppState,
    runtime: &R,
    task_id: &str,
    message: &str,
    session: &crate::db::AgentSessionRow,
) -> Result<(), (StatusCode, String)> {
    state.completed_session_reaper.active(task_id).await;
    match runtime
        .write(task_id, &terminal_follow_up_input(message))
        .await
    {
        Ok(()) => return Ok(()),
        Err(AgentFollowUpRuntimeError::Failed(error)) => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                format!(
                    "AGENT_FOLLOW_UP_DELIVERY_FAILED: Agent Session could not accept the follow-up: {error}"
                ),
            ));
        }
        Err(AgentFollowUpRuntimeError::Missing) => {}
    }

    let (task, workspace) = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .get_task(task_id)
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to load Task: {error}"),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::CONFLICT,
                    format!("AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} no longer exists"),
                )
            })?;
        let workspace = crate::provider_runtime::get_task_workspace(&db, task_id)
            .map_err(|error| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!(
                        "AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to resolve Task workspace: {error}"
                    ),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "AGENT_FOLLOW_UP_DELIVERY_FAILED: Task workspace is unavailable".to_string(),
                )
            })?;
        (task, workspace)
    };

    let result = runtime
        .resume(AgentFollowUpResumeRequest {
            task_id: task_id.to_string(),
            message: message.to_string(),
            session: session.clone(),
            workspace_path: std::path::PathBuf::from(workspace.workspace_path),
            agent: task.agent,
            permission_mode: task.permission_mode,
        })
        .await
        .map_err(|error| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to resume Agent Session: {error}"),
            )
        })?;
    let Some(pty_instance_id) = result.pty_instance_id else {
        runtime.stop(task_id).await;
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_FOLLOW_UP_DELIVERY_FAILED: resumed provider did not return a PTY instance"
                .to_string(),
        ));
    };

    let persisted = crate::db::acquire_db(&state.db).reactivate_agent_session_runtime(
        &session.id,
        pty_instance_id,
        result
            .opencode_session_id
            .as_deref()
            .or(result.pi_session_id.as_deref()),
    );
    if let Err(error) = persisted {
        runtime.stop(task_id).await;
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to persist resumed Agent Session: {error}"
            ),
        ));
    }

    Ok(())
}

fn pty_command_error_response(
    action: &str,
    error: crate::pty_manager::PtyError,
) -> (StatusCode, String) {
    if matches!(
        error,
        crate::pty_manager::PtyError::InvalidWorkspaceCwd { .. }
    ) {
        (StatusCode::BAD_REQUEST, error.to_string())
    } else {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("{action}: {error}"),
        )
    }
}

pub(super) async fn handle_app_pty_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let Some(pty_manager) = state.pty_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        ));
    };

    let value = match request.command.as_str() {
        "pty_spawn_shell" => {
            let app = state.app.clone();
            let payload = PtySpawnShellPayload::decode(&request.command, &request.payload)?;
            let instance_id = pty_manager
                .spawn_shell_pty(
                    crate::pty_manager::PtySpawnContext {
                        task_id: &payload.task_id,
                        cwd: std::path::Path::new(&payload.cwd),
                        cols: payload.cols,
                        rows: payload.rows,
                        app_handle: app,
                        app_event_tx: state.app_event_tx.clone(),
                    },
                    payload.terminal_index,
                    payload.terminal_image_protocol,
                )
                .await
                .map_err(|e| pty_command_error_response("Failed to spawn shell PTY", e))?;
            json_value(instance_id)?
        }
        "send_agent_follow_up" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let message = payload_string(&request.payload, "message")?;
            if message.trim().is_empty() || message.len() > MAX_AGENT_FOLLOW_UP_BYTES {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "AGENT_FOLLOW_UP_DELIVERY_FAILED: follow-up message must be non-empty and at most 256 KiB".to_string(),
                ));
            }

            let session = {
                let db = crate::db::acquire_db(&state.db);
                db.get_latest_session_for_ticket(&task_id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to load Agent Session: {error}"),
                        )
                    })?
            };
            let Some(session) = session else {
                return Err((
                    StatusCode::CONFLICT,
                    format!("AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} has no Agent Session"),
                ));
            };
            let Some(disposition) = follow_up_disposition(&session.status) else {
                return Err((
                    StatusCode::CONFLICT,
                    format!(
                        "AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} has no active Agent Session"
                    ),
                ));
            };

            let runtime = NativeAgentFollowUpRuntime { state, pty_manager };
            deliver_agent_follow_up(state, &runtime, &task_id, &message, &session).await?;
            json_value(AgentFollowUpReceipt {
                task_id,
                session_id: session.id,
                disposition,
            })?
        }
        "pty_write" => {
            let payload = PtyWritePayload::decode(&request.command, &request.payload)?;
            pty_manager
                .write_pty(&payload.task_id, payload.data.as_bytes())
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to write to PTY: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "pty_resize" => {
            let payload = PtyResizePayload::decode(&request.command, &request.payload)?;
            pty_manager
                .resize_pty(&payload.task_id, payload.cols, payload.rows)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to resize PTY: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "pty_kill" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            pty_manager.kill_pty(&payload.task_id).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to kill PTY: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "pty_kill_shells_for_task" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            pty_manager
                .kill_shells_for_task(&payload.task_id)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to kill task shells: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "get_pty_buffer" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            let replay = match pty_manager.get_pty_buffer(&payload.task_id).await {
                Some(replay) => Some(replay),
                None => crate::db::acquire_db(&state.db)
                    .get_latest_agent_terminal_replay(&payload.task_id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to load persisted PTY replay: {error}"),
                        )
                    })?,
            };
            json_value(replay)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RestartingRuntime {
        resumed: Mutex<Vec<AgentFollowUpResumeRequest>>,
    }

    impl AgentFollowUpRuntime for RestartingRuntime {
        fn write<'a>(
            &'a self,
            _task_id: &'a str,
            _input: &'a [u8],
        ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>> {
            Box::pin(async { Err(AgentFollowUpRuntimeError::Missing) })
        }

        fn resume<'a>(
            &'a self,
            request: AgentFollowUpResumeRequest,
        ) -> AgentFollowUpFuture<'a, Result<crate::providers::ProviderSessionResult, String>>
        {
            Box::pin(async move {
                self.resumed
                    .lock()
                    .expect("restart runtime lock")
                    .push(request);
                Ok(crate::providers::ProviderSessionResult {
                    port: 0,
                    opencode_session_id: None,
                    pi_session_id: Some("pi-session".to_string()),
                    pty_instance_id: Some(99),
                })
            })
        }

        fn stop<'a>(&'a self, _task_id: &'a str) -> AgentFollowUpFuture<'a, ()> {
            Box::pin(async {})
        }
    }

    #[tokio::test]
    async fn reclaimed_completed_session_resumes_provider_for_follow_up() {
        let (state, path) =
            crate::app_invoke::test_support::test_state("reclaimed_completed_session_follow_up");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let (task_id, session) = {
            let db = crate::db::acquire_db(&state.db);
            let project = db
                .create_project(
                    "Follow-up Project",
                    workspace.path().to_str().expect("workspace path"),
                )
                .expect("create project");
            let task = db
                .create_task(
                    "Continue completed work",
                    "doing",
                    Some(&project.id),
                    None,
                    None,
                )
                .expect("create task");
            db.create_task_workspace_record(
                &task.id,
                &project.id,
                workspace.path().to_str().expect("workspace path"),
                workspace.path().to_str().expect("workspace path"),
                "project_dir",
                None,
                "pi",
            )
            .expect("create workspace");
            db.create_agent_session(
                "session-follow-up",
                &task.id,
                None,
                "implementing",
                "completed",
                "pi",
            )
            .expect("create Agent Session");
            db.set_agent_session_pi_id("session-follow-up", "pi-session")
                .expect("set Pi session id");
            let session = db
                .get_agent_session("session-follow-up")
                .expect("load Agent Session")
                .expect("Agent Session exists");
            (task.id, session)
        };
        let runtime = RestartingRuntime::default();

        deliver_agent_follow_up(
            &state,
            &runtime,
            &task_id,
            "Review this follow-up",
            &session,
        )
        .await
        .expect("deliver follow-up");

        let resumed = runtime.resumed.lock().expect("restart runtime lock");
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed[0].task_id, task_id);
        assert_eq!(resumed[0].message, "Review this follow-up");
        assert_eq!(
            resumed[0].session.pi_session_id.as_deref(),
            Some("pi-session")
        );
        drop(resumed);
        let session = crate::db::acquire_db(&state.db)
            .get_agent_session("session-follow-up")
            .expect("load Agent Session")
            .expect("Agent Session exists");
        assert_eq!(session.status, "running");
        assert_eq!(session.pty_instance_id, Some(99));

        let _ = std::fs::remove_file(path);
    }
}
