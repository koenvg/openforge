use std::path::Path;

use super::{ProviderError, ProviderSessionResult, ProviderStartContext};
use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;

pub struct CodexProvider {
    pub pty_mgr: PtyManager,
}

impl CodexProvider {
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
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let pty_instance_id = self
            .pty_mgr
            .spawn_codex_pty(
                task_id,
                worktree_path,
                prompt,
                None,
                false,
                start_context.cols,
                start_context.rows,
                start_context.app_handle.clone(),
                start_context.app_event_tx.clone(),
            )
            .await?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: None,
            pty_instance_id: Some(pty_instance_id),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn resume(
        &self,
        task_id: &str,
        _session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        _agent: Option<&str>,
        _permission_mode: Option<&str>,
        _model: Option<&crate::opencode_client::PromptModel>,
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let actual_prompt = prompt.unwrap_or("");
        let continue_session = prompt.is_none();

        let pty_instance_id = self
            .pty_mgr
            .spawn_codex_pty(
                task_id,
                worktree_path,
                actual_prompt,
                None,
                continue_session,
                start_context.cols,
                start_context.rows,
                start_context.app_handle.clone(),
                start_context.app_event_tx.clone(),
            )
            .await?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: None,
            pty_instance_id: Some(pty_instance_id),
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
        "codex"
    }

    pub fn provider_session_id(&self, _session: &AgentSessionRow) -> Option<String> {
        None
    }

    pub fn list_commands(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        use crate::command_discovery::{scan_skills_directory, CODEX_SKILLS_SOURCE_DIR};
        use std::collections::HashMap;

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        if let Some(home) = dirs::home_dir() {
            for skill in scan_skills_directory(
                &home.join(CODEX_SKILLS_SOURCE_DIR).join("skills"),
                "user",
                CODEX_SKILLS_SOURCE_DIR,
            ) {
                commands_map
                    .entry(format!("skill:{}", skill.name))
                    .or_insert(crate::opencode_client::CommandInfo {
                        name: format!("skill:{}", skill.name),
                        description: skill.description,
                        source: Some("skill".to_string()),
                        agent: skill.agent,
                        extra: serde_json::Map::new(),
                    });
            }
        }

        if let Some(proj_path) = project_path {
            let proj = Path::new(proj_path);
            for skill in scan_skills_directory(
                &proj.join(CODEX_SKILLS_SOURCE_DIR).join("skills"),
                "project",
                CODEX_SKILLS_SOURCE_DIR,
            ) {
                commands_map.insert(
                    format!("skill:{}", skill.name),
                    crate::opencode_client::CommandInfo {
                        name: format!("skill:{}", skill.name),
                        description: skill.description,
                        source: Some("skill".to_string()),
                        agent: skill.agent,
                        extra: serde_json::Map::new(),
                    },
                );
            }
        }

        let mut commands: Vec<_> = commands_map.into_values().collect();
        commands.sort_by(|left, right| left.name.cmp(&right.name));
        commands
    }

    pub fn list_agents(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session() -> AgentSessionRow {
        AgentSessionRow {
            id: "session-1".to_string(),
            ticket_id: "T-001".to_string(),
            opencode_session_id: None,
            stage: "implementing".to_string(),
            status: "running".to_string(),
            checkpoint_data: None,
            pty_instance_id: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: "codex".to_string(),
            claude_session_id: None,
            pi_session_id: None,
        }
    }

    #[test]
    fn provider_name_is_codex() {
        let provider = CodexProvider::new(PtyManager::new());

        assert_eq!(provider.provider_name(), "codex");
    }

    #[test]
    fn provider_session_id_is_absent_until_codex_exposes_one() {
        let provider = CodexProvider::new(PtyManager::new());

        assert_eq!(provider.provider_session_id(&make_session()), None);
    }

    #[test]
    fn list_commands_includes_project_codex_skills_for_dollar_invocation() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let skill_dir = temp_dir.path().join(".codex/skills/grill-with-docs");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: grill-with-docs\ndescription: Grill plans against docs\n---\n# Grill with docs",
        )
        .expect("write skill");

        let provider = CodexProvider::new(PtyManager::new());
        let commands = provider.list_commands(temp_dir.path().to_str());

        assert!(commands.iter().any(|command| {
            command.name == "skill:grill-with-docs"
                && command.source.as_deref() == Some("skill")
                && command.description.as_deref() == Some("Grill plans against docs")
        }));
    }
}
