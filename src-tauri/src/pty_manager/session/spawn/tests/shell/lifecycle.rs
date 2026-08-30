use super::support::ShellTestHarness;
use crate::pty_manager::managed_process::ManagedProcessIdentity;
use crate::pty_manager::pids::shell_session_key;
use crate::pty_manager::session::lifecycle::PtySessionKind;
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shell_spawn_waits_for_output_reader_readiness_before_returning() {
    let harness = ShellTestHarness::new();
    let task_id = "shell-reader-readiness";
    let session_key = shell_session_key(task_id, Some(0));
    let (reader_ready_tx, reader_ready_rx) = std::sync::mpsc::channel();
    let (release_reader_tx, release_reader_rx) = std::sync::mpsc::channel();
    *harness
        .manager
        .output_reader_ready_gate
        .lock()
        .expect("shell output reader ready gate lock should not be poisoned") =
        Some(crate::pty_manager::PtyOutputReaderReadyGate {
            reached_tx: reader_ready_tx,
            release_rx: release_reader_rx,
        });

    let spawn_manager = harness.manager.clone();
    let spawn_cwd = harness.temp_dir.path().to_path_buf();
    let spawn = tokio::spawn(async move {
        spawn_manager
            .spawn_shell_pty_with_command(
                crate::pty_manager::PtySpawnContext {
                    task_id,
                    cwd: &spawn_cwd,
                    cols: 80,
                    rows: 24,
                    event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
                },
                Some(0),
                None,
                super::support::long_running_shell_command(),
            )
            .await
    });

    tokio::task::spawn_blocking(move || {
        reader_ready_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("shell output reader should report readiness");
    })
    .await
    .expect("readiness waiter should join");

    assert!(
        !spawn.is_finished(),
        "shell spawn must remain pending until its output reader is ready"
    );
    assert!(harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
    assert!(harness
        .manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(harness
        .manager
        .last_output
        .lock()
        .await
        .contains_key(&session_key));

    release_reader_tx
        .send(())
        .expect("shell output reader should be released");
    spawn
        .await
        .expect("shell spawn task should join")
        .expect("shell PTY should spawn after reader readiness");

    harness
        .manager
        .kill_pty(&session_key)
        .await
        .expect("shell cleanup should succeed");
}
#[tokio::test]
async fn shell_spawn_persists_identity_and_owns_lifecycle_state_until_cleanup() {
    let harness = ShellTestHarness::new();
    let task_id = "shell-lifecycle";
    let session_key = shell_session_key(task_id, Some(2));
    let pid_file = harness.pid_dir.join(format!("{session_key}.pid"));

    let instance_id = harness
        .spawn_long_running(task_id, Some(2))
        .await
        .expect("shell PTY should spawn");

    let expected_identity = {
        let sessions = harness.manager.sessions.lock().await;
        let session = sessions
            .get(&session_key)
            .expect("spawned shell should be registered");
        assert_eq!(session.instance_id, instance_id);
        assert!(matches!(
            &session.kind,
            PtySessionKind::Shell { task_id: stored_task_id } if stored_task_id == task_id
        ));
        session.managed_process.clone()
    };
    let persisted_identity: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(&pid_file).expect("shell identity should be persisted"),
    )
    .expect("shell identity should parse");
    assert_eq!(persisted_identity, expected_identity);
    assert!(harness
        .manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(harness
        .manager
        .last_output
        .lock()
        .await
        .contains_key(&session_key));
    assert!(harness.manager.lifecycle_locks.contains_key(&session_key));
    assert!(!harness
        .manager
        .agent_spawn_generations
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!harness
        .manager
        .pending_shell_spawns
        .contains_key(&session_key));

    harness
        .manager
        .kill_pty(&session_key)
        .await
        .expect("shell cleanup should succeed");
    assert!(!pid_file.exists());
    assert!(!harness
        .manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!harness
        .manager
        .last_output
        .lock()
        .await
        .contains_key(&session_key));
    tokio::time::timeout(Duration::from_secs(1), async {
        while harness.manager.lifecycle_locks.contains_key(&session_key) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("shell teardown should release its lifecycle lock");
}
