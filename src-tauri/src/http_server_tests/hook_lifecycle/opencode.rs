use super::*;

#[test]
fn opencode_status_events_follow_plugin_lifecycle_mapping() {
    let status_for = |event_type: &str, status_type: Option<&str>| {
        opencode_status_from_event(event_type, status_type).map(|(status, _)| status)
    };

    assert_eq!(status_for("session.created", None), Some("running"));
    assert_eq!(status_for("session.idle", None), Some("completed"));
    assert_eq!(status_for("session.status", Some("busy")), Some("running"));
    assert_eq!(status_for("session.status", Some("retry")), Some("running"));
    assert_eq!(status_for("session.status", Some("error")), Some("running"));
    assert_eq!(
        status_for("session.status", Some("idle")),
        Some("completed")
    );
    assert_eq!(status_for("session.updated", Some("idle")), Some("running"));
    assert_eq!(status_for("message.updated", None), Some("running"));
    assert_eq!(status_for("tool.execute.before", None), Some("running"));
    assert_eq!(status_for("tool.execute.after", None), Some("running"));
    assert_eq!(status_for("session.error", None), Some("failed"));
}

#[tokio::test]
async fn opencode_hook_stores_session_id_and_completes_on_idle_event() {
    let (state, _temp_dir) = test_state("opencode_hook_idle_complete");
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "OpenCode task",
            session_id: "ses-opencode-running",
            status: "running",
            provider: "opencode",
            pty_instance_id: 77,
        },
    );

    let _ = opencode_event_handler(
        State(state.clone()),
        Json(OpenCodePluginEventPayload {
            task_id: task_id.clone(),
            pty_instance_id: 77,
            event_type: "session.idle".to_string(),
            session_id: Some("ses_session77".to_string()),
            status_type: None,
            transcript_path: None,
            activity_snapshot: None,
        }),
    )
    .await
    .expect("handler response");

    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-opencode-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(
        session.opencode_session_id,
        Some("ses_session77".to_string())
    );
}

#[tokio::test]
async fn opencode_hook_preserves_checkpoint_when_start_event_runs_session() {
    let (state, _temp_dir) = test_state("opencode_hook_preserves_checkpoint");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-opencode-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "opencode",
        )
        .expect("create opencode session");
        db.set_agent_session_pty_instance_id("ses-opencode-completed", 77)
            .expect("store pty instance");
        task.id
    };

    let _ = opencode_event_handler(
        State(state.clone()),
        Json(OpenCodePluginEventPayload {
            task_id: task_id.clone(),
            pty_instance_id: 77,
            event_type: "session.created".to_string(),
            session_id: Some("ses_session77".to_string()),
            status_type: None,
            transcript_path: None,
            activity_snapshot: None,
        }),
    )
    .await
    .expect("handler response");

    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-opencode-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(session.pty_instance_id, Some(77));
    assert_eq!(session.checkpoint_data, None);
    assert_eq!(
        session.opencode_session_id,
        Some("ses_session77".to_string())
    );
}

#[tokio::test]
async fn opencode_hook_ignores_error_status_events() {
    let (state, _temp_dir) = test_state("opencode_hook_error_failed");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-opencode-error",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.set_agent_session_pty_instance_id("ses-opencode-error", 78)
            .expect("store pty instance");
        task.id
    };

    let _ = opencode_event_handler(
        State(state.clone()),
        Json(OpenCodePluginEventPayload {
            task_id: task_id.clone(),
            pty_instance_id: 78,
            event_type: "session.status".to_string(),
            session_id: None,
            status_type: Some("error".to_string()),
            transcript_path: None,
            activity_snapshot: None,
        }),
    )
    .await
    .expect("handler response");

    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-opencode-error")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
}
