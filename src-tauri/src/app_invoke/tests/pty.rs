use super::*;
use base64::Engine;

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[tokio::test]
async fn handles_commands_that_do_not_require_spawn() {
    let (state, _temp_dir) = test_state("app_invoke_pty_commands");

    assert_eq!(
        invoke_ok(
            &state,
            "get_pty_buffer",
            json!({ "shellSessionKey": "T-404" }),
        )
        .await,
        json!({ "buffer": null, "isLive": false, "instanceId": null })
    );
    assert!(invoke_ok(
        &state,
        "pty_kill_shells_for_task",
        json!({ "taskId": "T-404" }),
    )
    .await
    .is_null());
}

#[tokio::test]
async fn spawns_without_backend_app_emitter() {
    let (mut state, _temp_dir) = test_state("app_invoke_pty_spawn_without_app");

    // Raw and model PTY chunks share this receiver. Keep the bounded shell exchange
    // from evicting the events this test observes.
    let (app_event_tx, _) = tokio::sync::broadcast::channel(1_024);
    state.app_event_tx = Some(app_event_tx);

    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({ "taskId": "T-1", "cwd": "/tmp", "cols": 80, "rows": 24, "terminalIndex": 1 }),
    )
    .await;
    assert!(instance_id.as_u64().expect("instance id") > 0);

    let live_buffer = invoke_ok(
        &state,
        "get_pty_buffer",
        json!({ "shellSessionKey": "T-1-shell-1" }),
    )
    .await;
    assert_eq!(live_buffer["isLive"], true);
    assert_eq!(live_buffer["instanceId"], instance_id);
    assert!(live_buffer["buffer"].is_null());

    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .write_pty("T-1-shell-1", b"printf sidecar-pty-ready\\n\n")
        .await
        .expect("write shell command");
    let _ = state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .kill_shells_for_task("T-1")
        .await;
    let mut saw_output = false;
    let mut saw_exit = false;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !saw_output || !saw_exit {
            let event = events.recv().await.expect("event should be available");
            saw_output |= event.event_name == "pty-output-T-1-shell-1";
            saw_exit |= event.event_name == "pty-exit-T-1-shell-1";
        }
    })
    .await;
    assert!(saw_output, "sidecar should publish PTY output events");
    if !saw_exit {
        let _ = state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .kill_shells_for_task("T-1")
            .await;
    }
    assert!(saw_exit, "sidecar should publish PTY exit events");
}

#[tokio::test]
async fn ghostty_authority_returns_canonical_terminal_snapshot_for_xterm_rendering() {
    let (mut state, _temp_dir) = test_state("app_invoke_ghostty_snapshot");
    // Raw and model PTY chunks share this receiver. Size this test-local channel for the
    // bounded shell exchange so an unrelated burst cannot evict the event under test.
    let (app_event_tx, _) = tokio::sync::broadcast::channel(1_024);
    state.app_event_tx = Some(app_event_tx);
    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({
            "taskId": "T-ghostty",
            "cwd": "/tmp",
            "cols": 80,
            "rows": 24,
            "terminalIndex": 0,
        }),
    )
    .await;

    let state_view = invoke_ok(
        &state,
        "get_pty_buffer",
        json!({ "shellSessionKey": "T-ghostty-shell-0" }),
    )
    .await;

    assert_eq!(state_view["authority"], "ghostty-authoritative");
    assert!(state_view["buffer"].is_null());
    assert_eq!(state_view["instanceId"], instance_id);
    assert_eq!(state_view["snapshot"]["instanceId"], instance_id);
    assert!(state_view["snapshot"]["data"].as_str().is_some());

    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    // Exceed the shared fixture's 16-event capacity to reproduce the former CI failure.
    for sequence in 0..32 {
        crate::app_events::publish_app_event(
            &state.app_event_tx,
            "unrelated-test-event",
            &json!({ "sequence": sequence }),
        );
    }
    const IMAGE_SEQUENCE: &str =
        "\u{1b}]1337;File=size=34;inline=1:R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==\u{7}";
    let print_image =
        "printf '\\033]1337;File=size=34;inline=1:R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==\\007ghostty-model-output\\n'\n";
    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .write_pty("T-ghostty-shell-0", print_image.as_bytes())
        .await
        .expect("shell input should write");
    let model_event = loop {
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), events.recv())
            .await
            .expect("model output event deadline")
            .expect("model output event");
        if event.event_name == "pty-model-output-T-ghostty-shell-0" {
            break event;
        }
    };
    assert_eq!(model_event.payload["instance_id"], instance_id);
    assert!(model_event.payload["sequence"].as_u64().is_some());
    assert!(model_event.payload["data"]
        .as_str()
        .is_some_and(|data| !data.is_empty()));

    let compatibility_replay = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let replay = invoke_ok(
                &state,
                "get_pty_buffer",
                json!({ "shellSessionKey": "T-ghostty-shell-0" }),
            )
            .await;
            if let Some(encoded) = replay["snapshot"]["compatibilityData"].as_str() {
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .expect("compatibility replay should be base64");
                let has_image = decoded
                    .windows(IMAGE_SEQUENCE.len())
                    .any(|window| window == IMAGE_SEQUENCE.as_bytes());
                let has_output = decoded
                    .windows(b"ghostty-model-output".len())
                    .any(|window| window == b"ghostty-model-output");
                if has_image && has_output {
                    break decoded;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("bounded compatibility replay should include accepted raw output");
    assert!(compatibility_replay
        .windows(IMAGE_SEQUENCE.len())
        .any(|window| window == IMAGE_SEQUENCE.as_bytes()));
    assert!(compatibility_replay
        .windows(b"ghostty-model-output".len())
        .any(|window| window == b"ghostty-model-output"));

    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .kill_shells_for_task("T-ghostty")
        .await
        .expect("Ghostty shell should stop");
}

#[tokio::test]
async fn ghostty_authority_rejects_xterm_generated_query_responses() {
    let (state, _temp_dir) = test_state("app_invoke_ghostty_authority");
    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({
            "taskId": "T-ghostty-authority",
            "cwd": "/tmp",
            "cols": 80,
            "rows": 24,
            "terminalIndex": 0,
        }),
    )
    .await
    .as_u64()
    .expect("instance id");

    let error = invoke(
        &state,
        "pty_write_terminal_query_response",
        json!({
            "shellSessionKey": "T-ghostty-authority-shell-0",
            "ptyInstanceId": instance_id,
            "data": "\u{1b}[1;1R",
        }),
    )
    .await
    .expect_err("xterm responses must not write when Ghostty owns terminal state");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("Ghostty owns terminal query responses"));

    let _ = state
        .pty_manager
        .as_ref()
        .expect("PTY manager")
        .kill_shells_for_task("T-ghostty-authority")
        .await;
}

#[tokio::test]
async fn spawns_shell_in_workspace_path_with_spaces() {
    let (state, _temp_dir) = test_state("app_invoke_pty_spawn_space_cwd");
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let workspace_path = temp_dir.path().join("Snooze Vault");
    std::fs::create_dir_all(&workspace_path).expect("workspace with spaces should be created");
    let expected_cwd = workspace_path
        .canonicalize()
        .expect("workspace path should canonicalize")
        .to_string_lossy()
        .to_string();

    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({
            "taskId": "T-space",
            "cwd": workspace_path.to_string_lossy(),
            "cols": 80,
            "rows": 24,
            "terminalIndex": 0,
        }),
    )
    .await;
    assert!(instance_id.as_u64().expect("instance id") > 0);

    let output_path = temp_dir.path().join("shell cwd.txt");
    let command = format!(
        "pwd -P > {}\n",
        shell_single_quote(&output_path.to_string_lossy())
    );
    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .write_pty("T-space-shell-0", command.as_bytes())
        .await
        .expect("write shell command");

    let mut observed_cwd = None;
    for _ in 0..200 {
        if let Ok(contents) = std::fs::read_to_string(&output_path) {
            let trimmed = contents.trim_end_matches(&['\r', '\n'][..]).to_string();
            if !trimmed.is_empty() {
                observed_cwd = Some(trimmed);
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let _ = state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .kill_shells_for_task("T-space")
        .await;
    assert_eq!(
        observed_cwd.as_deref(),
        Some(expected_cwd.as_str()),
        "shell PTY should start with actual cwd at workspace containing spaces"
    );
}

#[tokio::test]
async fn rejects_shell_spawn_when_workspace_cwd_is_missing_instead_of_falling_back() {
    let (state, _temp_dir) = test_state("app_invoke_pty_spawn_missing_cwd");
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let missing_workspace = temp_dir.path().join("Missing Vault");

    let err = invoke(
        &state,
        "pty_spawn_shell",
        json!({
            "taskId": "T-missing-space",
            "cwd": missing_workspace.to_string_lossy(),
            "cols": 80,
            "rows": 24,
            "terminalIndex": 0,
        }),
    )
    .await
    .expect_err("missing cwd should be rejected before spawning a shell PTY");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("workspace cwd") && err.1.contains("Missing Vault"),
        "error should explain the inaccessible workspace cwd, got: {}",
        err.1
    );
    assert!(
        !err.1.contains("Failed to spawn shell PTY"),
        "client-facing invalid cwd errors should not be wrapped as internal spawn failures, got: {}",
        err.1
    );
}

fn seed_follow_up_session(state: &crate::http_server::AppState, status: &str) -> (String, String) {
    let db = crate::db::acquire_db(&state.db);
    let project = db
        .create_project("Follow-up Project", "/tmp/openforge-follow-up")
        .expect("create project");
    let task = db
        .create_task(
            "review visual feedback",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("create task");
    let session_id = format!("session-{}", status);
    db.create_agent_session(&session_id, &task.id, None, "implementing", status, "pi")
        .expect("create agent session");
    (task.id, session_id)
}

async fn wait_for_file(path: &std::path::Path) -> String {
    for _ in 0..100 {
        if let Ok(contents) = std::fs::read_to_string(path) {
            if contents.contains("Marker 1: Fix alignment") {
                return contents;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for follow-up delivery");
}

#[tokio::test]
async fn sends_idle_agent_follow_up_immediately_and_queues_busy_or_paused_sessions() {
    for (status, expected_disposition) in [
        ("completed", "delivered"),
        ("running", "queued"),
        ("paused", "queued"),
    ] {
        let (state, _temp_dir) = test_state(&format!("app_invoke_follow_up_{status}"));
        let (task_id, session_id) = seed_follow_up_session(&state, status);
        let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let output_path = temp_dir.path().join("follow-up.txt");
        let script = format!(
            "cat > {}",
            shell_single_quote(&output_path.to_string_lossy())
        );
        state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .spawn_companion_test_agent_pty(&task_id, temp_dir.path(), &script)
            .await
            .expect("spawn test Agent PTY");

        let receipt = invoke_ok(
            &state,
            "send_agent_follow_up",
            json!({ "taskId": task_id, "message": "# Visual feedback\n\nMarker 1: Fix alignment" }),
        )
        .await;

        assert_eq!(receipt["taskId"], task_id);
        assert_eq!(receipt["sessionId"], session_id);
        assert_eq!(receipt["disposition"], expected_disposition);
        let delivered = wait_for_file(&output_path).await;
        assert!(delivered.contains("Marker 1: Fix alignment"));

        let _ = state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .kill_pty(&task_id)
            .await;
    }
}

#[tokio::test]
async fn terminal_buffer_falls_back_to_persisted_completed_session_replay() {
    let (state, _temp_dir) = test_state("app_invoke_persisted_terminal_replay");
    let (task_id, _) = seed_follow_up_session(&state, "completed");
    {
        let db = crate::db::acquire_db(&state.db);
        assert!(db
            .save_completed_agent_terminal_replay(&task_id, "persisted terminal output")
            .expect("persist replay"));
    }

    let buffer = invoke_ok(
        &state,
        "get_pty_buffer",
        json!({ "shellSessionKey": task_id }),
    )
    .await;

    assert_eq!(
        buffer,
        json!({ "buffer": "persisted terminal output", "isLive": false, "instanceId": null })
    );
}

#[tokio::test]
async fn task_follow_up_failures_are_specific_and_task_isolated() {
    let (state, _temp_dir) = test_state("app_invoke_follow_up_failures");
    let (task_id, _) = seed_follow_up_session(&state, "running");

    let no_session = invoke(
        &state,
        "send_agent_follow_up",
        json!({ "taskId": "T-other", "message": "Visual feedback" }),
    )
    .await
    .expect_err("another Task must not reuse this Task's Agent Session");
    assert_eq!(no_session.0, StatusCode::CONFLICT);
    assert!(no_session.1.contains("AGENT_FOLLOW_UP_NO_SESSION"));

    let delivery_failure = invoke(
        &state,
        "send_agent_follow_up",
        json!({ "taskId": task_id, "message": "Visual feedback" }),
    )
    .await
    .expect_err("missing Agent PTY should be retryable");
    assert_eq!(delivery_failure.0, StatusCode::SERVICE_UNAVAILABLE);
    assert!(delivery_failure
        .1
        .contains("AGENT_FOLLOW_UP_DELIVERY_FAILED"));
}
