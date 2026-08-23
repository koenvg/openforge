use super::{
    contract::{
        create_router_with_task_creation, AllowAllAuthorizer, CompanionHostStatus,
        PairingUnavailableAuthorizer, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    pairing::PairingCoordinator,
    project_board::DatabaseCompanionProjectBoardSource,
    task_creation::DatabaseCompanionTaskCreator,
};
use crate::app_events::AppEventBus;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

#[tokio::test]
async fn paired_device_creates_a_backlog_task_in_the_visible_project() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("companion_create_task_in_project");
    let project = database
        .create_project("OpenForge", "/private/openforge")
        .expect("project");
    let database = Arc::new(std::sync::Mutex::new(database));
    let project_board = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
        &database,
    )));
    let task_creator = Arc::new(DatabaseCompanionTaskCreator::new(
        Arc::clone(&database),
        AppEventBus::new(16, 8),
    ));
    let pairing = Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ));
    let router = create_router_with_task_creation(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing,
        project_board,
        task_creator,
    );

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/companion/v1/projects/{}/tasks", project.id))
                .header("content-type", "application/json")
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .body(Body::from(
                    r#"{"initialPrompt":"Investigate mobile creation"}"#,
                ))
                .expect("request"),
        )
        .await
        .expect("router response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    let json: serde_json::Value = serde_json::from_slice(&body).expect("JSON response");
    assert_eq!(json["projectId"], project.id);
    assert_eq!(json["boardStatus"], "backlog");
    let task_id = json["taskId"].as_str().expect("Task id");
    let task = crate::db::acquire_db(&database)
        .get_task(task_id)
        .expect("read Task")
        .expect("created Task");
    assert_eq!(task.initial_prompt, "Investigate mobile creation");
    assert_eq!(task.status, "backlog");
    assert_eq!(task.project_id.as_deref(), Some(project.id.as_str()));
}

#[tokio::test]
async fn task_creation_rejects_invalid_hidden_and_unauthenticated_requests_safely() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("companion_create_task_safe_rejections");
    let visible = database
        .create_project("Visible", "/private/visible")
        .expect("visible project");
    let hidden = database
        .create_project("Hidden", "/private/hidden")
        .expect("hidden project");
    database
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![&hidden.id]).expect("hidden Projects"),
        )
        .expect("Project visibility");
    let database = Arc::new(std::sync::Mutex::new(database));
    let project_board = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
        &database,
    )));
    let task_creator = Arc::new(DatabaseCompanionTaskCreator::new(
        Arc::clone(&database),
        AppEventBus::new(16, 8),
    ));
    let pairing = Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ));
    let allowed = create_router_with_task_creation(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(AllowAllAuthorizer),
        Arc::clone(&pairing),
        Arc::clone(&project_board) as Arc<_>,
        Arc::clone(&task_creator) as Arc<_>,
    );

    for body in [
        r#"{"initialPrompt":"   "}"#,
        r#"{}"#,
        r#"{"initialPrompt":"Valid","extra":true}"#,
    ] {
        let response = allowed
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/companion/v1/projects/{}/tasks", visible.id))
                    .header("content-type", "application/json")
                    .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("invalid request response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    let hidden_response = allowed
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/companion/v1/projects/{}/tasks", hidden.id))
                .header("content-type", "application/json")
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .body(Body::from(r#"{"initialPrompt":"Do not create"}"#))
                .expect("request"),
        )
        .await
        .expect("hidden Project response");
    assert_eq!(hidden_response.status(), StatusCode::NOT_FOUND);

    let unauthorized = create_router_with_task_creation(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        pairing,
        project_board,
        task_creator,
    )
    .oneshot(
        Request::builder()
            .method("POST")
            .uri(format!("/companion/v1/projects/{}/tasks", visible.id))
            .header("content-type", "application/json")
            .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
            .body(Body::from(r#"{"initialPrompt":"Do not create"}"#))
            .expect("request"),
    )
    .await
    .expect("unauthorized response");
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    assert!(crate::db::acquire_db(&database)
        .get_tasks_for_project(&visible.id)
        .expect("visible Tasks")
        .is_empty());
    assert!(crate::db::acquire_db(&database)
        .get_tasks_for_project(&hidden.id)
        .expect("hidden Tasks")
        .is_empty());
}
