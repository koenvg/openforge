use super::{
    contract::{
        create_router_with_task_start, AllowAllAuthorizer, CompanionAuthorizer, CompanionErrorCode,
        CompanionHostStatus, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    project_board::{CompanionProject, CompanionProjectBoardSource},
    task_detail::{CompanionTaskDetail, CompanionTaskDetailSource},
    task_start::CompanionTaskStarter,
};
use crate::task_start::{DesktopActionReason, TaskStartError, TaskStartOutcome};
use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
    response::Response,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";
const TASK_ID: &str = "KVG-3031";
const PROJECT_ID: &str = "P-1";

#[derive(Debug)]
struct FixedTaskStarter {
    result: Result<TaskStartOutcome, TaskStartError>,
    calls: AtomicUsize,
}

impl FixedTaskStarter {
    fn new(result: Result<TaskStartOutcome, TaskStartError>) -> Self {
        Self {
            result,
            calls: AtomicUsize::new(0),
        }
    }
}

impl CompanionTaskStarter for FixedTaskStarter {
    fn start<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<TaskStartOutcome, TaskStartError>> + Send + 'a>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let result = self.result.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug)]
struct FixedTaskDetailSource {
    detail: Option<CompanionTaskDetail>,
}

impl CompanionTaskDetailSource for FixedTaskDetailSource {
    fn get(&self, _task_id: &str) -> Result<Option<CompanionTaskDetail>, String> {
        Ok(self.detail.clone())
    }
}

#[derive(Debug)]
struct FixedProjectBoardSource {
    visible: bool,
}

impl CompanionProjectBoardSource for FixedProjectBoardSource {
    fn catalog(&self) -> Result<Vec<CompanionProject>, String> {
        Ok(Vec::new())
    }

    fn is_project_visible(&self, _project_id: &str) -> Result<bool, String> {
        Ok(self.visible)
    }

    fn board(
        &self,
        _project_id: &str,
    ) -> Result<Option<crate::project_board::ProjectBoardProjection>, String> {
        Ok(None)
    }
}

#[derive(Debug)]
struct RejectAuthorizer(CompanionErrorCode);

impl CompanionAuthorizer for RejectAuthorizer {
    fn authorize(
        &self,
        _headers: &axum::http::HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        Err(self.0)
    }
}

fn pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
}

fn detail(board_status: &str) -> CompanionTaskDetail {
    CompanionTaskDetail {
        task_id: TASK_ID.to_string(),
        initial_prompt: "Start this Task from mobile".to_string(),
        title: "Start from mobile".to_string(),
        project_id: PROJECT_ID.to_string(),
        project_name: "OpenForge".to_string(),
        board_status: board_status.to_string(),
        agent_state: "waiting".to_string(),
        agent_error_summary: None,
        labels: Vec::new(),
        dependencies: Vec::new(),
        dependent_tasks: Vec::new(),
        created_at: 1_754_000_000,
        updated_at: 1_754_000_100,
        agent_updated_at: None,
    }
}

fn router(
    authorizer: Arc<dyn CompanionAuthorizer>,
    board_status: &str,
    project_visible: bool,
    starter: Arc<dyn CompanionTaskStarter>,
) -> axum::Router {
    create_router_with_task_start(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        pairing(),
        Arc::new(FixedProjectBoardSource {
            visible: project_visible,
        }),
        Arc::new(FixedTaskDetailSource {
            detail: Some(detail(board_status)),
        }),
        starter,
    )
}

fn start_request(body: Body) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(format!("/companion/v1/tasks/{TASK_ID}/start"))
        .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
        .body(body)
        .expect("request")
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

#[tokio::test]
async fn authenticated_visible_backlog_task_can_start_with_identity_only() {
    let starter = Arc::new(FixedTaskStarter::new(Ok(TaskStartOutcome::Started {
        task_id: TASK_ID.to_string(),
    })));
    let response = router(
        Arc::new(AllowAllAuthorizer),
        "backlog",
        true,
        starter.clone(),
    )
    .oneshot(start_request(Body::empty()))
    .await
    .expect("router response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({ "taskId": TASK_ID, "outcome": "started" })
    );
    assert_eq!(starter.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn start_requires_authorization_visible_project_and_current_backlog_state() {
    let scenarios = [
        (
            Arc::new(RejectAuthorizer(CompanionErrorCode::Revoked)) as Arc<dyn CompanionAuthorizer>,
            "backlog",
            true,
            StatusCode::UNAUTHORIZED,
            "revoked",
        ),
        (
            Arc::new(AllowAllAuthorizer) as Arc<dyn CompanionAuthorizer>,
            "backlog",
            false,
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            Arc::new(AllowAllAuthorizer) as Arc<dyn CompanionAuthorizer>,
            "doing",
            true,
            StatusCode::CONFLICT,
            "invalid_state",
        ),
    ];

    for (authorizer, board_status, visible, expected_status, expected_code) in scenarios {
        let starter = Arc::new(FixedTaskStarter::new(Ok(TaskStartOutcome::Started {
            task_id: TASK_ID.to_string(),
        })));
        let response = router(authorizer, board_status, visible, starter.clone())
            .oneshot(start_request(Body::empty()))
            .await
            .expect("router response");

        assert_eq!(response.status(), expected_status);
        assert_eq!(
            response_json(response).await["error"]["code"],
            expected_code
        );
        assert_eq!(starter.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn start_rejects_caller_supplied_execution_configuration() {
    let starter = Arc::new(FixedTaskStarter::new(Ok(TaskStartOutcome::Started {
        task_id: TASK_ID.to_string(),
    })));
    let response = router(
        Arc::new(AllowAllAuthorizer),
        "backlog",
        true,
        starter.clone(),
    )
    .oneshot(start_request(Body::from(
        r#"{"provider":"pi","workspacePath":"/tmp/unsafe"}"#,
    )))
    .await
    .expect("router response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_request"
    );
    assert_eq!(starter.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn start_maps_lifecycle_outcomes_to_safe_companion_states() {
    let scenarios = [
        (
            Ok(TaskStartOutcome::DesktopActionRequired {
                task_id: TASK_ID.to_string(),
                reason: DesktopActionReason::ExistingBranchDiverged,
            }),
            StatusCode::CONFLICT,
            "desktop_action_required",
        ),
        (
            Err(TaskStartError::AlreadyInProgress),
            StatusCode::CONFLICT,
            "operation_in_progress",
        ),
        (
            Err(TaskStartError::DependencyBlocked {
                dependency_id: "KVG-3000".to_string(),
            }),
            StatusCode::CONFLICT,
            "invalid_state",
        ),
        (
            Err(TaskStartError::ProviderLaunch(
                "provider secret /Users/example".to_string(),
            )),
            StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
        ),
    ];

    for (result, expected_status, expected_code) in scenarios {
        let response = router(
            Arc::new(AllowAllAuthorizer),
            "backlog",
            true,
            Arc::new(FixedTaskStarter::new(result)),
        )
        .oneshot(start_request(Body::empty()))
        .await
        .expect("router response");

        assert_eq!(response.status(), expected_status);
        let json = response_json(response).await;
        assert_eq!(json["error"]["code"], expected_code);
        assert!(!json.to_string().contains("/Users/example"));
        assert!(!json.to_string().contains("secret"));
    }
}
