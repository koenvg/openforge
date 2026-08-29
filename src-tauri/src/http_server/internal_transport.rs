use super::{
    authentication::require_backend_token, AppState, SidecarDegradedState, StartupResumeReadiness,
};
use crate::{
    app_events::{AppEventCursor, AppEventEnvelope, AppEventFrame},
    process_memory::{collect_process_memory_diagnostics, ProcessMemoryDiagnostics},
    process_memory_history::ProcessMemoryHistorySnapshot,
};
use axum::{
    extract::{DefaultBodyLimit, Json, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Router,
};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::Arc, time::Duration};

const APP_INVOKE_MAX_BODY_BYTES: usize = 96 * 1024 * 1024;
const APP_EVENT_KEEPALIVE_TEXT: &str = "openforge-event-stream-keepalive";
#[cfg(test)]
const APP_EVENT_KEEPALIVE_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(not(test))]
const APP_EVENT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReadinessEventsResponse {
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReadinessResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub events: AppReadinessEventsResponse,
    pub startup_resume: StartupResumeReadiness,
    pub degraded: Vec<SidecarDegradedState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInvokeRequest {
    pub command: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInvokeResponse {
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppHealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

pub(super) fn app_event_sse_data(envelope: &AppEventEnvelope) -> String {
    serde_json::to_string(envelope).unwrap_or_else(|_| {
        "{\"eventName\":\"app-event-serialization-failed\",\"payload\":null}".to_string()
    })
}

fn app_event_sse_event(envelope: &AppEventEnvelope) -> Event {
    let event = Event::default()
        .event("openforge-event")
        .data(app_event_sse_data(envelope));
    if let Some(id) = envelope.id.as_ref() {
        event.id(id.as_sse_id())
    } else {
        event
    }
}

fn app_event_keep_alive() -> KeepAlive {
    KeepAlive::new()
        .interval(APP_EVENT_KEEPALIVE_INTERVAL)
        .text(APP_EVENT_KEEPALIVE_TEXT)
}

async fn app_health_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AppHealthResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;
    Ok(Json(AppHealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

async fn app_readiness_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AppReadinessResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;
    Ok(Json(AppReadinessResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        events: AppReadinessEventsResponse {
            available: state.app_event_bus.is_some() || state.app_event_tx.is_some(),
        },
        startup_resume: state.sidecar_readiness.startup_resume(),
        degraded: state.sidecar_readiness.degraded(),
    }))
}

async fn app_events_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;

    if let Some(bus) = state.app_event_bus.as_ref() {
        let cursor = headers
            .get("last-event-id")
            .and_then(|value| value.to_str().ok())
            .and_then(AppEventCursor::parse);
        let subscription = bus.subscribe(cursor).map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "app event stream is not available".to_string(),
            )
        })?;
        let stream = futures::stream::unfold(subscription, |mut subscription| async move {
            subscription.recv().await.map(|frame| {
                let event = match frame {
                    AppEventFrame::Event(envelope) => app_event_sse_event(&envelope),
                    AppEventFrame::Gap(gap) => app_event_sse_event(&gap.into_envelope()),
                };
                (Ok(event), subscription)
            })
        })
        .boxed();

        return Ok(Sse::new(stream).keep_alive(app_event_keep_alive()));
    }

    let Some(sender) = state.app_event_tx.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "app event stream is not available".to_string(),
        ));
    };

    let receiver = sender.subscribe();
    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(envelope) => return Some((Ok(app_event_sse_event(&envelope)), receiver)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    })
    .boxed();

    Ok(Sse::new(stream).keep_alive(app_event_keep_alive()))
}

async fn app_invoke_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AppInvokeRequest>,
) -> Result<Json<AppInvokeResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;

    let value = crate::app_invoke::handle_command(&state, &request).await?;
    Ok(Json(AppInvokeResponse { value }))
}

async fn debug_process_memory_handler(
    State(state): State<AppState>,
) -> Result<Json<ProcessMemoryDiagnostics>, (StatusCode, String)> {
    collect_process_memory_diagnostics(
        Arc::clone(&state.db),
        state.pty_manager.clone(),
        state.plugin_host.clone(),
        state.github_client.response_cache_diagnostics(),
    )
    .await
    .map(Json)
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))
}
async fn debug_process_memory_history_handler(
    State(state): State<AppState>,
) -> Json<ProcessMemoryHistorySnapshot> {
    Json(state.process_memory_history.snapshot())
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/app/health", get(app_health_handler))
        .route("/app/readiness", get(app_readiness_handler))
        .route("/app/events", get(app_events_handler))
        .route(
            "/app/invoke",
            post(app_invoke_handler).layer(DefaultBodyLimit::max(APP_INVOKE_MAX_BODY_BYTES)),
        )
        .route("/debug/process-memory", get(debug_process_memory_handler))
        .route(
            "/debug/process-memory/history",
            get(debug_process_memory_history_handler),
        )
}
