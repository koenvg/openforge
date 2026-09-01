use super::*;

#[test]
fn test_pre_tool_use_transitions_from_non_running_to_running() {
    assert_eq!(
        map_hook_to_status("pre-tool-use", "paused"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "completed"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "failed"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "interrupted"),
        Some("running".to_string())
    );
}

#[test]
fn test_pre_tool_use_no_op_when_already_running() {
    assert_eq!(map_hook_to_status("pre-tool-use", "running"), None);
}

#[test]
fn test_post_tool_use_transitions_from_non_running_to_running() {
    assert_eq!(
        map_hook_to_status("post-tool-use", "paused"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("post-tool-use", "completed"),
        Some("running".to_string())
    );
}

#[test]
fn test_post_tool_use_no_op_when_already_running() {
    assert_eq!(map_hook_to_status("post-tool-use", "running"), None);
}

#[test]
fn test_stop_always_maps_to_completed() {
    assert_eq!(
        map_hook_to_status("stop", "running"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("stop", "paused"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("stop", "completed"),
        Some("completed".to_string())
    );
}

#[test]
fn test_session_end_always_maps_to_completed() {
    assert_eq!(
        map_hook_to_status("session-end", "running"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("session-end", "paused"),
        Some("completed".to_string())
    );
}

#[test]
fn test_notification_produces_no_status_change() {
    assert_eq!(map_hook_to_status("notification", "running"), None);
    assert_eq!(map_hook_to_status("notification", "paused"), None);
}

#[test]
fn test_notification_permission_maps_running_to_paused() {
    assert_eq!(
        map_hook_to_status("notification-permission", "running"),
        Some("paused".to_string())
    );
}

#[test]
fn test_notification_permission_no_op_when_not_running() {
    assert_eq!(
        map_hook_to_status("notification-permission", "paused"),
        None
    );
    assert_eq!(
        map_hook_to_status("notification-permission", "completed"),
        None
    );
    assert_eq!(
        map_hook_to_status("notification-permission", "interrupted"),
        None
    );
}

#[test]
fn test_unknown_event_type_produces_no_status_change() {
    assert_eq!(map_hook_to_status("unknown-event", "running"), None);
    assert_eq!(map_hook_to_status("", "running"), None);
}

#[test]
fn test_claude_hook_payload_deserialize_with_claude_task_id() {
    let json = r#"{"session_id": "sess-123", "tool_name": "bash", "CLAUDE_TASK_ID": "task-456"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.tool_name, Some("bash".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    assert!(payload.tool_input.is_none());
    assert!(payload.transcript_path.is_none());
    assert!(payload.pty_instance_id.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_with_claude_task_id_lowercase() {
    let json = r#"{"session_id": "sess-789", "claude_task_id": "task-999"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-789".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-999".to_string()));
}

#[test]
fn test_claude_hook_payload_deserialize_all_fields() {
    let json = r#"{
            "session_id": "sess-123",
            "tool_name": "bash",
            "tool_input": {"cmd": "ls -la"},
            "transcript_path": "/path/to/transcript",
            "CLAUDE_TASK_ID": "task-456",
            "OPENFORGE_PTY_INSTANCE_ID": 42
        }"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.tool_name, Some("bash".to_string()));
    assert!(payload.tool_input.is_some());
    assert_eq!(
        payload.transcript_path,
        Some("/path/to/transcript".to_string())
    );
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    assert_eq!(payload.pty_instance_id, Some(42));
}

#[test]
fn test_claude_hook_payload_deserialize_missing_task_id() {
    let json = r#"{"session_id": "sess-123", "tool_name": "bash"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert!(payload.claude_task_id.is_none());
    assert!(payload.pty_instance_id.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_empty_object() {
    let json = r#"{}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert!(payload.session_id.is_none());
    assert!(payload.tool_name.is_none());
    assert!(payload.tool_input.is_none());
    assert!(payload.transcript_path.is_none());
    assert!(payload.claude_task_id.is_none());
    assert!(payload.pty_instance_id.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_malformed_json() {
    let json = r#"{"session_id": "sess-123", invalid json}"#;
    let result: Result<ClaudeHookPayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "Should fail with malformed JSON");
}

#[test]
fn test_claude_hook_payload_creation() {
    let payload = ClaudeHookPayload {
        session_id: Some("sess-123".to_string()),
        tool_name: Some("bash".to_string()),
        tool_input: Some(serde_json::json!({"cmd": "ls"})),
        transcript_path: Some("/path".to_string()),
        claude_task_id: Some("task-456".to_string()),
        pty_instance_id: Some(456),
    };
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    assert_eq!(payload.pty_instance_id, Some(456));
}

#[test]
fn test_map_hook_to_status_full_lifecycle() {
    let mut status = "started".to_string();

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running");

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running", "Already running — no change");

    if let Some(s) = map_hook_to_status("post-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running", "post-tool-use when running — no change");

    // Permission prompt pauses the session
    if let Some(s) = map_hook_to_status("notification-permission", &status) {
        status = s;
    }
    assert_eq!(
        status, "paused",
        "notification-permission transitions running→paused"
    );

    // Tool use resumes from paused
    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(
        status, "running",
        "Resumed: pre-tool-use transitions paused→running"
    );

    if let Some(s) = map_hook_to_status("stop", &status) {
        status = s;
    }
    assert_eq!(status, "completed");

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(
        status, "running",
        "Resumed: pre-tool-use transitions completed→running"
    );

    if let Some(s) = map_hook_to_status("session-end", &status) {
        status = s;
    }
    assert_eq!(status, "completed");
}

#[test]
fn claude_activity_snapshot_is_bounded_and_excludes_transcript_path() {
    let payload = ClaudeHookPayload {
        session_id: Some("claude-session-from-payload".to_string()),
        tool_name: Some("Bash".to_string()),
        tool_input: Some(serde_json::json!({
            "command": format!("{}tail command", "x".repeat(9 * 1024))
        })),
        transcript_path: Some("/private/transcript.jsonl".to_string()),
        claude_task_id: Some("task-claude".to_string()),
        pty_instance_id: Some(9),
    };

    let snapshot = bounded_claude_activity_snapshot(
        "user-prompt-submit",
        &payload,
        Some("claude-session-from-query"),
    )
    .expect("activity snapshot");

    assert!(snapshot.len() <= 8 * 1024);
    assert!(snapshot.contains("tail command"));
    assert!(snapshot.contains("user-prompt-submit"));
    assert!(snapshot.contains("claude-session-from-query"));
    assert!(!snapshot.contains("/private/transcript.jsonl"));
}

#[tokio::test]
async fn claude_user_prompt_hook_uses_query_identity_and_payload_transcript_metadata() {
    let (state, _temp_dir) = test_state("claude_user_prompt_query_metadata");
    let task_id = create_agent_session_fixture(
        &state,
        AgentSessionFixture {
            task_title: "Claude metadata task",
            session_id: "ses-claude-user-prompt",
            status: "completed",
            provider: "claude-code",
            pty_instance_id: 96,
        },
    );

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!("/hooks/user-prompt-submit?task_id={task_id}&pty_instance_id=96&session_id=claude-query-96"))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"session_id":"","transcript_path":"/tmp/claude-transcript.jsonl","tool_name":"UserPromptSubmit","tool_input":{"prompt":"implement metadata"}}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-claude-user-prompt")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(
        session.claude_session_id.as_deref(),
        Some("claude-query-96")
    );
    assert_eq!(session.pty_instance_id, Some(96));
}

fn write_transcript(dir: &std::path::Path, lines: &[String]) -> std::path::PathBuf {
    let path = dir.join("transcript.jsonl");
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).expect("write transcript");
    path
}

fn backgrounded_shell_transcript() -> Vec<String> {
    vec![
        serde_json::json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [{
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Bash",
                "input": {"command": "pnpm dev", "run_in_background": true},
            }]},
        })
        .to_string(),
        serde_json::json!({
            "type": "user",
            "message": {"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": "ok",
            }]},
            "toolUseResult": {"backgroundTaskId": "b1"},
        })
        .to_string(),
    ]
}

fn armed_monitor_transcript(timeout_ms: u64) -> Vec<String> {
    vec![
        serde_json::json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [{
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Monitor",
                "input": {"until": "ci passes"},
            }]},
        })
        .to_string(),
        serde_json::json!({
            "type": "user",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "message": {"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": "ok",
            }]},
            "toolUseResult": {"taskId": "m1", "timeoutMs": timeout_ms, "persistent": false},
        })
        .to_string(),
    ]
}

async fn post_claude_hook(
    state: &AppState,
    endpoint: &str,
    task_id: &str,
    pty_instance_id: u64,
    transcript_path: &std::path::Path,
) {
    let session_id = format!("claude-stop-{pty_instance_id}");
    let response = create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/hooks/{endpoint}?task_id={task_id}&pty_instance_id={pty_instance_id}&session_id={session_id}"
                ))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "session_id": session_id,
                        "transcript_path": transcript_path.to_string_lossy(),
                    })
                    .to_string(),
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
}

fn session_status(state: &AppState, session_id: &str) -> String {
    state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session(session_id)
        .expect("get session")
        .expect("session exists")
        .status
}

fn running_claude_session(state: &AppState, name: &str, pty_instance_id: u64) -> String {
    create_agent_session_fixture(
        state,
        AgentSessionFixture {
            task_title: "Claude background task",
            session_id: name,
            status: "running",
            provider: "claude-code",
            pty_instance_id,
        },
    )
}

#[tokio::test]
async fn test_stop_keeps_the_session_running_while_a_monitor_is_still_armed() {
    let (state, _temp_dir) = test_state("claude_stop_armed_monitor");
    let task_id = running_claude_session(&state, "ses-claude-monitor", 110);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(
        transcript_dir.path(),
        &armed_monitor_transcript(60 * 60 * 1000),
    );

    post_claude_hook(&state, "stop", &task_id, 110, &transcript_path).await;

    assert_eq!(session_status(&state, "ses-claude-monitor"), "running");
}

#[tokio::test]
async fn test_stop_completes_the_session_once_the_monitor_timeout_has_passed() {
    let (state, _temp_dir) = test_state("claude_stop_expired_monitor");
    let task_id = running_claude_session(&state, "ses-claude-expired-monitor", 111);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(transcript_dir.path(), &armed_monitor_transcript(0));

    post_claude_hook(&state, "stop", &task_id, 111, &transcript_path).await;

    assert_eq!(
        session_status(&state, "ses-claude-expired-monitor"),
        "completed"
    );
}

#[tokio::test]
async fn test_session_end_completes_the_session_despite_pending_background_work() {
    let (state, _temp_dir) = test_state("claude_session_end_armed_monitor");
    let task_id = running_claude_session(&state, "ses-claude-session-end", 112);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(
        transcript_dir.path(),
        &armed_monitor_transcript(60 * 60 * 1000),
    );

    post_claude_hook(&state, "session-end", &task_id, 112, &transcript_path).await;

    assert_eq!(
        session_status(&state, "ses-claude-session-end"),
        "completed"
    );
}

#[tokio::test]
async fn test_stop_completes_session_when_background_liveness_cannot_be_confirmed() {
    let (state, _temp_dir) = test_state("claude_stop_unconfirmed_background_work");
    let task_id = running_claude_session(&state, "ses-claude-background", 104);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(transcript_dir.path(), &backgrounded_shell_transcript());

    post_claude_hook(&state, "stop", &task_id, 104, &transcript_path).await;

    assert_eq!(session_status(&state, "ses-claude-background"), "completed");
}

#[tokio::test]
async fn test_stop_completes_session_when_the_hook_carries_no_transcript() {
    let (state, _temp_dir) = test_state("claude_stop_without_transcript");
    let task_id = running_claude_session(&state, "ses-claude-no-transcript", 113);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = transcript_dir.path().join("missing.jsonl");

    post_claude_hook(&state, "stop", &task_id, 113, &transcript_path).await;

    assert_eq!(
        session_status(&state, "ses-claude-no-transcript"),
        "completed"
    );
}

fn persistent_monitor_transcript() -> Vec<String> {
    vec![
        serde_json::json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [{
                "type": "tool_use",
                "id": "toolu_1",
                "name": "Monitor",
                "input": {"until": "the dev server logs an error"},
            }]},
        })
        .to_string(),
        serde_json::json!({
            "type": "user",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "message": {"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": "ok",
            }]},
            "toolUseResult": {"taskId": "m1", "persistent": true},
        })
        .to_string(),
    ]
}

fn set_background_work_grace(state: &AppState, seconds: u64) {
    state
        .db
        .lock()
        .expect("lock db")
        .set_config(
            crate::http_server::deferred_completion::BACKGROUND_WORK_GRACE_CONFIG_KEY,
            &seconds.to_string(),
        )
        .expect("set background work grace");
}

async fn wait_for_session_status(state: &AppState, session_id: &str, expected: &str) {
    for _ in 0..60 {
        if session_status(state, session_id) == expected {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!(
        "session {session_id} never reached {expected}, last status was {}",
        session_status(state, session_id)
    );
}

#[tokio::test]
async fn test_a_deferred_session_completes_once_its_monitor_timeout_passes() {
    let (state, _temp_dir) = test_state("claude_deferred_monitor_expiry");
    let task_id = running_claude_session(&state, "ses-claude-deferred-monitor", 114);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(transcript_dir.path(), &armed_monitor_transcript(1500));

    post_claude_hook(&state, "stop", &task_id, 114, &transcript_path).await;
    assert_eq!(
        session_status(&state, "ses-claude-deferred-monitor"),
        "running"
    );

    wait_for_session_status(&state, "ses-claude-deferred-monitor", "completed").await;
}

#[tokio::test]
async fn test_a_deferred_session_completes_once_endless_background_work_outlives_its_grace() {
    let (state, _temp_dir) = test_state("claude_deferred_persistent_monitor");
    set_background_work_grace(&state, 1);
    let task_id = running_claude_session(&state, "ses-claude-deferred-persistent", 115);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(transcript_dir.path(), &persistent_monitor_transcript());

    post_claude_hook(&state, "stop", &task_id, 115, &transcript_path).await;
    assert_eq!(
        session_status(&state, "ses-claude-deferred-persistent"),
        "running"
    );

    wait_for_session_status(&state, "ses-claude-deferred-persistent", "completed").await;
}

#[tokio::test]
async fn test_a_later_hook_cancels_the_deferred_completion() {
    let (state, _temp_dir) = test_state("claude_deferred_completion_cancelled");
    set_background_work_grace(&state, 1);
    let task_id = running_claude_session(&state, "ses-claude-deferral-cancelled", 116);
    let transcript_dir = tempfile::tempdir().expect("transcript dir");
    let transcript_path = write_transcript(transcript_dir.path(), &persistent_monitor_transcript());

    post_claude_hook(&state, "stop", &task_id, 116, &transcript_path).await;
    post_claude_hook(&state, "post-tool-use", &task_id, 116, &transcript_path).await;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    assert_eq!(
        session_status(&state, "ses-claude-deferral-cancelled"),
        "running"
    );
}
