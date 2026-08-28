use super::*;

#[tokio::test]
async fn test_emitter_uses_runtime_app_event_adapter_once_when_app_and_sender_share_bus() {
    let manager = PtyManager::new();
    register_emitter_test_session(
        &manager,
        "task-dedupe-shell-0",
        7,
        "task-dedupe-shell-0.pid",
    )
    .await;
    let bus = crate::app_events::AppEventBus::new(16, 16);
    let app = crate::backend_runtime::AppHandle::new();
    app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
        bus.clone(),
    )));
    let mut events = bus.subscribe(None).expect("subscribe should work");
    let (output_tx, output_rx) = pty_output_channel();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");

    spawn_batched_pty_event_emitter(
        output_rx,
        PtyEventEmitterConfig {
            session_key: "task-dedupe-shell-0".to_string(),
            instance_id: 7,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(
                Some(app),
                Some(bus.sender()),
            ),
            ring_buffer: ring,
            attachment_hub: None,
            terminal_sessions: manager.terminal_sessions.clone(),
            exit_action: PtyExitAction::Cleanup {
                lifecycle_lock: LifecycleLockRegistry::default().lock_for("test-session"),
                pid_file: tmp_dir.path().join("task-dedupe-shell-0.pid"),
                emit_agent_exit: false,
            },
        },
    );

    output_tx
        .try_send(Some("deduped live output".to_string()))
        .expect("output should send");

    let crate::app_events::AppEventFrame::Event(received) =
        tokio::time::timeout(tokio::time::Duration::from_secs(1), events.recv())
            .await
            .expect("pty output should be emitted")
            .expect("pty output frame should be available")
    else {
        panic!("expected pty output event frame");
    };

    assert_eq!(received.event_name, "pty-output-task-dedupe-shell-0");
    assert_eq!(received.payload["data"], "deduped live output");
    assert_eq!(received.payload["instance_id"], 7);

    if let Ok(Some(crate::app_events::AppEventFrame::Event(duplicate))) =
        tokio::time::timeout(tokio::time::Duration::from_millis(50), events.recv()).await
    {
        assert_ne!(
            duplicate.event_name, "pty-output-task-dedupe-shell-0",
            "PTY output must not be published twice when the app handle is backed by the same app event bus as app_event_tx"
        );
    }

    drop(output_tx);
}

async fn collect_bus_events_until_quiet(
    events: &mut crate::app_events::AppEventSubscription,
) -> Vec<crate::app_events::AppEventEnvelope> {
    let mut received = Vec::new();

    loop {
        let timeout = if received.is_empty() {
            tokio::time::Duration::from_secs(1)
        } else {
            tokio::time::Duration::from_millis(50)
        };

        match tokio::time::timeout(timeout, events.recv()).await {
            Ok(Some(crate::app_events::AppEventFrame::Event(event))) => received.push(event),
            Ok(Some(crate::app_events::AppEventFrame::Gap(_))) => continue,
            Ok(None) | Err(_) => break,
        }
    }

    received
}

async fn collect_sender_events_until_quiet(
    events: &mut tokio::sync::broadcast::Receiver<crate::app_events::AppEventEnvelope>,
) -> Vec<crate::app_events::AppEventEnvelope> {
    let mut received = Vec::new();

    loop {
        let timeout = if received.is_empty() {
            tokio::time::Duration::from_secs(1)
        } else {
            tokio::time::Duration::from_millis(50)
        };

        match tokio::time::timeout(timeout, events.recv()).await {
            Ok(Ok(event)) => received.push(event),
            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) | Err(_) => break,
        }
    }

    received
}

fn count_events(events: &[crate::app_events::AppEventEnvelope], event_name: &str) -> usize {
    events
        .iter()
        .filter(|event| event.event_name == event_name)
        .count()
}

async fn register_emitter_test_session(
    manager: &PtyManager,
    session_key: &str,
    instance_id: u64,
    pid_file_name: &str,
) {
    let mut session = test_pty_session(PtySessionKind::Agent, pid_file_name.to_string());
    session.instance_id = instance_id;
    manager
        .sessions
        .lock()
        .await
        .insert(session_key.to_string(), session);
}

async fn release_test_child_and_wait_for_exit(
    child: &mut (dyn portable_pty::Child + Send + Sync),
    exit_gate: &Path,
) {
    std::fs::write(exit_gate, b"release").expect("test exit gate should release");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);

    loop {
        match child
            .try_wait()
            .expect("test child status should be readable")
        {
            Some(status) => {
                assert!(
                    status.success(),
                    "test fixture must exit successfully before EOF cleanup"
                );
                return;
            }
            None if std::time::Instant::now() < deadline => {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            None => panic!("test child should exit before EOF cleanup"),
        }
    }
}

#[tokio::test]
async fn test_runtime_adapter_dedupes_pty_exit_when_sender_shares_bus() {
    let manager = PtyManager::new();
    register_emitter_test_session(
        &manager,
        "task-dedupe-exit-shell-0",
        8,
        "task-dedupe-exit-shell-0.pid",
    )
    .await;
    let bus = crate::app_events::AppEventBus::new(16, 16);
    let app = crate::backend_runtime::AppHandle::new();
    app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
        bus.clone(),
    )));
    let mut events = bus.subscribe(None).expect("subscribe should work");
    let (output_tx, output_rx) = pty_output_channel();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");

    spawn_batched_pty_event_emitter(
        output_rx,
        PtyEventEmitterConfig {
            session_key: "task-dedupe-exit-shell-0".to_string(),
            instance_id: 8,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(
                Some(app),
                Some(bus.sender()),
            ),
            ring_buffer: ring,
            attachment_hub: None,
            terminal_sessions: manager.terminal_sessions.clone(),
            exit_action: PtyExitAction::Cleanup {
                lifecycle_lock: LifecycleLockRegistry::default().lock_for("test-session"),
                pid_file: tmp_dir.path().join("task-dedupe-exit-shell-0.pid"),
                emit_agent_exit: false,
            },
        },
    );

    output_tx.try_send(None).expect("exit signal should send");
    let received = collect_bus_events_until_quiet(&mut events).await;

    assert_eq!(
        count_events(&received, "pty-exit-task-dedupe-exit-shell-0"),
        1,
        "PTY exit must not be published twice when the app handle is backed by the same app event bus as app_event_tx"
    );
    assert_eq!(
        count_events(&received, "agent-pty-exited"),
        0,
        "cleanup-only PTYs must not emit agent-pty-exited"
    );
    let exit_event = received
        .iter()
        .find(|event| event.event_name == "pty-exit-task-dedupe-exit-shell-0")
        .expect("pty-exit event should be received");
    assert_eq!(exit_event.payload["instance_id"], 8);
}

#[tokio::test]
async fn test_runtime_adapter_dedupes_agent_pty_exited_when_sender_shares_bus() {
    let manager = PtyManager::new();
    register_emitter_test_session(&manager, "agent-dedupe-exit", 9, "agent-dedupe-exit.pid").await;
    let bus = crate::app_events::AppEventBus::new(16, 16);
    let app = crate::backend_runtime::AppHandle::new();
    app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
        bus.clone(),
    )));
    let mut events = bus.subscribe(None).expect("subscribe should work");
    let (output_tx, output_rx) = pty_output_channel();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");

    spawn_batched_pty_event_emitter(
        output_rx,
        PtyEventEmitterConfig {
            session_key: "agent-dedupe-exit".to_string(),
            instance_id: 9,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(
                Some(app),
                Some(bus.sender()),
            ),
            ring_buffer: ring,
            attachment_hub: None,
            terminal_sessions: manager.terminal_sessions.clone(),
            exit_action: PtyExitAction::Cleanup {
                lifecycle_lock: LifecycleLockRegistry::default().lock_for("test-session"),
                pid_file: tmp_dir.path().join("agent-dedupe-exit.pid"),
                emit_agent_exit: true,
            },
        },
    );

    output_tx.try_send(None).expect("exit signal should send");
    let received = collect_bus_events_until_quiet(&mut events).await;

    assert_eq!(
        count_events(&received, "pty-exit-agent-dedupe-exit"),
        1,
        "PTY exit must not be published twice when the app handle is backed by the same app event bus as app_event_tx"
    );
    assert_eq!(
        count_events(&received, "agent-pty-exited"),
        1,
        "agent PTY exit must not be published twice when the app handle is backed by the same app event bus as app_event_tx"
    );
    let agent_event = received
        .iter()
        .find(|event| event.event_name == "agent-pty-exited")
        .expect("agent-pty-exited event should be received");
    assert_eq!(agent_event.payload["task_id"], "agent-dedupe-exit");
    assert_eq!(agent_event.payload["success"], false);
}

#[tokio::test]
async fn test_exit_events_fallback_to_sender_without_runtime_adapter() {
    let manager = PtyManager::new();
    register_emitter_test_session(
        &manager,
        "agent-fallback-exit",
        10,
        "agent-fallback-exit.pid",
    )
    .await;
    let app = crate::backend_runtime::AppHandle::new();
    let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
    let (output_tx, output_rx) = pty_output_channel();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");

    spawn_batched_pty_event_emitter(
        output_rx,
        PtyEventEmitterConfig {
            session_key: "agent-fallback-exit".to_string(),
            instance_id: 10,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(
                Some(app),
                Some(app_event_tx),
            ),
            ring_buffer: ring,
            attachment_hub: None,
            terminal_sessions: manager.terminal_sessions.clone(),
            exit_action: PtyExitAction::Cleanup {
                lifecycle_lock: LifecycleLockRegistry::default().lock_for("test-session"),
                pid_file: tmp_dir.path().join("agent-fallback-exit.pid"),
                emit_agent_exit: true,
            },
        },
    );

    output_tx.try_send(None).expect("exit signal should send");
    let received = collect_sender_events_until_quiet(&mut app_event_rx).await;

    assert_eq!(
        count_events(&received, "pty-exit-agent-fallback-exit"),
        1,
        "PTY exit should be published exactly once through the fallback sender"
    );
    assert_eq!(
        count_events(&received, "agent-pty-exited"),
        1,
        "agent PTY exit should be published exactly once through the fallback sender"
    );
}

#[tokio::test]
async fn test_cleanup_exit_action_cleans_shell_state_without_agent_event() {
    let manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let exit_gate = tmp_dir.path().join("shell-exit-gate");
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).expect("openpty should succeed");

    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.arg("-c");
    cmd.env(
        "OPENFORGE_TEST_EXIT_GATE",
        exit_gate.to_string_lossy().to_string(),
    );
    cmd.arg("while [ ! -e \"$OPENFORGE_TEST_EXIT_GATE\" ]; do sleep 0.01; done");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .expect("spawn command should succeed");
    let managed_process =
        ManagedProcessIdentity::capture(child.process_id().expect("test child PID"))
            .expect("test process identity");

    release_test_child_and_wait_for_exit(child.as_mut(), &exit_gate).await;
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .expect("take writer should succeed");

    let key = "task-1-shell-0";
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(
            key.to_string(),
            PtySession {
                managed_process,
                child,
                master: std::sync::Arc::new(std::sync::Mutex::new(pair.master)),
                writer: Arc::new(
                    ordered_writer::OrderedPtyWriter::start(key.to_string(), 1, writer)
                        .expect("ordered writer should start"),
                ),
                instance_id: 1,
                kind: PtySessionKind::Shell {
                    task_id: "task-1".to_string(),
                },
                pid_file_name: "task-1-shell-0.pid".to_string(),
                terminal_model: None,
            },
        );
    }

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert(key.to_string(), Arc::clone(&ring));
    }
    {
        let mut times = manager.last_output.lock().await;
        times.insert(key.to_string(), Arc::new(AtomicU64::new(123)));
    }

    let pid_file = tmp_dir.path().join("task-1-shell-0.pid");
    write_test_session_metadata(&manager, key, &pid_file).await;

    let (output_tx, output_rx) = pty_output_channel();
    let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
    spawn_batched_pty_event_emitter(
        output_rx,
        PtyEventEmitterConfig {
            session_key: key.to_string(),
            instance_id: 1,
            event_publisher: crate::app_events::RuntimeEventPublisher::new(
                None,
                Some(app_event_tx),
            ),
            ring_buffer: ring,
            attachment_hub: None,
            terminal_sessions: manager.terminal_sessions.clone(),
            exit_action: PtyExitAction::Cleanup {
                lifecycle_lock: LifecycleLockRegistry::default().lock_for("test-session"),
                pid_file: pid_file.clone(),
                emit_agent_exit: false,
            },
        },
    );

    output_tx.try_send(None).expect("exit signal should send");
    let exit_event = tokio::time::timeout(tokio::time::Duration::from_secs(1), app_event_rx.recv())
        .await
        .expect("pty-exit event should be emitted")
        .expect("pty-exit event should be received");

    assert_eq!(exit_event.event_name, "pty-exit-task-1-shell-0");
    assert_eq!(exit_event.payload["instance_id"], 1);
    if let Ok(Ok(event)) =
        tokio::time::timeout(tokio::time::Duration::from_millis(50), app_event_rx.recv()).await
    {
        assert_ne!(
            event.event_name, "agent-pty-exited",
            "cleanup-only PTYs must not emit agent-pty-exited"
        );
    }
    assert!(
        !manager.sessions.lock().await.contains_key(key),
        "session should be removed after EOF cleanup"
    );
    assert!(
        !manager.output_buffers.lock().await.contains_key(key),
        "output buffer should be removed after EOF cleanup"
    );
    assert!(
        !manager.last_output.lock().await.contains_key(key),
        "last_output should be removed after EOF cleanup"
    );
    assert!(
        !pid_file.exists(),
        "pid file should be removed after EOF cleanup"
    );
}

#[tokio::test]
async fn test_agent_pty_exit_preserves_output_buffer_for_later_replay() {
    let manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let exit_gate = tmp_dir.path().join("agent-exit-gate");
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).expect("openpty should succeed");

    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.arg("-c");
    cmd.env(
        "OPENFORGE_TEST_EXIT_GATE",
        exit_gate.to_string_lossy().to_string(),
    );
    cmd.arg("while [ ! -e \"$OPENFORGE_TEST_EXIT_GATE\" ]; do sleep 0.01; done");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .expect("spawn command should succeed");
    drop(pair.slave);
    let managed_process =
        ManagedProcessIdentity::capture(child.process_id().expect("test child PID"))
            .expect("test process identity");
    release_test_child_and_wait_for_exit(child.as_mut(), &exit_gate).await;
    let writer = pair
        .master
        .take_writer()
        .expect("take writer should succeed");
    let key = "agent-task-1";
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(
            key.to_string(),
            PtySession {
                managed_process,
                child,
                master: std::sync::Arc::new(std::sync::Mutex::new(pair.master)),
                writer: Arc::new(
                    ordered_writer::OrderedPtyWriter::start(key.to_string(), 1, writer)
                        .expect("ordered writer should start"),
                ),
                instance_id: 1,
                kind: PtySessionKind::Agent,
                pid_file_name: "agent-task-1-pty.pid".to_string(),
                terminal_model: None,
            },
        );
    }

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    {
        let mut buf = ring.lock().expect("ring buffer should lock");
        buf.push(b"previous opencode tty output");
    }
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert(key.to_string(), Arc::clone(&ring));
    }
    {
        let mut times = manager.last_output.lock().await;
        times.insert(key.to_string(), Arc::new(AtomicU64::new(123)));
    }

    let pid_file = tmp_dir.path().join("agent-task-1-pty.pid");
    write_test_session_metadata(&manager, key, &pid_file).await;
    let lifecycle_lock = LifecycleLockRegistry::default().lock_for("test-session");

    let success = finalize_pty_exit(
        PtyExitCleanupContext {
            terminal_sessions: &manager.terminal_sessions,
            lifecycle_lock: &lifecycle_lock,
            pid_file: &pid_file,
        },
        key,
        1,
        false,
    )
    .await;

    assert!(success, "test process should exit successfully");
    assert_eq!(
        manager.get_pty_buffer(key).await,
        Some("previous opencode tty output".to_string()),
        "agent PTY output should remain replayable after process exit"
    );
    assert!(
        !manager.last_output.lock().await.contains_key(key),
        "liveness timestamps should still be cleaned up after exit"
    );
}

#[tokio::test]
async fn test_finalize_pty_exit_terminates_live_root_before_nonblocking_reap() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let key = "live-eof-agent";
    manager
        .sessions
        .lock()
        .await
        .insert(key.to_string(), test_agent_pty_session(key));
    let pid_file = tmp_dir.path().join(format!("{key}-pty.pid"));
    write_test_session_metadata(&manager, key, &pid_file).await;
    let lifecycle_lock = LifecycleLockRegistry::default().lock_for("test-session");

    let success = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        finalize_pty_exit(
            PtyExitCleanupContext {
                terminal_sessions: &manager.terminal_sessions,
                lifecycle_lock: &lifecycle_lock,
                pid_file: &pid_file,
            },
            key,
            1,
            false,
        ),
    )
    .await
    .expect("live-root EOF cleanup must not block on child wait");

    assert!(
        !success,
        "explicitly terminated root should not report success"
    );
    assert!(!manager.sessions.lock().await.contains_key(key));
    assert!(!pid_file.exists());
}

#[tokio::test]
async fn test_finalize_pty_exit_ignores_stale_instance() {
    let manager = PtyManager::new();
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).expect("openpty should succeed");

    let shell = get_shell_path();
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-lc");
    cmd.arg("sleep 1");
    let child = pair
        .slave
        .spawn_command(cmd)
        .expect("spawn command should succeed");
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .expect("take writer should succeed");

    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(
            "task-1".to_string(),
            PtySession {
                managed_process: ManagedProcessIdentity::capture(
                    child.process_id().expect("test child PID"),
                )
                .expect("test process identity"),
                child,
                master: std::sync::Arc::new(std::sync::Mutex::new(pair.master)),
                writer: Arc::new(
                    ordered_writer::OrderedPtyWriter::start("task-1".to_string(), 2, writer)
                        .expect("ordered writer should start"),
                ),
                instance_id: 2,
                kind: PtySessionKind::Agent,
                pid_file_name: "task-1-pty.pid".to_string(),
                terminal_model: None,
            },
        );
    }

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    {
        let mut buf = ring.lock().expect("ring buffer should lock");
        buf.push(b"active output");
    }
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert("task-1".to_string(), Arc::clone(&ring));
    }
    {
        let mut times = manager.last_output.lock().await;
        times.insert("task-1".to_string(), Arc::new(AtomicU64::new(123)));
    }

    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_file = tmp_dir.path().join("task-1-pty.pid");
    std::fs::write(&pid_file, "1234").expect("pid file should write");
    let lifecycle_lock = LifecycleLockRegistry::default().lock_for("test-session");

    let success = finalize_pty_exit(
        PtyExitCleanupContext {
            terminal_sessions: &manager.terminal_sessions,
            lifecycle_lock: &lifecycle_lock,
            pid_file: &pid_file,
        },
        "task-1",
        1,
        false,
    )
    .await;

    assert!(
        !success,
        "stale cleanup should not report a successful exit"
    );
    {
        let sessions = manager.sessions.lock().await;
        let session = sessions.get("task-1").expect("newer session should remain");
        assert_eq!(session.instance_id, 2);
    }
    {
        let buffers = manager.output_buffers.lock().await;
        assert!(
            buffers.contains_key("task-1"),
            "buffer should remain for active instance"
        );
    }
    {
        let times = manager.last_output.lock().await;
        assert!(
            times.contains_key("task-1"),
            "last_output should remain for active instance"
        );
    }
    assert!(
        pid_file.exists(),
        "stale cleanup must not remove the active pid file"
    );
}

#[tokio::test]
async fn passive_cleanup_failure_becomes_managed_recovery_and_blocks_spawn() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(temp_dir.path().to_path_buf());
    let session_key = "passive-cleanup-recovery";
    let mut session = test_agent_pty_session(session_key);
    let instance_id = session.instance_id;
    let pid = session.child.process_id().expect("test child PID");
    session.managed_process.root_start_time += 1;
    manager
        .sessions
        .lock()
        .await
        .insert(session_key.to_string(), session);

    let lifecycle_lock = manager.lifecycle_lock_for(session_key).await;
    let pid_file = temp_dir.path().join(format!("{session_key}-pty.pid"));
    let success = finalize_pty_exit(
        PtyExitCleanupContext {
            terminal_sessions: &manager.terminal_sessions,
            lifecycle_lock: &lifecycle_lock,
            pid_file: &pid_file,
        },
        session_key,
        instance_id,
        false,
    )
    .await;

    assert!(!success, "failed cleanup must not report success");
    assert!(!manager
        .get_session_keys()
        .await
        .contains(&session_key.to_string()));
    assert!(manager
        .process_diagnostic_sessions()
        .await
        .iter()
        .any(|diagnostic| {
            diagnostic.session_key == session_key
                && diagnostic.lifecycle_state == TerminalSessionLifecycleState::ManagedRecovery
        }));
    let spawn_result = manager
        .spawn_companion_test_agent_pty(session_key, temp_dir.path(), "printf should-not-spawn")
        .await;
    assert!(matches!(
        spawn_result,
        Err(PtyError::CleanupFailed(ref message))
            if message.contains("managed cleanup is still pending")
    ));

    let mut recovery = manager
        .terminal_sessions
        .take_managed_recovery_for_test(session_key, instance_id)
        .await
        .expect("failed passive cleanup should retain ownership");
    crate::pty_manager::managed_process::force_kill_unverified_spawn(pid)
        .expect("recovery process tree should accept SIGKILL");
    let _ = recovery.child.kill();
    let _ = recovery.child.try_wait();
}
