use super::*;

pub(super) fn handle(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "get_session_status" => {
            let session_id = payload_string(&request.payload, "sessionId")?;
            let session = {
                let db = crate::db::acquire_db(&state.db);
                db.get_agent_session(&session_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get session status: {e}"),
                        )
                    })?
                    .ok_or_else(|| {
                        (
                            StatusCode::NOT_FOUND,
                            format!("Session {session_id} not found"),
                        )
                    })?
            };
            json_value(session)
        }
        "get_latest_session" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let session = {
                let db = crate::db::acquire_db(&state.db);
                db.get_latest_session_for_ticket(&task_id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get latest session: {e}"),
                    )
                })?
            };
            json_value(session)
        }
        "get_agent_sessions" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let provider = payload_optional_string(&request.payload, "provider")?;
            let created_at_or_after = request
                .payload
                .get("createdAtOrAfter")
                .filter(|value| !value.is_null())
                .map(|_| payload_i64(&request.payload, "createdAtOrAfter"))
                .transpose()?;
            if created_at_or_after.is_some_and(|timestamp| timestamp < 0) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "createdAtOrAfter must be a non-negative Unix timestamp".to_string(),
                ));
            }
            let sessions = {
                let db = crate::db::acquire_db(&state.db);
                db.get_agent_sessions_for_task(&task_id, provider.as_deref(), created_at_or_after)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get Agent Sessions: {error}"),
                        )
                    })?
            };
            json_value(sessions)
        }
        "get_latest_sessions" => {
            let task_ids = payload_string_vec(&request.payload, "taskIds")?;
            let sessions = {
                let db = crate::db::acquire_db(&state.db);
                db.get_latest_sessions_for_tickets(&task_ids).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get sessions: {e}"),
                    )
                })?
            };
            json_value(sessions)
        }
        "finalize_agent_session" => finalize_agent_session(state, request),
        _ => unreachable!("agent session handler only receives agent session commands"),
    }
}

fn finalize_agent_session(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let task_id = payload_string(&request.payload, "taskId")?;
    let success = payload_bool(&request.payload, "success")?;
    let pty_instance_id = request
        .payload
        .get("ptyInstanceId")
        .and_then(|value| value.as_u64());

    let event_payload = {
        let db = crate::db::acquire_db(&state.db);
        if let Some(session) = db.get_latest_session_for_ticket(&task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get latest session: {e}"),
            )
        })? {
            let pty_backed_provider =
                crate::agent_lifecycle::provider_requires_pty_instance(&session.provider);
            let current_pty_instance_matches = !pty_backed_provider
                || pty_instance_id
                    .map(|id| crate::agent_lifecycle::session_matches_pty_instance(&session, id))
                    .unwrap_or(false);
            if pty_backed_provider && session.status == "running" && current_pty_instance_matches {
                let next_status = if matches!(
                    session.provider.as_str(),
                    "pi" | "opencode" | "codex"
                ) && success
                {
                    "completed"
                } else {
                    "interrupted"
                };
                let error_message = if next_status == "completed" {
                    None
                } else {
                    Some("PTY process exited")
                };
                db.update_agent_session(
                    &session.id,
                    &session.stage,
                    next_status,
                    None,
                    error_message,
                )
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update session: {e}"),
                    )
                })?;
                let project_id = db
                    .get_task(&task_id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to reload Task for Agent invalidation: {error}"),
                        )
                    })?
                    .and_then(|task| task.project_id);
                Some(serde_json::json!({
                    "task_id": task_id,
                    "project_id": project_id,
                    "status": next_status,
                    "provider": session.provider,
                }))
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some(payload) = event_payload {
        publish_app_event_to_runtime(
            state.app.as_ref(),
            &state.app_event_tx,
            "agent-status-changed",
            &payload,
        );
    }

    Ok(serde_json::Value::Null)
}
