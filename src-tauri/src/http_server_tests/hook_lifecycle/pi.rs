use super::*;

#[tokio::test]
async fn test_pi_agent_status_changes_publish_to_app_event_stream() {
    let (state, path) = test_state("pi_agent_status_publishes_app_event");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("Pi task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session("ses-pi", &task.id, None, "implement", "completed", "pi")
            .expect("create session");
        db.set_agent_session_pty_instance_id("ses-pi", 7)
            .expect("set checkpoint");
        task.id
    };

    let response = pi_agent_start_handler(
        State(state),
        Json(PiAgentLifecyclePayload {
            task_id: task_id.clone(),
            pty_instance_id: 7,
        }),
    )
    .await
    .expect("handler response");

    assert_eq!(response.0["status"], "ok");
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "running");
    assert_eq!(event.payload["provider"], "pi");
    assert_eq!(event.payload["kind"], "started");
    assert_eq!(event.payload["raw_event_type"], "agent.start");
    assert_eq!(event.payload["raw_status_type"], serde_json::Value::Null);
    assert_eq!(event.payload["pty_instance_id"], 7);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_end_hook_marks_running_pi_session_completed() {
    let (state, path) = test_state("http_pi_agent_end_completed");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.set_agent_session_pty_instance_id("ses-pi-running", 42)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-end")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(session.pty_instance_id, Some(42));
    assert_eq!(session.checkpoint_data, None);
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_start_hook_marks_completed_pi_session_running() {
    let (state, path) = test_state("http_pi_agent_start_running");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create pi session");
        db.set_agent_session_pty_instance_id("ses-pi-completed", 42)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-start")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(session.pty_instance_id, Some(42));
    assert_eq!(session.checkpoint_data, None);
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}

#[test]
fn test_pi_status_update_emits_when_matching_session_already_has_target_status() {
    let (state, path) = test_state("http_pi_agent_start_idempotent_running");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.set_agent_session_pty_instance_id("ses-pi-running", 42)
            .expect("store pty instance");
        task.id
    };

    let status_update = record_agent_lifecycle_notification(
        &state,
        &crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "pi".to_string(),
            task_id: task_id.clone(),
            pty_instance_id: Some(42),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::Started,
            raw_event_type: Some("agent.start".to_string()),
            raw_status_type: None,
        },
    );

    assert_eq!(
        status_update.map(|change| change.status),
        Some("running".to_string())
    );
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_start_hook_ignores_stale_pty_instance() {
    let (state, path) = test_state("http_pi_agent_start_stale_instance");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create pi session");
        db.set_agent_session_pty_instance_id("ses-pi-completed", 99)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-start")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_end_hook_ignores_stale_pty_instance() {
    let (state, path) = test_state("http_pi_agent_end_stale_instance");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.set_agent_session_pty_instance_id("ses-pi-running", 99)
            .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-end")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");

    let _ = std::fs::remove_file(path);
}
