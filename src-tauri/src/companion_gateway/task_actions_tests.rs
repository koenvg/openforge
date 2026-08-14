use super::{
    contract::{
        create_router_with_task_actions, AllowAllAuthorizer, CompanionAuthorizer,
        CompanionErrorCode, CompanionHostStatus,
    },
    devices::{CompanionDeviceRecord, CompanionDeviceStore, InMemoryCompanionDeviceStore},
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
    router_with_pairing(database, authorizer, pairing(), actions)
}

fn router_with_pairing(
    database: Arc<Mutex<Database>>,
    authorizer: Arc<dyn CompanionAuthorizer>,
    pairing: Arc<PairingCoordinator>,
    actions: Arc<dyn CompanionTaskActionService>,
) -> axum::Router {
    create_router_with_task_actions(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        pairing,
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

fn authorized_complete_request(task_id: &str, credential: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/companion/v1/tasks/{task_id}/complete"))
        .header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        )
        .header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {credential}"),
        )
        .body(Body::empty())
        .expect("request")
}

fn delete_request(task_id: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/companion/v1/tasks/{task_id}/delete"))
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

#[tokio::test]
async fn authenticated_delete_is_backlog_only_bodyless_and_permanent() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_delete_route");
    let database = Arc::new(Mutex::new(database));
    let (project_id, backlog_id, doing_id) = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("Visible", "/tmp/visible")
            .expect("create Project");
        let backlog = database
            .create_task("Delete me", "backlog", Some(&project.id), None, None)
            .expect("create backlog Task");
        database
            .update_task_summary(&backlog.id, "Reference notes")
            .expect("save reference notes");
        let doing = database
            .create_task("Do not delete", "doing", Some(&project.id), None, None)
            .expect("create doing Task");
        (project.id, backlog.id, doing.id)
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
    let app = router(Arc::clone(&database), Arc::new(AllowAllAuthorizer), service);

    let response = app
        .clone()
        .oneshot(delete_request(&backlog_id))
        .await
        .expect("router response");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"taskId": backlog_id, "outcome": "deleted"}),
    );
    assert_eq!(
        runtime.calls(),
        vec![
            ("agent".to_string(), "backlog".to_string()),
            ("shells".to_string(), "backlog".to_string()),
        ],
        "runtime shutdown must finish before permanent deletion",
    );
    assert!(
        crate::db::acquire_db(&database)
            .get_task(&backlog_id)
            .expect("read deleted Task")
            .is_none(),
        "Delete must not retain a Completed Task reference",
    );
    let AppEventFrame::Event(event) = subscription.recv().await.expect("Delete event") else {
        panic!("expected canonical Task event");
    };
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["action"], "deleted");
    assert_eq!(event.payload["task_id"], backlog_id);
    assert_eq!(event.payload["project_id"], project_id);

    let stale = app
        .clone()
        .oneshot(delete_request(&doing_id))
        .await
        .expect("router response");
    assert_eq!(stale.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "invalid_task_state",
    );

    let caller_supplied_cleanup = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/companion/v1/tasks/{backlog_id}/delete"))
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header("content-type", "application/json")
                .body(Body::from(r#"{"workspacePath":"/tmp/unsafe"}"#))
                .expect("request"),
        )
        .await
        .expect("router response");
    assert_eq!(
        caller_supplied_cleanup.status(),
        axum::http::StatusCode::BAD_REQUEST,
    );
    assert_eq!(
        response_json(caller_supplied_cleanup).await["error"]["code"],
        "invalid_request",
    );

    crate::db::acquire_db(&database)
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![project_id]).expect("hidden projects"),
        )
        .expect("hide Project");
    let hidden = app
        .oneshot(delete_request(&backlog_id))
        .await
        .expect("router response");
    assert_eq!(hidden.status(), axum::http::StatusCode::NOT_FOUND);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn delete_rejects_lost_authority_and_duplicate_operation_claims() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_delete_policy");
    let database = Arc::new(Mutex::new(database));
    let task_id = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("Visible", "/tmp/visible")
            .expect("create Project");
        database
            .create_task("Delete me", "backlog", Some(&project.id), None, None)
            .expect("create Task")
            .id
    };
    let runtime = RecordingRuntime::new(Arc::clone(&database));
    let claims = TaskClaims::new();
    let _claim = claims
        .try_claim(&task_id, TaskOperation::TerminalCompletion)
        .expect("claim Task");
    let service = Arc::new(TerminalTaskCompletionService::new(
        Arc::clone(&database),
        runtime.clone(),
        claims,
        None,
        Some(AppEventBus::new(16, 8)),
        None,
    ));

    let duplicate = router(
        Arc::clone(&database),
        Arc::new(AllowAllAuthorizer),
        service.clone(),
    )
    .oneshot(delete_request(&task_id))
    .await
    .expect("router response");
    assert_eq!(duplicate.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        response_json(duplicate).await["error"]["code"],
        "operation_in_progress",
    );
    assert!(runtime.calls().is_empty());

    let denied = router(
        database,
        Arc::new(RejectAuthorizer(CompanionErrorCode::Revoked)),
        service,
    )
    .oneshot(delete_request(&task_id))
    .await
    .expect("router response");
    assert_eq!(denied.status(), axum::http::StatusCode::UNAUTHORIZED);
    assert_eq!(response_json(denied).await["error"]["code"], "revoked");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn existing_paired_credential_keeps_task_authority_without_reapproval_or_host_unlock() {
    const CREDENTIAL: &str = "existing-device-credential";
    let (database, path) =
        crate::db::test_helpers::make_test_db("companion_existing_device_authority");
    let database = Arc::new(Mutex::new(database));
    let (first_task_id, second_task_id) = {
        let database = crate::db::acquire_db(&database);
        let project = database
            .create_project("Visible", "/tmp/visible")
            .expect("create Project");
        let first = database
            .create_task(
                "Complete while locked",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create first Task");
        let second = database
            .create_task("Revocation check", "doing", Some(&project.id), None, None)
            .expect("create second Task");
        (first.id, second.id)
    };

    let devices = Arc::new(InMemoryCompanionDeviceStore::default());
    devices
        .save(&CompanionDeviceRecord {
            device_id: "existing-device".to_string(),
            device_name: "Previously paired phone".to_string(),
            platform: "ios".to_string(),
            credential_verifier: super::trust_policy::credential_verifier(CREDENTIAL),
            paired_at: 1_700_000_000,
            last_seen_at: None,
            revoked_at: None,
        })
        .expect("seed existing paired credential without a new approval");
    let pairing = Arc::new(PairingCoordinator::new(devices, Duration::from_secs(60)));
    let authorizer: Arc<dyn CompanionAuthorizer> = pairing.clone();
    let service = Arc::new(TerminalTaskCompletionService::new(
        Arc::clone(&database),
        RecordingRuntime::new(Arc::clone(&database)),
        TaskClaims::new(),
        None,
        Some(AppEventBus::new(16, 8)),
        None,
    ));
    let app = router_with_pairing(database, authorizer, pairing.clone(), service);

    let invalid_credential = app
        .clone()
        .oneshot(authorized_complete_request(
            &first_task_id,
            "wrong-credential",
        ))
        .await
        .expect("invalid credential response");
    assert_eq!(
        invalid_credential.status(),
        axum::http::StatusCode::UNAUTHORIZED
    );

    // Host lock state is intentionally absent from the authorization boundary: the
    // persisted paired credential remains sufficient while OpenForge is running.
    let while_locked = app
        .clone()
        .oneshot(authorized_complete_request(&first_task_id, CREDENTIAL))
        .await
        .expect("existing credential action response");
    assert_eq!(while_locked.status(), axum::http::StatusCode::OK);

    pairing
        .revoke("existing-device")
        .expect("revoke paired device");
    let revoked = app
        .oneshot(authorized_complete_request(&second_task_id, CREDENTIAL))
        .await
        .expect("revoked credential response");
    assert_eq!(revoked.status(), axum::http::StatusCode::UNAUTHORIZED);
    assert_eq!(response_json(revoked).await["error"]["code"], "revoked");

    let _ = std::fs::remove_file(path);
}
