use super::*;

#[tokio::test]
async fn test_get_projects_handler_returns_all_projects() {
    let (state, path) = test_state("http_get_projects_handler_returns_projects");
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

    let _ = std::fs::remove_file(path);
}
