use super::{
    create_router_with_sources_event_access_and_pty, CompanionAuthorizer, CompanionErrorCode,
    CompanionHostStatus, CompanionRouterSources,
};
use crate::{
    app_events::AppEventBus,
    companion_gateway::{
        action_palette::UnavailableCompanionActionPaletteService,
        attention::{CompanionAttentionSource, UnavailableCompanionAttentionSource},
        live_events::{CompanionStreamAccess, GatewayCompanionStreamAccess},
        pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
        project_board::{CompanionProjectBoardSource, UnavailableCompanionProjectBoardSource},
        task_actions::{CompanionTaskActionService, UnavailableCompanionTaskActionService},
        task_creation::{CompanionTaskCreationService, UnavailableCompanionTaskCreator},
        task_detail::{CompanionTaskDetailSource, UnavailableCompanionTaskDetailSource},
        task_start::{CompanionTaskStarter, UnavailableCompanionTaskStarter},
    },
};
use axum::{http::HeaderMap, Router};
use std::sync::Arc;

#[derive(Debug, Default)]
pub(crate) struct PairingUnavailableAuthorizer;

impl CompanionAuthorizer for PairingUnavailableAuthorizer {
    fn authorize(
        &self,
        _headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        Err(CompanionErrorCode::Unauthenticated)
    }
}

#[derive(Debug, Default)]
pub(crate) struct AllowAllAuthorizer;

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

fn unavailable_sources(authorizer: &Arc<dyn CompanionAuthorizer>) -> CompanionRouterSources {
    CompanionRouterSources {
        attention: Arc::new(UnavailableCompanionAttentionSource),
        project_board: Arc::new(UnavailableCompanionProjectBoardSource),
        task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
        task_actions: Arc::new(UnavailableCompanionTaskActionService),
        action_palette: Arc::new(UnavailableCompanionActionPaletteService),
        task_creator: Arc::new(UnavailableCompanionTaskCreator),
        task_start: Arc::new(UnavailableCompanionTaskStarter),
        pty_manager: crate::pty_manager::PtyManager::new(),
        events: AppEventBus::new(16, 8),
        stream_access: Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(authorizer))),
    }
}

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

pub(crate) fn create_router_with_project_board(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
) -> Router {
    let mut sources = unavailable_sources(&authorizer);
    sources.project_board = project_board;
    create_router_with_sources_event_access_and_pty(host, authorizer, pairing, sources)
}

pub(crate) fn create_router_with_task_creation(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_creator: Arc<dyn CompanionTaskCreationService>,
) -> Router {
    let mut sources = unavailable_sources(&authorizer);
    sources.project_board = project_board;
    sources.task_creator = task_creator;
    create_router_with_sources_event_access_and_pty(host, authorizer, pairing, sources)
}

pub(crate) fn create_router_with_task_actions(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
) -> Router {
    let mut sources = unavailable_sources(&authorizer);
    sources.project_board = project_board;
    sources.task_detail = task_detail;
    sources.task_actions = task_actions;
    create_router_with_sources_event_access_and_pty(host, authorizer, pairing, sources)
}

pub(crate) fn create_router_with_task_start(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_start: Arc<dyn CompanionTaskStarter>,
) -> Router {
    let mut sources = unavailable_sources(&authorizer);
    sources.project_board = project_board;
    sources.task_detail = task_detail;
    sources.task_start = task_start;
    create_router_with_sources_event_access_and_pty(host, authorizer, pairing, sources)
}

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
    let mut sources = unavailable_sources(&authorizer);
    sources.attention = attention;
    sources.task_detail = task_detail;
    sources.events = events;
    sources.stream_access = stream_access;
    create_router_with_sources_event_access_and_pty(host, authorizer, pairing, sources)
}
