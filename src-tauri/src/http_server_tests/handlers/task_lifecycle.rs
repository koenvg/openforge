use super::*;

#[tokio::test]
async fn test_delete_task_handler_permanently_deletes_task_and_keeps_other_tasks() {
    let (mut state, path) = test_state("http_delete_task_handler_permanent");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task(
            "Completed prompt",
            "backlog",
            Some(&project.id),
            Some("Full prompt kept for agents"),
            None,
        )
        .expect("create completed task");
        db.create_task("Open task", "backlog", Some(&project.id), None, None)
            .expect("create open task");
    }

    let pty_dir = tempfile::tempdir().expect("PTY temp dir");
    let workspace_dir = tempfile::tempdir().expect("workspace temp dir");
    let pty_manager = state.pty_manager.as_mut().expect("PTY manager");
    pty_manager.set_pid_dir(pty_dir.path().to_path_buf());
    pty_manager
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id: "T-1",
                cwd: workspace_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(0),
            None,
        )
        .await
        .expect("legacy delete test shell should spawn");
    assert_eq!(
        pty_manager.get_session_keys().await,
        vec!["T-1-shell-0".to_string()]
    );

    let router = create_router(state.clone());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-1");
    assert_eq!(json["status"], "deleted");
    assert!(
        state
            .pty_manager
            .as_ref()
            .expect("PTY manager")
            .get_session_keys()
            .await
            .is_empty(),
        "legacy delete endpoint must run lifecycle-aware shell cleanup"
    );

    let deleted_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/task/T-1")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("get deleted task should return a response");
    assert_eq!(deleted_response.status(), StatusCode::NOT_FOUND);
    let normal_list_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&exclude_done=true&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("list visible tasks should succeed");
    assert_eq!(normal_list_response.status(), StatusCode::OK);
    let normal_list = response_body_json(normal_list_response).await;
    let normal_ids: Vec<_> = normal_list
        .as_array()
        .expect("normal list array")
        .iter()
        .map(|row| row["id"].as_str().expect("task id"))
        .collect();
    assert_eq!(normal_ids, vec!["T-2"]);

    let completed_list_response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=done&compact=true")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("list completed tasks should succeed");
    assert_eq!(completed_list_response.status(), StatusCode::OK);
    let completed_list = response_body_json(completed_list_response).await;
    assert!(completed_list
        .as_array()
        .expect("completed list array")
        .is_empty());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_hard_delete_task_handler_removes_task_row() {
    let (state, _temp_dir) = test_state("http_hard_delete_task_handler_removes_task");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task to remove", "backlog", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hard_delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-1");
    assert_eq!(json["status"], "deleted");
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .is_none());
}

#[tokio::test]
async fn test_hard_delete_task_handler_rejects_terminal_completion_claim() {
    let (state, _temp_dir) = test_state("http_hard_delete_conflicts_with_completion");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        db.create_task("Task to retain", "backlog", None, None, None)
            .expect("create task")
            .id
    };
    let _completion_claim = state
        .task_claims
        .try_claim(
            &task_id,
            crate::http_server::TaskOperation::TerminalCompletion,
        )
        .expect("claim terminal completion");

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/hard_delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "task_id": task_id }).to_string(),
                ))
                .expect("build request"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .is_some());
}

#[tokio::test]
async fn test_hard_delete_task_handler_conflicts_with_in_progress_start() {
    let (state, _temp_dir) = test_state("http_hard_delete_conflicts_with_start");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        db.create_task("Task to keep", "backlog", None, None, None)
            .expect("create task")
            .id
    };
    let _start_claim = state
        .task_claims
        .try_claim(&task_id, TaskOperation::StartImplementation)
        .expect("Start claim should be acquired");

    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/hard_delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "task_id": task_id }).to_string(),
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .is_some());
}

#[tokio::test]
async fn test_delete_task_handler_rejects_non_backlog_task() {
    let (state, _temp_dir) = test_state("http_delete_task_handler_non_backlog_task");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task", "doing", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .is_some());
}

#[tokio::test]
async fn test_delete_task_handler_rejects_missing_task() {
    let (state, _temp_dir) = test_state("http_delete_task_handler_missing_task");

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/delete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-404"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_start_task_handler_rejects_missing_task_id() {
    let (state, _temp_dir) = test_state("http_start_task_missing_task_id");
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/start_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn test_start_task_handler_returns_not_found_for_unknown_task() {
    let (state, _temp_dir) = test_state("http_start_task_unknown_task");
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/start_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-404"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(response_body_text(response)
        .await
        .contains("Task not found: T-404"));
}

#[tokio::test]
async fn test_start_task_handler_rejects_projectless_task() {
    let (state, _temp_dir) = test_state("http_start_task_projectless_task");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        db.create_task("Projectless", "backlog", None, None, None)
            .expect("create task")
            .id
    };
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/start_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"task_id":"{task_id}"}}"#)))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_body_text(response)
        .await
        .contains("task is not associated with a project"));
}

#[tokio::test]
async fn test_start_task_handler_preserves_dependency_conflicts() {
    let (state, _temp_dir) = test_state("http_start_task_dependency_conflict");
    let (dependency_id, task_id) = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project.id), None, None)
            .expect("create dependency");
        let task = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent task");
        db.set_task_dependencies(&task.id, std::slice::from_ref(&dependency.id))
            .expect("set dependency");
        (dependency.id, task.id)
    };
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/start_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"task_id":"{task_id}"}}"#)))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(response_body_text(response)
        .await
        .contains(&format!("Task dependency {dependency_id} is not done")));
}

#[tokio::test]
async fn test_start_task_handler_delegates_valid_task_to_native_lifecycle() {
    let (mut state, path) = test_state("http_start_task_native_lifecycle");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Start me", "backlog", Some(&project.id), None, None)
            .expect("create task")
            .id
    };
    state.pty_manager = None;
    let response = create_router(state)
        .oneshot(
            Request::builder()
                .uri("/start_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"task_id":"{task_id}"}}"#)))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(response_body_text(response)
        .await
        .contains("PTY manager is not available"));

    let _ = std::fs::remove_file(path);
}

#[test]
fn task_claims_make_start_and_initial_prompt_update_mutually_exclusive() {
    let claims = TaskClaims::new();
    let start_claim = claims
        .try_claim("T-1", TaskOperation::StartImplementation)
        .expect("start claim");

    assert!(claims
        .try_claim("T-1", TaskOperation::UpdateInitialPrompt)
        .is_none());
    assert!(claims
        .try_claim("T-2", TaskOperation::UpdateInitialPrompt)
        .is_some());

    drop(start_claim);
    assert!(claims
        .try_claim("T-1", TaskOperation::UpdateInitialPrompt)
        .is_some());
}
