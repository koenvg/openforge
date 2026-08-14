use super::*;

#[cfg(unix)]
#[tokio::test]
async fn test_debug_process_memory_handler_returns_read_only_diagnostics() {
    let (state, path) = test_state("http_debug_process_memory_handler");
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

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_zeroed_row_when_no_attention() {
    let (state, path) = test_state("http_get_project_attention_handler_zeroed_row");
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

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_not_found_for_unknown_project() {
    let (state, path) = test_state("http_get_project_attention_handler_not_found");

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

    let _ = std::fs::remove_file(path);
}
