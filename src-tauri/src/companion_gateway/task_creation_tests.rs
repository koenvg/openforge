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
    database
        .set_project_config(&project.id, "ai_provider", "pi")
        .expect("project provider");
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
    assert_eq!(
        crate::db::acquire_db(&database)
            .get_task_config(task_id, "ai_provider")
            .expect("read Task provider"),
        Some("pi".to_string()),
    );
}

#[tokio::test]
async fn paired_device_lists_desktop_task_prompt_suggestions_for_the_visible_project() {
    let (database, temp_dir) =
        crate::db::test_helpers::make_test_db("companion_task_prompt_catalog");
    let project_path = temp_dir.path().join("project");
    let prompt_dir = project_path.join(".pi").join("prompts");
    let skill_dir = project_path
        .join(".pi")
        .join("skills")
        .join("release-notes");
    std::fs::create_dir_all(&prompt_dir).expect("prompt directory");
    std::fs::create_dir_all(&skill_dir).expect("skill directory");
    std::fs::write(
        prompt_dir.join("review.md"),
        "---\ndescription: Review current changes\n---\nReview the code.",
    )
    .expect("prompt template");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: release-notes\ndescription: Draft release notes\n---\n# Release notes",
    )
    .expect("skill");
    let project = database
        .create_project(
            "OpenForge",
            project_path.to_str().expect("UTF-8 project path"),
        )
        .expect("project");
    database
        .set_project_config(&project.id, "ai_provider", "pi")
        .expect("project provider");
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
                .uri(format!(
                    "/companion/v1/projects/{}/task-prompt-catalog",
                    project.id
                ))
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("router response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    let json: serde_json::Value = serde_json::from_slice(&body).expect("JSON response");
    assert_eq!(json["provider"], "pi");
    assert_eq!(json["trigger"], "/");
    let suggestions = json["suggestions"].as_array().expect("suggestions");
    assert!(suggestions.iter().any(|suggestion| {
        suggestion["name"] == "review"
            && suggestion["kind"] == "command"
            && suggestion["source"] == "prompt"
    }));
    assert!(suggestions.iter().any(|suggestion| {
        suggestion["name"] == "skill:release-notes"
            && suggestion["kind"] == "skill"
            && suggestion["source"] == "skill"
    }));
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
        .clone()
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

    let hidden_catalog_response = allowed
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/companion/v1/projects/{}/task-prompt-catalog",
                    hidden.id
                ))
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("hidden Project catalog response");
    assert_eq!(hidden_catalog_response.status(), StatusCode::NOT_FOUND);

    let unauthorized_router = create_router_with_task_creation(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        pairing,
        project_board,
        task_creator,
    );
    let unauthorized = unauthorized_router
        .clone()
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

    let unauthorized_catalog = unauthorized_router
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/companion/v1/projects/{}/task-prompt-catalog",
                    visible.id
                ))
                .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("unauthorized catalog response");
    assert_eq!(unauthorized_catalog.status(), StatusCode::UNAUTHORIZED);

    assert!(crate::db::acquire_db(&database)
        .get_tasks_for_project(&visible.id)
        .expect("visible Tasks")
        .is_empty());
    assert!(crate::db::acquire_db(&database)
        .get_tasks_for_project(&hidden.id)
        .expect("hidden Tasks")
        .is_empty());
}
