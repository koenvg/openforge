use super::*;

#[tokio::test]
async fn durable_delivery_requires_authentication_and_emits_waiting_only_once() {
    let (mut state, _dir) = test_state("durable_delivery");
    state.backend_token = Some("private-test-token".into());
    let task = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Waiting during outage",
            session_id: "session",
            status: "running",
            provider: "pi",
            pty_instance_id: 42,
        },
    );
    let mut events = state.app_event_tx.as_ref().unwrap().subscribe();
    let payload = serde_json::json!({
        "journalId": "test-journal", "position": 1,
        "pty": {"installation": "test-installation", "lifetime": "test-lifetime", "instance": 42},
        "sessionKey": task,
        "envelope": {"id": "waiting-1", "payload": {"provider": "pi", "task_id": task, "pty_instance_id": 42, "kind": "requested_permission"}}
    });
    for (token, expected) in [
        ("forged", StatusCode::UNAUTHORIZED),
        ("private-test-token", StatusCode::OK),
        ("private-test-token", StatusCode::OK),
    ] {
        let response = create_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/internal/agent-notifications")
                    .header("Authorization", format!("Bearer {token}"))
                    .header("Content-Type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let event = events.try_recv().unwrap();
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["status"], "paused");
    assert!(events.try_recv().is_err());
    assert_eq!(
        state
            .db
            .lock()
            .unwrap()
            .get_agent_session("session")
            .unwrap()
            .unwrap()
            .status,
        "paused"
    );
}

#[tokio::test]
async fn durable_claude_stop_preserves_background_work_deferral() {
    let (mut state, _dir) = test_state("durable_claude_stop");
    state.backend_token = Some("private-test-token".into());
    let task = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Background work",
            session_id: "session",
            status: "running",
            provider: "claude-code",
            pty_instance_id: 42,
        },
    );
    let payload = serde_json::json!({
        "journalId": "test-journal", "position": 1,
        "pty": {"installation": "test-installation", "lifetime": "test-lifetime", "instance": 42},
        "sessionKey": task,
        "envelope": {"id": "stop-1", "payload": {"provider": "claude-code", "task_id": task, "pty_instance_id": 42, "kind": "ended", "raw_event_type":"stop", "background_tasks":[{"id":"b1","type":"shell","status":"running"}]}}
    });
    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/agent-notifications")
                .header("Authorization", "Bearer private-test-token")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        state
            .db
            .lock()
            .unwrap()
            .get_agent_session("session")
            .unwrap()
            .unwrap()
            .status,
        "running"
    );
    let pending: i64 = state
        .db
        .lock()
        .unwrap()
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM agent_deferred_completions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        pending, 1,
        "acknowledgment must include the completion obligation"
    );
}

#[tokio::test]
async fn durable_claude_stop_does_not_revive_explicitly_stopped_session() {
    let (mut state, _dir) = test_state("durable_stopped_claude");
    state.backend_token = Some("private-test-token".into());
    let task = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Explicit stop",
            session_id: "session",
            status: "running",
            provider: "claude-code",
            pty_instance_id: 42,
        },
    );
    state
        .db
        .lock()
        .unwrap()
        .update_agent_session(
            "session",
            "implementing",
            "interrupted",
            None,
            Some("Stopped by user"),
        )
        .unwrap();
    let payload = serde_json::json!({
        "journalId": "test-journal", "position": 1,
        "pty": {"installation": "test-installation", "lifetime": "test-lifetime", "instance": 42},
        "sessionKey": task,
        "envelope": {"id": "stop-1", "payload": {"provider": "claude-code", "task_id": task, "pty_instance_id": 42, "kind": "ended", "raw_event_type":"stop", "background_tasks":[{"id":"b1","type":"shell","status":"running"}]}}
    });
    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/agent-notifications")
                .header("Authorization", "Bearer private-test-token")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .unwrap()
        .get_agent_session("session")
        .unwrap()
        .unwrap();
    assert_eq!(session.status, "interrupted");
    assert_eq!(session.error_message.as_deref(), Some("Stopped by user"));
}
