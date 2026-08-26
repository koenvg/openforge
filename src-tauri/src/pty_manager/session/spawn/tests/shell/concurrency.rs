use super::support::{long_running_shell_command, ShellTestHarness};
use crate::app_events::RuntimeEventPublisher;
use crate::pty_manager::pids::shell_session_key;
use crate::pty_manager::{PtyError, PtySpawnContext};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_shell_cleanup_cancels_spawn_before_session_publication() {
    let harness = ShellTestHarness::new();
    let task_id = "pending-shell-cleanup";
    let session_key = shell_session_key(task_id, Some(0));
    let (spawn_pending_tx, spawn_pending_rx) = tokio::sync::oneshot::channel();
    let (release_spawn_tx, release_spawn_rx) = tokio::sync::oneshot::channel();
    *harness
        .manager
        .shell_spawn_pending_gate
        .lock()
        .expect("shell spawn pending gate lock should not be poisoned") =
        Some(crate::pty_manager::ShellSpawnPendingGate {
            reached_tx: spawn_pending_tx,
            release_rx: release_spawn_rx,
        });

    let spawn_manager = harness.manager.clone();
    let spawn_cwd = harness.temp_dir.path().to_path_buf();
    let spawn_task_id = task_id.to_string();
    let spawn_task = tokio::spawn(async move {
        spawn_manager
            .spawn_shell_pty_with_command(
                PtySpawnContext {
                    task_id: &spawn_task_id,
                    cwd: &spawn_cwd,
                    cols: 80,
                    rows: 24,
                    event_publisher: RuntimeEventPublisher::new(None, None),
                },
                Some(0),
                None,
                long_running_shell_command(),
            )
            .await
    });

    spawn_pending_rx
        .await
        .expect("shell spawn should become pending");
    assert!(
        harness
            .manager
            .pending_shell_spawns
            .contains_key(&session_key),
        "shell spawn should be discoverable before session publication"
    );

    let cleanup_manager = harness.manager.clone();
    let cleanup_task_id = task_id.to_string();
    let cleanup_task =
        tokio::spawn(async move { cleanup_manager.kill_shells_for_task(&cleanup_task_id).await });
    cleanup_task
        .await
        .expect("cleanup task should join")
        .expect("task shell cleanup should succeed");
    release_spawn_tx
        .send(())
        .expect("test should release pending shell spawn");

    let spawn_result = spawn_task.await.expect("spawn task should join");
    assert!(
        matches!(
            spawn_result,
            Err(PtyError::SpawnFailed(ref message))
                if message.contains("cancelled before spawn")
                    || message.contains("replaced before registration")
        ),
        "cleanup should cancel the pending shell spawn: {spawn_result:?}"
    );

    assert!(!harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!harness
        .manager
        .get_pid_dir()
        .expect("PID dir")
        .join(format!("{session_key}.pid"))
        .exists());
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
    .expect("session teardown should evict its lifecycle lock");
}
