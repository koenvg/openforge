use super::*;

/// The same fixture `review-thread-commands.test.js` asserts the CLI sends, so a
/// rename on either side of the boundary fails here instead of at runtime.
fn contract() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../docs/contracts/review-thread-write-contract-fixtures.json"
    ))
    .expect("Review Thread write contract fixture")
}

fn create_body() -> String {
    contract()["create"].to_string()
}

fn scope_body() -> String {
    contract()["scope"].to_string()
}

fn body_for(key: &str, thread_id: &str) -> String {
    let mut body = contract()[key].clone();
    body["threadId"] = serde_json::Value::String(thread_id.to_string());
    body.to_string()
}

fn keyed_create() -> serde_json::Value {
    contract()["createKeyed"].clone()
}

fn post(path: &str, body: String) -> Request<Body> {
    Request::builder()
        .uri(path)
        .method("POST")
        .header("content-type", "application/json")
        .body(Body::from(body))
        .expect("review thread request")
}

async fn created_thread(router: &axum::Router, body: String) -> serde_json::Value {
    let response = router
        .clone()
        .oneshot(post("/review_threads/create", body))
        .await
        .expect("create response");
    assert_eq!(response.status(), StatusCode::OK);
    response_body_json(response).await
}

async fn listed_threads(router: axum::Router) -> Vec<serde_json::Value> {
    response_body_json(
        router
            .oneshot(post("/review_threads/list", scope_body()))
            .await
            .expect("list response"),
    )
    .await
    .as_array()
    .expect("list")
    .clone()
}

#[tokio::test]
async fn test_review_thread_routes_create_reply_status_and_list_over_the_agent_transport() {
    let (state, _temp_dir) = test_state("http_review_threads_round_trip");
    let router = create_router(state);

    let created = created_thread(&router, create_body()).await;
    let thread_id = created["id"].as_str().expect("thread id").to_string();

    let listed = router
        .clone()
        .oneshot(post("/review_threads/list", scope_body()))
        .await
        .expect("list response");
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = response_body_json(listed).await;
    assert_eq!(listed[0]["id"], thread_id.as_str());
    assert_eq!(
        listed[0]["messages"][0]["body"],
        contract()["create"]["body"]
    );

    let replied = router
        .clone()
        .oneshot(post("/review_threads/reply", body_for("reply", &thread_id)))
        .await
        .expect("reply response");
    assert_eq!(replied.status(), StatusCode::OK);
    let replied = response_body_json(replied).await;
    assert_eq!(replied["messages"][1]["body"], contract()["reply"]["body"]);

    let resolved = router
        .clone()
        .oneshot(post(
            "/review_threads/status",
            body_for("status", &thread_id),
        ))
        .await
        .expect("status response");
    assert_eq!(resolved.status(), StatusCode::OK);
    assert_eq!(
        response_body_json(resolved).await["status"],
        contract()["status"]["status"]
    );

    let listed = response_body_json(
        router
            .oneshot(post("/review_threads/list", scope_body()))
            .await
            .expect("final list response"),
    )
    .await;
    assert_eq!(listed.as_array().expect("list").len(), 1);
    assert_eq!(listed[0]["status"], contract()["status"]["status"]);
}

#[tokio::test]
async fn test_one_rejected_review_thread_create_keeps_the_threads_the_run_already_stored() {
    let (state, _temp_dir) = test_state("http_review_threads_partial_run");
    let router = create_router(state);

    router
        .clone()
        .oneshot(post("/review_threads/create", create_body()))
        .await
        .expect("first create response");

    let mut invalid: serde_json::Value =
        serde_json::from_str(&create_body()).expect("create payload");
    invalid["anchor"]["line"] = serde_json::json!(0);
    let rejected = router
        .clone()
        .oneshot(post("/review_threads/create", invalid.to_string()))
        .await
        .expect("rejected create response");
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert!(response_body_text(rejected).await.contains("line"));

    let mut third = contract()["create"].clone();
    third["body"] = serde_json::json!("Second finding");
    third["anchor"]["filePath"] = serde_json::json!("src/lib.rs");
    router
        .clone()
        .oneshot(post("/review_threads/create", third.to_string()))
        .await
        .expect("third create response");

    let listed = response_body_json(
        router
            .oneshot(post("/review_threads/list", scope_body()))
            .await
            .expect("list response"),
    )
    .await;
    let mut bodies = listed
        .as_array()
        .expect("list")
        .iter()
        .map(|thread| thread["messages"][0]["body"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    bodies.sort_unstable();
    assert_eq!(
        bodies,
        vec![
            contract()["create"]["body"].as_str().expect("fixture body"),
            "Second finding"
        ]
    );
}

#[tokio::test]
async fn test_review_thread_routes_refuse_a_caller_without_a_valid_agent_identity() {
    let (mut state, temp_dir) = test_state("http_review_threads_forged_identity");
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    pty_manager.enable_daemon_shell(
        temp_dir.path().into(),
        "/unused-daemon".into(),
        "T-fixture-shell-0".into(),
    );
    state.pty_manager = Some(pty_manager);
    state.backend_token = Some("controller-only".into());
    let router = create_router(state);

    let mut forged = post("/review_threads/create", create_body());
    for (name, value) in [
        ("authorization", "Bearer controller-only"),
        ("x-openforge-agent-task", "T-not-a-task"),
        ("x-openforge-agent-session", "session-forged"),
        ("x-openforge-agent-installation", "installation-forged"),
        ("x-openforge-agent-instance", "1"),
    ] {
        forged
            .headers_mut()
            .insert(name, value.parse().expect("header"));
    }
    let refused = router
        .clone()
        .oneshot(forged)
        .await
        .expect("forged response");
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let reason = axum::body::to_bytes(refused.into_body(), usize::MAX)
        .await
        .expect("refusal body");
    assert_eq!(
        String::from_utf8_lossy(&reason),
        "agent Task/session unavailable"
    );

    let mut list = post("/review_threads/list", scope_body());
    list.headers_mut().insert(
        "authorization",
        "Bearer controller-only".parse().expect("header"),
    );
    let listed = response_body_json(router.oneshot(list).await.expect("list response")).await;
    assert_eq!(listed, serde_json::json!([]));
}

#[tokio::test]
async fn test_repeating_an_idempotency_key_returns_the_thread_the_first_create_stored() {
    let (state, _temp_dir) = test_state("http_review_threads_repeated_key");
    let router = create_router(state);

    let first = created_thread(&router, keyed_create().to_string()).await;
    let repeated = created_thread(&router, keyed_create().to_string()).await;

    assert_eq!(repeated["id"], first["id"]);
    assert_eq!(repeated["messages"], first["messages"]);
    assert_eq!(repeated["idempotencyKey"], keyed_create()["idempotencyKey"]);
    assert_eq!(listed_threads(router).await.len(), 1);
}

#[tokio::test]
async fn test_one_idempotency_key_under_a_new_revision_stores_a_second_thread() {
    let (state, _temp_dir) = test_state("http_review_threads_key_scoped_to_revision");
    let router = create_router(state);
    let mut next_revision = keyed_create();
    next_revision["revision"] = serde_json::json!("9a8b7c6");

    let first = created_thread(&router, keyed_create().to_string()).await;
    let second = created_thread(&router, next_revision.to_string()).await;

    assert_ne!(second["id"], first["id"]);
    let listed = listed_threads(router).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], first["id"]);
}

#[tokio::test]
async fn test_creates_without_an_idempotency_key_each_store_their_own_thread() {
    let (state, _temp_dir) = test_state("http_review_threads_unkeyed");
    let router = create_router(state);

    let first = created_thread(&router, create_body()).await;
    let second = created_thread(&router, create_body()).await;

    assert_ne!(second["id"], first["id"]);
    assert_eq!(listed_threads(router).await.len(), 2);
}
