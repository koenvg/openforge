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
        db.update_task_summary(&open_task.id, "Open task handoff notes")
            .expect("seed open summary");
        let done_task = db
            .create_task(
                "Done task full prompt",
                "done",
                Some(&project.id),
                Some("Done task runtime prompt"),
                None,
            )
            .expect("create done task");
        db.update_task_summary(&done_task.id, "Done task handoff notes")
            .expect("seed done summary");
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
async fn test_update_task_handler_updates_summary_without_changing_initial_prompt() {
    let (state, path) = test_state("http_update_task_summary_only");
    let (task_id, project_id) = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        (task.id, project.id)
    };
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","summary":"New Summary"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], task_id);
    assert_eq!(json["status"], "updated");
    let event = events.try_recv().expect("Task invalidation");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project_id);

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.summary, Some("New Summary".to_string()));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_updates_never_started_initial_prompt_and_preserves_summary() {
    let (state, path) = test_state("http_update_task_initial_prompt");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.update_task_summary(&task.id, "Existing Summary")
            .expect("seed summary");
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
    assert_eq!(task.summary.as_deref(), Some("Existing Summary"));

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
