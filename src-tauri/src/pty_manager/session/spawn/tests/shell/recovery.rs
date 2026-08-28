use super::support::ShellTestHarness;
use crate::pty_manager::commands::get_shell_path;
use crate::pty_manager::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use crate::pty_manager::ordered_writer::OrderedPtyWriter;
use crate::pty_manager::pids::{shell_session_key, write_managed_process_identity};
use crate::pty_manager::session::lifecycle::{PtySession, PtySessionKind};
use crate::pty_manager::{PtyError, TerminalSessionLifecycleState};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn unresolved_shell_recovery_metadata_blocks_spawn_without_clobbering_record() {
    let harness = ShellTestHarness::new();
    let task_id = "recovery-conflict-shell";
    let session_key = shell_session_key(task_id, Some(0));
    let pid_file = harness.pid_dir.join(format!("{session_key}.pid"));
    std::fs::create_dir_all(&harness.pid_dir).expect("PID directory should be created");
    let unresolved_identity = ManagedProcessIdentity {
        version: 1,
        root_pid: 999_991,
        process_group_id: 999_991,
        session_id: 999_991,
        root_start_time: 42,
    };
    write_managed_process_identity(&pid_file, &unresolved_identity)
        .expect("unresolved identity should persist");

    let result = harness.spawn_long_running(task_id, Some(0)).await;

    assert!(
        matches!(result, Err(PtyError::CleanupFailed(ref message)) if message.contains("existing recovery metadata was preserved"))
    );
    let persisted: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(&pid_file).expect("recovery metadata should remain"),
    )
    .expect("recovery metadata should still parse");
    assert_eq!(persisted, unresolved_identity);
    assert!(!harness
        .manager
        .sessions
        .lock()
        .await
        .contains_key(&session_key));
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
}

#[tokio::test]
async fn failed_unregistered_shell_cleanup_persists_recovery_metadata() {
    let mut harness = ShellTestHarness::new();
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
        master: Arc::new(Mutex::new(pair.master)),
        writer: Arc::new(
            OrderedPtyWriter::start(session_key.to_string(), instance_id, writer)
                .expect("ordered writer should start"),
        ),
        instance_id,
        kind: PtySessionKind::Shell {
            task_id: "failed-shell-cleanup".to_string(),
        },
        pid_file_name: format!("{session_key}.pid"),
        terminal_model: None,
        managed_process: mismatched_identity.clone(),
    };

    let result = harness
        .manager
        .terminate_or_retain_unregistered_session(session_key, session)
        .await;

    assert!(matches!(result, Err(PtyError::CleanupFailed(_))));
    let recovery_key = format!("{session_key}-cleanup-{instance_id}");
    let recovery_file = harness.pid_dir.join(format!("{recovery_key}-pty.pid"));
    let persisted: ManagedProcessIdentity = serde_json::from_str(
        &std::fs::read_to_string(&recovery_file)
            .expect("failed shell cleanup should persist recovery metadata"),
    )
    .expect("recovery metadata should parse");
    assert_eq!(persisted, mismatched_identity);
    let blocked_spawn = harness
        .spawn_long_running("failed-shell-cleanup", Some(0))
        .await;
    assert!(
        matches!(
            blocked_spawn,
            Err(PtyError::CleanupFailed(ref message))
                if message.contains("managed cleanup is still pending")
        ),
        "managed recovery must block another Terminal Session under the same key"
    );
    let diagnostics = harness.manager.process_diagnostic_sessions().await;
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic.session_key == recovery_key
                && diagnostic.lifecycle_state == TerminalSessionLifecycleState::ManagedRecovery
                && diagnostic.pty_instance_id == instance_id
        }),
        "managed recovery should be visible as a read-only lifecycle snapshot"
    );
    let retained = harness
        .manager
        .terminal_sessions
        .take_managed_recovery_for_test(session_key, instance_id)
        .await
        .expect("failed shell cleanup should retain in-memory ownership");

    let blocked_pid_dir = harness.temp_dir.path().join("blocked-pid-dir");
    std::fs::write(&blocked_pid_dir, "not a directory")
        .expect("blocked PID directory fixture should write");
    harness.manager.set_pid_dir(blocked_pid_dir);
    let preservation_result = harness
        .manager
        .terminate_or_retain_unregistered_session("metadata-write-failure", retained)
        .await;
    assert!(
        matches!(preservation_result, Err(PtyError::CleanupFailed(ref message)) if message.contains("recovery metadata")),
        "metadata persistence failure must be propagated"
    );

    let mut retained = harness
        .manager
        .terminal_sessions
        .take_managed_recovery_for_test("metadata-write-failure", instance_id)
        .await
        .expect("ownership must remain in memory when metadata persistence fails");
    force_kill_unverified_spawn(pid).expect("retained shell process tree should accept SIGKILL");
    let _ = retained.child.kill();
    let _ = retained.child.try_wait();
}
