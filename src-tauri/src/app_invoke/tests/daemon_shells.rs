use super::*;

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn restart_preparation_drains_spawns_and_rejects_later_mutations_as_not_executed() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-restart-fence-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut state, _db) = test_state("restart-fence");
    state.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        "*".into(),
    );
    let instance = invoke_ok(&state, "pty_spawn_shell", json!({
        "taskId": "T-fenced", "terminalIndex": 0, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
    })).await;
    let operation_id = uuid::Uuid::new_v4().to_string();
    let prepared = invoke_ok(
        &state,
        "prepare_app_restart",
        json!({
            "operationId": operation_id, "intent": "restart",
        }),
    )
    .await;
    assert_eq!(prepared["sessions"][0]["instanceId"], instance);
    let rejected = invoke(&state, "pty_spawn_shell", json!({
        "taskId": "T-rejected", "terminalIndex": 0, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
    })).await.unwrap_err();
    assert!(rejected.1.contains("not executed"), "{rejected:?}");
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    assert_eq!(inventory["sessions"].as_array().unwrap().len(), 1);
    invoke_ok(
        &state,
        "cancel_app_restart",
        json!({ "operationId": operation_id }),
    )
    .await;
    invoke_ok(&state, "pty_spawn_shell", json!({
        "taskId": "T-rejected", "terminalIndex": 0, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
    })).await;
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn production_daemon_owns_unindexed_and_indexed_shells() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-production-owner-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut state, _db) = test_state("production-daemon");
    state
        .pty_manager
        .as_mut()
        .unwrap()
        .enable_installation_daemon(fixture.0.path().into(), executable);
    for (task, index) in [("T-production-a", None), ("T-production-b", Some(3))] {
        invoke_ok(&state, "pty_spawn_shell", json!({
            "taskId": task, "terminalIndex": index, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
        })).await;
    }
    state
        .pty_manager
        .as_ref()
        .unwrap()
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id: "T-production-a",
                cwd: fixture.0.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
            None,
        )
        .await
        .unwrap();
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    assert_eq!(inventory["hasLegacySessions"], false);
    assert_eq!(inventory["sessions"].as_array().unwrap().len(), 2);
    let previous = invoke_ok(
        &state,
        "get_pty_buffer",
        json!({"shellSessionKey": "T-production-a-shell-0"}),
    )
    .await;
    invoke_ok(
        &state,
        "pty_kill",
        json!({"shellSessionKey": "T-production-a-shell-0"}),
    )
    .await;
    let replacement = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({
            "taskId": "T-production-a", "cwd": fixture.0.path(), "cols": 80, "rows": 24,
        }),
    )
    .await;
    assert_ne!(
        replacement, previous["instanceId"],
        "an explicit new shell needs a new identity"
    );
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    assert_eq!(
        inventory["sessions"].as_array().unwrap().len(),
        2,
        "only the current identity of each tab may be restored"
    );
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn controlled_workspace_recovers_multiple_indexed_shells_across_tasks() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-workspace-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut first, _db1) = test_state("workspace-first");
    first.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable.clone(),
        "*".into(),
    );
    let mut instances = Vec::new();
    for (task, index) in [("T-workspace-a", 2), ("T-workspace-b", 4)] {
        let instance = invoke_ok(&first, "pty_spawn_shell", json!({
            "taskId": task, "terminalIndex": index, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
        })).await;
        instances.push(instance);
    }
    let inventory = invoke_ok(&first, "get_restart_terminal_inventory", json!({})).await;
    if inventory["sessions"].as_array().unwrap().len() != 2 {
        for task in ["T-workspace-a", "T-workspace-b"] {
            invoke_ok(
                &first,
                "pty_kill_shells_for_task",
                json!({ "taskId": task }),
            )
            .await;
        }
    }
    assert_eq!(inventory["sessions"].as_array().unwrap().len(), 2);
    drop(first);
    let (mut second, _db2) = test_state("workspace-second");
    second.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        "*".into(),
    );
    for (i, key) in ["T-workspace-a-shell-2", "T-workspace-b-shell-4"]
        .into_iter()
        .enumerate()
    {
        let replay = invoke_ok(&second, "get_pty_buffer", json!({ "shellSessionKey": key })).await;
        assert_eq!(replay["instanceId"], instances[i]);
        assert_eq!(replay["isLive"], true);
    }
    invoke_ok(
        &second,
        "pty_kill_shells_for_task",
        json!({ "taskId": "T-workspace-a" }),
    )
    .await;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let inventory = invoke_ok(&second, "get_restart_terminal_inventory", json!({})).await;
        let sessions = inventory["sessions"].as_array().unwrap();
        assert_eq!(
            sessions
                .iter()
                .find(|session| session["key"] == "T-workspace-b-shell-4")
                .unwrap()["isLive"],
            true
        );
        if sessions
            .iter()
            .find(|session| session["key"] == "T-workspace-a-shell-2")
            .unwrap()["isLive"]
            == false
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Task-scoped stop did not reach the daemon shell"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    drop(second);
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn restart_inventory_reports_authoritative_shell_identity_without_spawn_configuration() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-inventory-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut state, _db) = test_state("restart-inventory");
    state.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        "T-inventory-shell-2".into(),
    );
    let instance = invoke_ok(&state, "pty_spawn_shell", json!({
        "taskId": "T-inventory", "terminalIndex": 2, "cwd": fixture.0.path(), "cols": 80, "rows": 24,
    })).await;
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    assert!(inventory["controller"].is_object());
    assert_eq!(inventory["hasLegacySessions"], false);
    assert_eq!(
        inventory["sessions"],
        json!([{
            "key": "T-inventory-shell-2", "instanceId": instance, "isLive": true,
        }])
    );
    assert!(!inventory.to_string().contains("environment"));
    let fence = json!({ "controller": inventory["controller"], "instanceId": instance });
    invoke_ok(
        &state,
        "pty_resize",
        json!({
            "shellSessionKey": "T-inventory-shell-2", "cols": 90, "rows": 30, "fence": fence,
        }),
    )
    .await;
    let mut stale = fence.clone();
    stale["controller"]["generation"] =
        json!(inventory["controller"]["generation"].as_u64().unwrap() + 1);
    let error = invoke(
        &state,
        "pty_write",
        json!({
            "shellSessionKey": "T-inventory-shell-2", "data": "must-not-arrive", "fence": stale,
        }),
    )
    .await
    .unwrap_err();
    assert!(error.1.contains("controller"), "{error:?}");
    stale = fence;
    stale["instanceId"] = json!(instance.as_u64().unwrap() + 1);
    let error = invoke(
        &state,
        "get_pty_buffer",
        json!({
            "shellSessionKey": "T-inventory-shell-2", "fence": stale,
        }),
    )
    .await
    .unwrap_err();
    assert!(error.1.to_lowercase().contains("pty"), "{error:?}");
    drop(state);
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn indexed_daemon_shell_reattaches_through_existing_ipc_after_sidecar_state_replacement() {
    let root = tempfile::Builder::new()
        .prefix("of-ipc-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut first, _first_db) = test_state("daemon-shell-first");
    first.pty_manager.as_mut().unwrap().enable_daemon_shell(
        root.path().into(),
        executable.clone(),
        "T-daemon-shell-3".into(),
    );
    let instance = invoke_ok(&first, "pty_spawn_shell", json!({ "taskId": "T-daemon", "terminalIndex": 3, "cwd": root.path(), "cols": 80, "rows": 24 })).await;
    invoke_ok(
        &first,
        "pty_write",
        json!({ "shellSessionKey": "T-daemon-shell-3", "data": "kept_across_sidecars=yes\n" }),
    )
    .await;
    drop(first);
    let (mut second, _second_db) = test_state("daemon-shell-second");
    second.pty_manager.as_mut().unwrap().enable_daemon_shell(
        root.path().into(),
        executable,
        "T-daemon-shell-3".into(),
    );
    let replay = invoke_ok(
        &second,
        "get_pty_buffer",
        json!({"shellSessionKey":"T-daemon-shell-3"}),
    )
    .await;
    assert_eq!(replay["instanceId"], instance);
    assert_eq!(replay["isLive"], true);
    assert!(replay["snapshot"]["continuationData"].is_string());
    let same = invoke_ok(&second, "pty_spawn_shell", json!({ "taskId": "T-daemon", "terminalIndex": 3, "cwd": root.path(), "cols": 80, "rows": 24 })).await;
    assert_eq!(
        same, instance,
        "reattachment must not spawn a replacement shell"
    );
    invoke_ok(
        &second,
        "pty_kill",
        json!({ "shellSessionKey": "T-daemon-shell-3" }),
    )
    .await;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let replay = invoke_ok(
            &second,
            "get_pty_buffer",
            json!({ "shellSessionKey": "T-daemon-shell-3" }),
        )
        .await;
        if replay["isLive"] == false {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    drop(second);
    let client = openforge_session_client::Client::connect(root.path()).unwrap();
    client.shutdown_empty().unwrap();
}
