use super::{
    CompanionErrorCode, CompanionErrorEnvelope, CompanionHostStatus, PROTOCOL_VERSION,
    PROTOCOL_VERSION_HEADER,
};
use crate::{
    app_events::AppEventBus,
    companion_gateway::{
        action_palette::CompanionActionPaletteService,
        attention::CompanionAttentionSource,
        live_events::CompanionStreamAccess,
        pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
        project_board::CompanionProjectBoardSource,
        rate_limit::{RateLimitError, SlidingWindowRateLimiter},
        task_actions::CompanionTaskActionService,
        task_creation::CompanionTaskCreationService,
        task_detail::CompanionTaskDetailSource,
        task_start::CompanionTaskStarter,
        terminal::CompanionTerminalRegistry,
    },
};
use axum::{
    extract::{connect_info::ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::{net::SocketAddr, sync::Arc, time::Duration};

const AUTHENTICATED_REQUESTS_PER_PEER_PER_MINUTE: usize = 120;
const GLOBAL_AUTHENTICATED_REQUESTS_PER_MINUTE: usize = 4_096;
const MAX_AUTHENTICATED_RATE_LIMIT_PEERS: usize = 1_024;
const AUTHENTICATED_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

pub(crate) trait CompanionAuthorizer: Send + Sync {
    fn authorize(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode>;
}

#[derive(Clone)]
pub(crate) struct CompanionRouterSources {
    pub(crate) attention: Arc<dyn CompanionAttentionSource>,
    pub(crate) project_board: Arc<dyn CompanionProjectBoardSource>,
    pub(crate) task_detail: Arc<dyn CompanionTaskDetailSource>,
    pub(crate) task_actions: Arc<dyn CompanionTaskActionService>,
    pub(crate) action_palette: Arc<dyn CompanionActionPaletteService>,
    pub(crate) task_creator: Arc<dyn CompanionTaskCreationService>,
    pub(crate) task_start: Arc<dyn CompanionTaskStarter>,
    pub(crate) pty_manager: crate::pty_manager::PtyManager,
    pub(crate) events: AppEventBus,
    pub(crate) stream_access: Arc<dyn CompanionStreamAccess>,
}

#[derive(Clone)]
pub(super) struct CompanionRouterState {
    pub(super) host: CompanionHostStatus,
    pub(super) authorizer: Arc<dyn CompanionAuthorizer>,
    pub(super) pairing: Arc<PairingCoordinator>,
    pub(super) attention: Arc<dyn CompanionAttentionSource>,
    pub(super) project_board: Arc<dyn CompanionProjectBoardSource>,
    pub(super) task_detail: Arc<dyn CompanionTaskDetailSource>,
    pub(super) task_actions: Arc<dyn CompanionTaskActionService>,
    pub(super) action_palette: Arc<dyn CompanionActionPaletteService>,
    pub(super) task_creator: Arc<dyn CompanionTaskCreationService>,
    pub(super) task_start: Arc<dyn CompanionTaskStarter>,
    pub(super) pty_manager: crate::pty_manager::PtyManager,
    pub(super) events: AppEventBus,
    pub(super) stream_access: Arc<dyn CompanionStreamAccess>,
    pub(super) terminal_registry: CompanionTerminalRegistry,
}

impl CompanionRouterState {
    pub(super) fn new(
        host: CompanionHostStatus,
        authorizer: Arc<dyn CompanionAuthorizer>,
        pairing: Arc<PairingCoordinator>,
        sources: CompanionRouterSources,
    ) -> Self {
        let CompanionRouterSources {
            attention,
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator,
            task_start,
            pty_manager,
            events,
            stream_access,
        } = sources;

        Self {
            host,
            authorizer,
            pairing,
            attention,
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator,
            task_start,
            pty_manager,
            events,
            stream_access,
            terminal_registry: CompanionTerminalRegistry::default(),
        }
    }
}

pub(super) fn authenticated_rate_limiter() -> Arc<SlidingWindowRateLimiter> {
    Arc::new(SlidingWindowRateLimiter::new(
        AUTHENTICATED_REQUESTS_PER_PEER_PER_MINUTE,
        GLOBAL_AUTHENTICATED_REQUESTS_PER_MINUTE,
        MAX_AUTHENTICATED_RATE_LIMIT_PEERS,
        AUTHENTICATED_RATE_LIMIT_WINDOW,
    ))
}

pub(super) fn error_response(
    status: StatusCode,
    code: CompanionErrorCode,
    message: &str,
) -> Response {
    (status, Json(CompanionErrorEnvelope::new(code, message))).into_response()
}

pub(super) fn authorization_error_response(code: CompanionErrorCode) -> Response {
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
        CompanionErrorCode::InvalidTaskState
        | CompanionErrorCode::InvalidState
        | CompanionErrorCode::OperationInProgress
        | CompanionErrorCode::DesktopActionRequired => (
            StatusCode::CONFLICT,
            "Companion Task action conflicts with current state",
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

pub(super) async fn authenticated_request_guard(
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

pub(super) fn require_compatible_protocol(headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
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

pub(super) fn authorize_versioned_request(
    state: &CompanionRouterState,
    headers: &HeaderMap,
) -> Result<(), CompanionErrorCode> {
    state.authorizer.authorize(headers)?;
    require_compatible_protocol(headers)
}
