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
                start_context.event_publisher.clone(),
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
                start_context.event_publisher.clone(),
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
        use crate::command_discovery::{
            enrich_command, scan_skills_directory, trigger_for, CODEX_SKILLS_SOURCE_DIR,
        };
        use std::collections::HashMap;

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        if let Some(codex_home) = crate::codex_hooks::codex_home_dir() {
            for skill in
                scan_skills_directory(&codex_home.join("skills"), "user", CODEX_SKILLS_SOURCE_DIR)
            {
                let key = format!("skill:{}", skill.name);
                commands_map.entry(key.clone()).or_insert_with(|| {
                    let mut cmd = crate::opencode_client::CommandInfo {
                        name: key,
                        description: skill.description,
                        source: Some("skill".to_string()),
                        agent: skill.agent,
                        extra: serde_json::Map::new(),
                    };
                    enrich_command(
                        &mut cmd,
                        "personal",
                        trigger_for(skill.disable_model_invocation),
                        Some(&skill.source_dir),
                        Some(&skill.source_path),
                        skill.user_invocable,
                    );
                    cmd.extra.insert(
                        "content".to_string(),
                        skill
                            .template
                            .map(serde_json::Value::from)
                            .unwrap_or(serde_json::Value::Null),
                    );
                    cmd
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
                let key = format!("skill:{}", skill.name);
                let mut cmd = crate::opencode_client::CommandInfo {
                    name: key.clone(),
                    description: skill.description,
                    source: Some("skill".to_string()),
                    agent: skill.agent,
                    extra: serde_json::Map::new(),
                };
                enrich_command(
                    &mut cmd,
                    "project",
                    trigger_for(skill.disable_model_invocation),
                    Some(&skill.source_dir),
                    Some(&skill.source_path),
                    skill.user_invocable,
                );
                cmd.extra.insert(
                    "content".to_string(),
                    skill
                        .template
                        .map(serde_json::Value::from)
                        .unwrap_or(serde_json::Value::Null),
                );
                commands_map.insert(key, cmd);
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

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &std::path::Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

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
            grok_session_id: None,
            output_revision: 0,
            viewed_output_revision: 0,
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
    fn list_commands_includes_user_codex_home_skills_for_dollar_invocation() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path().join("custom-codex-home");
        let skill_dir = codex_home.join("skills/home-only-skill");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: home-only-skill\ndescription: Skill from CODEX_HOME\n---\n# Home skill",
        )
        .expect("write skill");
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);

        let provider = CodexProvider::new(PtyManager::new());
        let commands = provider.list_commands(None);

        assert!(commands.iter().any(|command| {
            command.name == "skill:home-only-skill"
                && command.source.as_deref() == Some("skill")
                && command.description.as_deref() == Some("Skill from CODEX_HOME")
        }));
    }

    #[test]
    fn list_commands_enriches_home_skill_with_personal_origin() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path().join("custom-codex-home");
        let skill_dir = codex_home.join("skills/home-only-skill");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: home-only-skill\ndescription: Skill from CODEX_HOME\n---\n# Home skill",
        )
        .expect("write skill");
        let _guard = EnvVarGuard::set("CODEX_HOME", &codex_home);

        let provider = CodexProvider::new(PtyManager::new());
        let commands = provider.list_commands(None);

        let command = commands
            .iter()
            .find(|command| command.name == "skill:home-only-skill")
            .expect("home skill present");
        assert_eq!(
            command.extra.get("origin").and_then(|v| v.as_str()),
            Some("personal")
        );
        assert_eq!(
            command.extra.get("sourceDir").and_then(|v| v.as_str()),
            Some(".codex")
        );
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

        let command = commands
            .iter()
            .find(|command| command.name == "skill:grill-with-docs")
            .expect("project skill present");
        assert_eq!(
            command.extra.get("origin").and_then(|v| v.as_str()),
            Some("project")
        );
    }
}
