use super::*;

#[tokio::test]
async fn resume_startup_sessions_command_is_compatibility_noop() {
    let (state, path) = test_state("app_invoke_resume_startup_sessions");
    let mut receiver = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    invoke_ok(&state, "resume_startup_sessions", json!({})).await;

    assert!(receiver.try_recv().is_err());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_agent_lifecycle_followups() {
    let (state, path) = test_state("app_invoke_agent_lifecycle_followups");
    let (pi_task_id, claude_task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
            .expect("create project");
        let pi_task = db
            .create_task("pi task", "doing", Some(&project.id), None, None)
            .expect("create pi task");
        let claude_task = db
            .create_task("claude task", "doing", Some(&project.id), None, None)
            .expect("create claude task");
        db.create_agent_session(
            "session-pi",
            &pi_task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.create_agent_session(
            "session-claude",
            &claude_task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create claude session");
        db.set_agent_session_pty_instance_id("session-claude", 7)
            .expect("store claude pty instance");
        (pi_task.id, claude_task.id)
    };

    let status = invoke_ok(
        &state,
        "get_session_status",
        json!({ "sessionId": "session-pi" }),
    )
    .await;
    assert_eq!(status["id"], "session-pi");
    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": claude_task_id, "success": false, "ptyInstanceId": 7 }),
    )
    .await;
    invoke_ok(
        &state,
        "abort_implementation",
        json!({ "taskId": pi_task_id }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-claude")
            .expect("get claude")
            .expect("claude exists")
            .status,
        "interrupted"
    );
    assert_eq!(
        db.get_agent_session("session-pi")
            .expect("get pi")
            .expect("pi exists")
            .status,
        "interrupted"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn start_implementation_routes_provider_start_through_provider_module() {
    let source = include_str!("../lifecycle.rs");

    assert!(source.contains("Provider::from_name"));
    assert!(source.contains(".start("));
    assert!(!source.contains("spawn_opencode_run_pty"));
    assert!(!source.contains("spawn_claude_pty"));
    assert!(!source.contains("spawn_pi_pty"));
}

#[tokio::test]
async fn plugin_start_implementation_reports_missing_task_before_resolving_project_repo() {
    let (state, path) = test_state("app_invoke_plugin_start_missing_task");

    let err = invoke(
        &state,
        "plugin_start_implementation",
        json!({
            "taskId": "missing-task",
            "projectId": "project-1",
            "provider": "pi",
            "agent": "worker",
            "permissionMode": "default",
            "actionPrompt": "Implement it",
            "model": { "providerID": "anthropic", "modelID": "claude-sonnet" }
        }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn resume_implementation_reports_missing_session() {
    let (state, path) = test_state("app_invoke_resume_implementation_missing_session");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        db.create_task("Resume missing session", "doing", None, None, None)
            .expect("create task")
            .id
    };

    let err = invoke(
        &state,
        "resume_implementation",
        json!({ "taskId": task_id, "sessionId": "missing-session", "provider": "pi" }),
    )
    .await
    .expect_err("missing session should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Session not found"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn resume_implementation_rejects_session_for_another_task() {
    let (state, path) = test_state("app_invoke_resume_implementation_mismatched_session");
    let (task_id, other_session_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Resume mismatch project", "/tmp/openforge-resume-mismatch")
            .expect("create project");
        let task = db
            .create_task("resume this task", "doing", Some(&project.id), None, None)
            .expect("create task");
        let other_task = db
            .create_task("other task", "doing", Some(&project.id), None, None)
            .expect("create other task");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/openforge-resume-mismatch/workspace",
            "/tmp/openforge-resume-mismatch",
            "project_dir",
            None,
            "pi",
        )
        .expect("create task workspace");
        db.create_agent_session(
            "session-other-task",
            &other_task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create other task session");
        (task.id, "session-other-task".to_string())
    };

    let err = invoke(
        &state,
        "resume_implementation",
        json!({ "taskId": task_id, "sessionId": other_session_id, "provider": "pi" }),
    )
    .await
    .expect_err("mismatched session should be rejected before provider resume");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("session does not belong to task"),
        "error should identify task/session mismatch, got: {}",
        err.1
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_reports_missing_task() {
    let (state, path) = test_state("app_invoke_start_implementation");

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": "missing-task", "repoPath": "/tmp" }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_reports_invalid_workspace_cwd_as_bad_request() {
    let (state, path) = test_state("app_invoke_start_invalid_workspace_cwd");
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let missing_workspace = temp_dir.path().join("Missing Project");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Invalid Workspace Project",
                missing_workspace.to_str().expect("utf8 path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("disable worktrees");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task(
            "Start with missing cwd",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("create task")
        .id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": missing_workspace.to_string_lossy() }),
    )
    .await
    .expect_err("invalid workspace cwd should be rejected before spawning an agent PTY");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("workspace cwd") && err.1.contains("Missing Project"),
        "error should identify the inaccessible workspace cwd, got: {}",
        err.1
    );
    assert!(
        !err.1.contains("Failed to spawn"),
        "invalid workspace errors should not be reported as generic spawn failures, got: {}",
        err.1
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_opencode_pty_run() {
    let (state, path) = test_state("finalize_opencode_success");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode", 9)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true, "ptyInstanceId": 9 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "completed"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_ignores_missing_pty_exit_instance() {
    let (state, path) = test_state("finalize_ignores_missing_pty_exit");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode-missing-instance",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode-missing-instance", 42)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode-missing-instance")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "running"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_ignores_stale_pty_exit_instance() {
    let (state, path) = test_state("finalize_ignores_stale_pty_exit");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode-current",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode-current", 42)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false, "ptyInstanceId": 41 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode-current")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "running"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_does_not_override_paused_lifecycle_state() {
    let (state, path) = test_state("finalize_does_not_override_paused");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Paused agent task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-paused-opencode",
            &task.id,
            None,
            "implementing",
            "paused",
            "opencode",
        )
        .expect("create session");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    let session = db
        .get_agent_session("session-paused-opencode")
        .expect("get opencode")
        .expect("opencode exists");
    assert_eq!(session.status, "paused");
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}
