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

fn agent_follow_up_error_response(
    error: crate::agent_follow_up::AgentFollowUpError,
) -> (StatusCode, String) {
    use crate::agent_follow_up::AgentFollowUpError;

    let status = match &error {
        AgentFollowUpError::NoSession { .. }
        | AgentFollowUpError::InactiveSession { .. }
        | AgentFollowUpError::TaskMissing { .. } => StatusCode::CONFLICT,
        AgentFollowUpError::LiveDelivery(_)
        | AgentFollowUpError::WorkspaceResolution(_)
        | AgentFollowUpError::WorkspaceUnavailable
        | AgentFollowUpError::ProviderResume(_)
        | AgentFollowUpError::MissingPtyInstance => StatusCode::SERVICE_UNAVAILABLE,
        AgentFollowUpError::SessionLookup(_)
        | AgentFollowUpError::TaskLookup(_)
        | AgentFollowUpError::Persistence(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string())
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

            let service = crate::agent_follow_up::AgentFollowUpService::new(
                state.app.clone(),
                std::sync::Arc::clone(&state.db),
                pty_manager.clone(),
                state.app_event_tx.clone(),
                state.completed_session_reaper.clone(),
            );
            let outcome = service
                .deliver(&task_id, &message)
                .await
                .map_err(agent_follow_up_error_response)?;
            json_value(AgentFollowUpReceipt {
                task_id: outcome.task_id,
                session_id: outcome.session_id,
                disposition: outcome.disposition.as_str(),
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
        "get_terminal_view_snapshot" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            json_value(pty_manager.terminal_view_snapshot(&payload.task_id).await)?
        }
        "get_pty_buffer" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            let mut buffer_state = pty_manager.pty_buffer_state(&payload.task_id).await;
            if !buffer_state.is_live && buffer_state.buffer.is_none() {
                buffer_state.buffer = crate::db::acquire_db(&state.db)
                    .get_latest_agent_terminal_replay(&payload.task_id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to load persisted PTY replay: {error}"),
                        )
                    })?;
            }
            json_value(buffer_state)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
