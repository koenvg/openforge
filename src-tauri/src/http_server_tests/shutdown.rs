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
async fn sidecar_runtime_shutdown_cleanup_is_safe_and_idempotent_without_live_children() {
    let (state, _path) = test_state("sidecar_runtime_shutdown_cleanup_empty");

    shutdown_sidecar_runtime(&state).await;
    shutdown_sidecar_runtime(&state).await;
}

#[tokio::test]
async fn sidecar_runtime_shutdown_terminates_live_indexed_shell() {
    let (state, _path) = test_state("sidecar_runtime_shutdown_live_shell");
    let workspace = tempfile::tempdir().expect("workspace temp dir");
    let pty_manager = state.pty_manager.as_ref().expect("PTY manager");
    pty_manager
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id: "T-shutdown",
                cwd: workspace.path(),
                cols: 80,
                rows: 24,
                app_handle: None,
                app_event_tx: None,
            },
            Some(1),
            None,
        )
        .await
        .expect("shutdown test shell should spawn");
    assert_eq!(
        pty_manager.get_session_keys().await,
        vec!["T-shutdown-shell-1".to_string()]
    );

    shutdown_sidecar_runtime(&state).await;

    assert!(pty_manager.get_session_keys().await.is_empty());
    assert!(pty_manager.process_diagnostic_sessions().await.is_empty());
}
