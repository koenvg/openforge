use crate::app_events::{AppEventBus, AppEventFrame, InMemoryAppEventAdapter};
use crate::backend_runtime::AppHandle;
use crate::pty_manager::commands::get_shell_path;
use crate::pty_manager::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use crate::pty_manager::pids::{shell_session_key, write_managed_process_identity};
use crate::pty_manager::session::lifecycle::{PtySession, PtySessionKind};
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext, TerminalSessionLifecycleState};
use crate::terminal_model::{TerminalModelTestFault, TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::path::Path;
use std::sync::Arc;
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
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
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
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
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
        master: std::sync::Arc::new(std::sync::Mutex::new(pair.master)),
        writer: std::sync::Arc::new(
            crate::pty_manager::ordered_writer::OrderedPtyWriter::start(
                session_key.to_string(),
                instance_id,
                writer,
            )
            .expect("ordered writer should start"),
        ),
        instance_id,
        authority: manager.terminal_authority_contract(),
        kind: PtySessionKind::Shell {
            task_id: "failed-shell-cleanup".to_string(),
        },
        pid_file_name: format!("{session_key}.pid"),
        terminal_model: None,
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
    let blocked_spawn = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id: "failed-shell-cleanup",
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(0),
            None,
            long_running_shell_command(),
        )
        .await;
    assert!(
        matches!(
            blocked_spawn,
            Err(PtyError::CleanupFailed(ref message))
                if message.contains("managed cleanup is still pending")
        ),
        "managed recovery must block another Terminal Session under the same key"
    );
    let diagnostics = manager.process_diagnostic_sessions().await;
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic.session_key == recovery_key
                && diagnostic.lifecycle_state == TerminalSessionLifecycleState::ManagedRecovery
                && diagnostic.pty_instance_id == instance_id
        }),
        "managed recovery should be visible as a read-only lifecycle snapshot"
    );
    let retained = manager
        .terminal_sessions
        .take_managed_recovery_for_test(session_key, instance_id)
        .await
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

    let mut retained = manager
        .terminal_sessions
        .take_managed_recovery_for_test("metadata-write-failure", instance_id)
        .await
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
    let (spawn_pending_tx, spawn_pending_rx) = tokio::sync::oneshot::channel();
    let (release_spawn_tx, release_spawn_rx) = tokio::sync::oneshot::channel();
    *manager
        .shell_spawn_pending_gate
        .lock()
        .expect("shell spawn pending gate lock should not be poisoned") =
        Some(crate::pty_manager::ShellSpawnPendingGate {
            reached_tx: spawn_pending_tx,
            release_rx: release_spawn_rx,
        });

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
                    event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
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
        manager.pending_shell_spawns.contains_key(&session_key),
        "shell spawn should be discoverable before session publication"
    );

    let cleanup_manager = manager.clone();
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
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
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
            .terminal_model
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

async fn wait_for_model_shutdown(
    events: &mut crate::app_events::AppEventSubscription,
    session_key: &str,
    instance_id: u64,
) {
    let disabled_event = format!("pty-model-disabled-{session_key}");
    let exit_event = format!("pty-exit-{session_key}");
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut disabled = false;
        let mut exited = false;
        while !disabled || !exited {
            let AppEventFrame::Event(event) =
                events.recv().await.expect("event stream should stay open")
            else {
                continue;
            };
            if event.payload["instance_id"] != instance_id {
                continue;
            }
            disabled |= event.event_name == disabled_event;
            exited |= event.event_name == exit_event;
        }
    })
    .await
    .expect("failed Ghostty model should disable and terminate its PTY");
}

async fn wait_for_file_removal(path: &Path) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while path.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("failed model cleanup should remove the PTY identity file");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_creation_failure_terminates_session_and_preserves_shell_key() {
    let mut manager = PtyManager::new();
    manager.set_ghostty_terminal_state_enabled(true);
    manager.set_terminal_model_test_fault(TerminalModelTestFault::CreateFailure);
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_dir = tmp_dir.path().join("pids");
    manager.set_pid_dir(pid_dir.clone());
    let task_id = "ghostty-create-failure";
    let session_key = shell_session_key(task_id, Some(0));
    let bus = AppEventBus::new(32, 8);
    let app = AppHandle::new();
    app.set_app_event_adapter(Arc::new(InMemoryAppEventAdapter::new(bus.clone())));
    let mut events = bus.subscribe(None).expect("event subscription should open");

    let failed_instance = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(Some(app), None),
            },
            Some(0),
            None,
            long_running_shell_command(),
        )
        .await
        .expect("PTY spawn should complete before the asynchronous model failure is handled");

    wait_for_model_shutdown(&mut events, &session_key, failed_instance).await;
    assert!(!manager.sessions.lock().await.contains_key(&session_key));
    wait_for_file_removal(&pid_dir.join(format!("{session_key}.pid"))).await;

    let replacement_instance = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(0),
            None,
            long_running_shell_command(),
        )
        .await
        .expect("the same Shell Session Key should accept a replacement PTY");
    assert_ne!(replacement_instance, failed_instance);
    assert_eq!(
        manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(replacement_instance),
    );
    manager
        .terminate_failed_terminal_model(&session_key, failed_instance)
        .await
        .expect("a stale model failure should be ignored");
    assert_eq!(
        manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(replacement_instance),
        "the failed PTY instance must not terminate its successor",
    );
    manager
        .kill_pty(&session_key)
        .await
        .expect("replacement PTY should be cleaned up");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_queue_saturation_backpressures_and_recovers_the_session() {
    let mut manager = PtyManager::new();
    manager.set_ghostty_terminal_state_enabled(true);
    manager.set_terminal_model_test_fault(TerminalModelTestFault::StallFirstCommand);
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().join("pids"));
    let task_id = "ghostty-queue-saturation";
    let session_key = shell_session_key(task_id, Some(0));
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg(format!(
        "head -c {} /dev/zero | tr '\\0' x; printf model-queue-recovered; exec sleep 30",
        TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY + 8192
    ));

    let instance_id = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            Some(0),
            None,
            command,
        )
        .await
        .expect("Ghostty PTY should spawn");

    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if manager
                .get_pty_buffer(&session_key)
                .await
                .is_some_and(|output| output.contains("model-queue-recovered"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("PTY output should continue after the model queue catches up");

    let terminal_model = manager
        .sessions
        .lock()
        .await
        .get(&session_key)
        .and_then(|session| session.terminal_model.as_ref().map(Arc::clone))
        .expect("recovered authoritative session should retain its model");
    assert!(
        terminal_model.queue_saturated_for_test(),
        "the worker must observe a full command queue before recovery",
    );
    let snapshot = tokio::task::spawn_blocking(move || terminal_model.portable_snapshot())
        .await
        .expect("model snapshot task should join")
        .expect("the model worker should drain its saturated queue");
    assert_eq!(snapshot.instance_id, instance_id);
    assert!(snapshot
        .portable_vt
        .windows(b"model-queue-recovered".len())
        .any(|window| window == b"model-queue-recovered"));

    assert_eq!(
        manager
            .sessions
            .lock()
            .await
            .get(&session_key)
            .map(|session| session.instance_id),
        Some(instance_id),
    );
    manager
        .kill_pty(&session_key)
        .await
        .expect("recovered PTY should be cleaned up");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ghostty_model_worker_panic_terminates_the_affected_session() {
    let mut manager = PtyManager::new();
    manager.set_ghostty_terminal_state_enabled(true);
    manager.set_terminal_model_test_fault(TerminalModelTestFault::PanicOnFirstCommand);
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let pid_dir = tmp_dir.path().join("pids");
    manager.set_pid_dir(pid_dir.clone());
    let task_id = "ghostty-worker-panic";
    let session_key = shell_session_key(task_id, Some(0));
    let bus = AppEventBus::new(32, 8);
    let app = AppHandle::new();
    app.set_app_event_adapter(Arc::new(InMemoryAppEventAdapter::new(bus.clone())));
    let mut events = bus.subscribe(None).expect("event subscription should open");
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("printf panic-trigger; exec sleep 30");

    let instance_id = manager
        .spawn_shell_pty_with_command(
            PtySpawnContext {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(Some(app), None),
            },
            Some(0),
            None,
            command,
        )
        .await
        .expect("PTY should spawn before its model worker panics");

    wait_for_model_shutdown(&mut events, &session_key, instance_id).await;
    assert!(!manager.sessions.lock().await.contains_key(&session_key));
    wait_for_file_removal(&pid_dir.join(format!("{session_key}.pid"))).await;
}
