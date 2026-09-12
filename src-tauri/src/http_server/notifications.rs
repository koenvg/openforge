//! Private durable-delivery endpoint. It never makes a provider permission decision.
use super::AppState;
use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use openforge_session_protocol::{
    NotificationDelivery, NotificationReceipt, MAX_NOTIFICATION_BYTES,
};
use std::time::Duration;

pub(super) async fn receive(State(state): State<AppState>, request: Request) -> Response {
    if request.headers().get_all("authorization").iter().count() != 1 {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if let Err(error) = super::authentication::require_backend_token(&state, request.headers()) {
        return error.into_response();
    }
    let bytes = match tokio::time::timeout(
        Duration::from_secs(2),
        to_bytes(request.into_body(), MAX_NOTIFICATION_BYTES + 2048),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        _ => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                "notification delivery exceeds limit or is incomplete",
            )
                .into_response()
        }
    };
    let delivery: NotificationDelivery = match serde_json::from_slice(&bytes) {
        Ok(delivery) => delivery,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, "invalid notification delivery").into_response()
        }
    };
    if delivery.envelope.validate().is_err() {
        return (StatusCode::BAD_REQUEST, "invalid notification envelope").into_response();
    }
    let task_id = delivery.envelope.payload.task_id.clone();
    let _guard = state.deferred_completion_watcher.task_guard(&task_id).await;
    let claude = delivery.envelope.payload.provider == "claude-code";
    let pty_instance_id = delivery.envelope.payload.pty_instance_id;
    let outstanding =
        if claude && delivery.envelope.payload.raw_event_type.as_deref() == Some("stop") {
            Some(
                crate::claude_background_work::outstanding_background_work(
                    state.pty_manager.as_ref(),
                    &task_id,
                    Some(pty_instance_id),
                    delivery.envelope.payload.transcript_path.as_deref(),
                    delivery.envelope.payload.background_tasks.as_ref(),
                )
                .await,
            )
        } else {
            None
        };
    let completion = match outstanding
        .as_ref()
        .map(|work| {
            super::deferred_completion::completion_plan(
                &state,
                delivery.envelope.payload.transcript_path.clone(),
                work,
            )
        })
        .transpose()
    {
        Ok(plan) => plan.flatten(),
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "completion plan unavailable",
            )
                .into_response()
        }
    };
    let mut notification: crate::agent_lifecycle::AgentLifecycleNotification =
        match serde_json::from_value(serde_json::json!(delivery.envelope.payload)) {
            Ok(notification) => notification,
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        };
    let receipt = NotificationReceipt {
        journal_id: delivery.journal_id.clone(),
        position: delivery.position,
    };
    let transcript = delivery.envelope.payload.transcript_path.clone();
    let activity = delivery.envelope.payload.activity_snapshot.clone();
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::db::acquire_db(&db).apply_delivery_with_completion(&delivery, completion.as_ref())
    })
    .await;
    let application = match result {
        Ok(Ok(application)) => application,
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "notification domain commit not confirmed",
            )
                .into_response()
        }
    };
    let change = application.change;
    if let Some(change) = change.as_ref() {
        notification.kind = change.kind;
    }
    if claude && change.is_some() {
        if let Some(completion) = application.completion {
            state
                .deferred_completion_watcher
                .schedule(&state, completion)
                .await;
        } else {
            state.deferred_completion_watcher.resumed(&task_id).await;
        }
    }
    // Only the transaction winner publishes effects. On restart the presentation is
    // hydrated from the committed session, not from a second lifecycle mutation.
    if super::legacy_transport::events::publish_recorded_lifecycle(
        state,
        notification,
        transcript,
        activity,
        change,
        |db, refresh| async move {
            crate::task_metadata_refresh::refresh_queued_task_display_title_with_ai_once(
                db, refresh,
            )
            .await
        },
    )
    .await
    .is_err()
    {
        log::warn!("notification committed; presentation follow-up failed");
    }
    Json(receipt).into_response()
}
