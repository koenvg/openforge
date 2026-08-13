use super::{
    action_palette::{
        CompanionActionPaletteError, CompanionActionPaletteFuture, CompanionActionPaletteService,
        CompanionProjectActionId, CompanionTaskActionId,
    },
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router_with_sources_event_access_and_pty, AllowAllAuthorizer, CompanionHostStatus,
        CompanionRouterSources, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    live_events::GatewayCompanionStreamAccess,
    pairing::PairingCoordinator,
    project_board::UnavailableCompanionProjectBoardSource,
    task_actions::UnavailableCompanionTaskActionService,
    task_creation::UnavailableCompanionTaskCreator,
    task_detail::UnavailableCompanionTaskDetailSource,
    task_start::UnavailableCompanionTaskStarter,
};
use crate::app_events::AppEventBus;
use axum::{body::Body, http::Request};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

#[derive(Default)]
struct RecordingActionPalette {
    calls: Mutex<Vec<(String, String)>>,
}

impl RecordingActionPalette {
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("calls lock").clone()
    }
}

impl CompanionActionPaletteService for RecordingActionPalette {
    fn available_actions(
        &self,
        task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
        if task_id == "missing" {
            return Err(CompanionActionPaletteError::NotFound);
        }
        Ok(vec![
            CompanionTaskActionId::MergePullRequest,
            CompanionTaskActionId::SetAsideTask,
            CompanionTaskActionId::CompleteTask,
        ])
    }

    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        if project_id == "missing" {
            Err(CompanionActionPaletteError::NotFound)
        } else {
            Ok(vec![CompanionProjectActionId::RefreshGithub])
        }
    }
    fn execute<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionTaskActionId,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            if task_id == "stale" {
                return Err(CompanionActionPaletteError::InvalidTaskState);
            }
            self.calls
                .lock()
                .expect("calls lock")
                .push((task_id.to_string(), action.as_str().to_string()));
            Ok(())
        })
    }

    fn refresh_github<'a>(&'a self, project_id: &'a str) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            self.calls
                .lock()
                .expect("calls lock")
                .push((project_id.to_string(), "refresh_github".to_string()));
            Ok(())
        })
    }
}

fn router(actions: Arc<dyn CompanionActionPaletteService>) -> axum::Router {
    let authorizer: Arc<dyn super::contract::CompanionAuthorizer> = Arc::new(AllowAllAuthorizer);
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("host-1".to_string()),
        authorizer,
        Arc::new(PairingCoordinator::new(
            Arc::new(super::devices::InMemoryCompanionDeviceStore::default()),
            std::time::Duration::from_secs(60),
        )),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board: Arc::new(UnavailableCompanionProjectBoardSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            task_actions: Arc::new(UnavailableCompanionTaskActionService),
            action_palette: actions,
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start: Arc::new(UnavailableCompanionTaskStarter),
            pty_manager: crate::pty_manager::PtyManager::new(),
            events: AppEventBus::new(16, 8),
            stream_access,
        },
    )
}

fn request(method: &str, uri: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
        .body(Body::empty())
        .expect("request")
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

#[tokio::test]
async fn task_actions_snapshot_is_typed_ordered_and_task_scoped() {
    let response = router(Arc::new(RecordingActionPalette::default()))
        .oneshot(request("GET", "/companion/v1/tasks/KVG-3233/actions"))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({
            "taskId": "KVG-3233",
            "actions": [
                {
                    "id": "merge_pull_request",
                    "label": "Merge Pull Request",
                    "keywords": ["merge", "pull request", "pr", "github"],
                    "icon": "merge",
                    "requiresConfirmation": false,
                    "destructive": false
                },
                {
                    "id": "complete_task",
                    "label": "Complete",
                    "keywords": ["complete", "finish", "close", "done"],
                    "icon": "complete",
                    "requiresConfirmation": true,
                    "destructive": true
                },
                {
                    "id": "set_aside_task",
                    "label": "Set aside",
                    "keywords": ["set aside", "out of focus", "hide", "defer"],
                    "icon": "visibility_off",
                    "requiresConfirmation": false,
                    "destructive": false
                }
            ]
        })
    );
}

#[tokio::test]
async fn project_actions_snapshot_advertises_only_supported_project_capabilities() {
    let response = router(Arc::new(RecordingActionPalette::default()))
        .oneshot(request("GET", "/companion/v1/projects/P-1/actions"))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({
            "projectId": "P-1",
            "actions": [{
                "id": "refresh_github",
                "label": "Refresh GitHub",
                "keywords": ["sync", "github", "refresh", "pull"],
                "icon": "refresh",
                "requiresConfirmation": false,
                "destructive": false
            }]
        })
    );
}

#[tokio::test]
async fn explicit_task_and_project_action_routes_dispatch_without_request_bodies() {
    let actions = Arc::new(RecordingActionPalette::default());
    let app = router(actions.clone());
    for (uri, task_id, action) in [
        ("/companion/v1/tasks/T-1/set-aside", "T-1", "set_aside_task"),
        (
            "/companion/v1/tasks/T-2/return-to-board",
            "T-2",
            "return_to_board",
        ),
        ("/companion/v1/tasks/T-3/merge", "T-3", "merge_pull_request"),
        (
            "/companion/v1/tasks/T-4/enqueue",
            "T-4",
            "enqueue_pull_request",
        ),
        ("/companion/v1/tasks/T-5/run-app", "T-5", "run_app"),
    ] {
        let response = app
            .clone()
            .oneshot(request("POST", uri))
            .await
            .expect("router response");
        assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
        assert!(actions
            .calls()
            .contains(&(task_id.to_string(), action.to_string())));
    }

    let response = app
        .oneshot(request("POST", "/companion/v1/projects/P-1/refresh-github"))
        .await
        .expect("router response");
    assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
    assert!(actions
        .calls()
        .contains(&("P-1".to_string(), "refresh_github".to_string())));
}

#[tokio::test]
async fn stale_action_returns_a_typed_conflict_and_is_not_dispatched() {
    let response = router(Arc::new(RecordingActionPalette::default()))
        .oneshot(request("POST", "/companion/v1/tasks/stale/set-aside"))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_task_state"
    );
}
