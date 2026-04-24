use std::path::Path;

use tauri::AppHandle;

use super::ProviderSessionResult;
use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;

pub struct PiProvider {
    pub pty_mgr: PtyManager,
}

impl PiProvider {
    pub fn new(pty_mgr: PtyManager) -> Self {
        Self { pty_mgr }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        _agent: Option<&str>,
        _permission_mode: Option<&str>,
        _model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        self.pty_mgr
            .spawn_pi_pty(task_id, worktree_path, prompt, None, false, 80, 24, app.clone())
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn resume(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        _agent: Option<&str>,
        _permission_mode: Option<&str>,
        _model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        let resume_session_id = session.pi_session_id.as_deref();
        let actual_prompt = prompt.unwrap_or("");
        let continue_session = resume_session_id.is_none();

        self.pty_mgr
            .spawn_pi_pty(
                task_id,
                worktree_path,
                actual_prompt,
                resume_session_id,
                continue_session,
                80,
                24,
                app.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: resume_session_id.map(str::to_string),
        })
    }

    pub async fn abort(&self, task_id: &str, _session: &AgentSessionRow) -> Result<(), String> {
        self.pty_mgr
            .kill_pty(task_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn cleanup(&self, task_id: &str) -> Result<(), String> {
        self.pty_mgr
            .kill_pty(task_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub fn provider_name(&self) -> &'static str {
        "pi"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.pi_session_id.clone()
    }

    pub fn list_commands(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        vec![]
    }

    pub fn list_agents(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(pi_session_id: Option<&str>) -> AgentSessionRow {
        AgentSessionRow {
            id: "session-1".to_string(),
            ticket_id: "T-001".to_string(),
            opencode_session_id: None,
            stage: "implementing".to_string(),
            status: "running".to_string(),
            checkpoint_data: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: "pi".to_string(),
            claude_session_id: None,
            pi_session_id: pi_session_id.map(str::to_string),
        }
    }

    #[test]
    fn provider_session_id_returns_stored_value() {
        let provider = PiProvider::new(PtyManager::new());
        let session = make_session(Some("session-123"));

        assert_eq!(provider.provider_session_id(&session), Some("session-123".to_string()));
    }

    #[test]
    fn provider_session_id_returns_none_when_absent() {
        let provider = PiProvider::new(PtyManager::new());
        let session = make_session(None);

        assert_eq!(provider.provider_session_id(&session), None);
    }
}
