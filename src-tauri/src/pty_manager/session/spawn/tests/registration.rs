use super::*;
use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::session::spawn::process::{AgentProcessRequest, SpawnedPty};
use std::collections::HashMap;
use std::path::Path;

struct RegistrationTestAdapter;

impl AgentPtyProviderAdapter for RegistrationTestAdapter {
    fn label(&self) -> &'static str {
        "RegistrationTest"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        vec![
            "-lc".to_string(),
            "printf stale-registration; exec sleep 5".to_string(),
        ]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{task_id}-pty.pid")
    }

    fn track_last_output(&self) -> bool {
        false
    }
}

#[tokio::test]
async fn stale_session_registration_reaps_the_unpublished_process() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());
    let task_id = "stale-registration-stage";
    let adapter = RegistrationTestAdapter;
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
