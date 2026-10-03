//! Workspace working directories, including spaces and missing paths.

use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

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
}

#[tokio::test]
async fn agent_pty_starts_process_with_actual_workspace_cwd_containing_spaces() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
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
    cleanup.finish().expect("agent fixture PTY cleanup");
}

#[tokio::test]
async fn agent_pty_rejects_missing_workspace_cwd_instead_of_falling_back() {
    let mut manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
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
    cleanup.finish().expect("agent fixture PTY cleanup");
}
