use super::*;

#[tokio::test]
async fn test_get_tasks_handler_returns_tasks_for_project() {
    let (state, _temp_dir) = test_state("http_get_tasks_handler_returns_tasks");
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
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_and_compacts_when_requested() {
    let (state, _temp_dir) = test_state("http_get_tasks_handler_excludes_done_compact");
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
}

#[tokio::test]
async fn test_get_tasks_handler_excludes_done_when_include_done_is_false() {
    let (state, _temp_dir) = test_state("http_get_tasks_handler_include_done_false");
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
}

#[tokio::test]
async fn http_create_task_handler_uses_project_worktree_default() {
    let (state, _temp_dir) = test_state("http_create_task_handler_worktree_default");
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
}

#[tokio::test]
async fn create_task_returns_server_error_when_worktree_lookup_fails() {
    let (state, _temp_dir) = test_state("http_create_task_worktree_lookup_failure");
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
}

#[tokio::test]
async fn create_task_returns_server_error_when_project_listing_fails() {
    let (state, _temp_dir) = test_state("http_create_task_project_listing_failure");
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
}

#[tokio::test]
async fn create_task_returns_unprocessable_entity_for_unresolved_worktree() {
    let (state, _temp_dir) = test_state("http_create_task_unresolved_worktree");

    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Unresolved project","worktree":"/unknown/path"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = response_body_text(response).await;
    assert!(
        body.contains("Could not determine project"),
        "unexpected response body: {body}"
    );
}

#[tokio::test]
async fn create_task_with_explicit_project_worktree_outside_caller_directory() {
    let (state, _temp_dir) = test_state("http_create_task_explicit_project_worktree");
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
}

#[cfg(unix)]
#[tokio::test]
async fn create_task_infers_project_from_equivalent_registered_path() {
    let (state, _temp_dir) = test_state("http_create_task_equivalent_registered_path");
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
}

#[tokio::test]
async fn create_task_infers_project_when_registered_path_is_missing() {
    let (state, _temp_dir) = test_state("http_create_task_missing_registered_path");
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
}

#[tokio::test]
async fn test_get_tasks_handler_filters_by_state() {
    let (state, _temp_dir) = test_state("http_get_tasks_handler_filters_by_state");
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
}

#[tokio::test]
async fn test_get_tasks_handler_rejects_invalid_state() {
    let (state, _temp_dir) = test_state("http_get_tasks_handler_rejects_invalid_state");
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
}

#[tokio::test]
async fn test_update_task_handler_updates_never_started_initial_prompt() {
    let (state, _temp_dir) = test_state("http_update_task_initial_prompt");
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
}

#[tokio::test]
async fn test_update_task_handler_rejects_started_initial_prompt_with_replacement_guidance() {
    let (state, _temp_dir) = test_state("http_update_task_rejects_started_initial_prompt");
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
}

#[tokio::test]
async fn canonical_task_reads_are_bounded_and_preserve_legacy_routes() {
    let (state, _temp_dir) = test_state("http_canonical_task_reads");
    let (project_id, active_id, completed_id) = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/canonical-task-reads")
            .expect("create project");
        let completed = db
            .create_task(
                &format!("Completed authoring {}", "x".repeat(8 * 1024)),
                "done",
                Some(&project.id),
                Some("legacy execution override"),
                None,
            )
            .expect("create completed task");
        for index in 0..50 {
            db.create_task(
                &format!("Completed {index}"),
                "done",
                Some(&project.id),
                None,
                None,
            )
            .expect("create paged completed Task");
        }
        db.add_task_label(&completed.id, "cleanup")
            .expect("add cleanup label");
        db.add_task_label(&completed.id, "bug")
            .expect("add bug label");
        let active = db
            .create_task("Active authoring", "backlog", Some(&project.id), None, None)
            .expect("create active task");
        db.add_task_dependency(&active.id, &completed.id)
            .expect("link dependency");
        (project.id, active.id, completed.id)
    };
    let router = create_router(state);

    let active_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/v2/projects/{project_id}/tasks/active"))
                .body(Body::empty())
                .expect("active request"),
        )
        .await
        .expect("active response");
    assert_eq!(active_response.status(), StatusCode::OK);
    let active = response_body_json(active_response).await;
    assert_eq!(active["tasks"][0]["id"], active_id);
    assert_eq!(active["tasks"][0]["prompt"], "Active authoring");
    assert!(active["tasks"][0].get("initial_prompt").is_none());
    assert_eq!(active["related"][0]["id"], completed_id);
    assert!(active["related"][0].get("prompt").is_none());

    let completed_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/v2/projects/{project_id}/tasks/completed"))
                .body(Body::empty())
                .expect("completed request"),
        )
        .await
        .expect("completed response");
    assert_eq!(completed_response.status(), StatusCode::OK);
    let completed_page = response_body_json(completed_response).await;
    assert_eq!(
        completed_page["tasks"]
            .as_array()
            .expect("completed items")
            .len(),
        50
    );
    assert!(completed_page["nextCursor"].is_string());
    assert!(completed_page["tasks"][0].get("prompt").is_none());

    let labels_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/v2/projects/{project_id}/tasks/completed?labels=cleanup&labels=bug"
                ))
                .body(Body::empty())
                .expect("label request"),
        )
        .await
        .expect("label response");
    let label_page = response_body_json(labels_response).await;
    assert_eq!(
        label_page["tasks"].as_array().expect("label items").len(),
        1
    );
    assert_eq!(label_page["tasks"][0]["id"], completed_id);

    let detail_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/v2/projects/{project_id}/tasks/{completed_id}"))
                .body(Body::empty())
                .expect("detail request"),
        )
        .await
        .expect("detail response");
    assert_eq!(detail_response.status(), StatusCode::OK);
    let detail = response_body_json(detail_response).await;
    assert!(detail["task"]["prompt"]
        .as_str()
        .expect("detail prompt")
        .starts_with("Completed authoring"));
    assert!(!detail.to_string().contains("legacy execution override"));

    let invalid_cursor = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/v2/projects/{project_id}/tasks/completed?cursor=invalid"
                ))
                .body(Body::empty())
                .expect("invalid cursor request"),
        )
        .await
        .expect("invalid cursor response");
    assert_eq!(invalid_cursor.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body_json(invalid_cursor).await["code"],
        "invalid_cursor"
    );

    let missing_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/v2/projects/{project_id}/tasks/T-missing"))
                .body(Body::empty())
                .expect("missing request"),
        )
        .await
        .expect("missing response");
    assert_eq!(missing_response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_body_json(missing_response).await["code"],
        "task_not_found"
    );

    let legacy_response = router
        .oneshot(
            Request::builder()
                .uri(format!("/tasks?project_id={project_id}"))
                .body(Body::empty())
                .expect("legacy request"),
        )
        .await
        .expect("legacy response");
    assert_eq!(legacy_response.status(), StatusCode::OK);
    let legacy = response_body_json(legacy_response).await;
    assert!(legacy[0].get("initial_prompt").is_some());
}
