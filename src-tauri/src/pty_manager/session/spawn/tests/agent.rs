use crate::app_events::{AppEventBus, AppEventFrame, InMemoryAppEventAdapter};
use crate::backend_runtime::AppHandle;
use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::Duration;

use super::super::super::lifecycle::PtySessions;
use super::super::streams::AgentStreamState;
use crate::pty_manager::managed_process::ManagedProcessIdentity;
use crate::pty_manager::pids::write_managed_process_identity;

struct LockCheckingAgentAdapter {
    sessions: PtySessions,
    prepared_tx: Option<mpsc::Sender<()>>,
    command_delay: Duration,
    script: &'static str,
    check_lock: bool,
}

impl LockCheckingAgentAdapter {
    fn assert_sessions_unlocked(&self, phase: &str) {
        if self.check_lock {
            assert!(
                self.sessions.try_lock().is_ok(),
                "sessions mutex should not be held during {phase}"
            );
        }
    }
}

impl AgentPtyProviderAdapter for LockCheckingAgentAdapter {
    fn label(&self) -> &'static str {
        "LockChecking"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        self.assert_sessions_unlocked("command argument construction");
        if !self.command_delay.is_zero() {
            std::thread::sleep(self.command_delay);
        }
        // Keep test PTYs single-process so cleanup never waits on an orphan reaper.
        vec!["-lc".to_string(), format!("{}; exec sleep 5", self.script)]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        self.assert_sessions_unlocked("provider preparation");
        if let Some(prepared_tx) = self.prepared_tx.take() {
            let _ = prepared_tx.send(());
        }
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        self.assert_sessions_unlocked("provider environment construction");
        HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

#[tokio::test]
async fn agent_spawn_keeps_session_mutex_out_of_provider_and_command_work() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "lock-free-agent-spawn";
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_delay: Duration::ZERO,
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
        tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
        "PID file should still be written after spawn"
    );
    assert!(
        manager.output_buffers.lock().await.contains_key(task_id),
        "output buffer should still be registered for replay"
    );
    assert!(
        manager.last_output.lock().await.contains_key(task_id),
        "last-output tracking should still be registered for frozen detection"
    );

    manager
        .kill_pty(task_id)
        .await
        .expect("test PTY should be cleaned up");
    assert!(
        !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
        "PID file should be removed on cleanup"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "output buffer should be removed on explicit kill"
    );
    assert!(
        !manager.last_output.lock().await.contains_key(task_id),
        "last-output tracking should be removed on explicit kill"
    );
}

#[tokio::test]
async fn ghostty_agent_publishes_model_output_through_runtime_event_adapter() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "ghostty-agent-runtime-events";
    let bus = AppEventBus::new(32, 8);
    let app = AppHandle::new();
    app.set_app_event_adapter(Arc::new(InMemoryAppEventAdapter::new(bus.clone())));
    let mut events = bus.subscribe(None).expect("event subscription should open");
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_delay: Duration::ZERO,
        script: "printf ghostty-agent-output",
        check_lock: true,
    };

    let instance_id = manager
        .spawn_agent_pty(
            adapter,
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(Some(app), None),
            },
            None,
        )
        .await
        .expect("Ghostty agent PTY should spawn");

    let model_event = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let AppEventFrame::Event(event) =
                events.recv().await.expect("event stream should stay open")
            else {
                continue;
            };
            if event.event_name == format!("pty-model-output-{task_id}") {
                return event;
            }
        }
    })
    .await
    .expect("Ghostty model output should reach the runtime event adapter");

    assert_eq!(model_event.payload["instance_id"], instance_id);
    assert_eq!(model_event.payload["sequence"], 1);
    assert!(model_event.payload["data"].is_string());
    manager
        .kill_pty(task_id)
        .await
        .expect("test PTY should be cleaned up");
}

#[tokio::test]
async fn agent_attachment_exposes_bounded_replay_then_gap_free_live_output() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "companion-agent-attachment";
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_delay: Duration::ZERO,
        script: "stty -echo; IFS= read -r _; printf before; IFS= read -r _; printf after",
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
        .expect("agent PTY");

    let event_timeout = Duration::from_secs(5);
    let mut before_replay = manager
        .attach_agent_terminal(task_id)
        .await
        .expect("running Agent attachment");
    assert!(before_replay.replay().is_empty());
    before_replay
        .write_input(b"\n")
        .await
        .expect("release replay output");
    assert_eq!(
        tokio::time::timeout(event_timeout, before_replay.recv())
            .await
            .expect("replay output deadline")
            .expect("replay output"),
        crate::pty_manager::AgentTerminalEvent::Output(b"before".to_vec()),
    );

    let mut attachment = manager
        .attach_agent_terminal(task_id)
        .await
        .expect("running Agent attachment");
    assert_eq!(attachment.replay(), b"before");
    drop(before_replay);
    assert!(manager.agent_terminal_available(task_id).await);
    attachment
        .write_input(b"\n")
        .await
        .expect("release live output");
    assert_eq!(
        tokio::time::timeout(event_timeout, attachment.recv())
            .await
            .expect("live output deadline")
            .expect("live output"),
        crate::pty_manager::AgentTerminalEvent::Output(b"after".to_vec()),
    );

    manager.kill_pty(task_id).await.expect("PTY cleanup");
    assert_eq!(
        tokio::time::timeout(event_timeout, attachment.recv())
            .await
            .expect("exit deadline")
            .expect("exit event"),
        crate::pty_manager::AgentTerminalEvent::Exited,
    );
    assert!(!manager.agent_terminal_available(task_id).await);
}

#[tokio::test]
async fn unresolved_recovery_metadata_blocks_spawn_without_clobbering_record() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "recovery-conflict-agent";
    let pid_file = tmp_dir.path().join(format!("{task_id}-pty.pid"));
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
        command_delay: Duration::ZERO,
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
}

async fn assert_newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "concurrent-agent-spawn";
    let (old_prepared_tx, old_prepared_rx) = mpsc::channel();

    let old_manager = manager.clone();
    let old_cwd = tmp_dir.path().to_path_buf();
    let old_task_id = task_id.to_string();
    let old_adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: Some(old_prepared_tx),
        command_delay: Duration::from_millis(150),
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
        .recv_timeout(Duration::from_secs(1))
        .expect("older spawn should reach provider preparation");

    let new_adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_delay: Duration::ZERO,
        script: "printf new-agent",
        check_lock: false,
    };
    let new_instance_id = manager
        .spawn_agent_pty(
            new_adapter,
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
        .expect("newer spawn should become current");

    let old_result = old_spawn.join().expect("older spawn task should join");
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
        &std::fs::read_to_string(tmp_dir.path().join(format!("{task_id}-pty.pid")))
            .expect("newer process metadata should remain"),
    )
    .expect("newer process metadata should parse");
    assert_eq!(persisted_identity, expected_identity);
    assert!(
        manager.output_buffers.lock().await.contains_key(task_id),
        "newer spawn should keep output buffer registration"
    );
    assert!(
        manager.last_output.lock().await.contains_key(task_id),
        "newer spawn should keep last-output registration"
    );

    manager
        .kill_pty(task_id)
        .await
        .expect("newer test PTY should be cleaned up");
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
    manager.set_pid_dir(temp_dir.path().to_path_buf());
    let task_id = "agent-lock-order-race";
    manager
        .spawn_agent_pty(
            LockCheckingAgentAdapter {
                sessions: Arc::clone(&manager.sessions),
                prepared_tx: None,
                command_delay: Duration::ZERO,
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
            command_delay: Duration::ZERO,
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
            command_delay: Duration::ZERO,
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
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_agent_setup_before_event_stream_cleans_only_its_tracking_state() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
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
                command_delay: Duration::ZERO,
                script: "printf stale-agent",
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
    let stale_last_output = manager
        .last_output
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("stale output tracking should be registered before startup");
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
    let stale_result = stale_spawn.join().expect("stale spawn thread should join");
    assert!(
        matches!(stale_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before event streaming started")),
        "superseded setup should stop before event streaming: {stale_result:?}"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "superseded setup must remove its replay buffer"
    );
    assert!(
        !manager.last_output.lock().await.contains_key(task_id),
        "superseded setup must remove its output tracking"
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
                command_delay: Duration::ZERO,
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
    let newer_last_output = manager
        .last_output
        .lock()
        .await
        .get(task_id)
        .cloned()
        .expect("newer output tracking should remain registered");
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
                last_output_time: Some(Arc::clone(&stale_last_output)),
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
            .last_output
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &newer_last_output)),
        "delayed stale cleanup must preserve newer output tracking"
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
    assert!(!Arc::ptr_eq(&stale_last_output, &newer_last_output));
    assert!(!Arc::ptr_eq(&stale_hub, &newer_hub));
    assert_eq!(newer_hub.instance_id(), newer_instance_id);

    manager
        .kill_pty(task_id)
        .await
        .expect("newer test PTY should be cleaned up");
    drop(superseding_lock);
}

#[tokio::test]
async fn kill_pty_cancels_agent_spawn_before_session_insert() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "kill-pending-agent-spawn";
    let (prepared_tx, prepared_rx) = mpsc::channel();

    let spawn_manager = manager.clone();
    let spawn_cwd = tmp_dir.path().to_path_buf();
    let spawn_task_id = task_id.to_string();
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: Some(prepared_tx),
        command_delay: Duration::from_millis(150),
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
        .recv_timeout(Duration::from_secs(1))
        .expect("spawn should reach provider preparation");
    manager
        .kill_pty(task_id)
        .await
        .expect("kill during pending spawn should be accepted");

    let spawn_result = pending_spawn
        .join()
        .expect("pending spawn thread should join");
    assert!(
        matches!(spawn_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
        "pending spawn should abort after kill_pty invalidates it: {spawn_result:?}"
    );
    assert!(
        !manager.sessions.lock().await.contains_key(task_id),
        "killed pending spawn must not insert a session"
    );
    assert!(
        !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
        "killed pending spawn must not leave a PID file"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(task_id),
        "killed pending spawn must not register an output buffer"
    );
    assert!(
        !manager.last_output.lock().await.contains_key(task_id),
        "killed pending spawn must not register last-output tracking"
    );
}

const CWD_OUTPUT_READY: &str = "openforge-cwd-output=ready";

struct CwdPrintingAgentAdapter;

impl AgentPtyProviderAdapter for CwdPrintingAgentAdapter {
    fn label(&self) -> &'static str {
        "CwdPrinting"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        vec![
            "-c".to_string(),
            format!(
                "/bin/pwd -P; printf '{}\\n'; IFS= read -r _",
                CWD_OUTPUT_READY
            ),
        ]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

#[tokio::test]
async fn agent_pty_starts_process_with_actual_workspace_cwd_containing_spaces() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
    manager.set_pid_dir(temp_dir.path().join("pids"));
    let workspace_path = temp_dir.path().join("Snooze Vault");
    std::fs::create_dir_all(&workspace_path).expect("workspace with spaces should be created");
    let expected_cwd = workspace_path
        .canonicalize()
        .expect("workspace path should canonicalize")
        .to_string_lossy()
        .to_string();

    manager
        .spawn_agent_pty(
            CwdPrintingAgentAdapter,
            PtySpawnContext {
                task_id: "agent-space-cwd",
                cwd: &workspace_path,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(
                    None,
                    Some(app_event_tx),
                ),
            },
            None,
        )
        .await
        .expect("agent PTY should spawn in workspace with spaces");

    let output_result = tokio::time::timeout(Duration::from_secs(5), async {
        let mut output = String::new();
        loop {
            let event = app_event_rx.recv().await?;
            if event.event_name != "pty-output-agent-space-cwd" {
                continue;
            }

            output.push_str(
                event.payload["data"]
                    .as_str()
                    .expect("PTY output event should contain text data"),
            );
            if output
                .lines()
                .any(|line| line.trim_end_matches('\r') == CWD_OUTPUT_READY)
            {
                break Ok::<_, tokio::sync::broadcast::error::RecvError>(output);
            }
        }
    })
    .await;
    if !matches!(&output_result, Ok(Ok(_))) {
        let _ = manager.kill_pty("agent-space-cwd").await;
    }
    let output = output_result
        .expect("agent PTY should emit the cwd output readiness marker")
        .expect("PTY event channel should remain open until cwd output is ready");

    let release_result = manager.write_pty("agent-space-cwd", b"\n").await;
    if release_result.is_err() {
        let _ = manager.kill_pty("agent-space-cwd").await;
    }
    release_result.expect("test should release the cwd-printing process");
    let exit_result = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = app_event_rx.recv().await?;
            if event.event_name == "pty-exit-agent-space-cwd" {
                break Ok::<_, tokio::sync::broadcast::error::RecvError>(());
            }
        }
    })
    .await;
    if !matches!(&exit_result, Ok(Ok(()))) {
        let _ = manager.kill_pty("agent-space-cwd").await;
    }
    exit_result
        .expect("agent PTY should exit after the test releases it")
        .expect("PTY event channel should remain open until the process exits");

    assert!(
            output
                .lines()
                .any(|line| line.trim_end_matches('\r') == expected_cwd),
            "agent PTY process should start with actual cwd at the workspace even when it contains spaces; output was: {output:?}"
        );
}

#[tokio::test]
async fn agent_pty_rejects_missing_workspace_cwd_instead_of_falling_back() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(temp_dir.path().join("pids"));
    let missing_workspace = temp_dir.path().join("Missing Vault");

    let result = manager
        .spawn_agent_pty(
            CwdPrintingAgentAdapter,
            PtySpawnContext {
                task_id: "agent-missing-cwd",
                cwd: &missing_workspace,
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await;

    assert!(
        matches!(result, Err(PtyError::InvalidWorkspaceCwd { ref path, .. }) if path.contains("Missing Vault")),
        "missing cwd should be classified separately from internal PTY spawn failures: {result:?}"
    );
    assert!(
        !manager
            .sessions
            .lock()
            .await
            .contains_key("agent-missing-cwd"),
        "missing cwd must not register an agent session"
    );
}
