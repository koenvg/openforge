//! Agent PTY provider setup, lifecycle arbitration, and stream-state ownership.

use crate::app_events::AppEventSender;
use crate::terminal_model::ShadowTerminalFeeder;
use log::info;
use portable_pty::CommandBuilder;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::super::super::attachment::{PtyAttachmentHub, COMPANION_ATTACHMENT_EVENT_CAPACITY};
use super::super::super::commands::PiSessionTarget;
use super::super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::super::{PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol};
use super::super::lifecycle::{LifecycleLockLease, PtySessionKind, NEXT_INSTANCE_ID};
use super::super::provider_adapter::{
    AgentPtyProviderAdapter, ClaudeCodePtyAdapter, CodexPtyAdapter, GrokPtyAdapter,
    OpenCodePtyAdapter, PiPtyAdapter,
};
use super::{
    resolve_pty_cwd, PtyEventSink, PtyProcessRequest, SessionRegistrationRequest, SpawnedPty,
    NEXT_SPAWN_GENERATION,
};

#[derive(Clone, Copy)]
pub(super) struct AgentSpawnToken {
    pub(super) generation: u64,
    pub(super) label: &'static str,
}

impl AgentSpawnToken {
    pub(super) fn stale_error(&self, task_id: &str, stage: &str) -> PtyError {
        PtyError::SpawnFailed(format!(
            "{} PTY for task {} was replaced {stage}",
            self.label, task_id
        ))
    }
}

pub(super) struct AgentStreamState {
    pub(super) last_output_time: Option<Arc<AtomicU64>>,
    pub(super) ring_buffer: SharedRingBuffer,
    pub(super) attachment_hub: Arc<PtyAttachmentHub>,
}

pub(super) struct AgentProcessRequest<'a> {
    pub(super) task_id: &'a str,
    pub(super) cwd: &'a Path,
    pub(super) cols: u16,
    pub(super) rows: u16,
    pub(super) terminal_image_protocol: Option<TerminalImageProtocol>,
    pub(super) app_event_tx: Option<AppEventSender>,
}

struct AgentEventStreamRequest<'a> {
    task_id: &'a str,
    token: AgentSpawnToken,
    instance_id: u64,
    reader: Box<dyn Read + Send>,
    shadow_feeder: Option<ShadowTerminalFeeder>,
    stream_state: AgentStreamState,
    lifecycle_lock: LifecycleLockLease,
    pid_file: PathBuf,
    event_sink: PtyEventSink,
}

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

    async fn is_current_agent_session(&self, task_id: &str, instance_id: u64) -> bool {
        let sessions = self.sessions.lock().await;
        sessions
            .get(task_id)
            .map(|session| session.instance_id == instance_id)
            .unwrap_or(false)
    }

    async fn is_current_agent_spawn_and_session(
        &self,
        task_id: &str,
        generation: u64,
        instance_id: u64,
    ) -> bool {
        self.is_current_spawn(task_id, generation).await
            && self.is_current_agent_session(task_id, instance_id).await
    }

    pub(super) async fn begin_agent_spawn(
        &self,
        task_id: &str,
        label: &'static str,
    ) -> (AgentSpawnToken, LifecycleLockLease) {
        let token = AgentSpawnToken {
            generation: NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed),
            label,
        };
        self.agent_spawn_generations
            .lock()
            .await
            .insert(task_id.to_string(), token.generation);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        (token, lifecycle_lock)
    }

    async fn replace_existing_agent_session(
        &self,
        task_id: &str,
        label: &str,
    ) -> Result<(), PtyError> {
        let Some(mut old_session) = self.sessions.lock().await.remove(task_id) else {
            return Ok(());
        };

        info!(
            "[PTY] Replacing existing {} PTY for task {}",
            label, task_id
        );
        if let Err(error) = self
            .terminate_session_process(task_id, &mut old_session)
            .await
        {
            self.sessions
                .lock()
                .await
                .insert(task_id.to_string(), old_session);
            return Err(error);
        }
        self.clear_session_tracking(task_id).await;
        Ok(())
    }

    pub(super) fn create_agent_process<A: AgentPtyProviderAdapter>(
        &self,
        adapter: &A,
        request: AgentProcessRequest<'_>,
    ) -> Result<SpawnedPty, PtyError> {
        info!(
            "Spawning {} PTY for task {} ({}x{})",
            adapter.label(),
            request.task_id,
            request.cols,
            request.rows
        );

        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let mut command = CommandBuilder::new(adapter.command_name());
        for arg in adapter.command_args() {
            command.arg(arg);
        }
        Self::configure_pty_command(&mut command, request.cwd, request.terminal_image_protocol);
        for (key, value) in adapter.extra_env(request.task_id, instance_id) {
            command.env(key, value);
        }

        let spawned = self.create_pty_process(PtyProcessRequest {
            command,
            session_key: request.task_id.to_string(),
            cols: request.cols,
            rows: request.rows,
            instance_id,
            description: format!("{} PTY for task {}", adapter.label(), request.task_id),
            pid_file_name: adapter.pid_file_name(request.task_id),
            kind: PtySessionKind::Agent,
            app_event_tx: request.app_event_tx,
        })?;
        info!(
            "{} PTY for task {} started (PID: {})",
            adapter.label(),
            request.task_id,
            spawned.managed_process().root_pid
        );
        Ok(spawned)
    }

    async fn require_current_agent_spawn_and_session(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
        instance_id: u64,
        stage: &str,
    ) -> Result<(), PtyError> {
        if self
            .is_current_agent_spawn_and_session(task_id, token.generation, instance_id)
            .await
        {
            Ok(())
        } else {
            Err(token.stale_error(task_id, stage))
        }
    }

    async fn remove_agent_last_output_if_registered(
        &self,
        task_id: &str,
        registered_last_output: Option<&Arc<AtomicU64>>,
    ) {
        let Some(registered_last_output) = registered_last_output else {
            return;
        };

        let mut times = self.last_output.lock().await;
        if times
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_last_output))
        {
            times.remove(task_id);
        }
    }

    async fn register_agent_last_output_tracking(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
        instance_id: u64,
        enabled: bool,
    ) -> Result<Option<Arc<AtomicU64>>, PtyError> {
        let last_output_time = enabled.then(|| Arc::new(AtomicU64::new(0)));
        if let Some(last_output_time) = &last_output_time {
            self.last_output
                .lock()
                .await
                .insert(task_id.to_string(), Arc::clone(last_output_time));
        }

        if let Err(error) = self
            .require_current_agent_spawn_and_session(
                task_id,
                token,
                instance_id,
                "before output tracking completed",
            )
            .await
        {
            self.remove_agent_last_output_if_registered(task_id, last_output_time.as_ref())
                .await;
            return Err(error);
        }

        Ok(last_output_time)
    }

    pub(super) async fn register_agent_stream_state(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
        instance_id: u64,
        last_output_time: Option<Arc<AtomicU64>>,
    ) -> Result<AgentStreamState, PtyError> {
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        self.output_buffers
            .lock()
            .await
            .insert(task_id.to_string(), Arc::clone(&ring_buffer));

        let attachment_hub = Arc::new(PtyAttachmentHub::new(
            instance_id,
            CLAUDE_BUFFER_CAPACITY,
            COMPANION_ATTACHMENT_EVENT_CAPACITY,
        ));
        self.attachment_hubs
            .lock()
            .await
            .insert(task_id.to_string(), Arc::clone(&attachment_hub));

        if let Err(error) = self
            .require_current_agent_spawn_and_session(
                task_id,
                token,
                instance_id,
                "before output buffer registration completed",
            )
            .await
        {
            self.remove_agent_last_output_if_registered(task_id, last_output_time.as_ref())
                .await;
            self.remove_output_buffer_if_registered(task_id, &ring_buffer)
                .await;
            self.remove_attachment_hub_if_registered(task_id, &attachment_hub)
                .await;
            return Err(error);
        }

        Ok(AgentStreamState {
            last_output_time,
            ring_buffer,
            attachment_hub,
        })
    }

    #[cfg(test)]
    fn pause_before_agent_event_stream_start(&self) {
        let gate = self
            .agent_event_stream_start_gate
            .lock()
            .expect("event stream start gate lock should not be poisoned")
            .take();
        if let Some(gate) = gate {
            gate.reached_tx
                .send(())
                .expect("test should observe event stream startup");
            gate.release_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("test should release event stream startup");
        }
    }

    pub(super) async fn remove_agent_stream_state_if_registered(
        &self,
        task_id: &str,
        stream_state: &AgentStreamState,
    ) {
        self.remove_agent_last_output_if_registered(
            task_id,
            stream_state.last_output_time.as_ref(),
        )
        .await;
        self.remove_output_buffer_if_registered(task_id, &stream_state.ring_buffer)
            .await;
        self.remove_attachment_hub_if_registered(task_id, &stream_state.attachment_hub)
            .await;
    }

    async fn start_agent_event_stream(
        &self,
        request: AgentEventStreamRequest<'_>,
    ) -> Result<(), PtyError> {
        let AgentEventStreamRequest {
            task_id,
            token,
            instance_id,
            reader,
            shadow_feeder,
            stream_state,
            lifecycle_lock,
            pid_file,
            event_sink,
        } = request;
        if let Err(error) = self
            .require_current_agent_spawn_and_session(
                task_id,
                token,
                instance_id,
                "before event streaming started",
            )
            .await
        {
            self.remove_agent_stream_state_if_registered(task_id, &stream_state)
                .await;
            return Err(error);
        }

        let rx = spawn_pty_output_reader(
            reader,
            task_id.to_string(),
            stream_state.last_output_time.as_ref().map(Arc::clone),
            Some(Arc::clone(&stream_state.attachment_hub)),
            shadow_feeder,
        );
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle: event_sink.app_handle,
                app_event_tx: event_sink.app_event_tx,
                ring_buffer: stream_state.ring_buffer,
                attachment_hub: Some(stream_state.attachment_hub),
                attachment_hubs: Some(Arc::clone(&self.attachment_hubs)),
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    lifecycle_lock,
                    pid_file,
                    emit_agent_exit: true,
                },
            },
        );
        Ok(())
    }

    pub(super) async fn finish_agent_spawn(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
    ) -> Result<(), PtyError> {
        let mut generations = self.agent_spawn_generations.lock().await;
        if generations.get(task_id) == Some(&token.generation) {
            generations.remove(task_id);
            Ok(())
        } else {
            Err(token.stale_error(task_id, "before setup finished"))
        }
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
                app_event_tx: app_event_tx.clone(),
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
