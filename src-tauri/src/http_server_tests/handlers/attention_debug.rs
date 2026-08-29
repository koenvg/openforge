use super::*;

#[cfg(unix)]
#[tokio::test]
async fn test_debug_process_memory_handler_returns_read_only_diagnostics() {
    let (state, _temp_dir) = test_state("http_debug_process_memory_handler");
    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/debug/process-memory")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert!(json.get("electron").is_none());
    assert!(json["totals"]["electronTotalTreeRssBytes"]
        .as_u64()
        .is_some());
    assert_eq!(json["sidecar"]["pid"], std::process::id());
    assert!(json["sidecar"]["rssBytes"].as_u64().unwrap_or(0) > 0);
    assert!(
        json["totals"]["trackedUniqueRssBytes"]
            .as_u64()
            .unwrap_or(0)
            >= json["sidecar"]["rssBytes"].as_u64().unwrap_or(0)
    );
    assert!(json["ptyProcessTrees"].as_array().is_some());
    assert_eq!(json["githubResponseCache"]["entryCount"], 0);
    assert_eq!(json["githubResponseCache"]["bodyBytes"], 0);
}

#[tokio::test]
async fn test_debug_process_memory_history_handler_returns_the_bounded_totals_contract() {
    let (state, _temp_dir) = test_state("http_debug_process_memory_history_handler");
    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/debug/process-memory/history")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["enabled"], false);
    assert_eq!(json["sampleIntervalSeconds"], 60);
    assert_eq!(json["maxSamples"], 60);
    assert_eq!(json["samples"], serde_json::json!([]));
    assert!(json["rssSemantics"].as_str().is_some());
    assert!(json.get("commands").is_none());
    assert!(json.get("payloads").is_none());
}
#[tokio::test]
async fn test_get_project_attention_handler_returns_zeroed_row_when_no_attention() {
    let (state, _temp_dir) = test_state("http_get_project_attention_handler_zeroed_row");
    {
        let db = state.db.lock().expect("lock db");
        let _ = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-1/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["project_id"], "P-1");
    assert_eq!(json["needs_input"], 0);
    assert_eq!(json["running_agents"], 0);
    assert_eq!(json["ci_failures"], 0);
    assert_eq!(json["unaddressed_comments"], 0);
    assert_eq!(json["completed_agents"], 0);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_not_found_for_unknown_project() {
    let (state, _temp_dir) = test_state("http_get_project_attention_handler_not_found");

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-999/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
