use super::*;

#[tokio::test]
async fn test_create_task_handler_persists_dependency_ids() {
    let (state, path) = test_state("http_create_task_handler_dependencies");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Prerequisite", "done", Some(&project.id), None, None)
            .expect("create prerequisite");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Dependent","project_id":"P-1","depends_on":["T-1"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_set_task_dependencies_handler_replaces_dependencies() {
    let (state, path) = test_state("http_set_task_dependencies_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "done", Some(&project.id), None, None)
            .expect("create second");
        let dependent = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.add_task_dependency(&dependent.id, "T-1")
            .expect("seed dependency");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/set_task_dependencies")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-3","depends_on":["T-2"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-3");
    assert_eq!(json["status"], "updated");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_add_task_dependency_handler_appends_dependency() {
    let (state, path) = test_state("http_add_task_dependency_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/add_task_dependency")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-2","depends_on":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_link_task_chain_handler_links_atomically() {
    let (state, path) = test_state("http_link_task_chain_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second");
        db.create_task("Third", "backlog", Some(&project.id), None, None)
            .expect("create third");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/link_task_chain")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"chain":["T-1","T-2","T-3"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["links"][0]["task_id"], "T-2");
    assert_eq!(json["links"][0]["depends_on"], "T-1");
    assert_eq!(json["links"][1]["task_id"], "T-3");
    assert_eq!(json["links"][1]["depends_on"], "T-2");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}
