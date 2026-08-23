use super::*;

#[tokio::test]
async fn test_get_projects_handler_returns_all_projects() {
    let (state, _temp_dir) = test_state("http_get_projects_handler_returns_projects");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project A", "/tmp/project-a")
            .expect("create project a");
        db.create_project("Project B", "/tmp/project-b")
            .expect("create project b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/projects")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let projects = json.as_array().expect("array response");
    assert_eq!(projects.len(), 2);
    assert!(projects.iter().any(|project| {
        project["id"] == "P-1"
            && project["name"] == "Project A"
            && project["path"] == "/tmp/project-a"
    }));
    assert!(projects.iter().any(|project| {
        project["id"] == "P-2"
            && project["name"] == "Project B"
            && project["path"] == "/tmp/project-b"
    }));
}

#[tokio::test]
async fn get_projects_handler_recovers_from_poisoned_database_lock() {
    let (state, _temp_dir) = test_state("http_get_projects_handler_poisoned_database_lock");
    let database = Arc::clone(&state.db);
    let poison_result = std::thread::spawn(move || {
        let _database = database.lock().expect("lock healthy test database");
        panic!("poison test database lock");
    })
    .join();
    assert!(poison_result.is_err());

    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/projects")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should return a controlled response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body_json(response).await, serde_json::json!([]));
}
