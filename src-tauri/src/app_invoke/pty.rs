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

            pty_manager
                .write_pty(&task_id, &terminal_follow_up_input(&message))
                .await
                .map_err(|error| {
                    (
                        StatusCode::SERVICE_UNAVAILABLE,
                        format!("AGENT_FOLLOW_UP_DELIVERY_FAILED: Agent Session could not accept the follow-up: {error}"),
                    )
                })?;
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
            json_value(pty_manager.get_pty_buffer(&payload.task_id).await)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
