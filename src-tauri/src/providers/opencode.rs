use std::path::Path;

use super::{ProviderError, ProviderSessionResult, ProviderStartContext};
use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;

pub struct OpenCodeProvider {
    pub pty_mgr: PtyManager,
}

impl OpenCodeProvider {
    pub fn new(pty_mgr: PtyManager) -> Self {
        Self { pty_mgr }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        agent: Option<&str>,
        _permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let pty_instance_id = self
            .pty_mgr
            .spawn_opencode_run_pty(
                task_id,
                worktree_path,
                prompt,
                None,
                false,
                agent,
                model,
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
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        agent: Option<&str>,
        _permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let resume_session_id = session.opencode_session_id.as_deref();
        let actual_prompt = prompt.unwrap_or("");
        let continue_session = resume_session_id.is_none();
        let pty_instance_id = self
            .pty_mgr
            .spawn_opencode_run_pty(
                task_id,
                worktree_path,
                actual_prompt,
                resume_session_id,
                continue_session,
                agent,
                model,
                start_context.cols,
                start_context.rows,
                start_context.event_publisher.clone(),
            )
            .await?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: resume_session_id.map(str::to_string),
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
        "opencode"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.opencode_session_id.clone()
    }

    pub fn list_commands(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        use crate::command_discovery::{
            enrich_command, resolve_active_plugins, scan_commands_directory, scan_plugin_agents,
            scan_skills_directory, trigger_for,
        };
        use std::collections::HashMap;

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        let insert_skill = |map: &mut HashMap<String, crate::opencode_client::CommandInfo>,
                            skill: crate::opencode_client::SkillInfo,
                            origin: &str| {
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
                origin,
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
            map.entry(key).or_insert(cmd);
        };

        if let Some(config) = dirs::config_dir() {
            let opencode_config = config.join("opencode");
            for mut cmd in scan_commands_directory(&opencode_config.join("commands")) {
                enrich_command(
                    &mut cmd,
                    "personal",
                    "manual-only",
                    Some(".opencode"),
                    None,
                    None,
                );
                commands_map.insert(cmd.name.clone(), cmd);
            }
            for skill in scan_skills_directory(&opencode_config.join("skills"), "user", ".opencode")
            {
                insert_skill(&mut commands_map, skill, "personal");
            }
        }

        if let Some(proj_path) = project_path {
            let proj = Path::new(proj_path);
            for mut cmd in scan_commands_directory(&proj.join(".opencode").join("commands")) {
                enrich_command(
                    &mut cmd,
                    "project",
                    "manual-only",
                    Some(".opencode"),
                    None,
                    None,
                );
                commands_map.insert(cmd.name.clone(), cmd);
            }
            for skill in scan_skills_directory(
                &proj.join(".opencode").join("skills"),
                "project",
                ".opencode",
            ) {
                insert_skill(&mut commands_map, skill, "project");
            }
        }

        let active_plugins = dirs::home_dir()
            .map(|home| resolve_active_plugins(&home))
            .unwrap_or_default();
        let mut commands: Vec<_> = commands_map.into_values().collect();
        commands.extend(
            scan_plugin_agents(&active_plugins)
                .into_iter()
                .map(|agent| {
                    let mut cmd = crate::opencode_client::CommandInfo {
                        name: format!("agent:{}", agent.name),
                        description: Some(format!("Run with agent {}", agent.name)),
                        source: Some("agent".to_string()),
                        agent: Some(agent.name),
                        extra: serde_json::Map::new(),
                    };
                    enrich_command(&mut cmd, "plugin", "auto+manual", None, None, None);
                    cmd
                }),
        );
        commands.sort_by(|left, right| left.name.cmp(&right.name));
        commands
    }

    pub fn list_agents(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        let _ = project_path;
        dirs::home_dir()
            .map(|home| crate::command_discovery::resolve_active_plugins(&home))
            .map(|plugins| crate::command_discovery::scan_plugin_agents(&plugins))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AgentSessionRow;

    fn make_session(opencode_session_id: Option<&str>) -> AgentSessionRow {
        AgentSessionRow {
            id: "session-1".to_string(),
            ticket_id: "T-001".to_string(),
            opencode_session_id: opencode_session_id.map(str::to_string),
            stage: "implementing".to_string(),
            status: "running".to_string(),
            checkpoint_data: None,
            pty_instance_id: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: "opencode".to_string(),
            claude_session_id: None,
            pi_session_id: None,
            grok_session_id: None,
        }
    }

    #[test]
    fn test_provider_name() {
        let provider = OpenCodeProvider::new(PtyManager::new());
        assert_eq!(provider.provider_name(), "opencode");
    }

    #[test]
    fn test_provider_session_id_with_opencode_session() {
        let provider = OpenCodeProvider::new(PtyManager::new());
        let session = make_session(Some("oc-abc123"));
        assert_eq!(
            provider.provider_session_id(&session),
            Some("oc-abc123".to_string())
        );
    }

    #[test]
    fn list_commands_includes_project_opencode_skills() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let skill_dir = temp_dir.path().join(".opencode/skills/review");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: review\ndescription: Review the code\n---\nReview this project.",
        )
        .expect("write skill");

        let provider = OpenCodeProvider::new(PtyManager::new());
        let commands = provider.list_commands(temp_dir.path().to_str());

        assert!(commands.iter().any(|command| {
            command.name == "skill:review"
                && command.source.as_deref() == Some("skill")
                && command.description.as_deref() == Some("Review the code")
        }));

        let command = commands
            .iter()
            .find(|command| command.name == "skill:review")
            .expect("project skill present");
        assert_eq!(
            command.extra.get("origin").and_then(|v| v.as_str()),
            Some("project")
        );
        assert_eq!(
            command.extra.get("sourceDir").and_then(|v| v.as_str()),
            Some(".opencode")
        );
    }

    #[test]
    fn test_provider_session_id_without_opencode_session() {
        let provider = OpenCodeProvider::new(PtyManager::new());
        let session = make_session(None);
        assert_eq!(provider.provider_session_id(&session), None);
    }
}
