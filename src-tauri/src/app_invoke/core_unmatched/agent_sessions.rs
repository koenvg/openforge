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
        "list_agent_sessions" => {
            let provider = payload_string(&request.payload, "provider")?;
            let overlaps = request
                .payload
                .get("overlaps")
                .filter(|value| value.is_object())
                .ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "payload.overlaps must be an object".to_string(),
                    )
                })?;
            let start_inclusive = payload_i64(overlaps, "startInclusive")?;
            let end_exclusive = payload_i64(overlaps, "endExclusive")?;
            if start_inclusive < 0 || end_exclusive <= start_inclusive {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "payload.overlaps must satisfy 0 <= startInclusive < endExclusive".to_string(),
                ));
            }
            let task_id = payload_optional_string(&request.payload, "taskId")?;
            let cursor = payload_optional_string(&request.payload, "cursor")?;
            let page_size =
                payload_optional_usize(&request.payload, "pageSize")?.ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "payload.pageSize is required".to_string(),
                    )
                })?;
            if !(1..=crate::db::MAX_AGENT_SESSION_PAGE_SIZE).contains(&page_size) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!(
                        "payload.pageSize must be between 1 and {}",
                        crate::db::MAX_AGENT_SESSION_PAGE_SIZE
                    ),
                ));
            }

            let page = {
                let db = crate::db::acquire_db(&state.db);
                db.list_agent_sessions(
                    &provider,
                    start_inclusive,
                    end_exclusive,
                    task_id.as_deref(),
                    cursor.as_deref(),
                    page_size,
                )
                .map_err(|error| {
                    let status = if matches!(error, rusqlite::Error::InvalidParameterName(_)) {
                        StatusCode::BAD_REQUEST
                    } else {
                        StatusCode::INTERNAL_SERVER_ERROR
                    };
                    (status, format!("Failed to list Agent Sessions: {error}"))
                })?
            };
            json_value(page)
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
        "mark_agent_output_viewed" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let session_id = payload_string(&request.payload, "sessionId")?;
            let output_revision = payload_i64(&request.payload, "outputRevision")?;
            if output_revision < 0 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "outputRevision must be non-negative".to_string(),
                ));
            }
            let changed = {
                let db = crate::db::acquire_db(&state.db);
                db.mark_agent_output_viewed(&task_id, &session_id, output_revision)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to mark Agent output viewed: {error}"),
                        )
                    })?
            };
            json_value(changed)
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
