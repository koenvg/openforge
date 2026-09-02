use std::path::Path;

use log::warn;

use super::{ProviderError, ProviderSessionResult, ProviderStartContext};
use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;

pub struct GrokProvider {
    pub pty_mgr: PtyManager,
}

/// True when a `resume` call would silently fall back to starting a brand
/// new Grok session instead of resuming: a prompt was supplied (so
/// `--continue` is never used, mirroring ClaudeCodeProvider::resume), but no
/// Grok session id was ever recorded (e.g. because hook delivery is
/// best-effort and can fail silently) so `--resume` can't be emitted either.
fn should_warn_resume_starting_new_session(prompt: Option<&str>, resume_id: Option<&str>) -> bool {
    prompt.is_some() && resume_id.is_none()
}

impl GrokProvider {
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
        permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let model_id = model.map(|m| m.model_id.as_str());

        let pty_instance_id = self
            .pty_mgr
            .spawn_grok_pty(
                task_id,
                worktree_path,
                prompt,
                None,
                false,
                permission_mode,
                model_id,
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
        _agent: Option<&str>,
        permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        start_context: &ProviderStartContext,
    ) -> Result<ProviderSessionResult, ProviderError> {
        let resume_id = session.grok_session_id.as_deref();

        if should_warn_resume_starting_new_session(prompt, resume_id) {
            warn!(
                "[Grok] Resuming task {} with a prompt but no stored Grok session id was found; \
                 starting a new Grok session instead of resuming (the prior conversation may be lost)",
                task_id
            );
        }

        // Distinguish between two contexts (mirrors ClaudeCodeProvider::resume):
        // - Some(prompt) → caller sending new prompt, never use --continue
        // - None → startup resume: resume in-progress session, use --continue if no session ID
        let (actual_prompt, use_continue) = match prompt {
            Some(p) => (p, false),
            None => ("", resume_id.is_none()),
        };

        let model_id = model.map(|m| m.model_id.as_str());

        let pty_instance_id = self
            .pty_mgr
            .spawn_grok_pty(
                task_id,
                worktree_path,
                actual_prompt,
                resume_id,
                use_continue,
                permission_mode,
                model_id,
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
        "grok"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.grok_session_id.clone()
    }

    /// Discovers Grok Build's own skills, plugin-provided skills, and built-in slash
    /// commands, mirroring ClaudeCodeProvider's scan of commands/skills directories
    /// (previously deferred — see docs.x.ai/build/features/skills-plugins-marketplaces):
    /// - Personal skills: `~/.grok/skills/` and `~/.agents/skills/` (Grok Build reads
    ///   the shared Agents-format directory directly, per that doc).
    /// - Project skills: `<project>/.grok/skills/`.
    /// - Plugin skills: any plugin folder under `.grok/plugins/` (project) or
    ///   `~/.grok/plugins/` (personal) — presence on disk is enough to be active, there
    ///   is no separate enable/disable registry the way Claude Code has one.
    /// - Built-in Grok Build TUI commands (`builtin_grok_commands`).
    ///
    /// Not yet covered: marketplace-installed plugins under `.grok/plugins/marketplaces/`,
    /// extra paths configured via `~/.grok/config.toml`, and Claude's server-driven
    /// "authoritative" extras (`claude_authoritative`) — that overlay depends on Claude
    /// CLI's `stream-json` init protocol, which Grok Build has no confirmed equivalent of.
    pub fn list_commands(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        use crate::command_discovery::{
            builtin_grok_commands, enrich_command, resolve_installed_plugins_from_dir,
            scan_plugin_commands, scan_skills_directory, trigger_for, GENERIC_SKILLS_SOURCE_DIR,
            GROK_SKILLS_SOURCE_DIR,
        };
        use std::collections::HashMap;

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        for mut cmd in builtin_grok_commands() {
            enrich_command(&mut cmd, "builtin", "manual-only", None, None, None);
            commands_map.insert(cmd.name.clone(), cmd);
        }

        let insert_skill = |map: &mut HashMap<String, crate::opencode_client::CommandInfo>,
                            skill: crate::opencode_client::SkillInfo,
                            origin: &str| {
            let name = skill.name.clone();
            let mut cmd = crate::opencode_client::CommandInfo {
                name: skill.name,
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
            map.insert(name, cmd);
        };

        if let Some(home) = dirs::home_dir() {
            for skill in scan_skills_directory(
                &home.join(GROK_SKILLS_SOURCE_DIR).join("skills"),
                "user",
                GROK_SKILLS_SOURCE_DIR,
            ) {
                insert_skill(&mut commands_map, skill, "personal");
            }
            for skill in scan_skills_directory(
                &home.join(GENERIC_SKILLS_SOURCE_DIR).join("skills"),
                "user",
                GENERIC_SKILLS_SOURCE_DIR,
            ) {
                insert_skill(&mut commands_map, skill, "personal");
            }

            let plugins = resolve_installed_plugins_from_dir(
                &home.join(GROK_SKILLS_SOURCE_DIR).join("plugins"),
            );
            for plugin in &plugins {
                for skill in scan_skills_directory(
                    &plugin.cache_dir.join("skills"),
                    "user",
                    GROK_SKILLS_SOURCE_DIR,
                ) {
                    insert_skill(&mut commands_map, skill, "plugin");
                }
            }
            for mut cmd in scan_plugin_commands(&plugins) {
                enrich_command(&mut cmd, "plugin", "auto+manual", None, None, None);
                commands_map.insert(cmd.name.clone(), cmd);
            }
        }

        if let Some(proj_path) = project_path {
            let proj = Path::new(proj_path);
            for skill in scan_skills_directory(
                &proj.join(GROK_SKILLS_SOURCE_DIR).join("skills"),
                "project",
                GROK_SKILLS_SOURCE_DIR,
            ) {
                insert_skill(&mut commands_map, skill, "project");
            }

            let plugins = resolve_installed_plugins_from_dir(
                &proj.join(GROK_SKILLS_SOURCE_DIR).join("plugins"),
            );
            for plugin in &plugins {
                for skill in scan_skills_directory(
                    &plugin.cache_dir.join("skills"),
                    "project",
                    GROK_SKILLS_SOURCE_DIR,
                ) {
                    insert_skill(&mut commands_map, skill, "plugin");
                }
            }
            for mut cmd in scan_plugin_commands(&plugins) {
                enrich_command(&mut cmd, "plugin", "auto+manual", None, None, None);
                commands_map.insert(cmd.name.clone(), cmd);
            }
        }

        let mut commands: Vec<_> = commands_map.into_values().collect();
        commands.sort_by(|a, b| a.name.cmp(&b.name));
        commands
    }

    /// Agents ship inside a plugin's `agents/` folder — same convention Claude Code's
    /// plugins use — so this reuses `scan_plugin_agents` against the same on-disk plugin
    /// list `list_commands` resolves for plugin skills.
    pub fn list_agents(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        use crate::command_discovery::{
            resolve_installed_plugins_from_dir, scan_plugin_agents, GROK_SKILLS_SOURCE_DIR,
        };

        let mut agents = Vec::new();
        if let Some(home) = dirs::home_dir() {
            let plugins = resolve_installed_plugins_from_dir(
                &home.join(GROK_SKILLS_SOURCE_DIR).join("plugins"),
            );
            agents.extend(scan_plugin_agents(&plugins));
        }
        if let Some(proj_path) = project_path {
            let proj = Path::new(proj_path);
            let plugins = resolve_installed_plugins_from_dir(
                &proj.join(GROK_SKILLS_SOURCE_DIR).join("plugins"),
            );
            agents.extend(scan_plugin_agents(&plugins));
        }
        agents.sort_by(|a, b| a.name.cmp(&b.name));
        agents
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(grok_session_id: Option<&str>) -> AgentSessionRow {
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
            provider: "grok".to_string(),
            claude_session_id: None,
            pi_session_id: None,
            grok_session_id: grok_session_id.map(str::to_string),
            output_revision: 0,
            viewed_output_revision: 0,
        }
    }

    #[test]
    fn test_provider_name() {
        let provider = GrokProvider::new(PtyManager::new());
        assert_eq!(provider.provider_name(), "grok");
    }

    #[test]
    fn test_provider_session_id_with_grok_session() {
        let provider = GrokProvider::new(PtyManager::new());
        let session = make_session(Some("grok-abc123"));
        assert_eq!(
            provider.provider_session_id(&session),
            Some("grok-abc123".to_string())
        );
    }

    #[test]
    fn test_provider_session_id_without_grok_session() {
        let provider = GrokProvider::new(PtyManager::new());
        let session = make_session(None);
        assert_eq!(provider.provider_session_id(&session), None);
    }

    #[test]
    fn list_commands_includes_builtin_grok_commands() {
        let provider = GrokProvider::new(PtyManager::new());

        let commands = provider.list_commands(None);

        let model_cmd = commands
            .iter()
            .find(|cmd| cmd.name == "model")
            .expect("builtin /model command present");
        assert_eq!(model_cmd.source.as_deref(), Some("builtin"));
        assert_eq!(
            model_cmd.extra.get("origin").and_then(|v| v.as_str()),
            Some("builtin")
        );
    }

    #[test]
    fn list_commands_discovers_project_grok_skill() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir
            .path()
            .join(".grok")
            .join("skills")
            .join("release-notes");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: release-notes\ndescription: Draft release notes\n---\nBody",
        )
        .unwrap();

        let provider = GrokProvider::new(PtyManager::new());
        let commands = provider.list_commands(dir.path().to_str());

        let skill = commands
            .iter()
            .find(|cmd| cmd.name == "release-notes")
            .expect("project skill present");
        assert_eq!(
            skill.extra.get("origin").and_then(|v| v.as_str()),
            Some("project")
        );
        assert_eq!(
            skill.extra.get("sourceDir").and_then(|v| v.as_str()),
            Some(".grok")
        );
    }

    #[test]
    fn list_commands_discovers_project_plugin_skill_and_command() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_dir = dir.path().join(".grok").join("plugins").join("my-plugin");
        let skill_dir = plugin_dir.join("skills").join("triage");
        let commands_dir = plugin_dir.join("commands");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::create_dir_all(&commands_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: triage\ndescription: Triage an issue\n---\nBody",
        )
        .unwrap();
        std::fs::write(
            commands_dir.join("sync.md"),
            "---\ndescription: Sync the board\n---\nBody",
        )
        .unwrap();

        let provider = GrokProvider::new(PtyManager::new());
        let commands = provider.list_commands(dir.path().to_str());

        let skill = commands
            .iter()
            .find(|cmd| cmd.name == "triage")
            .expect("plugin skill present");
        assert_eq!(
            skill.extra.get("origin").and_then(|v| v.as_str()),
            Some("plugin")
        );

        let command = commands
            .iter()
            .find(|cmd| cmd.name == "my-plugin:sync")
            .expect("plugin command present");
        assert_eq!(
            command.extra.get("origin").and_then(|v| v.as_str()),
            Some("plugin")
        );
    }

    #[test]
    fn list_commands_skips_the_marketplaces_registry_as_a_plugin() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(
            dir.path()
                .join(".grok")
                .join("plugins")
                .join("marketplaces"),
        )
        .unwrap();

        let provider = GrokProvider::new(PtyManager::new());
        let commands = provider.list_commands(dir.path().to_str());

        assert!(commands.iter().all(|cmd| cmd.name != "marketplaces:sync"));
    }

    #[test]
    fn list_agents_discovers_project_plugin_agents() {
        let dir = tempfile::tempdir().unwrap();
        let agents_dir = dir
            .path()
            .join(".grok")
            .join("plugins")
            .join("my-plugin")
            .join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("reviewer.md"),
            "---\nname: reviewer\n---\nBody",
        )
        .unwrap();

        let provider = GrokProvider::new(PtyManager::new());
        let agents = provider.list_agents(dir.path().to_str());

        assert!(agents.iter().any(|agent| agent.name == "reviewer"));
    }

    // ------------------------------------------------------------------
    // Fix 12: warn when a "resume" would silently start a new session
    // ------------------------------------------------------------------

    #[test]
    fn warns_when_prompt_supplied_and_no_stored_session_id() {
        assert!(should_warn_resume_starting_new_session(
            Some("keep going"),
            None
        ));
    }

    #[test]
    fn does_not_warn_when_prompt_supplied_and_session_id_present() {
        assert!(!should_warn_resume_starting_new_session(
            Some("keep going"),
            Some("grok-session-1")
        ));
    }

    #[test]
    fn does_not_warn_on_startup_resume_without_prompt() {
        // None prompt means "startup resume" (falls back to --continue), not
        // the silently-lost-conversation case this warning targets.
        assert!(!should_warn_resume_starting_new_session(None, None));
    }
}
