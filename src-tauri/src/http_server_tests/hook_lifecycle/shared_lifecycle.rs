use super::*;

#[tokio::test]
async fn agent_lifecycle_route_updates_opencode_status_through_shared_seam() {
    let (state, path) = test_state("agent_lifecycle_route_opencode_running");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "OpenCode task",
            session_id: "ses-opencode-completed-shared",
            status: "completed",
            provider: "opencode",
            pty_instance_id: 88,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/agent-lifecycle")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"provider":"opencode","task_id":"{}","pty_instance_id":88,"provider_session_id":"ses_shared88","kind":"started","raw_event_type":"session.created"}}"#,
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
        .get_agent_session("ses-opencode-completed-shared")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(
        session.opencode_session_id,
        Some("ses_shared88".to_string())
    );
    assert_eq!(session.pty_instance_id, Some(88));
    assert_eq!(session.checkpoint_data, None);
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "running");
    assert_eq!(event.payload["provider"], "opencode");
    assert_eq!(event.payload["kind"], "started");
    assert_eq!(event.payload["raw_event_type"], "session.created");
    assert_eq!(event.payload["raw_status_type"], serde_json::Value::Null);
    assert_eq!(event.payload["pty_instance_id"], 88);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn agent_lifecycle_route_updates_pi_status_through_shared_seam() {
    let (state, path) = test_state("agent_lifecycle_route_pi_running");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Pi task",
            session_id: "ses-pi-shared",
            status: "completed",
            provider: "pi",
            pty_instance_id: 89,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/agent-lifecycle")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"provider":"pi","task_id":"{}","pty_instance_id":89,"kind":"started","raw_event_type":"agent.start"}}"#,
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
        .get_agent_session("ses-pi-shared")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "running");
    assert_eq!(event.payload["provider"], "pi");
    assert_eq!(event.payload["kind"], "started");
    assert_eq!(event.payload["raw_event_type"], "agent.start");
    assert_eq!(event.payload["raw_status_type"], serde_json::Value::Null);
    assert_eq!(event.payload["pty_instance_id"], 89);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn agent_lifecycle_route_updates_claude_status_through_shared_seam() {
    let (state, path) = test_state("agent_lifecycle_route_claude_running");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Claude task",
            session_id: "ses-claude-shared",
            status: "completed",
            provider: "claude-code",
            pty_instance_id: 90,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/agent-lifecycle")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"provider":"claude-code","task_id":"{}","pty_instance_id":90,"provider_session_id":"claude-shared-90","kind":"became_busy","raw_event_type":"pre-tool-use"}}"#,
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
        .get_agent_session("ses-claude-shared")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(
        session.claude_session_id,
        Some("claude-shared-90".to_string())
    );
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "running");
    assert_eq!(event.payload["provider"], "claude-code");
    assert_eq!(event.payload["kind"], "became_busy");
    assert_eq!(event.payload["raw_event_type"], "pre-tool-use");
    assert_eq!(event.payload["raw_status_type"], serde_json::Value::Null);
    assert_eq!(event.payload["pty_instance_id"], 90);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn agent_lifecycle_route_updates_claude_requested_permission_to_paused() {
    let (state, path) = test_state("agent_lifecycle_route_claude_permission");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Claude permission task",
            session_id: "ses-claude-permission",
            status: "running",
            provider: "claude-code",
            pty_instance_id: 91,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/agent-lifecycle")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"provider":"claude-code","task_id":"{}","pty_instance_id":91,"provider_session_id":"claude-shared-91","kind":"requested_permission","raw_event_type":"notification-permission"}}"#,
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
        .get_agent_session("ses-claude-permission")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "paused");
    assert_eq!(
        session.claude_session_id,
        Some("claude-shared-91".to_string())
    );
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "paused");
    assert_eq!(event.payload["provider"], "claude-code");
    assert_eq!(event.payload["kind"], "requested_permission");
    assert_eq!(event.payload["raw_event_type"], "notification-permission");
    assert_eq!(event.payload["raw_status_type"], serde_json::Value::Null);
    assert_eq!(event.payload["pty_instance_id"], 91);

    let _ = std::fs::remove_file(path);
}
