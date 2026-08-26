use super::*;

#[test]
fn missing_root_pid_runs_emergency_child_cleanup() {
    let cleanup_called = std::cell::Cell::new(false);

    let result = require_root_pid_or_cleanup(None, "Shell PTY for task T-1", || {
        cleanup_called.set(true);
        Ok(())
    });

    assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
    assert!(
        cleanup_called.get(),
        "a spawned child without a PID must still receive emergency cleanup"
    );
}
