//! Agent-specific spawn entry points and orchestration.

use crate::app_events::AppEventSender;
use std::path::Path;

use super::super::super::commands::PiSessionTarget;
use super::super::super::{PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol};
use super::super::provider_adapter::{
    AgentPtyProviderAdapter, ClaudeCodePtyAdapter, CodexPtyAdapter, GrokPtyAdapter,
    OpenCodePtyAdapter, PiPtyAdapter,
};
use super::process::{resolve_pty_cwd, AgentProcessRequest, SpawnedPty};
use super::registration::SessionRegistrationRequest;
use super::streams::{AgentEventStreamRequest, PtyEventSink};

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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
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
                app_handle,
                app_event_tx,
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            CodexPtyAdapter::new(prompt, resume_session_id, continue_session),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                app_handle,
                app_event_tx,
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
    /// * `app_handle` - Tauri app handle for emitting PTY output events
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
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
                app_handle,
                app_event_tx,
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            PiPtyAdapter::new(prompt, session_target, None),
            PtySpawnContext {
                task_id,
                cwd,
                cols,
                rows,
                app_handle,
                app_event_tx,
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
    /// * `app_handle` - Tauri app handle for emitting PTY output events
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
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
                app_handle,
                app_event_tx,
            },
            // Grok has no inline-image renderer, so it gets the same `None` as
            // Claude/Codex/OpenCode; only Pi threads a terminal image protocol.
            None,
        )
        .await
    }

    pub(super) async fn spawn_agent_pty<A: AgentPtyProviderAdapter>(
        &self,
        mut adapter: A,
        context: PtySpawnContext<'_>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        let PtySpawnContext {
            task_id,
            cwd,
            cols,
            rows,
            app_handle,
            app_event_tx,
        } = context;
        let resolved_cwd = resolve_pty_cwd(cwd)?;
        let (token, lifecycle_lock) = self.begin_agent_spawn(task_id, adapter.label()).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

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
            },
        )?;
        let instance_id = spawned.instance_id();
        let managed_process = spawned.managed_process().clone();
        let SpawnedPty {
            reader,
            session,
            pid_file,
            shadow_feeder,
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

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        self.require_current_agent_spawn_and_session(
            task_id,
            token,
            instance_id,
            "before setup completed",
        )
        .await?;
        let last_output_time = self
            .register_agent_last_output_tracking(
                task_id,
                token,
                instance_id,
                adapter.track_last_output(),
            )
            .await?;
        let stream_state = self
            .register_agent_stream_state(task_id, token, instance_id, last_output_time)
            .await?;
        #[cfg(test)]
        self.pause_before_agent_event_stream_start();
        self.start_agent_event_stream(AgentEventStreamRequest {
            task_id,
            token,
            instance_id,
            reader,
            shadow_feeder,
            stream_state,
            lifecycle_lock: lifecycle_lock.clone(),
            pid_file,
            event_sink: PtyEventSink {
                app_handle,
                app_event_tx,
            },
        })
        .await?;
        self.finish_agent_spawn(task_id, token).await?;

        Ok(instance_id)
    }
}

#[cfg(test)]
#[path = "tests/agent.rs"]
mod tests;
