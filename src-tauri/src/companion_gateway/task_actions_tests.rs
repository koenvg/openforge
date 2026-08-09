use super::{
    contract::{
        create_router_with_task_actions, AllowAllAuthorizer, CompanionAuthorizer,
        CompanionErrorCode, CompanionHostStatus,
    },
    devices::InMemoryCompanionDeviceStore,
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    project_board::DatabaseCompanionProjectBoardSource,
    task_actions::CompanionTaskActionService,
    task_detail::DatabaseCompanionTaskDetailSource,
};
use crate::{
    app_events::{AppEventBus, AppEventFrame},
    db::Database,
    task_claims::{TaskClaims, TaskOperation},
    terminal_task_completion::{
        RuntimeShutdownFuture, TerminalTaskCompletionService, TerminalTaskRuntime,
    },
};
use axum::{body::Body, http::Request, response::Response};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

#[derive(Clone)]
struct RecordingRuntime {
    database: Arc<Mutex<Database>>,
    calls: Arc<Mutex<Vec<(String, String)>>>,
}

impl RecordingRuntime {
    fn new(database: Arc<Mutex<Database>>) -> Self {
        Self {
            database,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn record(&self, operation: &str, task_id: &str) {
        let status = crate::db::acquire_db(&self.database)
            .get_task(task_id)
            .expect("read Task while stopping runtime")
            .expect("Task exists while stopping runtime")
            .status;
        self.calls
            .lock()
            .expect("runtime calls lock")
            .push((operation.to_string(), status));
    }

    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("runtime calls lock").clone()
    }
}

impl TerminalTaskRuntime for RecordingRuntime {
    fn stop_agent<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            self.record("agent", task_id);
            Ok(())
        })
    }

    fn stop_task_shells<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            self.record("shells", task_id);
            Ok(())
        })
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

fn router(
    database: Arc<Mutex<Database>>,
    authorizer: Arc<dyn CompanionAuthorizer>,
    actions: Arc<dyn CompanionTaskActionService>,
) -> axum::Router {
    create_router_with_task_actions(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        pairing(),
        Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
            &database,
        ))),
        Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
        actions,
    )
}

fn complete_request(task_id: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/companion/v1/tasks/{task_id}/complete"))
        .header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        )
        .body(Body::empty())
        .expect("request")
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

#[tokio::test]
async fn authenticated_complete_stops_runtime_retains_reference_data_and_invalidates() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_complete_route");
    let database = Arc::new(Mutex::new(database));
    let (project_id, task_id) = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("OpenForge", "/tmp/openforge")
            .expect("create Project");
        let task = database
            .create_task(
                "Complete from mobile",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create doing Task");
        (project.id, task.id)
    };
    let runtime = RecordingRuntime::new(Arc::clone(&database));
    let events = AppEventBus::new(16, 8);
    let mut subscription = events.subscribe(None).expect("subscribe to events");
    let service = Arc::new(TerminalTaskCompletionService::new(
        Arc::clone(&database),
        runtime.clone(),
        TaskClaims::new(),
        None,
        Some(events),
        None,
    ));

    let response = router(database.clone(), Arc::new(AllowAllAuthorizer), service)
        .oneshot(complete_request(&task_id))
        .await
        .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({
            "taskId": task_id,
            "boardStatus": "done",
            "cleanupScheduled": false,
        })
    );
    assert_eq!(
        runtime.calls(),
        vec![
            ("agent".to_string(), "doing".to_string()),
            ("shells".to_string(), "doing".to_string()),
        ]
    );
    let completed = crate::db::acquire_db(&database)
        .get_task(&task_id)
        .expect("read completed Task")
        .expect("Completed Task remains as reference data");
    assert_eq!(completed.status, "done");

    let AppEventFrame::Event(event) = subscription.recv().await.expect("completion event") else {
        panic!("expected completion event");
    };
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project_id);
    assert_eq!(event.payload["action"], "deleted");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn complete_conceals_hidden_tasks_and_rejects_stale_or_duplicate_operations() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_complete_policy");
    let database = Arc::new(Mutex::new(database));
    let (hidden_task_id, backlog_task_id, claimed_task_id) = {
        let database = crate::db::acquire_db(&database);
        let hidden = database
            .create_project("Hidden", "/tmp/hidden")
            .expect("create hidden Project");
        let visible = database
            .create_project("Visible", "/tmp/visible")
            .expect("create visible Project");
        let hidden_task = database
            .create_task("Hidden", "doing", Some(&hidden.id), None, None)
            .expect("create hidden Task");
        let backlog_task = database
            .create_task("Backlog", "backlog", Some(&visible.id), None, None)
            .expect("create backlog Task");
        let claimed_task = database
            .create_task("Claimed", "doing", Some(&visible.id), None, None)
            .expect("create claimed Task");
        database
            .set_config(
                "project_sidebar_hidden",
                &serde_json::to_string(&vec![hidden.id]).expect("hidden config"),
            )
            .expect("save hidden config");
        (hidden_task.id, backlog_task.id, claimed_task.id)
    };
    let runtime = RecordingRuntime::new(Arc::clone(&database));
    let claims = TaskClaims::new();
    let _claim = claims
        .try_claim(&claimed_task_id, TaskOperation::TerminalCompletion)
        .expect("claim Task");
    let service = Arc::new(TerminalTaskCompletionService::new(
        Arc::clone(&database),
        runtime.clone(),
        claims,
        None,
        Some(AppEventBus::new(16, 8)),
        None,
    ));
    let app = router(
        Arc::clone(&database),
        Arc::new(AllowAllAuthorizer),
        service.clone(),
    );

    for (task_id, expected_code, expected_status) in [
        (
            hidden_task_id,
            "not_found",
            axum::http::StatusCode::NOT_FOUND,
        ),
        (
            backlog_task_id,
            "invalid_task_state",
            axum::http::StatusCode::CONFLICT,
        ),
        (
            claimed_task_id,
            "operation_in_progress",
            axum::http::StatusCode::CONFLICT,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(complete_request(&task_id))
            .await
            .expect("router response");
        assert_eq!(response.status(), expected_status);
        assert_eq!(
            response_json(response).await["error"]["code"],
            expected_code
        );
    }
    assert!(
        runtime.calls().is_empty(),
        "hidden, stale, and duplicate requests must not stop Task runtimes",
    );

    let response = router(
        database,
        Arc::new(RejectAuthorizer(CompanionErrorCode::Revoked)),
        service,
    )
    .oneshot(complete_request("KVG-secret"))
    .await
    .expect("router response");
    assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    assert_eq!(response_json(response).await["error"]["code"], "revoked");

    let _ = std::fs::remove_file(path);
}
