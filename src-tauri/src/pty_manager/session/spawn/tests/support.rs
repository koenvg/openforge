use super::super::super::{PtyError, PtyManager, PtySpawnContext};
use super::super::provider_adapter::AgentPtyProviderAdapter;
use std::path::Path;

struct CompanionTestAgentAdapter {
    script: String,
}

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
