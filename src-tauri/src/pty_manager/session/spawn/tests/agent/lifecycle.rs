//! Agent registration, replay retention, and recovery metadata ownership.

use super::support::LockCheckingAgentAdapter;
use crate::pty_manager::managed_process::ManagedProcessIdentity;
use crate::pty_manager::pids::write_managed_process_identity;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use std::sync::Arc;

#[tokio::test]
async fn agent_spawn_keeps_session_mutex_out_of_provider_and_command_work() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "lock-free-agent-spawn";
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_release_rx: None,
        script: "printf lock-free-agent",
        check_lock: true,
    };

    manager
        .spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await
        .expect("agent PTY should spawn without holding sessions lock during slow setup");

    assert!(
        cleanup
            .pid_dir()
            .join(format!("{task_id}-pty.pid"))
            .exists(),
        "PID file should still be written after spawn"
    );
    assert!(
        manager.output_buffers.lock().await.contains_key(task_id),
        "output buffer should still be registered for replay"
    );

    manager
        .kill_pty(task_id)
        .await
        .expect("test PTY should be cleaned up");
    assert!(
        !cleanup
            .pid_dir()
            .join(format!("{task_id}-pty.pid"))
            .exists(),
        "PID file should be removed on cleanup"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "output buffer should be removed on explicit kill"
    );
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn scoped_agent_abort_retains_the_replay_buffer() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let session_key =
        "scoped-agent-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    manager
        .spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&manager.sessions),
                prepared_tx: None,
                command_release_rx: None,
                script: "printf scoped-output; exec sleep 5",
                check_lock: false,
            },
            PtySpawnContext {
                task_id: session_key,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await
        .expect("scoped agent PTY should spawn");

    manager
        .kill_pty_retaining_output(session_key)
        .await
        .expect("scoped agent PTY should stop");

    assert!(manager
        .output_buffers
        .lock()
        .await
        .contains_key(session_key));
    assert!(!manager.sessions.lock().await.contains_key(session_key));
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn unresolved_recovery_metadata_blocks_spawn_without_clobbering_record() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "recovery-conflict-agent";
    let pid_file = cleanup.pid_dir().join(format!("{task_id}-pty.pid"));
    std::fs::create_dir_all(cleanup.pid_dir()).expect("private PID directory should create");
    let unresolved_identity = ManagedProcessIdentity {
        version: 1,
        root_pid: 999_991,
        process_group_id: 999_991,
        session_id: 999_991,
        root_start_time: 42,
    };
    write_managed_process_identity(&pid_file, &unresolved_identity)
        .expect("unresolved identity should persist");
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_release_rx: None,
        script: "printf blocked-agent",
        check_lock: false,
    };

    let result = manager
        .spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await;

    assert!(
        matches!(result, Err(PtyError::CleanupFailed(ref message)) if message.contains("existing recovery metadata was preserved"))
    );
    let persisted: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(&pid_file).expect("recovery metadata should remain"),
    )
    .expect("recovery metadata should still parse");
    assert_eq!(persisted, unresolved_identity);
    assert!(!manager.sessions.lock().await.contains_key(task_id));
    // This test owns the synthetic record, not an unconfirmed native process.
    std::fs::remove_file(pid_file).expect("remove synthetic recovery record");
    cleanup.finish().expect("agent fixture PTY cleanup");
}
