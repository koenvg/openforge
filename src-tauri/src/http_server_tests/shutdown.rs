use super::*;

#[test]
fn sidecar_runtime_shutdown_budget_stays_inside_electron_sigterm_grace() {
    const ELECTRON_SIDECAR_SIGTERM_GRACE: Duration = Duration::from_millis(7_000);

    assert_eq!(
        SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
        Duration::from_millis(5_000),
        "Rust internal cleanup timeout is part of the Electron shutdown budget contract"
    );
    assert!(
        SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT < ELECTRON_SIDECAR_SIGTERM_GRACE,
        "Rust cleanup must finish before Electron escalates SIGTERM to SIGKILL"
    );
}

#[tokio::test]
async fn serve_error_still_runs_coordinated_sidecar_cleanup() {
    // Runs the production cleanup path, which sweeps every git fetch in the process.
    let _serialized = crate::git_origin_fetch::hanging_fetch_test_support::PROCESS_WIDE_FETCH_LOCK
        .lock()
        .await;
    let (mut state, _path) = test_state("sidecar_runtime_cleanup_after_serve_error");
    let manager = crate::companion_gateway::test_manager();
    manager.enable().await.expect("gateway should start");
    state.companion_gateway = Some(manager.clone());

    let serve_result = run_electron_sidecar_with_cleanup(
        async { Err(std::io::Error::other("injected serve failure")) },
        &state,
        None,
    )
    .await;

    let error = serve_result.expect_err("serve error should be preserved after cleanup");
    assert_eq!(error.kind(), std::io::ErrorKind::Other);
    assert_eq!(error.to_string(), "injected serve failure");

    let status = serde_json::to_value(manager.status().await).expect("serialize status");
    assert_eq!(status["phase"], "stopped");
    assert_eq!(status["enabled"], true);
}
#[tokio::test]
async fn sidecar_runtime_shutdown_cleanup_is_safe_and_idempotent_without_live_children() {
    let (state, _temp_dir) = test_state("sidecar_runtime_shutdown_cleanup_empty");

    shutdown_sidecar_runtime(&state, None).await;
    shutdown_sidecar_runtime(&state, None).await;
}

#[tokio::test]
async fn coordinated_sidecar_shutdown_closes_the_companion_gateway_within_budget() {
    let (mut state, _path) = test_state("sidecar_runtime_shutdown_companion_gateway");
    let manager = crate::companion_gateway::test_manager();
    manager.enable().await.expect("gateway should start");
    state.companion_gateway = Some(manager.clone());

    tokio::time::timeout(
        SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
        shutdown_sidecar_runtime(&state, None),
    )
    .await
    .expect("coordinated shutdown should remain within its budget");

    let status = serde_json::to_value(manager.status().await).expect("serialize status");
    assert_eq!(status["phase"], "stopped");
    assert_eq!(status["enabled"], true);
}

#[tokio::test]
async fn sidecar_runtime_shutdown_terminates_live_indexed_shell() {
    let (state, _temp_dir) = test_state("sidecar_runtime_shutdown_live_shell");
    let workspace = tempfile::tempdir().expect("workspace temp dir");
    let task_id = format!("T-shutdown-{}", uuid::Uuid::new_v4());
    let pty_manager = state.pty_manager.as_ref().expect("PTY manager");
    pty_manager
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id: &task_id,
                cwd: workspace.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(1),
            None,
        )
        .await
        .expect("shutdown test shell should spawn");
    assert_eq!(
        pty_manager.get_session_keys().await,
        vec![format!("{task_id}-shell-1")]
    );

    shutdown_sidecar_runtime(&state, None).await;

    assert!(pty_manager.get_session_keys().await.is_empty());
    assert!(pty_manager.process_diagnostic_sessions().await.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn sidecar_shutdown_signals_a_running_git_fetch_before_bounded_cleanup() {
    use crate::git_origin_fetch::hanging_fetch_test_support::*;

    let (mut state, _path) = test_state("sidecar_shutdown_hung_git_fetch");
    let repo = tempfile::tempdir().expect("repo temp dir");
    let repo_path = repo.path().join("repo");
    let pid_file = init_repo_with_hanging_origin(&repo_path);

    crate::git_worktree::list_git_branches(&repo_path)
        .await
        .expect("branches should list without waiting on the hung fetch");
    // The background origin refresh is hanging from here on.
    let helper_pid = wait_for_recorded_pid(&pid_file).await;

    // Nothing aborts this restore, so it keeps holding the gateway operation lock
    // while blocked in a non-cancellable identity read. The gateway shutdown step
    // inside the bounded cleanup waits on that lock, so the cleanup cannot be what
    // kills the fetch.
    let (manager, restore_entered, release_restore) =
        crate::companion_gateway::non_cancelling_test_manager();
    state.companion_gateway = Some(manager.clone());
    let stalled_restore = tokio::spawn({
        let manager = manager.clone();
        async move {
            let _ = manager.restore().await;
        }
    });
    tokio::time::timeout(Duration::from_secs(1), restore_entered)
        .await
        .expect("platform trust initialization should start")
        .expect("platform trust entry signal");

    let cleanup = run_electron_sidecar_with_cleanup(async { Ok(()) }, &state, None);
    tokio::pin!(cleanup);
    tokio::select! {
        _ = &mut cleanup => panic!("the bounded cleanup should still be blocked on the gateway operation lock"),
        _ = assert_process_exits(helper_pid) => {},
    }

    let _ = release_restore.send(());
    tokio::time::timeout(SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT * 2, cleanup)
        .await
        .expect("cleanup should finish once the gateway operation lock is released")
        .expect("shutdown should report the serve result");
    stalled_restore
        .await
        .expect("stalled restore should finish");
}

#[tokio::test]
async fn hung_companion_restore_cannot_consume_pty_shutdown_budget() {
    let (mut state, _path) = test_state("sidecar_runtime_shutdown_hung_companion_restore");
    let (manager, restore_entered, release_restore) =
        crate::companion_gateway::non_cancelling_test_manager();
    state.companion_gateway = Some(manager.clone());
    let restore_task = restore_companion_gateway_in_background(manager.clone(), true)
        .expect("enabled persisted gateway should own a restore task");
    tokio::time::timeout(Duration::from_secs(1), restore_entered)
        .await
        .expect("platform trust initialization should start")
        .expect("platform trust entry signal");

    let workspace = tempfile::tempdir().expect("workspace temp dir");
    let task_id = format!("T-hung-restore-shutdown-{}", uuid::Uuid::new_v4());
    let pty_manager = state.pty_manager.as_ref().expect("PTY manager");
    pty_manager
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id: &task_id,
                cwd: workspace.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(0),
            None,
        )
        .await
        .expect("shutdown test shell should spawn");

    tokio::time::timeout(
        SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
        shutdown_sidecar_runtime(&state, Some(restore_task)),
    )
    .await
    .expect("hung persisted restore must not consume the core cleanup budget");

    assert!(pty_manager.get_session_keys().await.is_empty());
    assert!(pty_manager.process_diagnostic_sessions().await.is_empty());
    assert_eq!(
        serde_json::to_value(manager.status().await).expect("serialize status")["phase"],
        "stopped"
    );
    drop(release_restore);
}
