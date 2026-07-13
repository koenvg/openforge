use super::pty_payload::{PtyResizePayload, PtySpawnShellPayload, PtyTaskPayload, PtyWritePayload};
use super::*;

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
                )
                .await
                .map_err(|e| pty_command_error_response("Failed to spawn shell PTY", e))?;
            json_value(instance_id)?
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
            pty_manager.kill_shells_for_task(&payload.task_id).await;
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
