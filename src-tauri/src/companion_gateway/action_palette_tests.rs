use super::{
    action_palette::{
        execute_task_action, CompanionActionPaletteError, CompanionActionPaletteFuture,
        CompanionActionPaletteService, CompanionActionPaletteTaskAction,
        CompanionMergeMethodPolicy, CompanionProjectActionId, CompanionTaskActionExecutionOwner,
        CompanionTaskActionId, DatabaseCompanionActionPaletteService,
    },
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router_with_sources_event_access_and_pty, AllowAllAuthorizer, CompanionHostStatus,
        CompanionRouterSources, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    live_events::GatewayCompanionStreamAccess,
    pairing::PairingCoordinator,
    project_board::{
        CompanionProjectBoardSource, DatabaseCompanionProjectBoardSource,
        UnavailableCompanionProjectBoardSource,
    },
    task_actions::{
        CompanionTaskActionFuture, CompanionTaskActionService,
        UnavailableCompanionTaskActionService,
    },
    task_creation::UnavailableCompanionTaskCreator,
    task_detail::{
        CompanionTaskDetailSource, DatabaseCompanionTaskDetailSource,
        UnavailableCompanionTaskDetailSource,
    },
    task_start::{CompanionTaskStarter, UnavailableCompanionTaskStarter},
};
use crate::{
    app_events::AppEventBus,
    task_start::{TaskStartError, TaskStartOutcome},
    terminal_task_completion::TerminalTaskCompletionOutcome,
};
use axum::{body::Body, http::Request};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};
use tower::ServiceExt;

#[derive(Default)]
struct RecordingActionPalette {
    calls: Mutex<Vec<(String, String)>>,
    refresh_error: Option<CompanionActionPaletteError>,
    merge_error: Option<CompanionActionPaletteError>,
}

impl RecordingActionPalette {
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("calls lock").clone()
    }

    fn with_refresh_error(error: CompanionActionPaletteError) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            refresh_error: Some(error),
            merge_error: None,
        }
    }

    fn with_merge_error(error: CompanionActionPaletteError) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            refresh_error: None,
            merge_error: Some(error),
        }
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

    fn merge_method_policy(
        &self,
        _task_id: &str,
    ) -> Result<Option<CompanionMergeMethodPolicy>, CompanionActionPaletteError> {
        Ok(Some(CompanionMergeMethodPolicy {
            allowed: vec![
                crate::github_client::PullRequestMergeMethod::Squash,
                crate::github_client::PullRequestMergeMethod::Rebase,
            ],
            default: Some(crate::github_client::PullRequestMergeMethod::Squash),
        }))
    }

    fn merge_pull_request<'a>(
        &'a self,
        task_id: &'a str,
        merge_method: crate::github_client::PullRequestMergeMethod,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            if let Some(error) = self.merge_error.clone() {
                return Err(error);
            }
            self.calls.lock().expect("calls lock").push((
                task_id.to_string(),
                format!("merge_pull_request:{}", merge_method.as_str()),
            ));
            Ok(())
        })
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
    fn execute_palette_action<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionActionPaletteTaskAction,
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

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_> {
        Box::pin(async move {
            if let Some(error) = self.refresh_error.clone() {
                return Err(error);
            }
            self.calls
                .lock()
                .expect("calls lock")
                .push(("global".to_string(), "refresh_github".to_string()));
            Ok(())
        })
    }
}

#[derive(Default)]
struct RecordingTaskStarter {
    calls: Mutex<Vec<String>>,
}

impl RecordingTaskStarter {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("start calls lock").clone()
    }
}

impl CompanionTaskStarter for RecordingTaskStarter {
    fn start<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<TaskStartOutcome, TaskStartError>> + Send + 'a>> {
        self.calls
            .lock()
            .expect("start calls lock")
            .push(task_id.to_string());
        let task_id = task_id.to_string();
        Box::pin(async move { Ok(TaskStartOutcome::Started { task_id }) })
    }
}

#[derive(Default)]
struct RecordingTaskActions {
    calls: Mutex<Vec<(String, String)>>,
}

impl RecordingTaskActions {
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("Task action calls lock").clone()
    }

    fn record(&self, action: &str, task_id: &str) {
        self.calls
            .lock()
            .expect("Task action calls lock")
            .push((action.to_string(), task_id.to_string()));
    }
}

impl CompanionTaskActionService for RecordingTaskActions {
    fn complete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        self.record("complete", task_id);
        let task_id = task_id.to_string();
        Box::pin(async move {
            Ok(TerminalTaskCompletionOutcome::Completed {
                task_id,
                cleanup_scheduled: false,
            })
        })
    }

    fn delete<'a>(&'a self, task_id: &'a str) -> CompanionTaskActionFuture<'a> {
        self.record("delete", task_id);
        let task_id = task_id.to_string();
        Box::pin(async move {
            Ok(TerminalTaskCompletionOutcome::Deleted {
                task_id,
                cleanup_scheduled: false,
            })
        })
    }
}

fn router(action_palette: Arc<dyn CompanionActionPaletteService>) -> axum::Router {
    router_with_task_sources(
        action_palette,
        Arc::new(UnavailableCompanionProjectBoardSource),
        Arc::new(UnavailableCompanionTaskDetailSource),
        Arc::new(UnavailableCompanionTaskActionService),
        Arc::new(UnavailableCompanionTaskStarter),
    )
}

fn router_with_task_sources(
    action_palette: Arc<dyn CompanionActionPaletteService>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
    task_start: Arc<dyn CompanionTaskStarter>,
) -> axum::Router {
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
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator: Arc::new(UnavailableCompanionTaskCreator),
            task_start,
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

#[derive(Clone, Copy)]
struct DelegatedTaskActionContract {
    action: CompanionTaskActionId,
    owner: CompanionTaskActionExecutionOwner,
    task_status: &'static str,
    route: &'static str,
}

const DELEGATED_TASK_ACTIONS: [DelegatedTaskActionContract; 3] = [
    DelegatedTaskActionContract {
        action: CompanionTaskActionId::StartTask,
        owner: CompanionTaskActionExecutionOwner::TaskStarter,
        task_status: "backlog",
        route: "start",
    },
    DelegatedTaskActionContract {
        action: CompanionTaskActionId::DeleteTask,
        owner: CompanionTaskActionExecutionOwner::TaskActions,
        task_status: "backlog",
        route: "delete",
    },
    DelegatedTaskActionContract {
        action: CompanionTaskActionId::CompleteTask,
        owner: CompanionTaskActionExecutionOwner::TaskActions,
        task_status: "doing",
        route: "complete",
    },
];

#[test]
fn delegated_task_actions_declare_their_execution_owner() {
    for contract in DELEGATED_TASK_ACTIONS {
        assert_eq!(contract.action.execution_owner(), contract.owner);
    }
}

#[tokio::test]
async fn palette_execution_rejects_actions_owned_by_task_services() {
    let service: Arc<dyn CompanionActionPaletteService> =
        Arc::new(RecordingActionPalette::default());

    for contract in DELEGATED_TASK_ACTIONS {
        assert_eq!(
            execute_task_action(service.as_ref(), "T-1", contract.action).await,
            Err(CompanionActionPaletteError::InvalidTaskState)
        );
    }
}

#[tokio::test]
async fn advertised_delegated_task_actions_route_to_their_owning_services() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("companion_action_route_contract");
    let database = Arc::new(Mutex::new(database));
    let (backlog_id, doing_id) = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("OpenForge", "/tmp/openforge")
            .expect("create Project");
        let backlog = database
            .create_task("Backlog", "backlog", Some(&project.id), None, None)
            .expect("create backlog Task");
        let doing = database
            .create_task("Doing", "doing", Some(&project.id), None, None)
            .expect("create doing Task");
        (backlog.id, doing.id)
    };
    let task_starter = Arc::new(RecordingTaskStarter::default());
    let task_actions = Arc::new(RecordingTaskActions::default());
    let app = router_with_task_sources(
        Arc::new(DatabaseCompanionActionPaletteService::new(Arc::clone(
            &database,
        ))),
        Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
            &database,
        ))),
        Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
        task_actions.clone(),
        task_starter.clone(),
    );

    for contract in DELEGATED_TASK_ACTIONS {
        let task_id = match contract.task_status {
            "backlog" => backlog_id.as_str(),
            "doing" => doing_id.as_str(),
            status => panic!("unsupported Task status in action contract: {status}"),
        };
        let advertised_response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/companion/v1/tasks/{task_id}/actions"),
            ))
            .await
            .expect("advertised actions response");
        assert_eq!(advertised_response.status(), axum::http::StatusCode::OK);
        let advertised = response_json(advertised_response).await;
        assert!(
            advertised["actions"]
                .as_array()
                .expect("advertised Task actions")
                .iter()
                .any(|presentation| presentation["id"] == contract.action.as_str()),
            "{} was not advertised for {task_id}",
            contract.action.as_str()
        );

        let execution_response = app
            .clone()
            .oneshot(request(
                "POST",
                &format!("/companion/v1/tasks/{task_id}/{}", contract.route),
            ))
            .await
            .expect("action execution response");
        assert_eq!(execution_response.status(), axum::http::StatusCode::OK);
    }

    assert_eq!(task_starter.calls(), vec![backlog_id.clone()]);
    assert_eq!(
        task_actions.calls(),
        vec![
            ("delete".to_string(), backlog_id),
            ("complete".to_string(), doing_id),
        ]
    );
}

#[tokio::test]
async fn task_actions_snapshot_matches_desktop_readiness_policy() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("companion_action_readiness_fallback");
    let database = Arc::new(Mutex::new(database));
    let task_id = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("OpenForge", "/tmp/openforge")
            .expect("create Project");
        let task = database
            .create_task("Doing", "doing", Some(&project.id), None, None)
            .expect("create doing Task");
        database
            .insert_pull_request(
                1,
                &task.id,
                "owner",
                "repo",
                "Ready PR",
                "https://example.com/pr",
                "open",
                1,
                1,
                false,
            )
            .expect("insert pull request");
        database
            .update_pr_head_sha(1, "head-sha")
            .expect("set pull request head SHA");
        database
            .update_pr_mergeability(1, Some(true), Some("clean"))
            .expect("set pull request mergeability");
        database
            .update_pr_merge_method_policy(1, true, r#"["squash","rebase"]"#, Some("squash"))
            .expect("set merge method policy");
        task.id
    };
    let app = router(Arc::new(DatabaseCompanionActionPaletteService::new(
        Arc::clone(&database),
    )));
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/companion/v1/tasks/{task_id}/actions"),
        ))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = response_json(response).await;
    let merge_action = body["actions"]
        .as_array()
        .expect("advertised Task actions")
        .iter()
        .find(|presentation| presentation["id"] == "merge_pull_request")
        .expect("merge action should match desktop readiness fallback");
    assert_eq!(
        merge_action["mergeMethods"],
        serde_json::json!(["squash", "rebase"])
    );
    assert_eq!(merge_action["defaultMergeMethod"], "squash");

    {
        let database = crate::db::acquire_db(&database);
        database
            .update_pr_merge_readiness(
                1,
                &crate::db::PrMergeReadinessFacts {
                    status: Some("ready_to_merge".to_string()),
                    action: Some("enqueue".to_string()),
                    blockers_json: Some("[]".to_string()),
                    warnings_json: Some("[]".to_string()),
                    source_head_sha: Some("head-sha".to_string()),
                    merge_group_sha: None,
                    required_checks_policy_known: Some(true),
                    required_reviews_policy_known: Some(true),
                    merge_queue_required: Some(false),
                    merge_queue_state: None,
                    updated_at: 1,
                },
            )
            .expect("set current mismatched readiness");
    }
    let response = app
        .oneshot(request(
            "GET",
            &format!("/companion/v1/tasks/{task_id}/actions"),
        ))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = response_json(response).await;
    assert!(!body["actions"]
        .as_array()
        .expect("advertised Task actions")
        .iter()
        .any(|presentation| presentation["id"] == "merge_pull_request"));
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
                    "requiresConfirmation": true,
                    "destructive": false,
                    "mergeMethods": ["squash", "rebase"],
                    "defaultMergeMethod": "squash"
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
async fn companion_merge_route_requires_and_dispatches_selected_method() {
    let actions = Arc::new(RecordingActionPalette::default());
    let response = router(actions.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/tasks/T-merge/merge")
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"mergeMethod":"squash"}"#))
                .expect("merge request"),
        )
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
    assert!(actions.calls().contains(&(
        "T-merge".to_string(),
        "merge_pull_request:squash".to_string()
    )));
}

#[tokio::test]
async fn companion_merge_route_surfaces_github_rejection_message() {
    let actions = Arc::new(RecordingActionPalette::with_merge_error(
        CompanionActionPaletteError::MergeRejected(
            "Merge commits are not allowed on this repository.".to_string(),
        ),
    ));
    let response = router(actions)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/tasks/T-merge/merge")
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"mergeMethod":"merge"}"#))
                .expect("merge request"),
        )
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        response_json(response).await["error"]["message"],
        "Merge commits are not allowed on this repository."
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
async fn explicit_task_and_global_action_routes_dispatch_without_request_bodies() {
    let actions = Arc::new(RecordingActionPalette::default());
    let app = router(actions.clone());
    for (uri, task_id, action) in [
        ("/companion/v1/tasks/T-1/set-aside", "T-1", "set_aside_task"),
        (
            "/companion/v1/tasks/T-2/return-to-board",
            "T-2",
            "return_to_board",
        ),
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
        .clone()
        .oneshot(request("POST", "/companion/v1/refresh-github"))
        .await
        .expect("router response");
    assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
    assert!(actions
        .calls()
        .contains(&("global".to_string(), "refresh_github".to_string())));

    let legacy_response = app
        .oneshot(request("POST", "/companion/v1/projects/P-1/refresh-github"))
        .await
        .expect("legacy router response");
    assert_eq!(legacy_response.status(), axum::http::StatusCode::NOT_FOUND,);
}

#[tokio::test]
async fn github_refresh_failures_return_typed_actionable_errors() {
    let cases = [
        (
            CompanionActionPaletteError::GithubTokenMissing,
            axum::http::StatusCode::CONFLICT,
            "invalid_state",
            "GitHub token is not configured. Add one in desktop Settings, then try again.",
        ),
        (
            CompanionActionPaletteError::GithubTokenUnavailable,
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
            "OpenForge could not read the GitHub token. Check desktop developer logs and try again.",
        ),
        (
            CompanionActionPaletteError::GithubSyncFailed { errors: 2 },
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
            "GitHub sync encountered 2 errors. Check desktop developer logs and try again.",
        ),
        (
            CompanionActionPaletteError::GithubRateLimited,
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "GitHub rate limit reached. Try again after it resets.",
        ),
    ];

    for (error, status, code, message) in cases {
        let response = router(Arc::new(RecordingActionPalette::with_refresh_error(error)))
            .oneshot(request("POST", "/companion/v1/refresh-github"))
            .await
            .expect("router response");

        assert_eq!(response.status(), status);
        let body = response_json(response).await;
        assert_eq!(body["error"]["code"], code);
        assert_eq!(body["error"]["message"], message);
    }
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
