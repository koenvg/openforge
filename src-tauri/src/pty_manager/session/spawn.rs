use crate::app_events::AppEventSender;
use crate::user_environment::user_environment;
use log::info;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::super::attachment::{PtyAttachmentHub, COMPANION_ATTACHMENT_EVENT_CAPACITY};
use super::super::commands::{get_shell_path, PiSessionTarget};
use super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use super::super::pids::{
    pid_file_name_for_session_key, shell_session_key, write_managed_process_identity,
};
use super::super::{
    terminal_environment, PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol,
};
use super::invalid_workspace_cwd;
use super::lifecycle::{LifecycleLockLease, PtySession, PtySessionKind, NEXT_INSTANCE_ID};
use super::provider_adapter::{
    AgentPtyProviderAdapter, ClaudeCodePtyAdapter, CodexPtyAdapter, GrokPtyAdapter,
    OpenCodePtyAdapter, PiPtyAdapter,
};

struct PendingShellSpawn {
    pending: Arc<dashmap::DashMap<String, (String, u64)>>,
    session_key: String,
    generation: u64,
}

impl PendingShellSpawn {
    fn register(manager: &PtyManager, session_key: &str, task_id: &str, generation: u64) -> Self {
        manager
            .pending_shell_spawns
            .insert(session_key.to_string(), (task_id.to_string(), generation));
        Self {
            pending: Arc::clone(&manager.pending_shell_spawns),
            session_key: session_key.to_string(),
            generation,
        }
    }
}

impl Drop for PendingShellSpawn {
    fn drop(&mut self) {
        self.pending
            .remove_if(&self.session_key, |_, value| value.1 == self.generation);
    }
}

fn require_root_pid_or_cleanup<F>(
    root_pid: Option<u32>,
    description: &str,
    emergency_cleanup: F,
) -> Result<u32, PtyError>
where
    F: FnOnce() -> io::Result<()>,
{
    if let Some(root_pid) = root_pid {
        return Ok(root_pid);
    }

    let cleanup_error = emergency_cleanup().err();
    let cleanup_context = cleanup_error
        .map(|error| format!("; emergency child cleanup failed: {error}"))
        .unwrap_or_default();
    Err(PtyError::SpawnFailed(format!(
        "{description} did not expose a root PID{cleanup_context}"
    )))
}
static NEXT_SPAWN_GENERATION: AtomicU64 = AtomicU64::new(1);

fn resolve_pty_cwd(cwd: &Path) -> Result<PathBuf, PtyError> {
    let resolved_cwd = std::fs::canonicalize(cwd).map_err(|e| invalid_workspace_cwd(cwd, e))?;

    let metadata = std::fs::metadata(&resolved_cwd).map_err(|e| invalid_workspace_cwd(cwd, e))?;

    if !metadata.is_dir() {
        return Err(invalid_workspace_cwd(cwd, "not a directory"));
    }

    Ok(resolved_cwd)
}

#[derive(Clone, Copy)]
struct AgentSpawnToken {
    generation: u64,
    label: &'static str,
}

impl AgentSpawnToken {
    fn stale_error(&self, task_id: &str, stage: &str) -> PtyError {
        PtyError::SpawnFailed(format!(
            "{} PTY for task {} was replaced {stage}",
            self.label, task_id
        ))
    }
}

struct SpawnedPty {
    reader: Box<dyn Read + Send>,
    session: PtySession,
    pid_file: PathBuf,
}

impl SpawnedPty {
    fn instance_id(&self) -> u64 {
        self.session.instance_id
    }

    fn managed_process(&self) -> &ManagedProcessIdentity {
        &self.session.managed_process
    }
}

struct PtyProcessRequest {
    command: CommandBuilder,
    cols: u16,
    rows: u16,
    instance_id: u64,
    description: String,
    pid_file_name: String,
    kind: PtySessionKind,
}

struct SessionRegistrationRequest<'a> {
    session_key: &'a str,
    generation: u64,
    session: PtySession,
    replacement_label: &'a str,
    stale_error: PtyError,
}

struct AgentStreamState {
    last_output_time: Option<Arc<AtomicU64>>,
    ring_buffer: SharedRingBuffer,
    attachment_hub: Arc<PtyAttachmentHub>,
}

struct AgentProcessRequest<'a> {
    task_id: &'a str,
    cwd: &'a Path,
    cols: u16,
    rows: u16,
    terminal_image_protocol: Option<TerminalImageProtocol>,
}

struct ShellProcessRequest<'a> {
    task_id: &'a str,
    session_key: &'a str,
    cwd: &'a Path,
    cols: u16,
    rows: u16,
    terminal_image_protocol: Option<TerminalImageProtocol>,
    command: CommandBuilder,
}

struct PtyEventSink {
    app_handle: Option<crate::backend_runtime::AppHandle>,
    app_event_tx: Option<AppEventSender>,
}

struct AgentEventStreamRequest<'a> {
    task_id: &'a str,
    token: AgentSpawnToken,
    instance_id: u64,
    reader: Box<dyn Read + Send>,
    stream_state: AgentStreamState,
    lifecycle_lock: LifecycleLockLease,
    pid_file: PathBuf,
    event_sink: PtyEventSink,
}

struct ShellSpawnToken {
    session_key: String,
    generation: u64,
}

impl ShellSpawnToken {
    fn stale_error(&self, task_id: &str, stage: &str) -> PtyError {
        PtyError::SpawnFailed(format!("shell PTY for task {task_id} was {stage}"))
    }
}

struct ShellStreamState {
    last_output_time: Arc<AtomicU64>,
    ring_buffer: SharedRingBuffer,
}

struct ShellEventStreamRequest {
    session_key: String,
    instance_id: u64,
    reader: Box<dyn Read + Send>,
    stream_state: ShellStreamState,
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

    async fn is_current_spawn(&self, session_key: &str, generation: u64) -> bool {
        let generations = self.agent_spawn_generations.lock().await;
        generations
            .get(session_key)
            .map(|current| *current == generation)
            .unwrap_or(false)
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

    async fn begin_agent_spawn(
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

    fn configure_pty_command(
        command: &mut CommandBuilder,
        cwd: &Path,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) {
        command.cwd(cwd);
        for (key, value) in user_environment() {
            command.env(key, value);
        }
        command.env("PWD", cwd.to_string_lossy().to_string());
        for (key, value) in terminal_environment(terminal_image_protocol) {
            command.env(key, value);
        }
    }

    fn create_pty_process(&self, request: PtyProcessRequest) -> Result<SpawnedPty, PtyError> {
        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(&request.pid_file_name);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| {
                PtyError::SpawnFailed(format!("Failed to create PTY pair: {error}"))
            })?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::SpawnFailed(format!("Failed to clone reader: {error}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::SpawnFailed(format!("Failed to take writer: {error}")))?;

        let mut child = pair
            .slave
            .spawn_command(request.command)
            .map_err(|error| PtyError::SpawnFailed(format!("Failed to spawn command: {error}")))?;
        drop(pair.slave);

        let pid = require_root_pid_or_cleanup(child.process_id(), &request.description, || {
            let cleanup_result = child.kill();
            let _ = child.try_wait();
            cleanup_result
        })?;
        let managed_process = ManagedProcessIdentity::capture(pid).map_err(|error| {
            force_kill_unverified_spawn(pid);
            let _ = child.try_wait();
            PtyError::SpawnFailed(format!(
                "Failed to capture managed process identity for {}: {error}",
                request.description
            ))
        })?;

        Ok(SpawnedPty {
            reader,
            session: PtySession {
                child,
                master: pair.master,
                writer,
                instance_id: request.instance_id,
                kind: request.kind,
                pid_file_name: request.pid_file_name,
                managed_process,
            },
            pid_file,
        })
    }

    fn create_agent_process<A: AgentPtyProviderAdapter>(
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
            cols: request.cols,
            rows: request.rows,
            instance_id,
            description: format!("{} PTY for task {}", adapter.label(), request.task_id),
            pid_file_name: adapter.pid_file_name(request.task_id),
            kind: PtySessionKind::Agent,
        })?;
        info!(
            "{} PTY for task {} started (PID: {})",
            adapter.label(),
            request.task_id,
            spawned.managed_process().root_pid
        );
        Ok(spawned)
    }

    async fn register_spawned_session(
        &self,
        request: SessionRegistrationRequest<'_>,
    ) -> Result<(), PtyError> {
        let SessionRegistrationRequest {
            session_key,
            generation,
            session,
            replacement_label,
            stale_error,
        } = request;
        let mut pending_session = Some(session);
        let replaced_session = {
            let generations = self.agent_spawn_generations.lock().await;
            let registration_is_stale = generations
                .get(session_key)
                .map(|current| *current != generation)
                .unwrap_or(true);
            if registration_is_stale {
                None
            } else {
                self.sessions.lock().await.insert(
                    session_key.to_string(),
                    pending_session.take().expect("pending PTY session"),
                )
            }
        };

        if let Some(stale_session) = pending_session {
            self.terminate_or_retain_unregistered_session(session_key, stale_session)
                .await?;
            return Err(stale_error);
        }

        if let Some(mut replaced_session) = replaced_session {
            info!("[PTY] Replacing existing {replacement_label} PTY for session {session_key}");
            self.terminate_session_process(session_key, &mut replaced_session)
                .await?;
            self.clear_session_tracking(session_key).await;
        }
        Ok(())
    }

    async fn persist_session_identity(
        &self,
        session_key: &str,
        pid_file: &Path,
        managed_process: &ManagedProcessIdentity,
    ) -> Result<(), PtyError> {
        if let Err(error) = write_managed_process_identity(pid_file, managed_process) {
            if let Some(failed_session) = self.sessions.lock().await.remove(session_key) {
                self.terminate_or_retain_unregistered_session(session_key, failed_session)
                    .await?;
            }
            self.clear_session_tracking(session_key).await;
            return Err(error);
        }
        Ok(())
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
            if let Some(last_output_time) = &last_output_time {
                let mut times = self.last_output.lock().await;
                if times
                    .get(task_id)
                    .is_some_and(|stored| Arc::ptr_eq(stored, last_output_time))
                {
                    times.remove(task_id);
                }
            }
            return Err(error);
        }

        Ok(last_output_time)
    }

    async fn register_agent_stream_state(
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
            if let Some(stale_last_output) = &last_output_time {
                let mut times = self.last_output.lock().await;
                if times
                    .get(task_id)
                    .is_some_and(|stored| Arc::ptr_eq(stored, stale_last_output))
                {
                    times.remove(task_id);
                }
            }
            let mut buffers = self.output_buffers.lock().await;
            if buffers
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &ring_buffer))
            {
                buffers.remove(task_id);
            }
            let mut hubs = self.attachment_hubs.lock().await;
            if hubs
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &attachment_hub))
            {
                hubs.remove(task_id);
            }
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

    async fn remove_agent_stream_state_if_registered(
        &self,
        task_id: &str,
        stream_state: &AgentStreamState,
    ) {
        if let Some(stale_last_output) = &stream_state.last_output_time {
            let mut times = self.last_output.lock().await;
            if times
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, stale_last_output))
            {
                times.remove(task_id);
            }
        }
        {
            let mut buffers = self.output_buffers.lock().await;
            if buffers
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &stream_state.ring_buffer))
            {
                buffers.remove(task_id);
            }
        }
        {
            let mut hubs = self.attachment_hubs.lock().await;
            if hubs
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &stream_state.attachment_hub))
            {
                hubs.remove(task_id);
            }
        }
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

    async fn finish_agent_spawn(
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

    async fn spawn_agent_pty<A: AgentPtyProviderAdapter>(
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

    async fn begin_shell_spawn(
        &self,
        session_key: &str,
        task_id: &str,
    ) -> (ShellSpawnToken, PendingShellSpawn, LifecycleLockLease) {
        let token = ShellSpawnToken {
            session_key: session_key.to_string(),
            generation: NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed),
        };
        let pending_spawn = {
            let mut generations = self.agent_spawn_generations.lock().await;
            let pending_spawn =
                PendingShellSpawn::register(self, session_key, task_id, token.generation);
            generations.insert(token.session_key.clone(), token.generation);
            pending_spawn
        };
        let lifecycle_lock = self.lifecycle_lock_for(session_key).await;
        (token, pending_spawn, lifecycle_lock)
    }

    async fn replace_existing_shell_session(
        &self,
        session_key: &str,
        task_id: &str,
    ) -> Result<(), PtyError> {
        let Some(mut old_session) = self.sessions.lock().await.remove(session_key) else {
            return Ok(());
        };

        info!("[PTY] Replacing existing shell PTY for task {task_id}");
        if let Err(error) = self
            .terminate_session_process(session_key, &mut old_session)
            .await
        {
            self.sessions
                .lock()
                .await
                .insert(session_key.to_string(), old_session);
            return Err(error);
        }
        self.clear_session_tracking(session_key).await;
        Ok(())
    }

    fn create_shell_process(
        &self,
        request: ShellProcessRequest<'_>,
    ) -> Result<SpawnedPty, PtyError> {
        let ShellProcessRequest {
            task_id,
            session_key,
            cwd,
            cols,
            rows,
            terminal_image_protocol,
            mut command,
        } = request;
        info!("Spawning shell PTY for task {task_id} ({cols}x{rows})");
        Self::configure_pty_command(&mut command, cwd, terminal_image_protocol);
        let spawned = self.create_pty_process(PtyProcessRequest {
            command,
            cols,
            rows,
            instance_id: NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed),
            description: format!("Shell PTY for task {task_id}"),
            pid_file_name: pid_file_name_for_session_key(session_key),
            kind: PtySessionKind::Shell {
                task_id: task_id.to_string(),
            },
        })?;
        info!(
            "Shell PTY for task {} started (PID: {})",
            task_id,
            spawned.managed_process().root_pid
        );
        Ok(spawned)
    }

    async fn register_shell_stream_state(&self, session_key: &str) -> ShellStreamState {
        let last_output_time = Arc::new(AtomicU64::new(0));
        self.last_output
            .lock()
            .await
            .insert(session_key.to_string(), Arc::clone(&last_output_time));
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        self.output_buffers
            .lock()
            .await
            .insert(session_key.to_string(), Arc::clone(&ring_buffer));
        ShellStreamState {
            last_output_time,
            ring_buffer,
        }
    }

    fn start_shell_event_stream(&self, request: ShellEventStreamRequest) {
        let ShellEventStreamRequest {
            session_key,
            instance_id,
            reader,
            stream_state,
            lifecycle_lock,
            pid_file,
            event_sink,
        } = request;
        let rx = spawn_pty_output_reader(
            reader,
            session_key.clone(),
            Some(Arc::clone(&stream_state.last_output_time)),
            None,
        );
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key,
                instance_id,
                app_handle: event_sink.app_handle,
                app_event_tx: event_sink.app_event_tx,
                ring_buffer: stream_state.ring_buffer,
                attachment_hub: None,
                attachment_hubs: None,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    lifecycle_lock,
                    pid_file,
                    emit_agent_exit: false,
                },
            },
        );
    }

    async fn finish_shell_spawn(&self, token: &ShellSpawnToken) {
        let mut generations = self.agent_spawn_generations.lock().await;
        if generations.get(&token.session_key) == Some(&token.generation) {
            generations.remove(&token.session_key);
        }
    }

    pub(crate) async fn spawn_shell_pty(
        &self,
        context: PtySpawnContext<'_>,
        terminal_index: Option<u32>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        self.spawn_shell_pty_with_command(
            context,
            terminal_index,
            terminal_image_protocol,
            CommandBuilder::new(get_shell_path()),
        )
        .await
    }

    async fn spawn_shell_pty_with_command(
        &self,
        context: PtySpawnContext<'_>,
        terminal_index: Option<u32>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
        command: CommandBuilder,
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
        let session_key = shell_session_key(task_id, terminal_index);
        let (token, _pending_spawn, lifecycle_lock) =
            self.begin_shell_spawn(&session_key, task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        if !self
            .is_current_spawn(&token.session_key, token.generation)
            .await
        {
            return Err(token.stale_error(task_id, "cancelled before spawn"));
        }

        self.replace_existing_shell_session(&session_key, task_id)
            .await?;
        let spawned = self.create_shell_process(ShellProcessRequest {
            task_id,
            session_key: &session_key,
            cwd: &resolved_cwd,
            cols,
            rows,
            terminal_image_protocol,
            command,
        })?;
        let instance_id = spawned.instance_id();
        let managed_process = spawned.managed_process().clone();
        let SpawnedPty {
            reader,
            session,
            pid_file,
        } = spawned;

        self.register_spawned_session(SessionRegistrationRequest {
            session_key: &session_key,
            generation: token.generation,
            session,
            replacement_label: "shell",
            stale_error: token.stale_error(task_id, "replaced before registration"),
        })
        .await?;
        self.persist_session_identity(&session_key, &pid_file, &managed_process)
            .await?;

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let stream_state = self.register_shell_stream_state(&session_key).await;
        self.start_shell_event_stream(ShellEventStreamRequest {
            session_key,
            instance_id,
            reader,
            stream_state,
            lifecycle_lock: lifecycle_lock.clone(),
            pid_file,
            event_sink: PtyEventSink {
                app_handle,
                app_event_tx,
            },
        });
        self.finish_shell_spawn(&token).await;
        Ok(instance_id)
    }
}

#[cfg(test)]
struct CompanionTestAgentAdapter {
    script: String,
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use super::super::lifecycle::PtySessions;
    use super::*;
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;

    fn long_running_shell_command() -> CommandBuilder {
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("exec sleep 30");
        command
    }

    struct LockCheckingAgentAdapter {
        sessions: PtySessions,
        prepared_tx: Option<mpsc::Sender<()>>,
        command_delay: Duration,
        script: &'static str,
        check_lock: bool,
    }

    impl LockCheckingAgentAdapter {
        fn assert_sessions_unlocked(&self, phase: &str) {
            if self.check_lock {
                assert!(
                    self.sessions.try_lock().is_ok(),
                    "sessions mutex should not be held during {phase}"
                );
            }
        }
    }

    impl AgentPtyProviderAdapter for LockCheckingAgentAdapter {
        fn label(&self) -> &'static str {
            "LockChecking"
        }

        fn command_name(&self) -> &'static str {
            "/bin/sh"
        }

        fn command_args(&self) -> Vec<String> {
            self.assert_sessions_unlocked("command argument construction");
            if !self.command_delay.is_zero() {
                std::thread::sleep(self.command_delay);
            }
            // Keep test PTYs single-process so cleanup never waits on an orphan reaper.
            vec!["-lc".to_string(), format!("{}; exec sleep 5", self.script)]
        }

        fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
            self.assert_sessions_unlocked("provider preparation");
            if let Some(prepared_tx) = self.prepared_tx.take() {
                let _ = prepared_tx.send(());
            }
            Ok(())
        }

        fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
            self.assert_sessions_unlocked("provider environment construction");
            HashMap::new()
        }

        fn pid_file_name(&self, task_id: &str) -> String {
            format!("{}-pty.pid", task_id)
        }

        fn track_last_output(&self) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn agent_spawn_arbitration_keeps_the_newest_generation_current() {
        let manager = PtyManager::new();
        let task_id = "stage-arbitration";
        let (older, older_lock) = manager.begin_agent_spawn(task_id, "Test").await;
        let (newer, newer_lock) = manager.begin_agent_spawn(task_id, "Test").await;

        assert!(manager.finish_agent_spawn(task_id, older).await.is_err());
        assert_eq!(
            manager.agent_spawn_generations.lock().await.get(task_id),
            Some(&newer.generation)
        );

        manager
            .finish_agent_spawn(task_id, newer)
            .await
            .expect("newest generation should complete arbitration");
        assert!(!manager
            .agent_spawn_generations
            .lock()
            .await
            .contains_key(task_id));

        drop(older_lock);
        drop(newer_lock);
    }

    #[tokio::test]
    async fn stale_agent_stream_registration_removes_its_last_output_tracking() {
        let manager = PtyManager::new();
        let task_id = "stale-stream-registration";
        let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
        let _ = manager.begin_agent_spawn(task_id, "Newer").await;
        let stale_last_output = Arc::new(AtomicU64::new(0));
        manager
            .last_output
            .lock()
            .await
            .insert(task_id.to_string(), Arc::clone(&stale_last_output));

        let result = manager
            .register_agent_stream_state(task_id, stale_token, 1, Some(stale_last_output))
            .await;

        assert!(result.is_err());
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "superseded stream registration should remove its last-output tracking"
        );
    }

    #[tokio::test]
    async fn stale_agent_stream_registration_preserves_newer_last_output_tracking() {
        let manager = PtyManager::new();
        let task_id = "newer-stream-registration";
        let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
        let _ = manager.begin_agent_spawn(task_id, "Newer").await;
        let newer_last_output = Arc::new(AtomicU64::new(0));
        manager
            .last_output
            .lock()
            .await
            .insert(task_id.to_string(), Arc::clone(&newer_last_output));

        let result = manager
            .register_agent_stream_state(task_id, stale_token, 1, Some(Arc::new(AtomicU64::new(0))))
            .await;

        assert!(result.is_err());
        assert!(
            manager
                .last_output
                .lock()
                .await
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &newer_last_output)),
            "superseded stream registration should preserve newer last-output tracking"
        );
    }

    #[tokio::test]
    async fn stale_agent_session_registration_reaps_the_unpublished_process() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "stale-registration-stage";
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            script: "printf stale-registration",
            check_lock: false,
        };
        let (stale_token, lifecycle_lock) =
            manager.begin_agent_spawn(task_id, adapter.label()).await;
        let lifecycle_guard = lifecycle_lock.lock().await;
        let spawned = manager
            .create_agent_process(
                &adapter,
                AgentProcessRequest {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    terminal_image_protocol: None,
                },
            )
            .expect("process creation stage should succeed");
        let SpawnedPty {
            reader,
            session,
            pid_file,
        } = spawned;
        let (current_token, current_lock) =
            manager.begin_agent_spawn(task_id, adapter.label()).await;

        let result = manager
            .register_spawned_session(SessionRegistrationRequest {
                session_key: task_id,
                generation: stale_token.generation,
                session,
                replacement_label: stale_token.label,
                stale_error: stale_token
                    .stale_error(task_id, "before session registration completed"),
            })
            .await;

        assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
        assert!(!manager.sessions.lock().await.contains_key(task_id));
        assert!(!pid_file.exists());
        assert_eq!(
            manager.agent_spawn_generations.lock().await.get(task_id),
            Some(&current_token.generation)
        );

        drop(reader);
        manager
            .finish_agent_spawn(task_id, current_token)
            .await
            .expect("newest generation should remain completable");
        drop(lifecycle_guard);
        drop(lifecycle_lock);
        drop(current_lock);
    }

    #[tokio::test]
    async fn agent_spawn_keeps_session_mutex_out_of_provider_and_command_work() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "lock-free-agent-spawn";
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            script: "printf lock-free-agent",
            check_lock: true,
        };

        manager
            .spawn_agent_pty(
                adapter,
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await
            .expect("agent PTY should spawn without holding sessions lock during slow setup");

        assert!(
            tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "PID file should still be written after spawn"
        );
        assert!(
            manager.output_buffers.lock().await.contains_key(task_id),
            "output buffer should still be registered for replay"
        );
        assert!(
            manager.last_output.lock().await.contains_key(task_id),
            "last-output tracking should still be registered for frozen detection"
        );

        manager
            .kill_pty(task_id)
            .await
            .expect("test PTY should be cleaned up");
        assert!(
            !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "PID file should be removed on cleanup"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(task_id),
            "output buffer should be removed on explicit kill"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "last-output tracking should be removed on explicit kill"
        );
    }

    #[tokio::test]
    async fn agent_attachment_exposes_bounded_replay_then_gap_free_live_output() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "companion-agent-attachment";
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            script: "stty -echo; IFS= read -r _; printf before; IFS= read -r _; printf after",
            check_lock: true,
        };
        manager
            .spawn_agent_pty(
                adapter,
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await
            .expect("agent PTY");

        let event_timeout = Duration::from_secs(5);
        let mut before_replay = manager
            .attach_agent_terminal(task_id)
            .await
            .expect("running Agent attachment");
        assert!(before_replay.replay().is_empty());
        before_replay
            .write_input(b"\n")
            .await
            .expect("release replay output");
        assert_eq!(
            tokio::time::timeout(event_timeout, before_replay.recv())
                .await
                .expect("replay output deadline")
                .expect("replay output"),
            crate::pty_manager::AgentTerminalEvent::Output(b"before".to_vec()),
        );

        let mut attachment = manager
            .attach_agent_terminal(task_id)
            .await
            .expect("running Agent attachment");
        assert_eq!(attachment.replay(), b"before");
        drop(before_replay);
        assert!(manager.agent_terminal_available(task_id).await);
        attachment
            .write_input(b"\n")
            .await
            .expect("release live output");
        assert_eq!(
            tokio::time::timeout(event_timeout, attachment.recv())
                .await
                .expect("live output deadline")
                .expect("live output"),
            crate::pty_manager::AgentTerminalEvent::Output(b"after".to_vec()),
        );

        manager.kill_pty(task_id).await.expect("PTY cleanup");
        assert_eq!(
            tokio::time::timeout(event_timeout, attachment.recv())
                .await
                .expect("exit deadline")
                .expect("exit event"),
            crate::pty_manager::AgentTerminalEvent::Exited,
        );
        assert!(!manager.agent_terminal_available(task_id).await);
    }

    #[tokio::test]
    async fn unresolved_recovery_metadata_blocks_spawn_without_clobbering_record() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "recovery-conflict-agent";
        let pid_file = tmp_dir.path().join(format!("{task_id}-pty.pid"));
        let unresolved_identity = ManagedProcessIdentity {
            version: 1,
            root_pid: 999_991,
            process_group_id: 999_991,
            session_id: 999_991,
            root_start_time: 42,
        };
        write_managed_process_identity(&pid_file, &unresolved_identity)
            .expect("unresolved identity should persist");
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            script: "printf blocked-agent",
            check_lock: false,
        };

        let result = manager
            .spawn_agent_pty(
                adapter,
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await;

        assert!(
            matches!(result, Err(PtyError::CleanupFailed(ref message)) if message.contains("existing recovery metadata was preserved"))
        );
        let persisted: ManagedProcessIdentity = serde_json::from_str(
            &std::fs::read_to_string(&pid_file).expect("recovery metadata should remain"),
        )
        .expect("recovery metadata should still parse");
        assert_eq!(persisted, unresolved_identity);
        assert!(!manager.sessions.lock().await.contains_key(task_id));
    }

    #[tokio::test]
    async fn shell_spawn_persists_identity_and_owns_lifecycle_state_until_cleanup() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_dir = tmp_dir.path().join("pids");
        manager.set_pid_dir(pid_dir.clone());
        let task_id = "shell-lifecycle";
        let session_key = shell_session_key(task_id, Some(2));
        let pid_file = pid_dir.join(format!("{session_key}.pid"));

        let instance_id = manager
            .spawn_shell_pty_with_command(
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                Some(2),
                None,
                long_running_shell_command(),
            )
            .await
            .expect("shell PTY should spawn");

        let expected_identity = {
            let sessions = manager.sessions.lock().await;
            let session = sessions
                .get(&session_key)
                .expect("spawned shell should be registered");
            assert_eq!(session.instance_id, instance_id);
            assert!(matches!(
                &session.kind,
                PtySessionKind::Shell { task_id: stored_task_id } if stored_task_id == task_id
            ));
            session.managed_process.clone()
        };
        let persisted_identity: ManagedProcessIdentity = serde_json::from_str(
            &std::fs::read_to_string(&pid_file).expect("shell identity should be persisted"),
        )
        .expect("shell identity should parse");
        assert_eq!(persisted_identity, expected_identity);
        assert!(manager
            .output_buffers
            .lock()
            .await
            .contains_key(&session_key));
        assert!(manager.last_output.lock().await.contains_key(&session_key));
        assert!(manager.lifecycle_locks.contains_key(&session_key));
        assert!(!manager
            .agent_spawn_generations
            .lock()
            .await
            .contains_key(&session_key));
        assert!(!manager.pending_shell_spawns.contains_key(&session_key));

        manager
            .kill_pty(&session_key)
            .await
            .expect("shell cleanup should succeed");
        assert!(!pid_file.exists());
        assert!(!manager
            .output_buffers
            .lock()
            .await
            .contains_key(&session_key));
        assert!(!manager.last_output.lock().await.contains_key(&session_key));
        tokio::time::timeout(Duration::from_secs(1), async {
            while manager.lifecycle_locks.contains_key(&session_key) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("shell teardown should release its lifecycle lock");
    }

    #[tokio::test]
    async fn unresolved_shell_recovery_metadata_blocks_spawn_without_clobbering_record() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_dir = tmp_dir.path().join("pids");
        manager.set_pid_dir(pid_dir.clone());
        let task_id = "recovery-conflict-shell";
        let session_key = shell_session_key(task_id, Some(0));
        let pid_file = pid_dir.join(format!("{session_key}.pid"));
        std::fs::create_dir_all(&pid_dir).expect("PID directory should be created");
        let unresolved_identity = ManagedProcessIdentity {
            version: 1,
            root_pid: 999_991,
            process_group_id: 999_991,
            session_id: 999_991,
            root_start_time: 42,
        };
        write_managed_process_identity(&pid_file, &unresolved_identity)
            .expect("unresolved identity should persist");

        let result = manager
            .spawn_shell_pty_with_command(
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                Some(0),
                None,
                long_running_shell_command(),
            )
            .await;

        assert!(
            matches!(result, Err(PtyError::CleanupFailed(ref message)) if message.contains("existing recovery metadata was preserved"))
        );
        let persisted: ManagedProcessIdentity = serde_json::from_str(
            &std::fs::read_to_string(&pid_file).expect("recovery metadata should remain"),
        )
        .expect("recovery metadata should still parse");
        assert_eq!(persisted, unresolved_identity);
        assert!(!manager.sessions.lock().await.contains_key(&session_key));
        assert!(!manager
            .output_buffers
            .lock()
            .await
            .contains_key(&session_key));
        assert!(!manager.last_output.lock().await.contains_key(&session_key));
    }

    #[test]
    fn missing_root_pid_runs_emergency_child_cleanup() {
        let cleanup_called = std::cell::Cell::new(false);

        let result = require_root_pid_or_cleanup(None, "Shell PTY for task T-1", || {
            cleanup_called.set(true);
            Ok(())
        });

        assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
        assert!(
            cleanup_called.get(),
            "a spawned child without a PID must still receive emergency cleanup"
        );
    }

    #[tokio::test]
    async fn failed_unregistered_shell_cleanup_persists_recovery_metadata() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_dir = tmp_dir.path().join("pids");
        manager.set_pid_dir(pid_dir.clone());
        let session_key = "failed-shell-cleanup-shell-0";
        let instance_id = 42;

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty should succeed");
        let mut command = CommandBuilder::new(get_shell_path());
        command.arg("-lc");
        command.arg("sleep 30");
        let child = pair
            .slave
            .spawn_command(command)
            .expect("shell should spawn");
        drop(pair.slave);
        let pid = child.process_id().expect("shell PID");
        let mut mismatched_identity =
            ManagedProcessIdentity::capture(pid).expect("managed identity");
        mismatched_identity.root_start_time += 1;
        let writer = pair
            .master
            .take_writer()
            .expect("writer should be available");
        let session = PtySession {
            child,
            master: pair.master,
            writer,
            instance_id,
            kind: PtySessionKind::Shell {
                task_id: "failed-shell-cleanup".to_string(),
            },
            pid_file_name: format!("{session_key}.pid"),
            managed_process: mismatched_identity.clone(),
        };

        let result = manager
            .terminate_or_retain_unregistered_session(session_key, session)
            .await;

        assert!(matches!(result, Err(PtyError::CleanupFailed(_))));
        let recovery_key = format!("{session_key}-cleanup-{instance_id}");
        let recovery_file = pid_dir.join(format!("{recovery_key}-pty.pid"));
        let persisted: ManagedProcessIdentity = serde_json::from_str(
            &std::fs::read_to_string(&recovery_file)
                .expect("failed shell cleanup should persist recovery metadata"),
        )
        .expect("recovery metadata should parse");
        assert_eq!(persisted, mismatched_identity);
        let retained = manager
            .sessions
            .lock()
            .await
            .remove(&recovery_key)
            .expect("failed shell cleanup should retain in-memory ownership");

        let blocked_pid_dir = tmp_dir.path().join("blocked-pid-dir");
        std::fs::write(&blocked_pid_dir, "not a directory")
            .expect("blocked PID directory fixture should write");
        manager.set_pid_dir(blocked_pid_dir);
        let preservation_result = manager
            .terminate_or_retain_unregistered_session("metadata-write-failure", retained)
            .await;
        assert!(
            matches!(preservation_result, Err(PtyError::CleanupFailed(ref message)) if message.contains("recovery metadata")),
            "metadata persistence failure must be propagated"
        );

        let failed_recovery_key = format!("metadata-write-failure-cleanup-{instance_id}");
        let mut retained = manager
            .sessions
            .lock()
            .await
            .remove(&failed_recovery_key)
            .expect("ownership must remain in memory when metadata persistence fails");
        force_kill_unverified_spawn(pid);
        let _ = retained.child.kill();
        let _ = retained.child.try_wait();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn task_shell_cleanup_cancels_spawn_before_session_publication() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().join("pids"));
        let task_id = "pending-shell-cleanup";
        let session_key = shell_session_key(task_id, Some(0));
        let lifecycle_lock = manager.lifecycle_lock_for(&session_key).await;
        let lifecycle_guard = lifecycle_lock.lock().await;

        let spawn_manager = manager.clone();
        let spawn_cwd = tmp_dir.path().to_path_buf();
        let spawn_task_id = task_id.to_string();
        let spawn_task = tokio::spawn(async move {
            spawn_manager
                .spawn_shell_pty_with_command(
                    PtySpawnContext {
                        task_id: &spawn_task_id,
                        cwd: &spawn_cwd,
                        cols: 80,
                        rows: 24,
                        app_handle: None,
                        app_event_tx: None,
                    },
                    Some(0),
                    None,
                    long_running_shell_command(),
                )
                .await
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while !manager.pending_shell_spawns.contains_key(&session_key)
            && std::time::Instant::now() < deadline
        {
            tokio::task::yield_now().await;
        }
        assert!(
            manager.pending_shell_spawns.contains_key(&session_key),
            "shell spawn should be discoverable before session publication"
        );

        let cleanup_manager = manager.clone();
        let cleanup_task_id = task_id.to_string();
        let cleanup_task =
            tokio::spawn(
                async move { cleanup_manager.kill_shells_for_task(&cleanup_task_id).await },
            );
        tokio::task::yield_now().await;
        drop(lifecycle_guard);

        let spawn_result = spawn_task.await.expect("spawn task should join");
        assert!(
            matches!(
                spawn_result,
                Err(PtyError::SpawnFailed(ref message))
                    if message.contains("cancelled before spawn")
                        || message.contains("replaced before registration")
            ),
            "cleanup should cancel the pending shell spawn: {spawn_result:?}"
        );
        cleanup_task
            .await
            .expect("cleanup task should join")
            .expect("task shell cleanup should succeed");

        assert!(!manager.sessions.lock().await.contains_key(&session_key));
        assert!(!manager
            .get_pid_dir()
            .expect("PID dir")
            .join(format!("{session_key}.pid"))
            .exists());
        assert!(!manager
            .output_buffers
            .lock()
            .await
            .contains_key(&session_key));
        assert!(!manager.last_output.lock().await.contains_key(&session_key));
        drop(lifecycle_lock);
        tokio::time::timeout(Duration::from_secs(1), async {
            while manager.lifecycle_locks.contains_key(&session_key) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("session teardown should evict its lifecycle lock");
    }

    async fn assert_newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "concurrent-agent-spawn";
        let (old_prepared_tx, old_prepared_rx) = mpsc::channel();

        let old_manager = manager.clone();
        let old_cwd = tmp_dir.path().to_path_buf();
        let old_task_id = task_id.to_string();
        let old_adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: Some(old_prepared_tx),
            command_delay: Duration::from_millis(150),
            script: "printf old-agent",
            check_lock: false,
        };
        let old_spawn = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("test runtime should build");
            runtime.block_on(old_manager.spawn_agent_pty(
                old_adapter,
                PtySpawnContext {
                    task_id: &old_task_id,
                    cwd: &old_cwd,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            ))
        });

        old_prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("older spawn should reach provider preparation");

        let new_adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            script: "printf new-agent",
            check_lock: false,
        };
        let new_instance_id = manager
            .spawn_agent_pty(
                new_adapter,
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await
            .expect("newer spawn should become current");

        let old_result = old_spawn.join().expect("older spawn task should join");
        assert!(
            matches!(old_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
            "older spawn should abort instead of replacing the newer session: {old_result:?}"
        );

        let expected_identity = {
            let sessions = manager.sessions.lock().await;
            let session = sessions
                .get(task_id)
                .expect("newer session should remain registered");
            assert_eq!(session.instance_id, new_instance_id);
            session.managed_process.clone()
        };
        let persisted_identity: ManagedProcessIdentity = serde_json::from_str(
            &std::fs::read_to_string(tmp_dir.path().join(format!("{task_id}-pty.pid")))
                .expect("newer process metadata should remain"),
        )
        .expect("newer process metadata should parse");
        assert_eq!(persisted_identity, expected_identity);
        assert!(
            manager.output_buffers.lock().await.contains_key(task_id),
            "newer spawn should keep output buffer registration"
        );
        assert!(
            manager.last_output.lock().await.contains_key(task_id),
            "newer spawn should keep last-output registration"
        );

        manager
            .kill_pty(task_id)
            .await
            .expect("newer test PTY should be cleaned up");
    }

    #[tokio::test]
    async fn newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
        for _ in 0..10 {
            assert_newer_agent_spawn_wins_when_older_spawn_finishes_setup_late().await;
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_agent_setup_before_event_stream_cleans_only_its_tracking_state() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "stale-before-event-stream";
        let (stream_start_tx, stream_start_rx) = mpsc::channel();
        let (release_stream_tx, release_stream_rx) = mpsc::channel();
        *manager
            .agent_event_stream_start_gate
            .lock()
            .expect("event stream start gate lock should not be poisoned") =
            Some(crate::pty_manager::AgentEventStreamStartGate {
                reached_tx: stream_start_tx,
                release_rx: release_stream_rx,
            });

        let stale_manager = manager.clone();
        let stale_cwd = tmp_dir.path().to_path_buf();
        let stale_task_id = task_id.to_string();
        let stale_spawn = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("test runtime should build");
            runtime.block_on(stale_manager.spawn_agent_pty(
                LockCheckingAgentAdapter {
                    sessions: Arc::clone(&stale_manager.sessions),
                    prepared_tx: None,
                    command_delay: Duration::ZERO,
                    script: "printf stale-agent",
                    check_lock: false,
                },
                PtySpawnContext {
                    task_id: &stale_task_id,
                    cwd: &stale_cwd,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            ))
        });

        stream_start_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("stale spawn should pause immediately before event stream startup");
        let stale_buffer = manager
            .output_buffers
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("stale replay buffer should be registered before startup");
        let stale_last_output = manager
            .last_output
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("stale output tracking should be registered before startup");
        let stale_hub = manager
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("stale attachment hub should be registered before startup");

        let (_superseding_token, superseding_lock) =
            manager.begin_agent_spawn(task_id, "Newer").await;
        release_stream_tx
            .send(())
            .expect("stale spawn should be released");
        let stale_result = stale_spawn.join().expect("stale spawn thread should join");
        assert!(
            matches!(stale_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before event streaming started")),
            "superseded setup should stop before event streaming: {stale_result:?}"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(task_id),
            "superseded setup must remove its replay buffer"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "superseded setup must remove its output tracking"
        );
        assert!(
            !manager.attachment_hubs.lock().await.contains_key(task_id),
            "superseded setup must remove its attachment hub"
        );

        let newer_instance_id = manager
            .spawn_agent_pty(
                LockCheckingAgentAdapter {
                    sessions: Arc::clone(&manager.sessions),
                    prepared_tx: None,
                    command_delay: Duration::ZERO,
                    script: "printf newer-agent",
                    check_lock: false,
                },
                PtySpawnContext {
                    task_id,
                    cwd: tmp_dir.path(),
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await
            .expect("newer spawn should complete");
        let newer_buffer = manager
            .output_buffers
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("newer replay buffer should remain registered");
        let newer_last_output = manager
            .last_output
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("newer output tracking should remain registered");
        let newer_hub = manager
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .cloned()
            .expect("newer attachment hub should remain registered");
        manager
            .remove_agent_stream_state_if_registered(
                task_id,
                &AgentStreamState {
                    last_output_time: Some(Arc::clone(&stale_last_output)),
                    ring_buffer: Arc::clone(&stale_buffer),
                    attachment_hub: Arc::clone(&stale_hub),
                },
            )
            .await;
        assert!(
            manager
                .output_buffers
                .lock()
                .await
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &newer_buffer)),
            "delayed stale cleanup must preserve the newer replay buffer"
        );
        assert!(
            manager
                .last_output
                .lock()
                .await
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &newer_last_output)),
            "delayed stale cleanup must preserve newer output tracking"
        );
        assert!(
            manager
                .attachment_hubs
                .lock()
                .await
                .get(task_id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &newer_hub)),
            "delayed stale cleanup must preserve the newer attachment hub"
        );
        assert!(!Arc::ptr_eq(&stale_buffer, &newer_buffer));
        assert!(!Arc::ptr_eq(&stale_last_output, &newer_last_output));
        assert!(!Arc::ptr_eq(&stale_hub, &newer_hub));
        assert_eq!(newer_hub.instance_id(), newer_instance_id);

        manager
            .kill_pty(task_id)
            .await
            .expect("newer test PTY should be cleaned up");
        drop(superseding_lock);
    }

    #[tokio::test]
    async fn kill_pty_cancels_agent_spawn_before_session_insert() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "kill-pending-agent-spawn";
        let (prepared_tx, prepared_rx) = mpsc::channel();

        let spawn_manager = manager.clone();
        let spawn_cwd = tmp_dir.path().to_path_buf();
        let spawn_task_id = task_id.to_string();
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: Some(prepared_tx),
            command_delay: Duration::from_millis(150),
            script: "printf killed-agent",
            check_lock: false,
        };
        let pending_spawn = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("test runtime should build");
            runtime.block_on(spawn_manager.spawn_agent_pty(
                adapter,
                PtySpawnContext {
                    task_id: &spawn_task_id,
                    cwd: &spawn_cwd,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            ))
        });

        prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("spawn should reach provider preparation");
        manager
            .kill_pty(task_id)
            .await
            .expect("kill during pending spawn should be accepted");

        let spawn_result = pending_spawn
            .join()
            .expect("pending spawn thread should join");
        assert!(
            matches!(spawn_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
            "pending spawn should abort after kill_pty invalidates it: {spawn_result:?}"
        );
        assert!(
            !manager.sessions.lock().await.contains_key(task_id),
            "killed pending spawn must not insert a session"
        );
        assert!(
            !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "killed pending spawn must not leave a PID file"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(task_id),
            "killed pending spawn must not register an output buffer"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "killed pending spawn must not register last-output tracking"
        );
    }

    const CWD_OUTPUT_READY: &str = "openforge-cwd-output=ready";

    struct CwdPrintingAgentAdapter;

    impl AgentPtyProviderAdapter for CwdPrintingAgentAdapter {
        fn label(&self) -> &'static str {
            "CwdPrinting"
        }

        fn command_name(&self) -> &'static str {
            "/bin/sh"
        }

        fn command_args(&self) -> Vec<String> {
            vec![
                "-c".to_string(),
                format!(
                    "/bin/pwd -P; printf '{}\\n'; IFS= read -r _",
                    CWD_OUTPUT_READY
                ),
            ]
        }

        fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
            Ok(())
        }

        fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
            HashMap::new()
        }

        fn pid_file_name(&self, task_id: &str) -> String {
            format!("{}-pty.pid", task_id)
        }

        fn track_last_output(&self) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn agent_pty_starts_process_with_actual_workspace_cwd_containing_spaces() {
        let mut manager = PtyManager::new();
        let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
        manager.set_pid_dir(temp_dir.path().join("pids"));
        let workspace_path = temp_dir.path().join("Snooze Vault");
        std::fs::create_dir_all(&workspace_path).expect("workspace with spaces should be created");
        let expected_cwd = workspace_path
            .canonicalize()
            .expect("workspace path should canonicalize")
            .to_string_lossy()
            .to_string();

        manager
            .spawn_agent_pty(
                CwdPrintingAgentAdapter,
                PtySpawnContext {
                    task_id: "agent-space-cwd",
                    cwd: &workspace_path,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: Some(app_event_tx),
                },
                None,
            )
            .await
            .expect("agent PTY should spawn in workspace with spaces");

        let output_result = tokio::time::timeout(Duration::from_secs(5), async {
            let mut output = String::new();
            loop {
                let event = app_event_rx.recv().await?;
                if event.event_name != "pty-output-agent-space-cwd" {
                    continue;
                }

                output.push_str(
                    event.payload["data"]
                        .as_str()
                        .expect("PTY output event should contain text data"),
                );
                if output
                    .lines()
                    .any(|line| line.trim_end_matches('\r') == CWD_OUTPUT_READY)
                {
                    break Ok::<_, tokio::sync::broadcast::error::RecvError>(output);
                }
            }
        })
        .await;
        if !matches!(&output_result, Ok(Ok(_))) {
            let _ = manager.kill_pty("agent-space-cwd").await;
        }
        let output = output_result
            .expect("agent PTY should emit the cwd output readiness marker")
            .expect("PTY event channel should remain open until cwd output is ready");

        let release_result = manager.write_pty("agent-space-cwd", b"\n").await;
        if release_result.is_err() {
            let _ = manager.kill_pty("agent-space-cwd").await;
        }
        release_result.expect("test should release the cwd-printing process");
        let exit_result = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let event = app_event_rx.recv().await?;
                if event.event_name == "pty-exit-agent-space-cwd" {
                    break Ok::<_, tokio::sync::broadcast::error::RecvError>(());
                }
            }
        })
        .await;
        if !matches!(&exit_result, Ok(Ok(()))) {
            let _ = manager.kill_pty("agent-space-cwd").await;
        }
        exit_result
            .expect("agent PTY should exit after the test releases it")
            .expect("PTY event channel should remain open until the process exits");

        assert!(
            output
                .lines()
                .any(|line| line.trim_end_matches('\r') == expected_cwd),
            "agent PTY process should start with actual cwd at the workspace even when it contains spaces; output was: {output:?}"
        );
    }

    #[tokio::test]
    async fn agent_pty_rejects_missing_workspace_cwd_instead_of_falling_back() {
        let mut manager = PtyManager::new();
        let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(temp_dir.path().join("pids"));
        let missing_workspace = temp_dir.path().join("Missing Vault");

        let result = manager
            .spawn_agent_pty(
                CwdPrintingAgentAdapter,
                PtySpawnContext {
                    task_id: "agent-missing-cwd",
                    cwd: &missing_workspace,
                    cols: 80,
                    rows: 24,
                    app_handle: None,
                    app_event_tx: None,
                },
                None,
            )
            .await;

        assert!(
            matches!(result, Err(PtyError::InvalidWorkspaceCwd { ref path, .. }) if path.contains("Missing Vault")),
            "missing cwd should be classified separately from internal PTY spawn failures: {result:?}"
        );
        assert!(
            !manager
                .sessions
                .lock()
                .await
                .contains_key("agent-missing-cwd"),
            "missing cwd must not register an agent session"
        );
    }
}
