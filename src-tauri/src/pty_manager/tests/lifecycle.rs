use super::*;

#[tokio::test]
async fn test_get_pty_buffer_not_found() {
    let manager = PtyManager::new();
    let result = manager.get_pty_buffer("nonexistent-task").await;
    assert!(result.is_none());
}

#[test]
fn test_instance_id_generation() {
    let id1 = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
    let id2 = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
    assert_ne!(id1, id2);
    assert!(id2 > id1);
}

#[tokio::test]
async fn test_kill_all_empty_sessions() {
    let manager = PtyManager::new();
    // Should complete without panic or error on empty session map
    manager.kill_all().await;
    let sessions = manager.sessions.lock().await;
    assert_eq!(sessions.len(), 0);
}

#[tokio::test]
async fn test_kill_all_removes_indexed_shell_pid_files() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let task_id = "task-1";
    let shell_key = shell_session_key(task_id, Some(2));
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(shell_key.clone(), test_shell_pty_session(task_id, 2));
    }

    let shell_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(2)));
    write_test_session_metadata(&manager, &shell_key, &shell_pid_file).await;

    manager.kill_all().await;

    assert!(
        !shell_pid_file.exists(),
        "kill_all should remove the indexed shell PID file via centralized session-key classification"
    );
    let sessions = manager.sessions.lock().await;
    assert!(!sessions.contains_key(&shell_key));
}

#[tokio::test]
async fn test_kill_all_keeps_agent_pid_derivation_for_task_id_with_shell_suffix() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let task_id = "task-1-shell-2";
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(task_id.to_string(), test_agent_pty_session(task_id));
    }

    let agent_pid_file = tmp_dir.path().join(format!("{}-pty.pid", task_id));
    let misleading_shell_pid_file = tmp_dir.path().join(format!("{}.pid", task_id));
    write_test_session_metadata(&manager, task_id, &agent_pid_file).await;
    std::fs::write(&misleading_shell_pid_file, "5678")
        .expect("misleading shell pid file should write");

    manager.kill_all().await;

    assert!(
        !agent_pid_file.exists(),
        "agent-like task IDs ending in -shell-N must still remove their agent PID file"
    );
    assert!(
        misleading_shell_pid_file.exists(),
        "agent cleanup should not derive the misleading indexed shell PID path"
    );
}

#[tokio::test]
async fn test_kill_pty_removes_actual_provider_pid_file_name() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let task_id = "task-claude";
    let pid_file_name = format!("{}-claude.pid", task_id);
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(
            task_id.to_string(),
            test_pty_session(PtySessionKind::Agent, pid_file_name.clone()),
        );
    }

    let pid_file = tmp_dir.path().join(pid_file_name);
    write_test_session_metadata(&manager, task_id, &pid_file).await;

    manager
        .kill_pty(task_id)
        .await
        .expect("kill_pty should succeed");

    assert!(
        !pid_file.exists(),
        "kill_pty should remove the actual provider PID file tracked by the session"
    );
}

#[test]
fn test_freeze_detection_with_ring_buffer() {
    let mut ring_buf = RingBuffer::new(512);
    ring_buf.push(b"Claude is processing...\n");
    ring_buf.push(b"Tool call: bash\n");

    let now_ms: u64 = 200_000_000;
    let last_output_ms = now_ms - 20_000;

    let frozen = frozen_seconds(last_output_ms, now_ms);
    assert_eq!(frozen, Some(20));

    let buffered = ring_buf.snapshot();
    assert!(buffered.contains("Claude is processing"));
    assert!(buffered.contains("Tool call: bash"));

    let still_frozen = frozen_seconds(last_output_ms, now_ms);
    assert_eq!(
        still_frozen,
        Some(20),
        "Freeze detection unaffected by ring buffer snapshot"
    );

    let recent_output = now_ms - 5_000;
    assert!(frozen_seconds(recent_output, now_ms).is_none());
}

#[tokio::test]
async fn test_interrupt_claude_not_found() {
    let manager = PtyManager::new();
    let result = manager.interrupt_claude("nonexistent-task").await;
    assert!(matches!(result, Err(PtyError::ProcessNotFound(_))));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_pty_keeps_session_lookup_available_during_io() {
    struct BlockingWriter {
        started: Option<std::sync::mpsc::SyncSender<()>>,
        release: std::sync::mpsc::Receiver<()>,
    }

    impl std::io::Write for BlockingWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if let Some(started) = self.started.take() {
                started.send(()).expect("write start should be observed");
            }
            self.release
                .recv()
                .expect("blocked write should be released");
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let manager = PtyManager::new();
    let task_id = "nonblocking-session-lookup";
    let mut session = test_agent_pty_session(task_id);
    let instance_id = session.instance_id;
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    session.writer = Arc::new(
        ordered_writer::OrderedPtyWriter::start(
            task_id.to_string(),
            instance_id,
            Box::new(BlockingWriter {
                started: Some(started_tx),
                release: release_rx,
            }),
        )
        .expect("blocking writer should start"),
    );
    manager
        .sessions
        .lock()
        .await
        .insert(task_id.to_string(), session);

    let write_manager = manager.clone();
    let write = tokio::spawn(async move { write_manager.write_pty(task_id, b"input").await });
    tokio::task::spawn_blocking(move || {
        started_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("PTY write should start");
    })
    .await
    .expect("write-start waiter should finish");

    let keys = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        manager.get_session_keys(),
    )
    .await;

    release_tx.send(()).expect("blocked write should release");
    write
        .await
        .expect("write task should join")
        .expect("PTY write should succeed");
    manager.kill_all().await;

    assert_eq!(
        keys.expect("session lookup must not wait for PTY I/O"),
        vec![task_id.to_string()]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_pty_keeps_session_lookup_available_during_io() {
    let manager = PtyManager::new();
    let task_id = "nonblocking-resize-lookup";
    manager
        .sessions
        .lock()
        .await
        .insert(task_id.to_string(), test_agent_pty_session(task_id));

    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    manager
        .terminal_sessions
        .set_resize_start_gate(ResizeStartGate {
            reached_tx: started_tx,
            release_rx,
        });

    let resize_manager = manager.clone();
    let resize = tokio::spawn(async move { resize_manager.resize_pty(task_id, 120, 40).await });
    tokio::task::spawn_blocking(move || {
        started_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("PTY resize should start");
    })
    .await
    .expect("resize-start waiter should finish");

    let keys = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        manager.get_session_keys(),
    )
    .await;

    release_tx.send(()).expect("blocked resize should release");
    resize
        .await
        .expect("resize task should join")
        .expect("PTY resize should succeed");
    manager.kill_all().await;

    assert_eq!(
        keys.expect("session lookup must not wait for PTY resize"),
        vec![task_id.to_string()]
    );
}

#[tokio::test]
async fn test_check_claude_frozen_not_found() {
    let manager = PtyManager::new();
    let result = manager.check_claude_frozen("nonexistent-task").await;
    assert!(result.is_none());
}

#[test]
fn test_frozen_seconds_no_output_yet() {
    assert!(frozen_seconds(0, 100_000_000).is_none());
}

#[test]
fn test_frozen_seconds_below_threshold() {
    let now_ms: u64 = 100_000_000;
    assert!(frozen_seconds(now_ms - 14_999, now_ms).is_none());
}

#[test]
fn test_frozen_seconds_at_threshold() {
    let now_ms: u64 = 100_000_000;
    assert_eq!(frozen_seconds(now_ms - 15_000, now_ms), Some(15));
}

#[test]
fn test_frozen_seconds_above_threshold() {
    let now_ms: u64 = 100_000_000;
    assert_eq!(frozen_seconds(now_ms - 60_000, now_ms), Some(60));
}

#[tokio::test]
async fn test_get_pty_buffer_returns_snapshot() {
    let manager = PtyManager::new();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(1024)));
    {
        let mut buf = ring.lock().unwrap();
        buf.push(b"test output data");
    }
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert("task-snap".to_string(), Arc::clone(&ring));
    }
    let first = manager.get_pty_buffer("task-snap").await;
    assert_eq!(first, Some("test output data".to_string()));
    let second = manager.get_pty_buffer("task-snap").await;
    assert_eq!(second, Some("test output data".to_string()));
}

#[tokio::test]
async fn test_kill_pty_cleans_output_buffers() {
    let mut manager = PtyManager::new();
    let tmp_dir = std::env::temp_dir().join("test_kill_pty_cleanup_buffers");
    std::fs::create_dir_all(&tmp_dir).unwrap();
    manager.set_pid_dir(tmp_dir.clone());

    let task_id = "cleanup-test-task";

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(1024)));
    {
        let mut buf = ring.lock().unwrap();
        buf.push(b"some output");
    }
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert(task_id.to_string(), Arc::clone(&ring));
    }
    {
        let mut times = manager.last_output.lock().await;
        times.insert(task_id.to_string(), Arc::new(AtomicU64::new(12345)));
    }

    {
        let buffers = manager.output_buffers.lock().await;
        assert!(
            buffers.contains_key(task_id),
            "buffer entry should exist before kill"
        );
    }
    {
        let times = manager.last_output.lock().await;
        assert!(
            times.contains_key(task_id),
            "last_output entry should exist before kill"
        );
    }

    let _ = manager.kill_pty(task_id).await;

    {
        let buffers = manager.output_buffers.lock().await;
        assert!(
            !buffers.contains_key(task_id),
            "output_buffers should be cleaned up after kill_pty"
        );
    }
    {
        let times = manager.last_output.lock().await;
        assert!(
            !times.contains_key(task_id),
            "last_output should be cleaned up after kill_pty"
        );
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[tokio::test]
async fn reclaim_agent_pty_stops_the_process_and_keeps_replay() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(temp_dir.path().to_path_buf());
    let task_id = "completed-agent-reclaim";
    manager
        .spawn_companion_test_agent_pty(
            task_id,
            temp_dir.path(),
            "printf 'completed output'; while true; do sleep 1; done",
        )
        .await
        .expect("spawn Agent Session PTY");

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if manager
                .get_pty_buffer(task_id)
                .await
                .is_some_and(|output| output.contains("completed output"))
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Agent Session output deadline");

    manager
        .reclaim_agent_pty(task_id)
        .await
        .expect("reclaim Agent Session PTY");

    assert!(!manager
        .get_session_keys()
        .await
        .contains(&task_id.to_string()));
    assert_eq!(
        manager.get_pty_buffer(task_id).await.as_deref(),
        Some("completed output"),
    );
}

#[tokio::test]
async fn test_get_session_keys_empty() {
    let manager = PtyManager::new();
    let keys = manager.get_session_keys().await;
    assert!(keys.is_empty());
}

#[tokio::test]
async fn test_kill_shells_for_task_removes_indexed_shell_pid_files() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let task_id = "task-1";
    let shell0_key = shell_session_key(task_id, Some(0));
    let shell1_key = shell_session_key(task_id, Some(1));
    let unrelated_key = shell_session_key("task-2", Some(0));

    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(shell0_key.clone(), test_shell_pty_session(task_id, 0));
        sessions.insert(shell1_key.clone(), test_shell_pty_session(task_id, 1));
        sessions.insert(unrelated_key.clone(), test_shell_pty_session("task-2", 0));
    }

    let shell0_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(0)));
    let shell1_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(1)));
    let unrelated_pid_file = tmp_dir.path().join(shell_pid_file_name("task-2", Some(0)));
    write_test_session_metadata(&manager, &shell0_key, &shell0_pid_file).await;
    write_test_session_metadata(&manager, &shell1_key, &shell1_pid_file).await;
    std::fs::write(&unrelated_pid_file, "9012").expect("unrelated pid file should write");

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert(shell0_key.clone(), Arc::clone(&ring));
        buffers.insert(shell1_key.clone(), Arc::clone(&ring));
        buffers.insert(unrelated_key.clone(), Arc::clone(&ring));
    }
    {
        let mut times = manager.last_output.lock().await;
        times.insert(shell0_key.clone(), Arc::new(AtomicU64::new(123)));
        times.insert(shell1_key.clone(), Arc::new(AtomicU64::new(456)));
        times.insert(unrelated_key.clone(), Arc::new(AtomicU64::new(789)));
    }

    manager
        .kill_shells_for_task(task_id)
        .await
        .expect("task shells should be killed");

    assert!(
        !shell0_pid_file.exists(),
        "shell 0 pid file should be removed"
    );
    assert!(
        !shell1_pid_file.exists(),
        "shell 1 pid file should be removed"
    );
    assert!(
        unrelated_pid_file.exists(),
        "unrelated shell pid file should not be removed"
    );

    let sessions = manager.sessions.lock().await;
    assert!(!sessions.contains_key(&shell0_key));
    assert!(!sessions.contains_key(&shell1_key));
    assert!(sessions.contains_key(&unrelated_key));
    drop(sessions);

    let buffers = manager.output_buffers.lock().await;
    assert!(!buffers.contains_key(&shell0_key));
    assert!(!buffers.contains_key(&shell1_key));
    assert!(buffers.contains_key(&unrelated_key));
    drop(buffers);

    let times = manager.last_output.lock().await;
    assert!(!times.contains_key(&shell0_key));
    assert!(!times.contains_key(&shell1_key));
    assert!(times.contains_key(&unrelated_key));
}

#[tokio::test]
async fn test_kill_shells_for_task_does_not_kill_agent_with_shell_suffix_task_id() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let task_id = "task-1";
    let shell_key = shell_session_key(task_id, Some(0));
    let agent_like_shell_key = "task-1-shell-2";
    {
        let mut sessions = manager.sessions.lock().await;
        sessions.insert(shell_key.clone(), test_shell_pty_session(task_id, 0));
        sessions.insert(
            agent_like_shell_key.to_string(),
            test_agent_pty_session(agent_like_shell_key),
        );
    }

    let shell_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(0)));
    let agent_pid_file = tmp_dir
        .path()
        .join(format!("{}-pty.pid", agent_like_shell_key));
    write_test_session_metadata(&manager, &shell_key, &shell_pid_file).await;
    std::fs::write(&agent_pid_file, "5678").expect("agent pid file should write");

    manager
        .kill_shells_for_task(task_id)
        .await
        .expect("matching task shell should be killed");

    assert!(
        !shell_pid_file.exists(),
        "matching shell PID should be removed"
    );
    assert!(
        agent_pid_file.exists(),
        "agent PID should not be removed just because its task ID looks shell-like"
    );
    let sessions = manager.sessions.lock().await;
    assert!(!sessions.contains_key(&shell_key));
    assert!(sessions.contains_key(agent_like_shell_key));
}

#[test]
fn test_kill_shells_for_task_key_matching() {
    let task_id = "t1";
    let keys = [
        "t1-shell-0",
        "t1-shell-1",
        "t1",
        "t2-shell-0",
        "t1-shell-feature",
    ];

    let matching: Vec<_> = keys
        .iter()
        .filter(|key| is_shell_session_key_for_task(key, task_id))
        .collect();

    assert_eq!(matching.len(), 2);
    assert!(matching.contains(&&"t1-shell-0"));
    assert!(matching.contains(&&"t1-shell-1"));
    assert!(!matching.contains(&&"t1"));
    assert!(!matching.contains(&&"t2-shell-0"));
    assert!(!matching.contains(&&"t1-shell-feature"));
}
