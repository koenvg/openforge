//! Agent-specific spawn entry points and orchestration.

use crate::app_events::RuntimeEventPublisher;
use std::path::Path;

use super::super::super::commands::PiSessionTarget;
use super::super::super::events::{PtyExitObserver, PtyExitPolicy};
use super::super::super::{PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol};
use super::super::provider_adapter::{
    AgentPtyProviderAdapter, ClaudeCodePtyAdapter, CodexPtyAdapter, GrokPtyAdapter,
    OpenCodePtyAdapter, PiPtyAdapter, ScopedClaudeCodePtyAdapter, ScopedClaudeCodePtyConfig,
};
use super::process::{resolve_pty_cwd, AgentProcessRequest, SpawnedPty};
use super::registration::SessionRegistrationRequest;
use super::streams::{AgentEventStreamRequest, AgentStreamState};

impl PtyManager {
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_opencode_run_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        agent: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
    ) -> Result<u64, PtyError> {
        let model_name = model.map(|model| format!("{}/{}", model.provider_id, model.model_id));
        self.spawn_agent_pty(
            OpenCodePtyAdapter::new(
                prompt,
                resume_session_id,
                continue_session,
                agent,
                model_name.as_deref(),
            ),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_codex_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            CodexPtyAdapter::new(prompt, resume_session_id, continue_session),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            None,
        )
        .await
    }

    /// Spawns a Claude CLI process in a PTY for the given task_id.
    /// Runs `claude "prompt"` for new sessions, `claude --resume <id>` for resuming,
    /// or `claude --continue` to continue the most recent session in the working directory.
    /// Always passes `--settings <hooks_settings_path>` to load the Claude hooks config.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task (used for events and PID tracking)
    /// * `cwd` - Working directory for the Claude process (task's worktree path)
    /// * `prompt` - The prompt to send to Claude (empty string to skip)
    /// * `resume_session_id` - If Some, resumes an existing Claude session with `--resume <id>`
    /// * `continue_session` - If true and no resume_session_id, uses `--continue`
    /// * `hooks_settings_path` - Path to the hooks settings JSON file
    /// * `permission_mode` - If Some, passes `--permission-mode <mode>` to Claude CLI
    /// * `cols` - Terminal width in columns
    /// * `rows` - Terminal height in rows
    /// * `event_publisher` - Runtime publisher for PTY output events
    ///
    /// # Returns
    /// The unique instance ID for this PTY session
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_claude_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        hooks_settings_path: &Path,
        permission_mode: Option<&str>,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            ClaudeCodePtyAdapter::new(
                prompt,
                resume_session_id,
                continue_session,
                hooks_settings_path,
                permission_mode,
            ),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_pi_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        session_target: PiSessionTarget,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            PiPtyAdapter::new(prompt, session_target, None),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            terminal_image_protocol,
        )
        .await
    }

    /// Spawns a Grok CLI process in a PTY for the given task_id.
    /// Runs `grok [--resume <id>|--continue] [...] [-- prompt]`: the prompt is
    /// passed as a trailing positional argument, matching `grok [OPTIONS] [PROMPT]`.
    /// Installs the OpenForge lifecycle hook into the user's Grok home so status updates
    /// are reported back to OpenForge's local HTTP server.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task (used for events and PID tracking)
    /// * `cwd` - Working directory for the Grok process (task's worktree path)
    /// * `prompt` - The prompt to send to Grok (empty string to skip)
    /// * `resume_session_id` - If Some, resumes an existing Grok session with `--resume <id>`
    /// * `continue_session` - If true and no resume_session_id, uses `--continue`
    /// * `permission_mode` - If Some, passes `--permission-mode <mode>` to the Grok CLI
    /// * `model` - If Some, passes `--model <model>` to the Grok CLI
    /// * `cols` - Terminal width in columns
    /// * `rows` - Terminal height in rows
    /// * `event_publisher` - Runtime publisher for PTY output events
    ///
    /// # Returns
    /// The unique instance ID for this PTY session
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_grok_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        permission_mode: Option<&str>,
        model: Option<&str>,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            GrokPtyAdapter::new(
                prompt,
                resume_session_id,
                continue_session,
                permission_mode,
                model,
            ),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            // Grok has no inline-image renderer, so it gets the same `None` as
            // Claude/Codex/OpenCode; only Pi threads a terminal image protocol.
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn spawn_scoped_claude_pty(
        &self,
        session_key: &str,
        scoped_session_id: &str,
        cwd: &Path,
        prompt: &str,
        provider_session_id: &str,
        resume: bool,
        settings_path: &Path,
        sandbox_profile: String,
        credential_path: Option<std::path::PathBuf>,
        provider_state_dir: std::path::PathBuf,
        cols: u16,
        rows: u16,
        event_publisher: RuntimeEventPublisher,
        exit_observer: PtyExitObserver,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty_with_exit_policy(
            ScopedClaudeCodePtyAdapter::new(ScopedClaudeCodePtyConfig {
                prompt: prompt.to_string(),
                provider_session_id: provider_session_id.to_string(),
                resume,
                settings_path: settings_path.to_path_buf(),
                sandbox_profile,
                credential_path,
                provider_state_dir,
                scoped_session_id: scoped_session_id.to_string(),
            }),
            PtySpawnContext {
                task_id: session_key,
                cwd,
                cols,
                rows,
                event_publisher,
            },
            None,
            PtyExitPolicy::ScopedAgent(exit_observer),
        )
        .await
    }

    pub(in crate::pty_manager::session) async fn spawn_agent_pty<A: AgentPtyProviderAdapter>(
        &self,
        adapter: A,
        context: PtySpawnContext<'_>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty_with_exit_policy(
            adapter,
            context,
            terminal_image_protocol,
            PtyExitPolicy::TaskAgent,
        )
        .await
    }

    async fn spawn_agent_pty_with_exit_policy<A: AgentPtyProviderAdapter>(
        &self,
        mut adapter: A,
        context: PtySpawnContext<'_>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
        exit_policy: PtyExitPolicy,
    ) -> Result<u64, PtyError> {
        let daemon_bridge = self
            .daemon_shells
            .as_ref()
            .filter(|bridge| bridge.owns_agent(context.task_id));
        if let Some(bridge) = daemon_bridge {
            if !bridge.selects_provider(context.task_id, adapter.command_name()) {
                return Err(PtyError::SpawnFailed(
                    "task is selected for another daemon provider".into(),
                ));
            }
            let scoped_bridge = bridge.for_key(context.task_id);
            let instance = self
                .spawn_daemon_agent(
                    scoped_bridge.clone(),
                    adapter,
                    context,
                    terminal_image_protocol,
                )
                .await?;
            if let PtyExitPolicy::ScopedAgent(observer) = exit_policy {
                Self::observe_daemon_scoped_exit(scoped_bridge, instance, observer);
            }
            return Ok(instance);
        }
        let PtySpawnContext {
            task_id,
            cwd,
            cols,
            rows,
            event_publisher,
        } = context;
        let resolved_cwd = resolve_pty_cwd(cwd)?;
        self.terminal_sessions
            .ensure_no_managed_recovery(task_id)
            .await?;
        let (token, lifecycle_lock) = self.begin_agent_spawn(task_id, adapter.label()).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        if let Err(error) = self
            .terminal_sessions
            .ensure_no_managed_recovery(task_id)
            .await
        {
            let _ = self.finish_agent_spawn(task_id, token).await;
            return Err(error);
        }
        if !self.is_current_spawn(task_id, token.generation).await {
            return Err(token.stale_error(task_id, "cancelled before spawn"));
        }

        self.replace_existing_agent_session(task_id, token.label)
            .await?;
        adapter.prepare(&resolved_cwd)?;

        let spawned = self.create_agent_process(
            &adapter,
            AgentProcessRequest {
                task_id,
                cwd: &resolved_cwd,
                cols,
                rows,
                terminal_image_protocol,
                event_publisher: event_publisher.clone(),
            },
        )?;
        let instance_id = spawned.instance_id();
        let managed_process = spawned.managed_process().clone();
        let SpawnedPty {
            reader,
            session,
            pid_file,
            terminal_model_feeder,
        } = spawned;

        self.register_spawned_session(SessionRegistrationRequest {
            session_key: task_id,
            generation: token.generation,
            session,
            replacement_label: token.label,
            stale_error: token.stale_error(task_id, "before session registration completed"),
        })
        .await?;
        self.persist_session_identity(task_id, &pid_file, &managed_process)
            .await?;

        if matches!(exit_policy, PtyExitPolicy::TaskAgent) {
            let generations = self.terminal_sessions.agent_spawn_generations.lock().await;
            if generations.get(task_id) == Some(&token.generation) {
                self.terminal_sessions.pr_discovery.register_agent(
                    task_id,
                    resolved_cwd.clone(),
                    instance_id,
                );
            }
        }
        let stream_state = AgentStreamState::new(instance_id);
        let output = self
            .start_agent_output_reader(task_id, reader, terminal_model_feeder, &stream_state)
            .await?;

        self.require_current_agent_spawn_and_session(
            task_id,
            token,
            instance_id,
            "before setup completed",
        )
        .await?;
        self.register_agent_stream_state(task_id, token, instance_id, &stream_state)
            .await?;
        #[cfg(test)]
        self.pause_before_agent_event_stream_start();
        self.start_agent_event_stream(AgentEventStreamRequest {
            task_id,
            token,
            instance_id,
            output,
            stream_state,
            lifecycle_lock: lifecycle_lock.clone(),
            pid_file,
            event_publisher,
            exit_policy,
        })
        .await?;
        self.finish_agent_spawn(task_id, token).await?;

        Ok(instance_id)
    }
}

#[cfg(test)]
#[path = "tests/agent.rs"]
mod tests;
