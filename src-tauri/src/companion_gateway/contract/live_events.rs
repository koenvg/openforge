use super::{
    authorization_error_response, error_response, require_compatible_protocol, CompanionErrorCode,
    CompanionRouterState,
};
use crate::{
    app_events::AppEventCursor,
    companion_gateway::{
        live_events::companion_event_stream,
        terminal::{serve_terminal_socket, TerminalOutputPresentation},
    },
};
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{sse::KeepAlive, IntoResponse, Response, Sse},
    routing::get,
    Router,
};
use std::sync::Arc;

const TERMINAL_CONTROL_MAX_BYTES: usize = 4 * 1_024;

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new()
        .route("/companion/v1/events", get(events_handler))
        .route(
            "/companion/v1/tasks/:task_id/agent-terminal",
            get(agent_terminal_handler),
        )
}

async fn events_handler(State(state): State<CompanionRouterState>, headers: HeaderMap) -> Response {
    let access = match state.stream_access.open(&headers) {
        Ok(access) => access,
        Err(code) => return authorization_error_response(code),
    };
    if let Err(code) = require_compatible_protocol(&headers) {
        return authorization_error_response(code);
    }
    let cursor = match headers.get("last-event-id") {
        Some(value) => {
            let Some(cursor) = value.to_str().ok().and_then(AppEventCursor::parse) else {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    CompanionErrorCode::InvalidRequest,
                    "Companion event cursor is invalid",
                );
            };
            Some(cursor)
        }
        None => None,
    };
    let stream = match companion_event_stream(
        &state.events,
        cursor,
        access,
        Arc::clone(&state.project_board),
    ) {
        Ok(stream) => stream,
        Err(code) => return authorization_error_response(code),
    };
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(std::time::Duration::from_secs(15))
                .text("openforge-companion-keepalive"),
        )
        .into_response()
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOptions {
    #[serde(default)]
    include_agent_output: bool,
}

async fn agent_terminal_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
    Query(options): Query<TerminalOptions>,
    upgrade: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
) -> Response {
    let device = match state.authorizer.authorize(&headers) {
        Ok(device) => device,
        Err(code) => return authorization_error_response(code),
    };
    if let Err(code) = require_compatible_protocol(&headers) {
        return authorization_error_response(code);
    }
    let cancellation = match state.stream_access.open(&headers) {
        Ok(cancellation) => cancellation,
        Err(code) => return authorization_error_response(code),
    };
    let upgrade = match upgrade {
        Ok(upgrade) => upgrade,
        Err(rejection) => return rejection.into_response(),
    };
    let pending_occurrence = if options.include_agent_output {
        match state.task_detail.agent_output_occurrence(&task_id) {
            Ok(value) => value,
            Err(_) => {
                return error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    CompanionErrorCode::TemporarilyUnavailable,
                    "Agent output is temporarily unavailable",
                )
            }
        }
    } else {
        None
    };
    let detail_source = Arc::clone(&state.task_detail);
    let pty_manager = state.pty_manager.clone();
    let registry = state.terminal_registry.clone();
    upgrade
        .max_message_size(TERMINAL_CONTROL_MAX_BYTES)
        .max_frame_size(TERMINAL_CONTROL_MAX_BYTES)
        .on_upgrade(move |socket| {
            serve_terminal_socket(
                socket,
                task_id,
                device.device_id,
                pty_manager,
                cancellation,
                registry,
                TerminalOutputPresentation {
                    pending_occurrence,
                    include_agent_output: options.include_agent_output,
                    detail_source,
                },
            )
        })
        .into_response()
}
