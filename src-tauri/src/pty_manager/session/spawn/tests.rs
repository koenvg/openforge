use super::super::super::commands::get_shell_path;
use super::super::super::pids::shell_session_key;
use super::super::super::PtySpawnContext;
use super::super::provider_adapter::AgentPtyProviderAdapter;
use super::agent::*;
use super::*;
use crate::pty_manager::{PtyAttachmentHub, RingBuffer};
use std::sync::Arc;

#[cfg(test)]
struct CompanionTestAgentAdapter {
    script: String,
}

#[cfg(test)]
impl AgentPtyProviderAdapter for CompanionTestAgentAdapter {
    fn label(&self) -> &'static str {
        "CompanionTest"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        vec!["-lc".to_string(), self.script.clone()]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        Ok(())
    }

    fn extra_env(
        &self,
        _task_id: &str,
        _instance_id: u64,
    ) -> std::collections::HashMap<String, String> {
        std::collections::HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{task_id}-pty.pid")
    }

    fn track_last_output(&self) -> bool {
        false
    }
}

#[cfg(test)]
impl PtyManager {
    pub(crate) async fn spawn_companion_test_agent_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        script: &str,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            CompanionTestAgentAdapter {
                script: script.to_string(),
            },
            PtySpawnContext {
                task_id,
                cwd,
                cols: 80,
                rows: 24,
                app_handle: None,
                app_event_tx: None,
            },
            None,
        )
        .await
    }
}

use super::super::lifecycle::PtySessions;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

fn long_running_shell_command() -> CommandBuilder {
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-c");
    command.arg("exec sleep 30");
    command
}

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
async fn agent_spawn_arbitration_keeps_the_newest_generation_current() {
    let manager = PtyManager::new();
    let task_id = "stage-arbitration";
    let (older, older_lock) = manager.begin_agent_spawn(task_id, "Test").await;
    let (newer, newer_lock) = manager.begin_agent_spawn(task_id, "Test").await;

    assert!(manager.finish_agent_spawn(task_id, older).await.is_err());
    assert_eq!(
        manager.agent_spawn_generations.lock().await.get(task_id),
        Some(&newer.generation)
    );

    manager
        .finish_agent_spawn(task_id, newer)
        .await
        .expect("newest generation should complete arbitration");
    assert!(!manager
        .agent_spawn_generations
        .lock()
        .await
        .contains_key(task_id));

    drop(older_lock);
    drop(newer_lock);
}

#[tokio::test]
async fn stale_agent_stream_registration_removes_its_last_output_tracking() {
    let manager = PtyManager::new();
    let task_id = "stale-stream-registration";
    let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
    let _ = manager.begin_agent_spawn(task_id, "Newer").await;
    let stale_last_output = Arc::new(AtomicU64::new(0));
    manager
        .last_output
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&stale_last_output));

    let result = manager
        .register_agent_stream_state(task_id, stale_token, 1, Some(stale_last_output))
        .await;

    assert!(result.is_err());
    assert!(
        !manager.last_output.lock().await.contains_key(task_id),
        "superseded stream registration should remove its last-output tracking"
    );
}

#[tokio::test]
async fn stale_agent_stream_registration_preserves_newer_last_output_tracking() {
    let manager = PtyManager::new();
    let task_id = "newer-stream-registration";
    let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
    let _ = manager.begin_agent_spawn(task_id, "Newer").await;
    let newer_last_output = Arc::new(AtomicU64::new(0));
    manager
        .last_output
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&newer_last_output));

    let result = manager
        .register_agent_stream_state(task_id, stale_token, 1, Some(Arc::new(AtomicU64::new(0))))
        .await;

    assert!(result.is_err());
    assert!(
        manager
            .last_output
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &newer_last_output)),
        "superseded stream registration should preserve newer last-output tracking"
    );
}

#[tokio::test]
async fn output_buffer_cleanup_removes_own_registration_and_preserves_replacement() {
    let manager = PtyManager::new();
    let task_id = "output-buffer-cleanup";
    let registered = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    manager
        .output_buffers
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&registered));

    manager
        .remove_output_buffer_if_registered(task_id, &registered)
        .await;

    assert!(!manager.output_buffers.lock().await.contains_key(task_id));

    let replacement = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    manager
        .output_buffers
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&replacement));

    manager
        .remove_output_buffer_if_registered(task_id, &registered)
        .await;

    assert!(
        manager
            .output_buffers
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &replacement)),
        "stale cleanup must preserve the replacement output buffer"
    );
}

#[tokio::test]
async fn attachment_hub_cleanup_removes_own_registration_and_preserves_replacement() {
    let manager = PtyManager::new();
    let task_id = "attachment-hub-cleanup";
    let registered = Arc::new(PtyAttachmentHub::new(1, 64, 4));
    manager
        .attachment_hubs
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&registered));

    manager
        .remove_attachment_hub_if_registered(task_id, &registered)
        .await;

    assert!(!manager.attachment_hubs.lock().await.contains_key(task_id));

    let replacement = Arc::new(PtyAttachmentHub::new(2, 64, 4));
    manager
        .attachment_hubs
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&replacement));

    manager
        .remove_attachment_hub_if_registered(task_id, &registered)
        .await;

    assert!(
        manager
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &replacement)),
        "stale cleanup must preserve the replacement attachment hub"
    );
}

#[tokio::test]
async fn stale_agent_session_registration_reaps_the_unpublished_process() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "stale-registration-stage";
    let adapter = LockCheckingAgentAdapter {
        sessions: Arc::clone(&manager.sessions),
        prepared_tx: None,
        command_delay: Duration::ZERO,
        script: "printf stale-registration",
        check_lock: false,
    };
    let (stale_token, lifecycle_lock) = manager.begin_agent_spawn(task_id, adapter.label()).await;
    let lifecycle_guard = lifecycle_lock.lock().await;
    let spawned = manager
        .create_agent_process(
            &adapter,
            AgentProcessRequest {
                task_id,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                terminal_image_protocol: None,
                app_event_tx: None,
            },
        )
        .expect("process creation stage should succeed");
    let SpawnedPty {
        reader,
        session,
        pid_file,
        shadow_feeder: _,
    } = spawned;
    let (current_token, current_lock) = manager.begin_agent_spawn(task_id, adapter.label()).await;

    let result = manager
        .register_spawned_session(SessionRegistrationRequest {
            session_key: task_id,
            generation: stale_token.generation,
            session,
            replacement_label: stale_token.label,
            stale_error: stale_token.stale_error(task_id, "before session registration completed"),
        })
        .await;

    assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
    assert!(!manager.sessions.lock().await.contains_key(task_id));
    assert!(!pid_file.exists());
    assert_eq!(
        manager.agent_spawn_generations.lock().await.get(task_id),
        Some(&current_token.generation)
    );

    drop(reader);
    manager
        .finish_agent_spawn(task_id, current_token)
        .await
        .expect("newest generation should remain completable");
    drop(lifecycle_guard);
    drop(lifecycle_lock);
    drop(current_lock);
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: None,
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
                app_handle: None,
                app_event_tx: Some(app_event_tx),
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
                app_handle: None,
                app_event_tx: None,
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
