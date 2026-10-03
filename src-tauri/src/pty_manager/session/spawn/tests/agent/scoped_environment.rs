//! Scoped agent identity and inherited environment isolation.

use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::test_fixture::NativePtyFixtureCleanup;
use crate::pty_manager::{PtyError, PtyManager, PtySpawnContext};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

struct SanitizedEnvironmentAdapter;

impl AgentPtyProviderAdapter for SanitizedEnvironmentAdapter {
    fn label(&self) -> &'static str {
        "SanitizedEnvironment"
    }

    fn command_name(&self) -> &'static str {
        "/usr/bin/env"
    }

    fn command_args(&self) -> Vec<String> {
        Vec::new()
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        HashMap::from([
            ("NO_COLOR".to_string(), "adapter-opt-out".to_string()),
            (
                "OPENFORGE_AGENT_CONFIG".to_string(),
                "scoped-config".to_string(),
            ),
        ])
    }

    fn removed_env(&self) -> &'static [&'static str] {
        &[
            "CLAUDE_TASK_ID",
            "OPENFORGE_AGENT_CONFIG",
            "OPENFORGE_AGENT_TOKEN",
            "OPENFORGE_BACKEND_TOKEN",
            "OPENFORGE_TASK_ID",
        ]
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{task_id}-pty.pid")
    }
}

#[tokio::test]
async fn scoped_agent_child_receives_only_its_issued_identity() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let mut cleanup = NativePtyFixtureCleanup::new(&mut manager);
    for key in [
        "CLAUDE_TASK_ID",
        "OPENFORGE_AGENT_CONFIG",
        "OPENFORGE_AGENT_TOKEN",
        "OPENFORGE_BACKEND_TOKEN",
        "OPENFORGE_TASK_ID",
        "NO_COLOR",
    ] {
        manager.set_test_environment_variable(key, "inherited-secret");
    }
    let session_key =
        "scoped-agent-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    manager
        .spawn_agent_pty(
            SanitizedEnvironmentAdapter,
            PtySpawnContext {
                task_id: session_key,
                cwd: tmp_dir.path(),
                cols: 80,
                rows: 24,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(None, None),
            },
            None,
        )
        .await
        .expect("environment probe should spawn");

    let output = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let output = manager
                .get_pty_buffer(session_key)
                .await
                .unwrap_or_default();
            if output.contains("OPENFORGE_AGENT_CONFIG=scoped-config") {
                break output;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("environment output should arrive");

    assert!(output.contains("OPENFORGE_AGENT_CONFIG=scoped-config"));
    assert!(!output.contains("inherited-secret"));
    assert!(!output.contains("OPENFORGE_BACKEND_TOKEN="));
    assert!(!output.contains("OPENFORGE_TASK_ID="));
    assert!(!output.contains("CLAUDE_TASK_ID="));
    assert!(!output.contains("NO_COLOR="));
    manager.kill_pty(session_key).await.expect("cleanup probe");
    cleanup.finish().expect("agent fixture PTY cleanup");
}
