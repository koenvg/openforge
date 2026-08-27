use super::*;

#[tokio::test]
async fn resume_startup_sessions_command_is_compatibility_noop() {
    let (state, _temp_dir) = test_state("app_invoke_resume_startup_sessions");
    let mut receiver = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    invoke_ok(&state, "resume_startup_sessions", json!({})).await;

    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn handles_agent_lifecycle_followups() {
    let (state, _temp_dir) = test_state("app_invoke_agent_lifecycle_followups");
    let claude_task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
            .expect("create project");
        let claude_task = db
            .create_task("claude task", "doing", Some(&project.id), None, None)
            .expect("create claude task");
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
        claude_task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": claude_task_id, "success": false, "ptyInstanceId": 7 }),
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
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_opencode_pty_run() {
    let (state, _temp_dir) = test_state("finalize_opencode_success");
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
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_codex_pty_run() {
    let (state, _temp_dir) = test_state("finalize_codex_success");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Codex task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-codex",
            &task.id,
            None,
            "implementing",
            "running",
            "codex",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-codex", 11)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true, "ptyInstanceId": 11 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-codex")
            .expect("get codex")
            .expect("codex exists")
            .status,
        "completed"
    );
    drop(db);
    let event = events.try_recv().expect("status event should be emitted");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "completed");
    assert_eq!(event.payload["provider"], "codex");
}

#[tokio::test]
async fn finalize_agent_session_interrupts_failed_codex_pty_run() {
    let (state, _temp_dir) = test_state("finalize_codex_failure");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Codex task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-codex-failed",
            &task.id,
            None,
            "implementing",
            "running",
            "codex",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-codex-failed", 12)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false, "ptyInstanceId": 12 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    let session = db
        .get_agent_session("session-codex-failed")
        .expect("get codex")
        .expect("codex exists");
    assert_eq!(session.status, "interrupted");
    assert_eq!(session.error_message.as_deref(), Some("PTY process exited"));
}

#[tokio::test]
async fn finalize_agent_session_ignores_missing_pty_exit_instance() {
    let (state, _temp_dir) = test_state("finalize_ignores_missing_pty_exit");
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
}

#[tokio::test]
async fn finalize_agent_session_ignores_stale_pty_exit_instance() {
    let (state, _temp_dir) = test_state("finalize_ignores_stale_pty_exit");
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
}

#[tokio::test]
async fn finalize_agent_session_does_not_override_paused_lifecycle_state() {
    let (state, _temp_dir) = test_state("finalize_does_not_override_paused");
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
}
