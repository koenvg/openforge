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
