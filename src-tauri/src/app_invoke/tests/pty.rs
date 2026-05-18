use super::*;

#[tokio::test]
async fn handles_commands_that_do_not_require_spawn() {
    let (state, path) = test_state("app_invoke_pty_commands");

    assert!(
        invoke_ok(&state, "get_pty_buffer", json!({ "taskId": "T-404" }))
            .await
            .is_null()
    );
    assert!(invoke_ok(
        &state,
        "pty_kill_shells_for_task",
        json!({ "taskId": "T-404" }),
    )
    .await
    .is_null());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn spawns_without_backend_app_emitter() {
    let (state, path) = test_state("app_invoke_pty_spawn_without_app");

    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({ "taskId": "T-1", "cwd": "/tmp", "cols": 80, "rows": 24, "terminalIndex": 1 }),
    )
    .await;
    assert!(instance_id.as_u64().expect("instance id") > 0);

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
    for _ in 0..8 {
        let Ok(event) =
            tokio::time::timeout(std::time::Duration::from_secs(2), events.recv()).await
        else {
            break;
        };
        let event = event.expect("event should be available");
        saw_output |= event.event_name == "pty-output-T-1-shell-1";
        saw_exit |= event.event_name == "pty-exit-T-1-shell-1";
        if saw_output && saw_exit {
            break;
        }
    }
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
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn spawns_shell_in_workspace_path_with_spaces() {
    let (state, path) = test_state("app_invoke_pty_spawn_space_cwd");
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

    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .write_pty("T-space-shell-0", b"pwd -P\n")
        .await
        .expect("write shell command");

    let mut saw_workspace_cwd = false;
    for _ in 0..12 {
        let Ok(event) =
            tokio::time::timeout(std::time::Duration::from_secs(2), events.recv()).await
        else {
            break;
        };
        let event = event.expect("event should be available");
        if event.event_name == "pty-output-T-space-shell-0"
            && event.payload["data"]
                .as_str()
                .is_some_and(|data| data.contains(&expected_cwd))
        {
            saw_workspace_cwd = true;
            break;
        }
    }

    let _ = state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .kill_shells_for_task("T-space")
        .await;
    assert!(
        saw_workspace_cwd,
        "shell PTY should start with actual cwd at workspace containing spaces: {expected_cwd}"
    );
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn rejects_shell_spawn_when_workspace_cwd_is_missing_instead_of_falling_back() {
    let (state, path) = test_state("app_invoke_pty_spawn_missing_cwd");
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
    let _ = std::fs::remove_file(path);
}
