use super::*;

#[tokio::test]
async fn test_get_tasks_handler_returns_tasks_for_project() {
    let (state, path) = test_state("http_get_tasks_handler_returns_tasks");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task A", "backlog", Some(&project.id), None, None)
            .expect("create task a");
        db.create_task("Task B", "doing", Some(&project.id), None, None)
            .expect("create task b");
        db.create_task("Task C", "done", Some(&project.id), None, None)
            .expect("create task c");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 3);
    assert!(tasks.iter().any(|task| task["status"] == "done"));
    assert!(tasks[0].get("initial_prompt").is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_and_compacts_when_requested() {
    let (state, path) = test_state("http_get_tasks_handler_excludes_done_compact");
    let open_task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let open_task = db
            .create_task(
                "Open task full prompt",
                "backlog",
                Some(&project.id),
                Some("Open task runtime prompt"),
                None,
            )
            .expect("create open task");
        let _done_task = db
            .create_task(
                "Done task full prompt",
                "done",
                Some(&project.id),
                Some("Done task runtime prompt"),
                None,
            )
            .expect("create done task");
        open_task.id
    };

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&exclude_done=true&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["id"], open_task_id);
    assert_eq!(tasks[0]["status"], "backlog");
    assert_eq!(tasks[0]["title"], "Open task full prompt");
    assert!(tasks[0].get("initial_prompt").is_none());
    assert!(tasks[0].get("prompt").is_none());
    assert!(tasks[0].get("summary").is_none());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_when_include_done_is_false() {
    let (state, path) = test_state("http_get_tasks_handler_include_done_false");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task A", "backlog", Some(&project.id), None, None)
            .expect("create task a");
        db.create_task("Task B", "done", Some(&project.id), None, None)
            .expect("create task b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&include_done=false")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"], "backlog");
    assert!(tasks[0].get("initial_prompt").is_some());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn http_create_task_handler_uses_project_worktree_default() {
    let (state, path) = test_state("http_create_task_handler_worktree_default");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("set worktree default");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Project directory task","project_id":"P-1"}"#,
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
        .get_task("T-1")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.worktree_source.as_deref(), Some("disabled"));
    assert_eq!(task.worktree_branch, None);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn create_task_returns_server_error_when_worktree_lookup_fails() {
    let (state, path) = test_state("http_create_task_worktree_lookup_failure");
    state
        .db
        .lock()
        .expect("lock db")
        .connection()
        .lock()
        .expect("lock connection")
        .execute("DROP TABLE worktrees", [])
        .expect("drop worktrees table");

    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Lookup failure","worktree":"/tmp/worktree"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = response_body_text(response).await;
    assert!(
        body.contains("Failed to resolve project from worktree"),
        "unexpected response body: {body}"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn create_task_returns_server_error_when_project_listing_fails() {
    let (state, path) = test_state("http_create_task_project_listing_failure");
    state
        .db
        .lock()
        .expect("lock db")
        .connection()
        .lock()
        .expect("lock connection")
        .execute("DROP TABLE projects", [])
        .expect("drop projects table");

    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"initial_prompt":"Lookup failure"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = response_body_text(response).await;
    assert!(
        body.contains("Failed to list projects while resolving project"),
        "unexpected response body: {body}"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn create_task_with_explicit_project_worktree_outside_caller_directory() {
    let (state, path) = test_state("http_create_task_explicit_project_worktree");
    let project_id = {
        let db = state.db.lock().expect("lock db");
        db.create_project("OpenForge", "/Users/koen/workspace/openforge")
            .expect("create project")
            .id
    };

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Explicit worktree task","worktree":"/Users/koen/workspace/openforge"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["project_id"], project_id);
    let task_id = json["task_id"].as_str().expect("task id");
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.project_id.as_deref(), Some(project_id.as_str()));

    let _ = std::fs::remove_file(path);
}

#[cfg(unix)]
#[tokio::test]
async fn create_task_infers_project_from_equivalent_registered_path() {
    let (state, path) = test_state("http_create_task_equivalent_registered_path");
    let filesystem = tempfile::tempdir().expect("create filesystem fixture");
    let project_directory = filesystem.path().join("project");
    let nested_directory = project_directory.join("nested");
    std::fs::create_dir_all(&nested_directory).expect("create registered project directory");
    let project_symlink = filesystem.path().join("project-link");
    std::os::unix::fs::symlink(&project_directory, &project_symlink)
        .expect("create project symlink");

    let project_id = {
        let db = state.db.lock().expect("lock db");
        db.create_project(
            "Project",
            project_directory.to_str().expect("UTF-8 project path"),
        )
        .expect("create project")
        .id
    };
    let equivalent_paths = [
        format!("{}/", project_directory.display()),
        format!("{}/./nested/..", project_directory.display()),
        project_symlink.to_string_lossy().into_owned(),
    ];
    let router = create_router(state);

    for (index, worktree) in equivalent_paths.into_iter().enumerate() {
        let body = serde_json::json!({
            "initial_prompt": format!("Equivalent path task {index}"),
            "worktree": &worktree,
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/create_task")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK, "worktree: {worktree}");
        let json = response_body_json(response).await;
        assert_eq!(json["project_id"], project_id, "worktree: {worktree}");
    }

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn create_task_infers_project_when_registered_path_is_missing() {
    let (state, path) = test_state("http_create_task_missing_registered_path");
    let filesystem = tempfile::tempdir().expect("create filesystem fixture");
    let missing_project = filesystem.path().join("missing-project");
    let missing_project = missing_project.to_str().expect("UTF-8 missing path");
    let project_id = {
        let db = state.db.lock().expect("lock db");
        db.create_project("Missing Project", missing_project)
            .expect("create project")
            .id
    };

    let body = serde_json::json!({
        "initial_prompt": "Missing path task",
        "worktree": missing_project,
    });
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["project_id"], project_id);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_filters_by_state() {
    let (state, path) = test_state("http_get_tasks_handler_filters_by_state");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task backlog", "backlog", Some(&project.id), None, None)
            .expect("create backlog task");
        db.create_task("Task doing", "doing", Some(&project.id), None, None)
            .expect("create doing task");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=doing")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"], "doing");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_rejects_invalid_state() {
    let (state, path) = test_state("http_get_tasks_handler_rejects_invalid_state");
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
                .uri("/tasks?project_id=P-1&state=blocked")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_updates_never_started_initial_prompt() {
    let (state, path) = test_state("http_update_task_initial_prompt");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","initial_prompt":"New prompt"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "New prompt");
    assert_eq!(task.prompt.as_deref(), Some("New prompt"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_rejects_started_initial_prompt_with_replacement_guidance() {
    let (state, path) = test_state("http_update_task_rejects_started_initial_prompt");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.update_task_status(&task.id, "doing")
            .expect("start task");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","initial_prompt":"New prompt"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response_body_text(response).await;
    assert!(body.contains("replacement task"));

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.prompt.as_deref(), Some("Original prompt"));

    let _ = std::fs::remove_file(path);
}
