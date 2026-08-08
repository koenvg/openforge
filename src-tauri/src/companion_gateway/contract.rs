mod live_events;
mod pairing;
mod snapshots;

use super::{
    attention::CompanionAttentionSource,
    live_events::CompanionStreamAccess,
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    rate_limit::{RateLimitError, SlidingWindowRateLimiter},
    task_detail::CompanionTaskDetailSource,
    terminal::CompanionTerminalRegistry,
};
#[cfg(test)]
use super::{
    attention::UnavailableCompanionAttentionSource, live_events::GatewayCompanionStreamAccess,
    task_detail::UnavailableCompanionTaskDetailSource,
};
use crate::app_events::AppEventBus;
use axum::{
    extract::{connect_info::ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
pub(crate) const PROTOCOL_VERSION: u8 = 1;
pub(crate) const PROTOCOL_VERSION_HEADER: &str = "openforge-companion-protocol-version";
const AUTHENTICATED_REQUESTS_PER_PEER_PER_MINUTE: usize = 120;
const GLOBAL_AUTHENTICATED_REQUESTS_PER_MINUTE: usize = 4_096;
const MAX_AUTHENTICATED_RATE_LIMIT_PEERS: usize = 1_024;
const AUTHENTICATED_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

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
    pub(crate) agent_terminal_available: bool,
    pub(crate) agent_error_summary: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) agent_updated_at: Option<String>,
}

pub(crate) trait CompanionAuthorizer: Send + Sync {
    fn authorize(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode>;
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct PairingUnavailableAuthorizer;

#[cfg(test)]
impl CompanionAuthorizer for PairingUnavailableAuthorizer {
    fn authorize(
        &self,
        _headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        Err(CompanionErrorCode::Unauthenticated)
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct AllowAllAuthorizer;

#[cfg(test)]
impl CompanionAuthorizer for AllowAllAuthorizer {
    fn authorize(
        &self,
        _headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        Ok(CompanionAuthenticatedDevice {
            device_id: "test-device".to_string(),
        })
    }
}

#[derive(Clone)]
pub(crate) struct CompanionRouterSources {
    pub(crate) attention: Arc<dyn CompanionAttentionSource>,
    pub(crate) task_detail: Arc<dyn CompanionTaskDetailSource>,
    pub(crate) pty_manager: crate::pty_manager::PtyManager,
    pub(crate) events: AppEventBus,
    pub(crate) stream_access: Arc<dyn CompanionStreamAccess>,
}

#[derive(Clone)]
struct CompanionRouterState {
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    pty_manager: crate::pty_manager::PtyManager,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
    terminal_registry: CompanionTerminalRegistry,
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

async fn authenticated_request_guard(
    State(rate_limit): State<Arc<SlidingWindowRateLimiter>>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    request: Request,
    next: Next,
) -> Response {
    let peer = connect_info
        .map(|ConnectInfo(address)| address.ip())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    match rate_limit.admit(peer) {
        Ok(()) => next.run(request).await,
        Err(RateLimitError::Limited) => {
            authorization_error_response(CompanionErrorCode::RateLimited)
        }
        Err(RateLimitError::Unavailable) => {
            authorization_error_response(CompanionErrorCode::TemporarilyUnavailable)
        }
    }
}

fn require_compatible_protocol(headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
    let compatible = headers
        .get(PROTOCOL_VERSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u8>().ok())
        .is_some_and(|version| version == PROTOCOL_VERSION);
    if compatible {
        Ok(())
    } else {
        Err(CompanionErrorCode::IncompatibleVersion)
    }
}

fn authorize_versioned_request(
    state: &CompanionRouterState,
    headers: &HeaderMap,
) -> Result<(), CompanionErrorCode> {
    state.authorizer.authorize(headers)?;
    require_compatible_protocol(headers)
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

#[cfg(test)]
pub(crate) fn create_router_with_sources_and_event_access(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
) -> Router {
    create_router_with_sources_event_access_and_pty(
        host,
        authorizer,
        pairing,
        CompanionRouterSources {
            attention,
            task_detail,
            events,
            stream_access,
            pty_manager: crate::pty_manager::PtyManager::new(),
        },
    )
}

pub(crate) fn create_router_with_sources_event_access_and_pty(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    sources: CompanionRouterSources,
) -> Router {
    let CompanionRouterSources {
        attention,
        task_detail,
        pty_manager,
        events,
        stream_access,
    } = sources;
    let pairing_routes = pairing::routes(Arc::clone(&pairing));

    let authenticated_rate_limit = Arc::new(SlidingWindowRateLimiter::new(
        AUTHENTICATED_REQUESTS_PER_PEER_PER_MINUTE,
        GLOBAL_AUTHENTICATED_REQUESTS_PER_MINUTE,
        MAX_AUTHENTICATED_RATE_LIMIT_PEERS,
        AUTHENTICATED_RATE_LIMIT_WINDOW,
    ));
    let authenticated_routes = Router::new()
        .merge(snapshots::routes())
        .merge(live_events::routes())
        .route_layer(middleware::from_fn_with_state(
            authenticated_rate_limit,
            authenticated_request_guard,
        ));

    Router::new()
        .merge(authenticated_routes)
        .merge(pairing_routes)
        .fallback(not_found_handler)
        .with_state(CompanionRouterState {
            host,
            authorizer,
            pairing,
            attention,
            task_detail,
            pty_manager,
            events,
            stream_access,
            terminal_registry: CompanionTerminalRegistry::default(),
        })
}
