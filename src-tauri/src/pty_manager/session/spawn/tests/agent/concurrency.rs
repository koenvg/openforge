//! Reader readiness, competing spawns, stale setup, and pending-spawn cancellation.

use super::support::{LockCheckingAgentAdapter, CONCURRENT_SPAWN_TIMEOUT};
use crate::pty_manager::managed_process::ManagedProcessIdentity;
use crate::pty_manager::session::spawn::streams::AgentStreamState;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn join_thread_with_timeout<T: Send + 'static>(
    thread: std::thread::JoinHandle<T>,
    description: &str,
) -> T {
    let (result_tx, result_rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = result_tx.send(thread.join());
    });

    match result_rx.recv_timeout(CONCURRENT_SPAWN_TIMEOUT) {
        Ok(Ok(result)) => result,
        Ok(Err(payload)) => std::panic::resume_unwind(payload),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            panic!("{description} should join within {CONCURRENT_SPAWN_TIMEOUT:?}")
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            panic!("{description} join monitor disconnected")
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn agent_spawn_waits_for_output_reader_readiness_before_registering_stream_state() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "reader-ready-agent-spawn";
    let (reader_ready_tx, reader_ready_rx) = mpsc::channel();
    let (release_reader_tx, release_reader_rx) = mpsc::channel();
    *manager
        .output_reader_ready_gate
        .lock()
        .expect("output reader ready gate lock should not be poisoned") =
        Some(crate::pty_manager::PtyOutputReaderReadyGate {
            reached_tx: reader_ready_tx,
            release_rx: release_reader_rx,
        });
    let (stream_start_tx, stream_start_rx) = mpsc::channel();
    let (release_stream_tx, release_stream_rx) = mpsc::channel();
    *manager
        .agent_event_stream_start_gate
        .lock()
        .expect("event stream start gate lock should not be poisoned") =
        Some(crate::pty_manager::AgentEventStreamStartGate {
            reached_tx: stream_start_tx,
            release_rx: release_stream_rx,
        });

    let spawn_manager = manager.clone();
    let spawn_cwd = tmp_dir.path().to_path_buf();
    let spawn_task_id = task_id.to_string();
    let spawn = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        runtime.block_on(spawn_manager.spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&spawn_manager.sessions),
                prepared_tx: None,
                command_release_rx: None,
                script: "printf reader-ready; exec sleep 5",
                check_lock: false,
            },
            PtySpawnContext {
                task_id: &spawn_task_id,
                cwd: &spawn_cwd,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        ))
    });

    reader_ready_rx
        .recv_timeout(CONCURRENT_SPAWN_TIMEOUT)
        .expect("agent output reader should reach its readiness signal");
    assert!(
        manager.sessions.lock().await.contains_key(task_id),
        "the spawned process should be registered before output-reader readiness"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "replay buffer registration must wait for output-reader readiness"
    );
    assert!(
        !manager.attachment_hubs.lock().await.contains_key(task_id),
        "attachment registration must wait for output-reader readiness"
    );
    assert!(
        matches!(stream_start_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "event-stream registration must wait for output-reader readiness"
    );

    release_reader_tx
        .send(())
        .expect("agent output reader should be released");
    stream_start_rx
        .recv_timeout(CONCURRENT_SPAWN_TIMEOUT)
        .expect("event stream should register after output-reader readiness");
    assert!(manager.output_buffers.lock().await.contains_key(task_id));
    assert!(manager.attachment_hubs.lock().await.contains_key(task_id));
    release_stream_tx
        .send(())
        .expect("agent event stream should be released");

    let instance_id = join_thread_with_timeout(spawn, "reader-ready agent spawn")
        .expect("agent spawn should complete after readiness");
    assert_eq!(
        manager
            .sessions
            .lock()
            .await
            .get(task_id)
            .expect("agent session should remain registered")
            .instance_id,
        instance_id
    );
    manager
        .kill_pty(task_id)
        .await
        .expect("test PTY should be cleaned up");
    cleanup.finish().expect("agent fixture PTY cleanup");
}

async fn assert_newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "concurrent-agent-spawn";
    let (old_prepared_tx, old_prepared_rx) = mpsc::channel();
    let (release_old_command_tx, release_old_command_rx) = mpsc::channel();

    let old_manager = manager.clone();
    let old_cwd = tmp_dir.path().to_path_buf();
    let old_task_id = task_id.to_string();
    let old_adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: Some(old_prepared_tx),
        command_release_rx: Some(release_old_command_rx),
        script: "printf old-agent",
        check_lock: false,
    };
    let old_spawn = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        runtime.block_on(old_manager.spawn_agent_pty(
            old_adapter,
            PtySpawnContext {
                task_id: &old_task_id,
                cwd: &old_cwd,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        ))
    });

    old_prepared_rx
        .recv_timeout(CONCURRENT_SPAWN_TIMEOUT)
        .expect("older spawn should reach provider preparation");
    let old_generation = manager
        .agent_spawn_generations
        .lock()
        .await
        .get(task_id)
        .copied()
        .expect("older spawn should publish its claim before command construction");

    let new_adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_release_rx: None,
        script: "printf new-agent",
        check_lock: false,
    };
    let mut new_spawn = Box::pin(manager.spawn_agent_pty(
        new_adapter,
        PtySpawnContext {
            task_id,
            cwd: tmp_dir.path(),
            cols: 80,
            rows: 24,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
        },
        None,
    ));
    assert!(
        futures::poll!(new_spawn.as_mut()).is_pending(),
        "newer spawn should wait for the older spawn's lifecycle lock"
    );
    let new_generation = manager
        .agent_spawn_generations
        .lock()
        .await
        .get(task_id)
        .copied()
        .expect("newer spawn should publish its claim before waiting");
    assert_ne!(
        new_generation, old_generation,
        "newer spawn should supersede the older claim"
    );

    release_old_command_tx
        .send(())
        .expect("older spawn command construction should be released");
    let old_result = join_thread_with_timeout(old_spawn, "older spawn task");
    let new_instance_id = tokio::time::timeout(CONCURRENT_SPAWN_TIMEOUT, new_spawn.as_mut())
        .await
        .expect("newer spawn should finish before the deadline")
        .expect("newer spawn should become current");
    assert!(
        matches!(old_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
        "older spawn should abort instead of replacing the newer session: {old_result:?}"
    );

    let expected_identity = {
        let sessions = manager.sessions.lock().await;
        let session = sessions
            .get(task_id)
            .expect("newer session should remain registered");
        assert_eq!(session.instance_id, new_instance_id);
        session.managed_process.clone()
    };
    let persisted_identity: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(cleanup.pid_dir().join(format!("{task_id}-pty.pid")))
            .expect("newer process metadata should remain"),
    )
    .expect("newer process metadata should parse");
    assert_eq!(persisted_identity, expected_identity);
    assert!(
        manager.output_buffers.lock().await.contains_key(task_id),
        "newer spawn should keep output buffer registration"
    );

    manager
        .kill_pty(task_id)
        .await
        .expect("newer test PTY should be cleaned up");
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
    for _ in 0..10 {
        assert_newer_agent_spawn_wins_when_older_spawn_finishes_setup_late().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn older_waiting_agent_spawn_cannot_terminate_newer_winner() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "agent-lock-order-race";
    manager
        .spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&manager.sessions),
                prepared_tx: None,
                command_release_rx: None,
                script: "while true; do sleep 1; done",
                check_lock: false,
            },
            PtySpawnContext {
                task_id,
                cwd: temp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await
        .expect("initial Terminal Session should spawn");

    let lifecycle_lock = manager.lifecycle_lock_for(task_id).await;
    let lifecycle_guard = lifecycle_lock.lock().await;
    let mut old_spawn = Box::pin(manager.spawn_agent_pty(
        LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_release_rx: None,
            script: "printf old-should-not-win; while true; do sleep 1; done",
            check_lock: false,
        },
        PtySpawnContext {
            task_id,
            cwd: temp_dir.path(),
            cols: 80,
            rows: 24,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
        },
        None,
    ));
    assert!(
        futures::poll!(old_spawn.as_mut()).is_pending(),
        "older spawn should wait for the lifecycle lock"
    );
    let old_generation = manager
        .agent_spawn_generations
        .lock()
        .await
        .get(task_id)
        .copied()
        .expect("older spawn should publish its claim before waiting");

    let mut new_spawn = Box::pin(manager.spawn_agent_pty(
        LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_release_rx: None,
            script: "printf new-winner; while true; do sleep 1; done",
            check_lock: false,
        },
        PtySpawnContext {
            task_id,
            cwd: temp_dir.path(),
            cols: 80,
            rows: 24,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
        },
        None,
    ));
    assert!(
        futures::poll!(new_spawn.as_mut()).is_pending(),
        "newer spawn should queue behind the older spawn"
    );
    let new_generation = manager
        .agent_spawn_generations
        .lock()
        .await
        .get(task_id)
        .copied()
        .expect("newer spawn should publish its claim before waiting");
    assert_ne!(
        new_generation, old_generation,
        "newer spawn should supersede the older claim"
    );
    drop(lifecycle_guard);

    let spawn_results = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(old_spawn.as_mut(), new_spawn.as_mut())
    })
    .await;
    let (old_result, new_result) = match spawn_results {
        Ok(results) => results,
        Err(_) => {
            drop(old_spawn);
            drop(new_spawn);
            let _ = tokio::time::timeout(Duration::from_secs(2), manager.kill_pty(task_id)).await;
            panic!("competing agent spawns should finish within 10 seconds");
        }
    };
    let new_instance_id = new_result.expect("newer spawn should win");
    assert!(
        matches!(
            old_result,
            Err(PtyError::SpawnFailed(ref message))
                if message.contains("cancelled before spawn")
        ),
        "older waiter must stop before replacing the newer Terminal Session: {old_result:?}"
    );
    assert_eq!(
        manager
            .sessions
            .lock()
            .await
            .get(task_id)
            .expect("newer Terminal Session should remain current")
            .instance_id,
        new_instance_id
    );
    manager
        .kill_pty(task_id)
        .await
        .expect("winning Terminal Session should clean up");
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_agent_setup_before_event_stream_cleans_only_its_tracking_state() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "stale-before-event-stream";
    let (stream_start_tx, stream_start_rx) = mpsc::channel();
    let (release_stream_tx, release_stream_rx) = mpsc::channel();
    *manager
        .agent_event_stream_start_gate
        .lock()
        .expect("event stream start gate lock should not be poisoned") =
        Some(crate::pty_manager::AgentEventStreamStartGate {
            reached_tx: stream_start_tx,
            release_rx: release_stream_rx,
        });

    let stale_manager = manager.clone();
    let stale_cwd = tmp_dir.path().to_path_buf();
    let stale_task_id = task_id.to_string();
    let stale_spawn = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        runtime.block_on(stale_manager.spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&stale_manager.sessions),
                prepared_tx: None,
                command_release_rx: None,
                script: "printf stale-agent; exec sleep 60",
                check_lock: false,
            },
            PtySpawnContext {
                task_id: &stale_task_id,
                cwd: &stale_cwd,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        ))
    });

    stream_start_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("stale spawn should pause immediately before event stream startup");
    let stale_buffer = manager
        .output_buffers
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("stale replay buffer should be registered before startup");
    let stale_hub = manager
        .attachment_hubs
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("stale attachment hub should be registered before startup");

    let (_superseding_token, superseding_lock) = manager.begin_agent_spawn(task_id, "Newer").await;
    release_stream_tx
        .send(())
        .expect("stale spawn should be released");
    let stale_result = join_thread_with_timeout(stale_spawn, "stale spawn thread");
    assert!(
        matches!(stale_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before event streaming started")),
        "superseded setup should stop before event streaming: {stale_result:?}"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "superseded setup must remove its replay buffer"
    );
    assert!(
        !manager.attachment_hubs.lock().await.contains_key(task_id),
        "superseded setup must remove its attachment hub"
    );

    let newer_instance_id = manager
        .spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&manager.sessions),
                prepared_tx: None,
                command_release_rx: None,
                script: "printf newer-agent",
                check_lock: false,
            },
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
        .expect("newer spawn should complete");
    let newer_buffer = manager
        .output_buffers
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("newer replay buffer should remain registered");
    let newer_hub = manager
        .attachment_hubs
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("newer attachment hub should remain registered");
    manager
        .remove_agent_stream_state_if_registered(
            task_id,
            &AgentStreamState {
                ring_buffer: Arc::clone(&stale_buffer),
                attachment_hub: Arc::clone(&stale_hub),
            },
        )
        .await;
    assert!(
        manager
            .output_buffers
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &newer_buffer)),
        "delayed stale cleanup must preserve the newer replay buffer"
    );
    assert!(
        manager
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &newer_hub)),
        "delayed stale cleanup must preserve the newer attachment hub"
    );
    assert!(!Arc::ptr_eq(&stale_buffer, &newer_buffer));
    assert!(!Arc::ptr_eq(&stale_hub, &newer_hub));
    assert_eq!(newer_hub.instance_id(), newer_instance_id);

    manager
        .kill_pty(task_id)
        .await
        .expect("newer test PTY should be cleaned up");
    drop(superseding_lock);
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn kill_pty_cancels_agent_spawn_before_session_insert() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    let task_id = "kill-pending-agent-spawn";
    let (prepared_tx, prepared_rx) = mpsc::channel();
    let (release_command_tx, release_command_rx) = mpsc::channel();

    let spawn_manager = manager.clone();
    let spawn_cwd = tmp_dir.path().to_path_buf();
    let spawn_task_id = task_id.to_string();
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: Some(prepared_tx),
        command_release_rx: Some(release_command_rx),
        script: "printf killed-agent",
        check_lock: false,
    };
    let pending_spawn = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        runtime.block_on(spawn_manager.spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id: &spawn_task_id,
                cwd: &spawn_cwd,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        ))
    });

    prepared_rx
        .recv_timeout(CONCURRENT_SPAWN_TIMEOUT)
        .expect("spawn should reach provider preparation");
    let mut kill = Box::pin(manager.kill_pty(task_id));
    assert!(
        futures::poll!(kill.as_mut()).is_pending(),
        "kill should wait for the pending spawn's lifecycle lock"
    );
    assert!(
        !manager
            .agent_spawn_generations
            .lock()
            .await
            .contains_key(task_id),
        "kill should invalidate the pending spawn before waiting"
    );

    release_command_tx
        .send(())
        .expect("pending spawn command construction should be released");
    let spawn_result = join_thread_with_timeout(pending_spawn, "pending spawn thread");
    tokio::time::timeout(CONCURRENT_SPAWN_TIMEOUT, kill.as_mut())
        .await
        .expect("kill should finish before the deadline")
        .expect("kill during pending spawn should be accepted");
    assert!(
        matches!(spawn_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
        "pending spawn should abort after kill_pty invalidates it: {spawn_result:?}"
    );
    assert!(
        !manager.sessions.lock().await.contains_key(task_id),
        "killed pending spawn must not insert a session"
    );
    assert!(
        !cleanup
            .pid_dir()
            .join(format!("{task_id}-pty.pid"))
            .exists(),
        "killed pending spawn must not leave a PID file"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "killed pending spawn must not register an output buffer"
    );
    cleanup.finish().expect("agent fixture PTY cleanup");
}
