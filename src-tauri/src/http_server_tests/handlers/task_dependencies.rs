use super::*;

#[tokio::test]
async fn create_task_handler_accepts_dependency_from_another_project() {
    let (state, path) = test_state("http_create_task_handler_cross_project_dependency");
    {
        let db = state.db.lock().expect("lock db");
        let dependent_project = db
            .create_project("Dependent Project", "/tmp/dependent-project")
            .expect("create dependent project");
        let prerequisite_project = db
            .create_project("Prerequisite Project", "/tmp/prerequisite-project")
            .expect("create prerequisite project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task(
            "Prerequisite",
            "done",
            Some(&prerequisite_project.id),
            None,
            None,
        )
        .expect("create prerequisite");
        assert_ne!(dependent_project.id, prerequisite_project.id);
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
async fn create_task_dependency_storage_failure_is_atomic_when_cleanup_delete_would_fail() {
    let (state, path) = test_state("http_create_task_dependency_failure_atomic");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first dependency");
        db.create_task("Second", "done", Some(&project.id), None, None)
            .expect("create second dependency");
        db.connection()
            .lock()
            .expect("lock connection")
            .execute_batch(
                "CREATE TRIGGER reject_second_task_dependency
                 BEFORE INSERT ON task_dependencies
                 WHEN NEW.depends_on_task_id = 'T-2'
                 BEGIN
                   SELECT RAISE(ABORT, 'dependency insert rejected');
                 END;
                 CREATE TRIGGER reject_task_delete
                 BEFORE DELETE ON tasks
                 BEGIN
                   SELECT RAISE(ABORT, 'task delete rejected');
                 END;",
            )
            .expect("create storage failure triggers");
    }

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Dependent","project_id":"P-1","depends_on":["T-1","T-2"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let db = state.db.lock().expect("lock db");
    assert!(db.get_task("T-3").expect("get attempted task").is_none());
    assert_eq!(
        db.get_config("next_task_id").expect("get task counter"),
        Some("3".to_string())
    );
    let dependency_count: i64 = db
        .connection()
        .lock()
        .expect("lock connection")
        .query_row(
            "SELECT COUNT(*) FROM task_dependencies WHERE task_id = 'T-3'",
            [],
            |row| row.get(0),
        )
        .expect("count rolled-back dependencies");
    assert_eq!(dependency_count, 0);
    drop(db);

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
