use crate::app_events::publish_app_event_to_runtime;
use crate::http_server::AppState;
use axum::{extract::Json, http::StatusCode};
use log::{error, warn};
use std::{path::PathBuf, sync::Arc};

const TASK_DISPLAY_TITLE_METADATA_UPDATES_ENABLED_CONFIG_KEY: &str =
    "task_display_title_metadata_updates_enabled";

pub(super) fn emit_task_changed(
    state: &AppState,
    action: &str,
    task_id: &str,
    project_id: Option<&str>,
) {
    let mut payload = serde_json::json!({
        "action": action,
        "task_id": task_id,
    });
    if let Some(project_id) = project_id {
        payload["project_id"] = serde_json::json!(project_id);
    }

    if let Some(events) = &state.app_event_bus {
        let result = match action {
            "created" => Some(events.tasks().created(task_id, project_id)),
            "updated" => Some(events.tasks().updated(task_id, project_id)),
            _ => None,
        };
        match result {
            Some(Err(error)) => warn!(
                "[http_server] Failed to publish task-changed app event: {:?}",
                error
            ),
            None => publish_app_event_to_runtime(
                state.app.as_ref(),
                &state.app_event_tx,
                "task-changed",
                &payload,
            ),
            Some(Ok(_)) => {}
        }
    } else {
        publish_app_event_to_runtime(
            state.app.as_ref(),
            &state.app_event_tx,
            "task-changed",
            &payload,
        );
    }
}

fn emit_agent_status_changed(
    state: &AppState,
    change: &crate::agent_lifecycle::AgentLifecycleStatusChange,
) {
    let project_id = crate::db::acquire_db(&state.db)
        .get_task(&change.task_id)
        .ok()
        .flatten()
        .and_then(|task| task.project_id);
    let payload = serde_json::json!({
        "task_id": change.task_id,
        "project_id": project_id,
        "status": change.status,
        "provider": change.provider,
        "kind": change.kind,
        "pty_instance_id": change.pty_instance_id,
        "raw_event_type": change.raw_event_type,
        "raw_status_type": change.raw_status_type,
    });

    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "agent-status-changed",
        &payload,
    );
}

pub(in crate::http_server) fn record_agent_lifecycle_notification(
    state: &AppState,
    notification: &crate::agent_lifecycle::AgentLifecycleNotification,
) -> Option<crate::agent_lifecycle::AgentLifecycleStatusChange> {
    let db = crate::db::acquire_db(&state.db);
    match crate::agent_lifecycle::apply_agent_lifecycle_notification(&db, notification) {
        Ok(status_change) => status_change,
        Err(error) => {
            error!(
                "[http_server] Failed to apply {} lifecycle notification for task {}: {}",
                notification.provider, notification.task_id, error
            );
            None
        }
    }
}

pub(super) async fn handle_agent_lifecycle_notification(
    state: AppState,
    notification: crate::agent_lifecycle::AgentLifecycleNotification,
    transcript_path: Option<String>,
    activity_snapshot: Option<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification_with_refresh(
        state,
        notification,
        transcript_path,
        activity_snapshot,
        |db, queued_refresh| async move {
            crate::task_metadata_refresh::refresh_queued_task_display_title_with_ai_once(
                db,
                queued_refresh,
            )
            .await
        },
    )
    .await
}

pub(in crate::http_server) async fn handle_agent_lifecycle_notification_with_refresh<F, Fut>(
    state: AppState,
    notification: crate::agent_lifecycle::AgentLifecycleNotification,
    transcript_path: Option<String>,
    activity_snapshot: Option<String>,
    title_refresh: F,
) -> Result<Json<serde_json::Value>, StatusCode>
where
    F: FnOnce(
            Arc<std::sync::Mutex<crate::db::Database>>,
            crate::task_metadata_refresh::QueuedTaskDisplayTitleRefresh,
        ) -> Fut
        + Send
        + 'static,
    Fut: std::future::Future<Output = Result<bool, String>> + Send + 'static,
{
    let status_change = record_agent_lifecycle_notification(&state, &notification);

    if let Some(change) = status_change {
        emit_agent_status_changed(&state, &change);
        if change.status == "completed" {
            if let Some(manager) = state.pty_manager.as_ref() {
                crate::completed_session_replay::capture_completed_session_replay(
                    &state.db,
                    manager,
                    &change.task_id,
                )
                .await;
            }
        }
        let should_start_title_refresh =
            should_start_task_display_title_refresh(&state, &notification).map_err(|error| {
                error!(
                    "[http_server] failed to resolve task display title metadata update config for task {}: {}",
                    notification.task_id, error
                );
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        if should_start_title_refresh {
            let refresh_state = state.clone();
            let db = Arc::clone(&refresh_state.db);
            let task_id = notification.task_id.clone();
            let provider = notification.provider.clone();
            let transcript_path = transcript_path.map(PathBuf::from);
            let activity_snapshot = activity_snapshot.clone();
            let queued_refresh = crate::task_metadata_refresh::queue_task_display_title_refresh(
                task_id.clone(),
                provider,
                transcript_path,
                activity_snapshot,
            );
            tokio::spawn(async move {
                match title_refresh(db, queued_refresh).await {
                    Ok(true) => {
                        let project_id = crate::db::acquire_db(&refresh_state.db)
                            .get_task(&task_id)
                            .ok()
                            .flatten()
                            .and_then(|task| task.project_id);
                        emit_task_changed(
                            &refresh_state,
                            "updated",
                            &task_id,
                            project_id.as_deref(),
                        );
                    }
                    Ok(false) => {}
                    Err(error) => warn!(
                        "[http_server] task display title refresh failed error_bytes={}",
                        error.len()
                    ),
                }
            });
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

fn task_display_title_metadata_updates_enabled(
    state: &AppState,
    task_id: &str,
) -> rusqlite::Result<bool> {
    crate::db::acquire_db(&state.db).resolve_task_bool(
        task_id,
        TASK_DISPLAY_TITLE_METADATA_UPDATES_ENABLED_CONFIG_KEY,
        false,
    )
}

pub(in crate::http_server) fn should_start_task_display_title_refresh(
    state: &AppState,
    notification: &crate::agent_lifecycle::AgentLifecycleNotification,
) -> rusqlite::Result<bool> {
    let enabled = task_display_title_metadata_updates_enabled(state, &notification.task_id)?;
    if !enabled {
        return Ok(false);
    }

    if notification.kind != crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy {
        return Ok(false);
    }

    Ok(match notification.provider.as_str() {
        "codex" => notification.raw_event_type.as_deref() == Some("UserPromptSubmit"),
        "claude-code" => notification.raw_event_type.as_deref() == Some("user-prompt-submit"),
        "opencode" => notification.raw_event_type.as_deref() == Some("message.updated"),
        "pi" => notification.raw_event_type.as_deref() == Some("user_prompt"),
        _ => false,
    })
}
