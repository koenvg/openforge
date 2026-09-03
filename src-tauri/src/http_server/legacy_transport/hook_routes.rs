use super::{events::handle_agent_lifecycle_notification, models::*};
use crate::{app_events::publish_app_event_to_runtime, http_server::AppState};
use axum::{
    extract::{Json, Query, State},
    http::StatusCode,
};
use log::{info, warn};

fn claude_event_kind_from_event(
    event_type: &str,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match event_type {
        "user-prompt-submit" | "pre-tool-use" | "post-tool-use" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy)
        }
        "stop" | "session-end" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended),
        "notification-permission" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::RequestedPermission)
        }
        "notification" => None,
        _ => None,
    }
}

#[cfg(test)]
pub(in crate::http_server) fn map_hook_to_status(
    event_type: &str,
    current_status: &str,
) -> Option<String> {
    let kind = claude_event_kind_from_event(event_type)?;
    let (target_status, eligible_statuses) =
        crate::agent_lifecycle::lifecycle_status_transition(kind);
    if !eligible_statuses.contains(&current_status) {
        return None;
    }
    if current_status == target_status
        && kind != crate::agent_lifecycle::AgentLifecycleEventKind::Ended
    {
        return None;
    }
    Some(target_status.to_string())
}

fn agent_session_is_running(state: &AppState, task_id: &str) -> bool {
    crate::db::acquire_db(&state.db)
        .get_latest_session_for_ticket(task_id)
        .ok()
        .flatten()
        .is_some_and(|session| session.status == "running")
}

/// Claude's `Stop` hook fires at the end of every turn, including turns that leave a
/// backgrounded shell, an armed `Monitor` or a subagent running. The session resumes on its
/// own when that work notifies, so reporting `Ended` there marks the task as needing
/// attention while nothing is actually waiting on the user.
///
async fn deferrable_background_work(
    state: &AppState,
    event_type: &str,
    task_id: &str,
    pty_instance_id: Option<u64>,
    transcript_path: Option<&str>,
    background_tasks: Option<&serde_json::Value>,
) -> crate::claude_background_work::OutstandingWork {
    if event_type != "stop" || !agent_session_is_running(state, task_id) {
        return crate::claude_background_work::OutstandingWork::Replayed(Vec::new());
    }

    let outstanding = crate::claude_background_work::outstanding_background_work(
        state.pty_manager.as_ref(),
        task_id,
        pty_instance_id,
        transcript_path,
        background_tasks,
    )
    .await;
    if !outstanding.is_empty() {
        info!(
            "[http_server] task {} still has background work running per {}, deferring completion: {}",
            task_id,
            outstanding.source(),
            crate::claude_background_work::describe_tasks(outstanding.tasks())
        );
    }
    outstanding
}

const CLAUDE_ACTIVITY_SNAPSHOT_BYTES: usize = 8 * 1024;

fn non_empty_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn tail_bounded_lossy_text(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    String::from_utf8_lossy(&text.as_bytes()[text.len() - max_bytes..]).to_string()
}

pub(in crate::http_server) fn bounded_claude_activity_snapshot(
    event_type: &str,
    payload: &ClaudeHookPayload,
    provider_session_id: Option<&str>,
) -> Option<String> {
    let mut activity = serde_json::Map::new();
    activity.insert(
        "event_type".to_string(),
        serde_json::Value::String(event_type.to_string()),
    );
    if let Some(session_id) = provider_session_id.filter(|session_id| !session_id.trim().is_empty())
    {
        activity.insert(
            "session_id".to_string(),
            serde_json::Value::String(session_id.to_string()),
        );
    }
    if let Some(tool_name) = payload
        .tool_name
        .as_deref()
        .filter(|tool_name| !tool_name.trim().is_empty())
    {
        activity.insert(
            "tool_name".to_string(),
            serde_json::Value::String(tool_name.to_string()),
        );
    }
    if let Some(tool_input) = &payload.tool_input {
        let tool_input = tool_input.to_string();
        activity.insert(
            "tool_input_tail".to_string(),
            serde_json::Value::String(tail_bounded_lossy_text(
                &tool_input,
                CLAUDE_ACTIVITY_SNAPSHOT_BYTES / 2,
            )),
        );
    }

    let content = serde_json::Value::Object(activity).to_string();
    Some(tail_bounded_lossy_text(
        &content,
        CLAUDE_ACTIVITY_SNAPSHOT_BYTES,
    ))
}

async fn handle_hook(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
    event_type: &str,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let task_id = non_empty_string(payload.claude_task_id.clone())
        .or_else(|| non_empty_string(query.task_id.clone()));
    let provider_session_id = non_empty_string(payload.session_id.clone())
        .or_else(|| non_empty_string(query.session_id.clone()));
    let pty_instance_id = payload.pty_instance_id.or(query.pty_instance_id);

    if let Some(task_id) = task_id {
        let payload_value = serde_json::to_value(&payload).unwrap_or(serde_json::json!({}));
        publish_app_event_to_runtime(
            state.app.as_ref(),
            &state.app_event_tx,
            "claude-hook-event",
            &serde_json::json!({
                "task_id": task_id,
                "event_type": event_type,
                "payload": payload_value
            }),
        );

        if let Some(kind) = claude_event_kind_from_event(event_type) {
            let _task_guard = state.deferred_completion_watcher.task_guard(&task_id).await;
            let outstanding = deferrable_background_work(
                &state,
                event_type,
                &task_id,
                pty_instance_id,
                payload.transcript_path.as_deref(),
                payload.background_tasks.as_ref(),
            )
            .await;
            let kind = if outstanding.is_empty() {
                kind
            } else {
                crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy
            };
            let notification = crate::agent_lifecycle::AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task_id.clone(),
                pty_instance_id,
                provider_session_id: provider_session_id.clone(),
                kind,
                raw_event_type: Some(event_type.to_string()),
                raw_status_type: None,
            };
            let response = handle_agent_lifecycle_notification(
                state.clone(),
                notification,
                payload.transcript_path.clone(),
                bounded_claude_activity_snapshot(
                    event_type,
                    &payload,
                    provider_session_id.as_deref(),
                ),
            )
            .await;
            if outstanding.is_empty() {
                state.deferred_completion_watcher.resumed(&task_id).await;
            } else {
                state
                    .deferred_completion_watcher
                    .deferred(
                        &state,
                        crate::http_server::deferred_completion::DeferredCompletion {
                            task_id,
                            pty_instance_id,
                            transcript_path: payload.transcript_path.clone(),
                        },
                        &outstanding,
                    )
                    .await;
            }
            return response;
        }
    } else {
        warn!(
            "[http_server] Warning: Hook event '{}' received without CLAUDE_TASK_ID",
            event_type
        );
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn pi_agent_start_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "pi".to_string(),
            task_id: payload.task_id,
            pty_instance_id: Some(payload.pty_instance_id),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::Started,
            raw_event_type: Some("agent.start".to_string()),
            raw_status_type: None,
        },
        None,
        None,
    )
    .await
}

pub async fn pi_agent_end_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "pi".to_string(),
            task_id: payload.task_id,
            pty_instance_id: Some(payload.pty_instance_id),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::Ended,
            raw_event_type: Some("agent.end".to_string()),
            raw_status_type: None,
        },
        None,
        None,
    )
    .await
}

fn opencode_event_kind_from_event(
    event_type: &str,
    status_type: Option<&str>,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match event_type {
        "session.created" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Started),
        "session.idle" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended),
        "session.error" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Failed),
        "session.status" if status_type == Some("idle") => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended)
        }
        "session.status"
        | "session.updated"
        | "message.updated"
        | "tool.execute.before"
        | "tool.execute.after" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy),
        _ => None,
    }
}

#[cfg(test)]
pub(in crate::http_server) fn opencode_status_from_event(
    event_type: &str,
    status_type: Option<&str>,
) -> Option<(&'static str, &'static [&'static str])> {
    let kind = opencode_event_kind_from_event(event_type, status_type)?;
    Some(crate::agent_lifecycle::lifecycle_status_transition(kind))
}

pub async fn opencode_event_handler(
    State(state): State<AppState>,
    Json(payload): Json<OpenCodePluginEventPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "opencode-plugin-event",
        &serde_json::json!({
            "task_id": payload.task_id,
            "event_type": payload.event_type,
            "session_id": payload.session_id,
            "status_type": payload.status_type,
        }),
    );

    let Some(kind) =
        opencode_event_kind_from_event(&payload.event_type, payload.status_type.as_deref())
    else {
        return Ok(Json(serde_json::json!({ "status": "ok" })));
    };

    let notification = crate::agent_lifecycle::AgentLifecycleNotification {
        provider: "opencode".to_string(),
        task_id: payload.task_id,
        pty_instance_id: Some(payload.pty_instance_id),
        provider_session_id: payload.session_id,
        kind,
        raw_event_type: Some(payload.event_type),
        raw_status_type: payload.status_type,
    };
    let transcript_path = payload.transcript_path;
    let activity_snapshot = payload.activity_snapshot;

    handle_agent_lifecycle_notification(state, notification, transcript_path, activity_snapshot)
        .await
}

pub async fn agent_lifecycle_handler(
    State(state): State<AppState>,
    Json(payload): Json<AgentLifecycleNotificationPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(
        state,
        payload.notification,
        payload.transcript_path,
        payload.activity_snapshot,
    )
    .await
}

pub async fn hook_stop_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Query(query), Json(payload), "stop").await
}

pub async fn hook_user_prompt_submit_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(
        State(state),
        Query(query),
        Json(payload),
        "user-prompt-submit",
    )
    .await
}

pub async fn hook_pre_tool_use_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Query(query), Json(payload), "pre-tool-use").await
}

pub async fn hook_post_tool_use_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Query(query), Json(payload), "post-tool-use").await
}

pub async fn hook_session_end_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Query(query), Json(payload), "session-end").await
}

pub async fn hook_notification_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Query(query), Json(payload), "notification").await
}

pub async fn hook_notification_permission_handler(
    State(state): State<AppState>,
    Query(query): Query<ClaudeHookQuery>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(
        State(state),
        Query(query),
        Json(payload),
        "notification-permission",
    )
    .await
}

/// Shared handler for Grok's lifecycle hooks (installed by `grok_hooks`).
///
/// Mirrors `handle_hook`'s Claude flow: identity travels via query params
/// (`task_id`, `pty_instance_id`, `session_id`), the raw event type is mapped
/// to an `AgentLifecycleEventKind` via `grok_hooks::grok_lifecycle_kind_from_event`,
/// and the resulting notification is dispatched through the same
/// `handle_agent_lifecycle_notification` seam every other provider uses. That
/// seam (`apply_agent_lifecycle_notification`) is what persists the Grok
/// session id whenever `provider_session_id` is present — the same place
/// Claude's session id gets persisted, since Claude has no dedicated
/// session-start hook either.
async fn handle_grok_hook(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
    event_type: &str,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let task_id = non_empty_string(query.task_id.clone());
    let provider_session_id = non_empty_string(query.session_id.clone());
    let pty_instance_id = query.pty_instance_id.as_deref().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        match trimmed.parse::<u64>() {
            Ok(value) => Some(value),
            Err(_) => {
                warn!(
                    "[http_server] Warning: Grok hook event '{}' received unparseable pty_instance_id '{}'",
                    event_type, raw
                );
                None
            }
        }
    });

    if let Some(task_id) = task_id {
        if let Some(kind) = crate::grok_hooks::grok_lifecycle_kind_from_event(event_type) {
            let notification = crate::agent_lifecycle::AgentLifecycleNotification {
                provider: "grok".to_string(),
                task_id,
                pty_instance_id,
                provider_session_id,
                kind,
                raw_event_type: Some(event_type.to_string()),
                raw_status_type: None,
            };
            return handle_agent_lifecycle_notification(state, notification, None, None).await;
        } else {
            warn!(
                "[http_server] Warning: Grok hook received unmapped event type '{}'",
                event_type
            );
        }
    } else {
        warn!(
            "[http_server] Warning: Grok hook event '{}' received without task_id",
            event_type
        );
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn grok_hook_session_start_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "session-start").await
}

pub async fn grok_hook_user_prompt_submit_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "user-prompt-submit").await
}

pub async fn grok_hook_pre_tool_use_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "pre-tool-use").await
}

pub async fn grok_hook_post_tool_use_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "post-tool-use").await
}

pub async fn grok_hook_stop_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "stop").await
}

pub async fn grok_hook_session_end_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "session-end").await
}

pub async fn grok_hook_notification_permission_handler(
    State(state): State<AppState>,
    Query(query): Query<GrokHookQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_grok_hook(State(state), Query(query), "notification-permission").await
}
