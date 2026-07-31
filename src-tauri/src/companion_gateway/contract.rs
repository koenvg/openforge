use super::{
    attention::CompanionAttentionSource,
    live_events::{companion_event_stream, CompanionStreamAccess},
    pairing::{
        PairingCoordinator, PairingError, PairingPollResponse, PairingRequestKind,
        PairingSubmission,
    },
    task_detail::CompanionTaskDetailSource,
};
#[cfg(test)]
use super::{
    attention::UnavailableCompanionAttentionSource, live_events::GatewayCompanionStreamAccess,
    task_detail::UnavailableCompanionTaskDetailSource,
};
use crate::app_events::{AppEventBus, AppEventCursor};
use axum::{
    extract::{
        connect_info::ConnectInfo, rejection::JsonRejection, DefaultBodyLimit, Path, Request, State,
    },
    http::{header::AUTHORIZATION, HeaderMap, Method, StatusCode},
    middleware::{self, Next},
    response::{sse::KeepAlive, IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};

pub(crate) const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone)]
pub(crate) struct CompanionHostStatus {
    host_id: String,
}

impl CompanionHostStatus {
    pub(crate) fn new(host_id: String) -> Self {
        Self { host_id }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionErrorCode {
    Unauthenticated,
    Revoked,
    IncompatibleVersion,
    InvalidRequest,
    NotFound,
    RateLimited,
    TemporarilyUnavailable,
}

#[cfg(test)]
impl CompanionErrorCode {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::Revoked => "revoked",
            Self::IncompatibleVersion => "incompatible_version",
            Self::InvalidRequest => "invalid_request",
            Self::NotFound => "not_found",
            Self::RateLimited => "rate_limited",
            Self::TemporarilyUnavailable => "temporarily_unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionErrorBody {
    pub(crate) code: CompanionErrorCode,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CompanionErrorEnvelope {
    pub(crate) error: CompanionErrorBody,
}

impl CompanionErrorEnvelope {
    fn new(code: CompanionErrorCode, message: impl Into<String>) -> Self {
        Self {
            error: CompanionErrorBody {
                code,
                message: message.into(),
                request_id: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionHostStatusResponse {
    pub(crate) host_id: String,
    pub(crate) protocol_version: u8,
    pub(crate) server_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionAttentionItem {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) title: String,
    pub(crate) state: String,
    pub(crate) reason: String,
    pub(crate) activity_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionAttentionSnapshot {
    pub(crate) snapshot_at: String,
    pub(crate) items: Vec<CompanionAttentionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskDetailResponse {
    pub(crate) task_id: String,
    pub(crate) title: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) board_status: String,
    pub(crate) handoff_notes: Option<String>,
    pub(crate) agent_state: String,
    pub(crate) agent_error_summary: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) agent_updated_at: Option<String>,
}

pub(crate) trait CompanionAuthorizer: Send + Sync {
    fn authorize(&self, headers: &HeaderMap) -> Result<(), CompanionErrorCode>;
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct PairingUnavailableAuthorizer;

#[cfg(test)]
impl CompanionAuthorizer for PairingUnavailableAuthorizer {
    fn authorize(&self, _headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
        Err(CompanionErrorCode::Unauthenticated)
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct AllowAllAuthorizer;

#[cfg(test)]
impl CompanionAuthorizer for AllowAllAuthorizer {
    fn authorize(&self, _headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
        Ok(())
    }
}

#[derive(Clone)]
struct CompanionRouterState {
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
}

fn error_response(status: StatusCode, code: CompanionErrorCode, message: &str) -> Response {
    (status, Json(CompanionErrorEnvelope::new(code, message))).into_response()
}
fn authorization_error_response(code: CompanionErrorCode) -> Response {
    let (status, message) = match code {
        CompanionErrorCode::Unauthenticated | CompanionErrorCode::Revoked => (
            StatusCode::UNAUTHORIZED,
            "Companion device authentication is required",
        ),
        CompanionErrorCode::IncompatibleVersion => (
            StatusCode::CONFLICT,
            "Companion protocol version is incompatible",
        ),
        CompanionErrorCode::InvalidRequest => (
            StatusCode::BAD_REQUEST,
            "Companion authorization request is invalid",
        ),
        CompanionErrorCode::NotFound => (
            StatusCode::NOT_FOUND,
            "Companion authorization record was not found",
        ),
        CompanionErrorCode::RateLimited => (
            StatusCode::TOO_MANY_REQUESTS,
            "Companion authorization is rate limited",
        ),
        CompanionErrorCode::TemporarilyUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Companion authorization is temporarily unavailable",
        ),
    };
    error_response(status, code, message)
}

fn pairing_error_response(error: PairingError) -> Response {
    let (status, code, message) = match error {
        PairingError::Invalid => (
            StatusCode::UNAUTHORIZED,
            CompanionErrorCode::Unauthenticated,
            "Pairing authorization is invalid",
        ),
        PairingError::Gone => (
            StatusCode::GONE,
            CompanionErrorCode::NotFound,
            "Pairing session is no longer available",
        ),
        PairingError::Rejected => (
            StatusCode::FORBIDDEN,
            CompanionErrorCode::Unauthenticated,
            "Pairing request was rejected",
        ),
        PairingError::RateLimited => (
            StatusCode::TOO_MANY_REQUESTS,
            CompanionErrorCode::RateLimited,
            "Too many pairing attempts",
        ),
        PairingError::InvalidDevice => (
            StatusCode::BAD_REQUEST,
            CompanionErrorCode::InvalidRequest,
            "Device name or platform is invalid",
        ),
        PairingError::Unavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Pairing is temporarily unavailable",
        ),
    };
    error_response(status, code, message)
}

fn invalid_pairing_request_response(status: StatusCode) -> Response {
    error_response(
        status,
        CompanionErrorCode::InvalidRequest,
        "Pairing request body is invalid",
    )
}

async fn pairing_request_guard(
    State(pairing): State<Arc<PairingCoordinator>>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    request: Request,
    next: Next,
) -> Response {
    let kind = if request.method() == Method::POST {
        PairingRequestKind::Submission
    } else {
        PairingRequestKind::Poll
    };
    let peer = connect_info
        .map(|ConnectInfo(address)| address.ip())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    if let Err(error) = pairing.admit_request(peer, kind) {
        return pairing_error_response(error);
    }

    let oversized_header = request
        .headers()
        .get(AUTHORIZATION)
        .is_some_and(|value| value.as_bytes().len() > 128);
    let oversized_body = request
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > 4_096);
    if oversized_header || oversized_body {
        return invalid_pairing_request_response(StatusCode::PAYLOAD_TOO_LARGE);
    }

    next.run(request).await
}

async fn status_handler(State(state): State<CompanionRouterState>, headers: HeaderMap) -> Response {
    if let Err(code) = state.authorizer.authorize(&headers) {
        return authorization_error_response(code);
    }

    Json(CompanionHostStatusResponse {
        host_id: state.host.host_id,
        protocol_version: PROTOCOL_VERSION,
        server_time: chrono::Utc::now().to_rfc3339(),
    })
    .into_response()
}

async fn events_handler(State(state): State<CompanionRouterState>, headers: HeaderMap) -> Response {
    let access = match state.stream_access.open(&headers) {
        Ok(access) => access,
        Err(code) => return authorization_error_response(code),
    };
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
    let stream = match companion_event_stream(&state.events, cursor, access) {
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
fn attention_activity_at(timestamp: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|value| value.to_rfc3339())
}

async fn attention_handler(
    State(state): State<CompanionRouterState>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = state.authorizer.authorize(&headers) {
        return authorization_error_response(code);
    }

    let rows = match state.attention.snapshot() {
        Ok(rows) => rows,
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Task attention is temporarily unavailable",
            );
        }
    };
    let items = rows
        .into_iter()
        .map(|row| {
            Some(CompanionAttentionItem {
                task_id: row.task_id,
                project_id: row.project_id,
                project_name: row.project_name,
                title: row.title,
                state: row.state,
                reason: row.reason,
                activity_at: attention_activity_at(row.activity_at)?,
            })
        })
        .collect::<Option<Vec<_>>>();
    let Some(items) = items else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task attention is temporarily unavailable",
        );
    };

    Json(CompanionAttentionSnapshot {
        snapshot_at: chrono::Utc::now().to_rfc3339(),
        items,
    })
    .into_response()
}

fn detail_timestamp(timestamp: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|value| value.to_rfc3339())
}

async fn task_detail_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = state.authorizer.authorize(&headers) {
        return authorization_error_response(code);
    }

    let detail = match state.task_detail.get(&task_id) {
        Ok(Some(detail)) => detail,
        Ok(None) => {
            return error_response(
                StatusCode::NOT_FOUND,
                CompanionErrorCode::NotFound,
                "Task was not found",
            );
        }
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Task detail is temporarily unavailable",
            );
        }
    };

    let Some(created_at) = detail_timestamp(detail.created_at) else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task detail is temporarily unavailable",
        );
    };
    let Some(updated_at) = detail_timestamp(detail.updated_at) else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task detail is temporarily unavailable",
        );
    };
    let agent_updated_at = match detail.agent_updated_at {
        Some(timestamp) => {
            let Some(timestamp) = detail_timestamp(timestamp) else {
                return error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    CompanionErrorCode::TemporarilyUnavailable,
                    "Task detail is temporarily unavailable",
                );
            };
            Some(timestamp)
        }
        None => None,
    };

    Json(CompanionTaskDetailResponse {
        task_id: detail.task_id,
        title: detail.title,
        project_id: detail.project_id,
        project_name: detail.project_name,
        board_status: detail.board_status,
        handoff_notes: detail.handoff_notes,
        agent_state: detail.agent_state,
        agent_error_summary: detail.agent_error_summary,
        created_at,
        updated_at,
        agent_updated_at,
    })
    .into_response()
}

async fn submit_pairing_handler(
    State(state): State<CompanionRouterState>,
    submission: Result<Json<PairingSubmission>, JsonRejection>,
) -> Response {
    let Json(submission) = match submission {
        Ok(submission) => submission,
        Err(rejection) => {
            let status = if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            };
            return invalid_pairing_request_response(status);
        }
    };
    match state.pairing.submit(submission) {
        Ok(response) => (StatusCode::ACCEPTED, Json(response)).into_response(),
        Err(error) => pairing_error_response(error),
    }
}

async fn poll_pairing_handler(
    State(state): State<CompanionRouterState>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(secret) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Pairing "))
    else {
        return pairing_error_response(PairingError::Invalid);
    };
    match state.pairing.poll(&request_id, secret) {
        Ok(
            response @ PairingPollResponse {
                status: "pending", ..
            },
        ) => (StatusCode::ACCEPTED, Json(response)).into_response(),
        Ok(response) => Json(response).into_response(),
        Err(error) => pairing_error_response(error),
    }
}

async fn not_found_handler() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Companion resource was not found",
    )
}

#[cfg(test)]
pub(crate) fn create_router(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
) -> Router {
    create_router_with_sources(
        host,
        authorizer,
        pairing,
        Arc::new(UnavailableCompanionAttentionSource),
        Arc::new(UnavailableCompanionTaskDetailSource),
    )
}

#[cfg(test)]
pub(crate) fn create_router_with_attention(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
) -> Router {
    create_router_with_sources(
        host,
        authorizer,
        pairing,
        attention,
        Arc::new(UnavailableCompanionTaskDetailSource),
    )
}

#[cfg(test)]
pub(crate) fn create_router_with_sources(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
) -> Router {
    create_router_with_sources_and_events(
        host,
        authorizer,
        pairing,
        attention,
        task_detail,
        AppEventBus::new(16, 8),
    )
}

#[cfg(test)]
pub(crate) fn create_router_with_sources_and_events(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    events: AppEventBus,
) -> Router {
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_and_event_access(
        host,
        authorizer,
        pairing,
        attention,
        task_detail,
        events,
        stream_access,
    )
}

pub(crate) fn create_router_with_sources_and_event_access(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
) -> Router {
    let pairing_routes = Router::new()
        .route(
            "/companion/v1/pairing/requests",
            post(submit_pairing_handler),
        )
        .route(
            "/companion/v1/pairing/requests/:request_id",
            get(poll_pairing_handler),
        )
        .route_layer(middleware::from_fn_with_state(
            pairing.clone(),
            pairing_request_guard,
        ))
        .layer(DefaultBodyLimit::max(4_096));

    Router::new()
        .route("/companion/v1/status", get(status_handler))
        .route("/companion/v1/attention", get(attention_handler))
        .route("/companion/v1/events", get(events_handler))
        .route("/companion/v1/tasks/:task_id", get(task_detail_handler))
        .merge(pairing_routes)
        .fallback(not_found_handler)
        .with_state(CompanionRouterState {
            host,
            authorizer,
            pairing,
            attention,
            task_detail,
            events,
            stream_access,
        })
}
