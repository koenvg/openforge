use super::*;
use crate::pty_manager::commands::get_shell_path;
use crate::pty_manager::pids::shell_session_key;
use std::time::Duration;

fn long_running_shell_command() -> CommandBuilder {
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("exec sleep 30");
    command
}

#[tokio::test]
async fn shell_spawn_persists_identity_and_owns_lifecycle_state_until_cleanup() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_dir = tmp_dir.path().join("pids");
    manager.set_pid_dir(pid_dir.clone());
    let task_id = "shell-lifecycle";
    let session_key = shell_session_key(task_id, Some(2));
    let pid_file = pid_dir.join(format!("{session_key}.pid"));

    let instance_id = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                app_handle: None,
                app_event_tx: None,
            },
            Some(2),
            None,
            long_running_shell_command(),
        )
        .await
        .expect("shell PTY should spawn");

    let expected_identity = {
        let sessions = manager.sessions.lock().await;
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
    assert!(manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(manager.last_output.lock().await.contains_key(&session_key));
    assert!(manager.lifecycle_locks.contains_key(&session_key));
    assert!(!manager
        .agent_spawn_generations
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!manager.pending_shell_spawns.contains_key(&session_key));

    manager
        .kill_pty(&session_key)
        .await
        .expect("shell cleanup should succeed");
    assert!(!pid_file.exists());
    assert!(!manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!manager.last_output.lock().await.contains_key(&session_key));
    tokio::time::timeout(Duration::from_secs(1), async {
        while manager.lifecycle_locks.contains_key(&session_key) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("shell teardown should release its lifecycle lock");
}

#[tokio::test]
async fn unresolved_shell_recovery_metadata_blocks_spawn_without_clobbering_record() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_dir = tmp_dir.path().join("pids");
    manager.set_pid_dir(pid_dir.clone());
    let task_id = "recovery-conflict-shell";
    let session_key = shell_session_key(task_id, Some(0));
    let pid_file = pid_dir.join(format!("{session_key}.pid"));
    std::fs::create_dir_all(&pid_dir).expect("PID directory should be created");
    let unresolved_identity = ManagedProcessIdentity {
        version: 1,
        root_pid: 999_991,
        process_group_id: 999_991,
        session_id: 999_991,
        root_start_time: 42,
    };
    write_managed_process_identity(&pid_file, &unresolved_identity)
        .expect("unresolved identity should persist");

    let result = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                app_handle: None,
                app_event_tx: None,
            },
            Some(0),
            None,
            long_running_shell_command(),
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
    assert!(!manager.sessions.lock().await.contains_key(&session_key));
    assert!(!manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!manager.last_output.lock().await.contains_key(&session_key));
}

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

#[tokio::test]
async fn failed_unregistered_shell_cleanup_persists_recovery_metadata() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_dir = tmp_dir.path().join("pids");
    manager.set_pid_dir(pid_dir.clone());
    let session_key = "failed-shell-cleanup-shell-0";
    let instance_id = 42;

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty should succeed");
    let mut command = CommandBuilder::new(get_shell_path());
    command.arg("-lc");
    command.arg("sleep 30");
    let child = pair
        .slave
        .spawn_command(command)
        .expect("shell should spawn");
    drop(pair.slave);
    let pid = child.process_id().expect("shell PID");
    let mut mismatched_identity = ManagedProcessIdentity::capture(pid).expect("managed identity");
    mismatched_identity.root_start_time += 1;
    let writer = pair
        .master
        .take_writer()
        .expect("writer should be available");
    let session = PtySession {
        child,
        master: pair.master,
        writer,
        instance_id,
        kind: PtySessionKind::Shell {
            task_id: "failed-shell-cleanup".to_string(),
        },
        pid_file_name: format!("{session_key}.pid"),
        shadow_model: None,
        managed_process: mismatched_identity.clone(),
    };

    let result = manager
        .terminate_or_retain_unregistered_session(session_key, session)
        .await;

    assert!(matches!(result, Err(PtyError::CleanupFailed(_))));
    let recovery_key = format!("{session_key}-cleanup-{instance_id}");
    let recovery_file = pid_dir.join(format!("{recovery_key}-pty.pid"));
    let persisted: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(&recovery_file)
            .expect("failed shell cleanup should persist recovery metadata"),
    )
    .expect("recovery metadata should parse");
    assert_eq!(persisted, mismatched_identity);
    let retained = manager
        .sessions
        .lock()
        .await
        .remove(&recovery_key)
        .expect("failed shell cleanup should retain in-memory ownership");

    let blocked_pid_dir = tmp_dir.path().join("blocked-pid-dir");
    std::fs::write(&blocked_pid_dir, "not a directory")
        .expect("blocked PID directory fixture should write");
    manager.set_pid_dir(blocked_pid_dir);
    let preservation_result = manager
        .terminate_or_retain_unregistered_session("metadata-write-failure", retained)
        .await;
    assert!(
        matches!(preservation_result, Err(PtyError::CleanupFailed(ref message)) if message.contains("recovery metadata")),
        "metadata persistence failure must be propagated"
    );

    let failed_recovery_key = format!("metadata-write-failure-cleanup-{instance_id}");
    let mut retained = manager
        .sessions
        .lock()
        .await
        .remove(&failed_recovery_key)
        .expect("ownership must remain in memory when metadata persistence fails");
    force_kill_unverified_spawn(pid);
    let _ = retained.child.kill();
    let _ = retained.child.try_wait();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_shell_cleanup_cancels_spawn_before_session_publication() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().join("pids"));
    let task_id = "pending-shell-cleanup";
    let session_key = shell_session_key(task_id, Some(0));
    let lifecycle_lock = manager.lifecycle_lock_for(&session_key).await;
    let lifecycle_guard = lifecycle_lock.lock().await;

    let spawn_manager = manager.clone();
    let spawn_cwd = tmp_dir.path().to_path_buf();
    let spawn_task_id = task_id.to_string();
    let spawn_task = tokio::spawn(async move {
        spawn_manager
            .spawn_shell_pty_with_command(
                PtySpawnContext {
                    task_id: &spawn_task_id,
                    cwd: &spawn_cwd,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                Some(0),
                None,
                long_running_shell_command(),
            )
            .await
    });

    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    while !manager.pending_shell_spawns.contains_key(&session_key)
        && std::time::Instant::now() < deadline
    {
        tokio::task::yield_now().await;
    }
    assert!(
        manager.pending_shell_spawns.contains_key(&session_key),
        "shell spawn should be discoverable before session publication"
    );

    let cleanup_manager = manager.clone();
    let cleanup_task_id = task_id.to_string();
    let cleanup_task =
        tokio::spawn(async move { cleanup_manager.kill_shells_for_task(&cleanup_task_id).await });
    tokio::task::yield_now().await;
    drop(lifecycle_guard);

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
    cleanup_task
        .await
        .expect("cleanup task should join")
        .expect("task shell cleanup should succeed");

    assert!(!manager.sessions.lock().await.contains_key(&session_key));
    assert!(!manager
        .get_pid_dir()
        .expect("PID dir")
        .join(format!("{session_key}.pid"))
        .exists());
    assert!(!manager
        .output_buffers
        .lock()
        .await
        .contains_key(&session_key));
    assert!(!manager.last_output.lock().await.contains_key(&session_key));
    drop(lifecycle_lock);
    tokio::time::timeout(Duration::from_secs(1), async {
        while manager.lifecycle_locks.contains_key(&session_key) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("session teardown should evict its lifecycle lock");
}

#[tokio::test]
async fn shadow_mode_tracks_live_shell_without_changing_replay_or_lifecycle() {
    let mut manager = PtyManager::new();
    manager.set_shadow_mode(crate::terminal_model::ShadowMode::Enabled);
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(temp_dir.path().join("pids"));
    let task_id = "shadow-shell";
    let session_key = shell_session_key(task_id, Some(0));
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-lc");
    command.arg("printf 'shadow-output'; exec sleep 30");

    let instance_id = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: temp_dir.path(),
                cols: 80,
                rows: 24,
                app_handle: None,
                app_event_tx: None,
            },
            Some(0),
            None,
            command,
        )
        .await
        .expect("shell PTY should spawn with shadow mode enabled");

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if manager
                .get_pty_buffer(&session_key)
                .await
                .is_some_and(|output| output.contains("shadow-output"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("normal replay output should remain available");
    manager
        .resize_pty(&session_key, 100, 30)
        .await
        .expect("normal PTY resize should still succeed");

    {
        let sessions = manager.sessions.lock().await;
        let session = sessions.get(&session_key).expect("live shell session");
        assert_eq!(session.instance_id, instance_id);
        let shadow = session
            .shadow_model
            .as_ref()
            .expect("shadow model should follow the live instance");
        let snapshot = shadow.snapshot().expect("canonical snapshot should encode");
        let portable = shadow.portable_vt().expect("portable VT should format");
        assert!(snapshot.starts_with(b"GHOSTSNP"));
        assert!(portable
            .windows(b"shadow-output".len())
            .any(|part| part == b"shadow-output"));
    }

    manager
        .kill_pty(&session_key)
        .await
        .expect("normal PTY cleanup should still succeed");
    assert!(!manager.sessions.lock().await.contains_key(&session_key));
}
