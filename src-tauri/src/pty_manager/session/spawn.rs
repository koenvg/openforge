use crate::app_events::AppEventSender;
use crate::user_environment::user_environment;
use log::info;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::super::commands::get_shell_path;
use super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use super::super::pids::{
    pid_file_name_for_session_key, shell_session_key, write_managed_process_identity,
};
use super::super::{
    terminal_environment, PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol,
};
use super::invalid_workspace_cwd;
use super::lifecycle::{PtySession, PtySessionKind, NEXT_INSTANCE_ID};
use super::provider_adapter::{
    AgentPtyProviderAdapter, ClaudeCodePtyAdapter, CodexPtyAdapter, OpenCodePtyAdapter,
    PiPtyAdapter,
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
        resume_session_id: Option<&str>,
        continue_session: bool,
        cols: u16,
        rows: u16,
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
        terminal_image_protocol: Option<TerminalImageProtocol>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            PiPtyAdapter::new(prompt, resume_session_id, continue_session, None),
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
        let spawn_generation = NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed);
        {
            let mut generations = self.agent_spawn_generations.lock().await;
            generations.insert(task_id.to_string(), spawn_generation);
        }
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let old_session = self.sessions.lock().await.remove(task_id);
        if let Some(mut old_session) = old_session {
            info!(
                "[PTY] Replacing existing {} PTY for task {}",
                adapter.label(),
                task_id
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
        }

        adapter.prepare(&resolved_cwd)?;
        let pid_file_name = adapter.pid_file_name(task_id);
        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(&pid_file_name);

        info!(
            "Spawning {} PTY for task {} ({}x{})",
            adapter.label(),
            task_id,
            cols,
            rows
        );

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to create PTY pair: {}", e)))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let mut cmd = CommandBuilder::new(adapter.command_name());
        for arg in adapter.command_args() {
            cmd.arg(arg);
        }
        cmd.cwd(&resolved_cwd);

        for (key, value) in user_environment() {
            cmd.env(key, value);
        }
        cmd.env("PWD", resolved_cwd.to_string_lossy().to_string());

        for (key, value) in terminal_environment(terminal_image_protocol) {
            cmd.env(key, value);
        }
        for (key, value) in adapter.extra_env(task_id, instance_id) {
            cmd.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid_description = format!("{} PTY for task {}", adapter.label(), task_id);
        let pid = require_root_pid_or_cleanup(child.process_id(), &pid_description, || {
            let cleanup_result = child.kill();
            let _ = child.try_wait();
            cleanup_result
        })?;
        let managed_process = ManagedProcessIdentity::capture(pid).map_err(|error| {
            force_kill_unverified_spawn(pid);
            let _ = child.try_wait();
            PtyError::SpawnFailed(format!(
                "Failed to capture managed process identity for {} PTY task {}: {}",
                adapter.label(),
                task_id,
                error
            ))
        })?;
        info!(
            "{} PTY for task {} started (PID: {})",
            adapter.label(),
            task_id,
            pid
        );

        let mut pending_session = Some(PtySession {
            child,
            master: pair.master,
            writer,
            instance_id,
            kind: PtySessionKind::Agent,
            pid_file_name: pid_file_name.clone(),
            managed_process: managed_process.clone(),
        });
        let replaced_session = {
            let generations = self.agent_spawn_generations.lock().await;
            let registration_is_stale = generations
                .get(task_id)
                .map(|current| *current != spawn_generation)
                .unwrap_or(true);
            if registration_is_stale {
                None
            } else {
                self.sessions.lock().await.insert(
                    task_id.to_string(),
                    pending_session.take().expect("pending session"),
                )
            }
        };

        if let Some(stale_session) = pending_session {
            self.terminate_or_retain_unregistered_session(task_id, stale_session)
                .await?;
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before session registration completed",
                adapter.label(),
                task_id
            )));
        }

        if let Some(mut replaced_session) = replaced_session {
            info!(
                "[PTY] Replacing existing {} PTY for task {}",
                adapter.label(),
                task_id
            );
            self.terminate_session_process(task_id, &mut replaced_session)
                .await?;
            self.clear_session_tracking(task_id).await;
        }
        if let Err(error) = write_managed_process_identity(&pid_file, &managed_process) {
            if let Some(failed_session) = self.sessions.lock().await.remove(task_id) {
                self.terminate_or_retain_unregistered_session(task_id, failed_session)
                    .await?;
            }
            self.clear_session_tracking(task_id).await;
            return Err(error);
        }

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before setup completed",
                adapter.label(),
                task_id
            )));
        }

        let last_output_time = adapter
            .track_last_output()
            .then(|| Arc::new(AtomicU64::new(0)));
        if let Some(last_output_time) = &last_output_time {
            let mut times = self.last_output.lock().await;
            times.insert(task_id.to_string(), Arc::clone(last_output_time));
        }
        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            if let Some(last_output_time) = &last_output_time {
                let mut times = self.last_output.lock().await;
                if times
                    .get(task_id)
                    .map(|stored| Arc::ptr_eq(stored, last_output_time))
                    .unwrap_or(false)
                {
                    times.remove(task_id);
                }
            }
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before output tracking completed",
                adapter.label(),
                task_id
            )));
        }

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            let mut buffers = self.output_buffers.lock().await;
            if buffers
                .get(task_id)
                .map(|stored| Arc::ptr_eq(stored, &ring_buffer))
                .unwrap_or(false)
            {
                buffers.remove(task_id);
            }
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before output buffer registration completed",
                adapter.label(),
                task_id
            )));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before event streaming started",
                adapter.label(),
                task_id
            )));
        }

        let rx = spawn_pty_output_reader(
            reader,
            task_id.to_string(),
            last_output_time.as_ref().map(Arc::clone),
        );
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    lifecycle_lock: Arc::clone(&lifecycle_lock),
                    pid_file,
                    emit_agent_exit: true,
                },
            },
        );

        {
            let mut generations = self.agent_spawn_generations.lock().await;
            if generations
                .get(task_id)
                .map(|current| *current == spawn_generation)
                .unwrap_or(false)
            {
                generations.remove(task_id);
            } else {
                return Err(PtyError::SpawnFailed(format!(
                    "{} PTY for task {} was replaced before setup finished",
                    adapter.label(),
                    task_id
                )));
            }
        }

        Ok(instance_id)
    }

    pub(crate) async fn spawn_shell_pty(
        &self,
        context: PtySpawnContext<'_>,
        terminal_index: Option<u32>,
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
        let key = shell_session_key(task_id, terminal_index);
        let spawn_generation = NEXT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed);
        self.agent_spawn_generations
            .lock()
            .await
            .insert(key.clone(), spawn_generation);
        let _pending_shell_spawn =
            PendingShellSpawn::register(self, &key, task_id, spawn_generation);
        let pid_file_name = pid_file_name_for_session_key(&key);
        let lifecycle_lock = self.lifecycle_lock_for(&key).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        if !self.is_current_spawn(&key, spawn_generation).await {
            return Err(PtyError::SpawnFailed(format!(
                "shell PTY for task {task_id} was cancelled before spawn"
            )));
        }
        let old_session = self.sessions.lock().await.remove(&key);

        if let Some(mut old_session) = old_session {
            info!("[PTY] Replacing existing shell PTY for task {}", task_id);
            if let Err(error) = self.terminate_session_process(&key, &mut old_session).await {
                self.sessions.lock().await.insert(key.clone(), old_session);
                return Err(error);
            }
            self.clear_session_tracking(&key).await;
        }
        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(&pid_file_name);

        info!(
            "Spawning shell PTY for task {} ({}x{})",
            task_id, cols, rows
        );

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to create PTY pair: {}", e)))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        let shell_path = get_shell_path();
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&resolved_cwd);

        for (key, value) in user_environment() {
            cmd.env(key, value);
        }
        cmd.env("PWD", resolved_cwd.to_string_lossy().to_string());

        for (key, value) in terminal_environment(terminal_image_protocol) {
            cmd.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid_description = format!("Shell PTY for task {task_id}");
        let pid = require_root_pid_or_cleanup(child.process_id(), &pid_description, || {
            let cleanup_result = child.kill();
            let _ = child.try_wait();
            cleanup_result
        })?;
        let managed_process = ManagedProcessIdentity::capture(pid).map_err(|error| {
            force_kill_unverified_spawn(pid);
            let _ = child.try_wait();
            PtyError::SpawnFailed(format!(
                "Failed to capture managed process identity for shell PTY task {task_id}: {error}"
            ))
        })?;
        info!("Shell PTY for task {} started (PID: {})", task_id, pid);
        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let mut pending_session = Some(PtySession {
            child,
            master: pair.master,
            writer,
            instance_id,
            kind: PtySessionKind::Shell {
                task_id: task_id.to_string(),
            },
            pid_file_name: pid_file_name.clone(),
            managed_process: managed_process.clone(),
        });
        if !self.is_current_spawn(&key, spawn_generation).await {
            self.terminate_or_retain_unregistered_session(
                &key,
                pending_session.take().expect("pending shell session"),
            )
            .await?;
            return Err(PtyError::SpawnFailed(format!(
                "shell PTY for task {task_id} was replaced before registration"
            )));
        }

        let replaced_session = self.sessions.lock().await.insert(
            key.clone(),
            pending_session.take().expect("pending shell session"),
        );
        if let Some(mut replaced_session) = replaced_session {
            self.terminate_session_process(&key, &mut replaced_session)
                .await?;
            self.clear_session_tracking(&key).await;
        }
        if let Err(error) = write_managed_process_identity(&pid_file, &managed_process) {
            if let Some(failed_session) = self.sessions.lock().await.remove(&key) {
                self.terminate_or_retain_unregistered_session(&key, failed_session)
                    .await?;
            }
            self.clear_session_tracking(&key).await;
            return Err(error);
        }

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let last_output_time = Arc::new(AtomicU64::new(0));
        {
            let mut times = self.last_output.lock().await;
            times.insert(key.clone(), Arc::clone(&last_output_time));
        }
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(key.clone(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let rx = spawn_pty_output_reader(reader, key.clone(), Some(Arc::clone(&last_output_time)));
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: key.clone(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    lifecycle_lock: Arc::clone(&lifecycle_lock),
                    pid_file,
                    emit_agent_exit: false,
                },
            },
        );
        let mut generations = self.agent_spawn_generations.lock().await;
        if generations.get(&key) == Some(&spawn_generation) {
            generations.remove(&key);
        }

        Ok(instance_id)
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

    struct LockCheckingAgentAdapter {
        sessions: PtySessions,
        prepared_tx: Option<mpsc::Sender<()>>,
        command_delay: Duration,
        output: &'static str,
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
            vec![
                "-lc".to_string(),
                format!("printf {}; sleep 5", self.output),
            ]
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
    async fn agent_spawn_keeps_session_mutex_out_of_provider_and_command_work() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "lock-free-agent-spawn";
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            output: "lock-free-agent",
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
            output: "blocked-agent",
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
                .spawn_shell_pty(
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

        let _ = spawn_task.await.expect("spawn task should join");
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
    }

    #[tokio::test]
    async fn newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
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
            output: "old-agent",
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
            output: "new-agent",
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
            output: "killed-agent",
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

    struct CwdPrintingAgentAdapter;

    impl AgentPtyProviderAdapter for CwdPrintingAgentAdapter {
        fn label(&self) -> &'static str {
            "CwdPrinting"
        }

        fn command_name(&self) -> &'static str {
            "/bin/pwd"
        }

        fn command_args(&self) -> Vec<String> {
            vec!["-P".to_string()]
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
                    app_event_tx: None,
                },
                None,
            )
            .await
            .expect("agent PTY should spawn in workspace with spaces");

        let mut output = String::new();
        for _ in 0..20 {
            if let Some(buffer) = manager.get_pty_buffer("agent-space-cwd").await {
                output = buffer;
                if output.contains(&expected_cwd) {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        manager
            .kill_pty("agent-space-cwd")
            .await
            .expect("test PTY should be cleaned up");
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
