use super::{
    contract::{
        create_router_with_task_actions, AllowAllAuthorizer, CompanionHostStatus,
        PairingUnavailableAuthorizer, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    pairing::PairingCoordinator,
    project_board::DatabaseCompanionProjectBoardSource,
    task_actions::UnavailableCompanionTaskActionService,
    task_detail::DatabaseCompanionTaskDetailSource,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

fn router(database: Arc<Mutex<crate::db::Database>>, allowed: bool) -> axum::Router {
    create_router_with_task_actions(
        CompanionHostStatus::new(HOST_ID.to_string()),
        if allowed {
            Arc::new(AllowAllAuthorizer)
        } else {
            Arc::new(PairingUnavailableAuthorizer)
        },
        Arc::new(PairingCoordinator::new(
            Arc::new(InMemoryCompanionDeviceStore::default()),
            Duration::from_secs(60),
        )),
        Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
            &database,
        ))),
        Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
        Arc::new(UnavailableCompanionTaskActionService),
    )
}

fn request(method: &str, uri: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
        .header("content-type", "application/json")
        .body(body)
        .expect("request")
}

async fn json(response: Response) -> serde_json::Value {
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 16 * 1024)
            .await
            .expect("response body"),
    )
    .expect("JSON response")
}
async fn board(router: &axum::Router, project_id: &str) -> serde_json::Value {
    let path = format!("/companion/v1/projects/{project_id}/board?includeAgentOutput=true");
    json(
        router
            .clone()
            .oneshot(request("GET", &path, Body::empty()))
            .await
            .unwrap(),
    )
    .await
}

#[tokio::test]
async fn mobile_output_receipts_are_opt_in_authorized_and_revision_scoped() {
    let (database, _temp_dir) = crate::db::test_helpers::make_test_db("companion_output_viewed");
    let project = database
        .create_project("Visible", "/secret/visible")
        .unwrap();
    let task = database
        .create_task("Review output", "doing", Some(&project.id), None, None)
        .unwrap();
    database
        .create_agent_session("first", &task.id, None, "implement", "running", "pi")
        .unwrap();
    database
        .set_agent_session_pty_instance_id("first", 41)
        .unwrap();
    database
        .update_agent_session("first", "implement", "paused", None, None)
        .unwrap();
    database
        .set_project_config(&project.id, "focus_filter_states", r#"["needs-input"]"#)
        .unwrap();
    let database = Arc::new(Mutex::new(database));
    let allowed = router(Arc::clone(&database), true);
    let denied = router(Arc::clone(&database), false);
    let detail_path = format!("/companion/v1/tasks/{}", task.id);
    let viewed_path = format!("{detail_path}/agent-output/viewed");
    let legacy = json(
        allowed
            .clone()
            .oneshot(request("GET", &detail_path, Body::empty()))
            .await
            .unwrap(),
    )
    .await;
    assert!(legacy.get("agentOutputReceipt").is_none());
    let detail = json(
        allowed
            .clone()
            .oneshot(request(
                "GET",
                &format!("{detail_path}?includeAgentOutput=true"),
                Body::empty(),
            ))
            .await
            .unwrap(),
    )
    .await;
    let before = board(&allowed, &project.id).await;
    assert_eq!(before["counts"]["focus"], 1);
    assert_eq!(before["lanes"]["focus"][0]["hasUnreadAgentOutput"], true);
    let receipt = detail["agentOutputReceipt"]
        .as_str()
        .expect("unread receipt");
    assert!(!receipt.contains("first"));
    assert!(detail["agentOutputSessionBinding"].as_str().is_some());
    let body = || Body::from(serde_json::json!({"receipt": receipt}).to_string());
    let unauthorized = denied
        .oneshot(request("POST", &viewed_path, body()))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let viewed = json(
        allowed
            .clone()
            .oneshot(request("POST", &viewed_path, body()))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(viewed["viewed"], true);
    let after = board(&allowed, &project.id).await;
    assert_eq!(after["counts"]["focus"], 0);
    assert_eq!(after["counts"]["inFlight"], 1);
    assert_eq!(after["lanes"]["inFlight"][0]["hasUnreadAgentOutput"], false);
    let duplicate = json(
        allowed
            .clone()
            .oneshot(request("POST", &viewed_path, body()))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(duplicate["viewed"], false);
    database
        .lock()
        .unwrap()
        .update_agent_session("first", "implement", "running", None, None)
        .unwrap();
    database
        .lock()
        .unwrap()
        .update_agent_session("first", "implement", "paused", None, None)
        .unwrap();
    let stale = json(
        allowed
            .clone()
            .oneshot(request("POST", &viewed_path, body()))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(stale["viewed"], false);
    let after_stale = board(&allowed, &project.id).await;
    assert_eq!(after_stale["counts"]["focus"], 1);
    assert_eq!(
        after_stale["lanes"]["focus"][0]["hasUnreadAgentOutput"],
        true
    );
    let latest = database
        .lock()
        .unwrap()
        .get_agent_session("first")
        .unwrap()
        .unwrap();
    assert_eq!(latest.viewed_output_revision, 1);
    assert_eq!(latest.output_revision, 2);
    database
        .lock()
        .unwrap()
        .create_agent_session("second", &task.id, None, "implement", "running", "pi")
        .unwrap();
    database
        .lock()
        .unwrap()
        .update_agent_session("second", "implement", "paused", None, None)
        .unwrap();
    let superseded = json(
        allowed
            .clone()
            .oneshot(request("POST", &viewed_path, body()))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(superseded["viewed"], false);
    let latest = database
        .lock()
        .unwrap()
        .get_latest_session_for_ticket(&task.id)
        .unwrap()
        .unwrap();
    assert_eq!(latest.id, "second");
    assert_eq!(latest.viewed_output_revision, 0);
    let another = database
        .lock()
        .unwrap()
        .create_task("Another", "doing", Some(&project.id), None, None)
        .unwrap();
    let another_path = format!("/companion/v1/tasks/{}/agent-output/viewed", another.id);
    let wrong_task = json(
        allowed
            .clone()
            .oneshot(request("POST", &another_path, body()))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(wrong_task["viewed"], false);
    database
        .lock()
        .unwrap()
        .set_config(
            "project_sidebar_hidden",
            &serde_json::json!([project.id]).to_string(),
        )
        .unwrap();
    let hidden = allowed
        .oneshot(request("POST", &viewed_path, body()))
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
}
