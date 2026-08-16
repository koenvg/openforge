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
        "grok"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.grok_session_id.clone()
    }

    pub fn list_commands(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        // v1: no `.grok`/`.claude`-compat command discovery yet. Richer discovery
        // (mirroring ClaudeCodeProvider's scan of commands/skills directories) is
        // a deferred follow-up.
        Vec::new()
    }

    pub fn list_agents(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        // v1: no `.grok` agent discovery yet. Deferred follow-up, same as list_commands.
        Vec::new()
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
    fn test_list_commands_returns_empty() {
        let provider = GrokProvider::new(PtyManager::new());
        assert!(provider.list_commands(None).is_empty());
    }

    #[test]
    fn test_list_agents_returns_empty() {
        let provider = GrokProvider::new(PtyManager::new());
        assert!(provider.list_agents(None).is_empty());
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
