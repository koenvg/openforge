mod action_palette;
mod live_events;
mod pairing;
mod router_state;
mod snapshots;
mod task_actions;
mod task_creation;
#[cfg(test)]
mod test_constructors;

use router_state::{authenticated_rate_limiter, authenticated_request_guard, CompanionRouterState};
use router_state::{
    authorization_error_response, authorize_versioned_request, error_response,
    require_compatible_protocol,
};
pub(crate) use router_state::{CompanionAuthorizer, CompanionRouterSources};
#[cfg(test)]
pub(crate) use test_constructors::{
    create_router, create_router_with_attention, create_router_with_project_board,
    create_router_with_sources, create_router_with_sources_and_event_access,
    create_router_with_sources_and_events, create_router_with_task_actions,
    create_router_with_task_creation, create_router_with_task_start, AllowAllAuthorizer,
    PairingUnavailableAuthorizer,
};

use super::{
    action_presentation::{CompanionProjectActionPresentation, CompanionTaskActionPresentation},
    pairing::PairingCoordinator,
};
use axum::{http::StatusCode, middleware, response::Response, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
pub(crate) const PROTOCOL_VERSION: u8 = 3;
pub(crate) const PROTOCOL_VERSION_HEADER: &str = "openforge-companion-protocol-version";

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

async fn not_found_handler() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Companion resource was not found",
    )
}

pub(crate) fn create_router_with_sources_event_access_and_pty(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    sources: CompanionRouterSources,
) -> Router {
    let pairing_routes = pairing::routes(Arc::clone(&pairing));
    let authenticated_rate_limit = authenticated_rate_limiter();
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
        .with_state(CompanionRouterState::new(
            host, authorizer, pairing, sources,
        ))
}
