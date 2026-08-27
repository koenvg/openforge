mod action_palette;
mod live_events;
mod pairing;
mod snapshots;
mod task_actions;
mod task_creation;
use super::{
    action_palette::CompanionActionPaletteService,
    action_presentation::{CompanionProjectActionPresentation, CompanionTaskActionPresentation},
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
};
#[cfg(test)]
use super::{
    action_palette::UnavailableCompanionActionPaletteService,
    attention::UnavailableCompanionAttentionSource, live_events::GatewayCompanionStreamAccess,
    project_board::UnavailableCompanionProjectBoardSource,
    task_actions::UnavailableCompanionTaskActionService,
    task_creation::UnavailableCompanionTaskCreator,
    task_detail::UnavailableCompanionTaskDetailSource, task_start::UnavailableCompanionTaskStarter,
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
pub(crate) const PROTOCOL_VERSION: u8 = 3;
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
    InvalidTaskState,
    OperationInProgress,
    NotFound,
    InvalidState,
    DesktopActionRequired,
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
            Self::InvalidTaskState => "invalid_task_state",
            Self::OperationInProgress => "operation_in_progress",
            Self::NotFound => "not_found",
            Self::InvalidState => "invalid_state",
            Self::DesktopActionRequired => "desktop_action_required",
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
pub(crate) struct CompanionProjectCatalogItem {
    pub(crate) project_id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectCatalogResponse {
    pub(crate) snapshot_at: String,
    pub(crate) projects: Vec<CompanionProjectCatalogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectBoardCounts {
    pub(crate) focus: usize,
    pub(crate) in_flight: usize,
    pub(crate) out_of_focus: usize,
    pub(crate) backlog: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectBoardTask {
    pub(crate) task_id: String,
    pub(crate) title: String,
    pub(crate) lane: crate::project_board::ProjectBoardLane,
    pub(crate) state: String,
    pub(crate) reason: String,
    pub(crate) activity_at: String,
    pub(crate) dependency_count: usize,
    pub(crate) waiting_dependency_count: usize,
    pub(crate) labels: Vec<String>,
    pub(crate) pull_request_count: usize,
    pub(crate) primary_pull_request_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectBoardLanes {
    pub(crate) focus: Vec<CompanionProjectBoardTask>,
    pub(crate) in_flight: Vec<CompanionProjectBoardTask>,
    pub(crate) out_of_focus: Vec<CompanionProjectBoardTask>,
    pub(crate) backlog: Vec<CompanionProjectBoardTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectBoardResponse {
    pub(crate) snapshot_at: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) counts: CompanionProjectBoardCounts,
    pub(crate) lanes: CompanionProjectBoardLanes,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskRelationshipResponse {
    pub(crate) task_id: String,
    pub(crate) title: String,
    pub(crate) board_status: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionDependentTaskResponse {
    pub(crate) task_id: String,
    pub(crate) title: String,
    pub(crate) board_status: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) remaining_dependency_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskDetailResponse {
    pub(crate) task_id: String,
    pub(crate) initial_prompt: String,
    pub(crate) title: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) board_status: String,
    pub(crate) agent_state: String,
    pub(crate) agent_terminal_available: bool,
    pub(crate) agent_error_summary: Option<String>,
    pub(crate) labels: Vec<String>,
    pub(crate) dependencies: Vec<CompanionTaskRelationshipResponse>,
    pub(crate) dependent_tasks: Vec<CompanionDependentTaskResponse>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) agent_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskCompleteResponse {
    pub(crate) task_id: String,
    pub(crate) board_status: String,
    pub(crate) cleanup_scheduled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionTaskDeleteOutcome {
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskDeleteResponse {
    pub(crate) task_id: String,
    pub(crate) outcome: CompanionTaskDeleteOutcome,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskStartResponse {
    pub(crate) task_id: String,
    pub(crate) outcome: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskCreateResponse {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
    pub(crate) board_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskActionsResponse {
    pub(crate) task_id: String,
    pub(crate) actions: Vec<CompanionTaskActionPresentation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionProjectActionsResponse {
    pub(crate) project_id: String,
    pub(crate) actions: Vec<CompanionProjectActionPresentation>,
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
struct CompanionRouterState {
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
    action_palette: Arc<dyn CompanionActionPaletteService>,
    task_creator: Arc<dyn CompanionTaskCreationService>,
    task_start: Arc<dyn CompanionTaskStarter>,
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
pub(crate) fn create_router_with_project_board(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
) -> Router {
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_event_access_and_pty(
        host,
        authorizer,
        pairing,
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board,
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            task_actions: Arc::new(UnavailableCompanionTaskActionService),
            action_palette: Arc::new(
                super::action_palette::UnavailableCompanionActionPaletteService,
            ),
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start: Arc::new(UnavailableCompanionTaskStarter),
            pty_manager: crate::pty_manager::PtyManager::new(),
            events: AppEventBus::new(16, 8),
            stream_access,
        },
    )
}
#[cfg(test)]
pub(crate) fn create_router_with_task_creation(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_creator: Arc<dyn CompanionTaskCreationService>,
) -> Router {
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_event_access_and_pty(
        host,
        authorizer,
        pairing,
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board,
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            task_actions: Arc::new(UnavailableCompanionTaskActionService),
            action_palette: Arc::new(
                super::action_palette::UnavailableCompanionActionPaletteService,
            ),
            task_creator,
            task_start: Arc::new(UnavailableCompanionTaskStarter),
            pty_manager: crate::pty_manager::PtyManager::new(),
            events: AppEventBus::new(16, 8),
            stream_access,
        },
    )
}

#[cfg(test)]
pub(crate) fn create_router_with_task_actions(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
) -> Router {
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_event_access_and_pty(
        host,
        authorizer,
        pairing,
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board,
            task_detail,
            task_actions,
            action_palette: Arc::new(UnavailableCompanionActionPaletteService),
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start: Arc::new(UnavailableCompanionTaskStarter),
            pty_manager: crate::pty_manager::PtyManager::new(),
            events: AppEventBus::new(16, 8),
            stream_access,
        },
    )
}

#[cfg(test)]
pub(crate) fn create_router_with_task_start(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_start: Arc<dyn CompanionTaskStarter>,
) -> Router {
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_event_access_and_pty(
        host,
        authorizer,
        pairing,
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board,
            task_detail,
            task_actions: Arc::new(UnavailableCompanionTaskActionService),
            action_palette: Arc::new(
                super::action_palette::UnavailableCompanionActionPaletteService,
            ),
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start,
            pty_manager: crate::pty_manager::PtyManager::new(),
            events: AppEventBus::new(16, 8),
            stream_access,
        },
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
            project_board: Arc::new(UnavailableCompanionProjectBoardSource),
            task_detail,
            task_actions: Arc::new(UnavailableCompanionTaskActionService),
            action_palette: Arc::new(
                super::action_palette::UnavailableCompanionActionPaletteService,
            ),
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start: Arc::new(UnavailableCompanionTaskStarter),
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
    let pairing_routes = pairing::routes(Arc::clone(&pairing));

    let authenticated_rate_limit = Arc::new(SlidingWindowRateLimiter::new(
        AUTHENTICATED_REQUESTS_PER_PEER_PER_MINUTE,
        GLOBAL_AUTHENTICATED_REQUESTS_PER_MINUTE,
        MAX_AUTHENTICATED_RATE_LIMIT_PEERS,
        AUTHENTICATED_RATE_LIMIT_WINDOW,
    ));
    let authenticated_routes = Router::new()
        .merge(snapshots::routes())
        .merge(task_actions::routes())
        .merge(action_palette::routes())
        .merge(task_creation::routes())
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
        })
}
