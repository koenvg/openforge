use crate::app_events::AppEventSender;
use crate::user_environment::{find_tool_on_path, user_environment, user_tool_path};
use log::{error, info};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::{HashMap, HashSet};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::commands::{
    build_claude_args, build_codex_args, build_opencode_tui_args, build_pi_args, get_shell_path,
};
use super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::managed_process::{
    force_kill_unverified_spawn, terminate_managed_process_tree, ManagedProcessIdentity,
};
use super::pids::{
    pid_file_name_for_session_key, shell_session_key, terminate_and_remove_managed_process,
    write_managed_process_identity, MANAGED_PROCESS_TERM_TIMEOUT,
};
use super::{PtyError, PtyManager, PtyProcessDiagnosticSession, PtySpawnContext};

pub(super) type PtySessions = Arc<Mutex<HashMap<String, PtySession>>>;
pub(super) type LastOutputTimes = Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>;
pub(super) type PtyOutputBuffers = Arc<Mutex<HashMap<String, SharedRingBuffer>>>;
pub(super) type AgentSpawnGenerations = Arc<Mutex<HashMap<String, u64>>>;

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
// ============================================================================
// Instance ID Generator
// ============================================================================

pub(super) static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_SPAWN_GENERATION: AtomicU64 = AtomicU64::new(1);

// ============================================================================
// PTY Session
// ============================================================================

pub(super) enum PtySessionKind {
    Agent,
    Shell { task_id: String },
}

impl PtySessionKind {
    fn is_shell_for_task(&self, task_id: &str) -> bool {
        matches!(self, Self::Shell { task_id: shell_task_id } if shell_task_id == task_id)
    }

    fn task_id_for_session_key<'a>(&'a self, session_key: &'a str) -> &'a str {
        match self {
            Self::Agent => session_key,
            Self::Shell { task_id } => task_id,
        }
    }

    fn diagnostic_kind(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Shell { .. } => "shell",
        }
    }
}

pub(super) struct PtySession {
    #[allow(dead_code)]
    pub(super) child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    pub(super) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(super) writer: Box<dyn std::io::Write + Send>,
    pub(super) instance_id: u64,
    pub(super) kind: PtySessionKind,
    pub(super) pid_file_name: String,
    pub(super) managed_process: ManagedProcessIdentity,
}

trait AgentPtyProviderAdapter {
    fn label(&self) -> &'static str;
    fn command_name(&self) -> &'static str;
    fn command_args(&self) -> Vec<String>;
    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError>;
    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String>;
    fn pid_file_name(&self, task_id: &str) -> String;
    fn track_last_output(&self) -> bool;
}

struct ClaudeCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    hooks_settings_path: PathBuf,
    permission_mode: Option<String>,
}

impl ClaudeCodePtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        hooks_settings_path: &Path,
        permission_mode: Option<&str>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            hooks_settings_path: hooks_settings_path.to_path_buf(),
            permission_mode: permission_mode.map(str::to_string),
        }
    }
}

impl AgentPtyProviderAdapter for ClaudeCodePtyAdapter {
    fn label(&self) -> &'static str {
        "Claude"
    }

    fn command_name(&self) -> &'static str {
        "claude"
    }

    fn command_args(&self) -> Vec<String> {
        build_claude_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            &self.hooks_settings_path,
            self.permission_mode.as_deref(),
        )
    }

    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError> {
        // Pre-approve workspace trust so the "Do you trust this folder?" dialog is skipped.
        if let Err(e) = crate::claude_hooks::ensure_workspace_trusted(cwd) {
            info!(
                "[PTY] Warning: Failed to pre-approve workspace trust: {}",
                e
            );
            // Non-fatal — Claude will just show the trust dialog.
        }
        Ok(())
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        HashMap::from([
            ("OPENFORGE_TASK_ID".to_string(), task_id.to_string()),
            ("CLAUDE_TASK_ID".to_string(), task_id.to_string()),
            (
                "OPENFORGE_PTY_INSTANCE_ID".to_string(),
                instance_id.to_string(),
            ),
        ])
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-claude.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

struct OpenCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    agent: Option<String>,
    model: Option<String>,
}

impl OpenCodePtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        agent: Option<&str>,
        model: Option<&str>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            agent: agent.map(str::to_string),
            model: model.map(str::to_string),
        }
    }
}

impl AgentPtyProviderAdapter for OpenCodePtyAdapter {
    fn label(&self) -> &'static str {
        "OpenCode"
    }

    fn command_name(&self) -> &'static str {
        "opencode"
    }

    fn command_args(&self) -> Vec<String> {
        build_opencode_tui_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            self.agent.as_deref(),
            self.model.as_deref(),
        )
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        crate::opencode_plugin::ensure_opencode_plugin_installed()
            .map(|_| ())
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to install OpenCode plugin: {}", e)))
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

struct CodexPtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
}

impl CodexPtyAdapter {
    fn new(prompt: &str, resume_session_id: Option<&str>, continue_session: bool) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
        }
    }
}

impl AgentPtyProviderAdapter for CodexPtyAdapter {
    fn label(&self) -> &'static str {
        "Codex"
    }

    fn command_name(&self) -> &'static str {
        "codex"
    }

    fn command_args(&self) -> Vec<String> {
        let mut args = vec![
            "--profile".to_string(),
            crate::codex_hooks::OPENFORGE_CODEX_PROFILE_NAME.to_string(),
        ];
        args.extend(build_codex_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
        ));
        args
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        crate::codex_hooks::ensure_codex_hooks_installed()
            .map(|_| ())
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to install Codex hooks: {}", e)))
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

type PiNodeCwdPreflight = fn(&Path, &HashMap<String, String>) -> Result<(), String>;

struct PiPtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    extension_path: Option<PathBuf>,
    node_cwd_preflight: PiNodeCwdPreflight,
}

impl PiPtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        extension_path: Option<PathBuf>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            extension_path,
            node_cwd_preflight: run_pi_node_cwd_preflight,
        }
    }
}

impl AgentPtyProviderAdapter for PiPtyAdapter {
    fn label(&self) -> &'static str {
        "Pi"
    }

    fn command_name(&self) -> &'static str {
        "pi"
    }

    fn command_args(&self) -> Vec<String> {
        build_pi_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            self.extension_path.as_deref(),
        )
    }

    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError> {
        verify_pi_node_cwd_access(cwd, self.node_cwd_preflight)?;

        if self.extension_path.is_none() {
            self.extension_path = Some(
                crate::pi_extension::ensure_pi_extension_installed().map_err(|e| {
                    PtyError::SpawnFailed(format!("Failed to install Pi extension: {}", e))
                })?,
            );
        }
        Ok(())
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        false
    }
}

fn openforge_agent_env(task_id: &str, instance_id: u64) -> HashMap<String, String> {
    HashMap::from([
        ("OPENFORGE_TASK_ID".to_string(), task_id.to_string()),
        (
            "OPENFORGE_PTY_INSTANCE_ID".to_string(),
            instance_id.to_string(),
        ),
        (
            "OPENFORGE_HTTP_PORT".to_string(),
            crate::claude_hooks::get_http_server_port().to_string(),
        ),
    ])
}

fn invalid_workspace_cwd(cwd: &Path, reason: impl ToString) -> PtyError {
    PtyError::InvalidWorkspaceCwd {
        path: cwd.display().to_string(),
        reason: reason.to_string(),
    }
}

fn verify_pi_node_cwd_access(cwd: &Path, preflight: PiNodeCwdPreflight) -> Result<(), PtyError> {
    let env = user_environment();
    verify_pi_node_cwd_access_with(cwd, &env, preflight)
}

fn verify_pi_node_cwd_access_with(
    cwd: &Path,
    env: &HashMap<String, String>,
    preflight: impl FnOnce(&Path, &HashMap<String, String>) -> Result<(), String>,
) -> Result<(), PtyError> {
    preflight(cwd, env)
        .map_err(|err| invalid_workspace_cwd(cwd, format!("not accessible to Pi/Node: {err}")))
}

fn run_pi_node_cwd_preflight(cwd: &Path, env: &HashMap<String, String>) -> Result<(), String> {
    let path = env.get("PATH").cloned().unwrap_or_else(user_tool_path);
    let node_path = find_tool_on_path("node", &path)
        .ok_or_else(|| "node executable was not found on PATH".to_string())?;

    let output = std::process::Command::new(&node_path)
        .arg("-e")
        .arg("process.cwd()")
        .current_dir(cwd)
        .envs(env)
        .output()
        .map_err(|e| format!("failed to start node cwd preflight: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "node exited without diagnostic output".to_string()
    };

    Err(format!(
        "node cwd preflight failed with status {}: {}",
        output.status, detail
    ))
}

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

    async fn terminate_session_process(
        &self,
        session_key: &str,
        session: &mut PtySession,
    ) -> Result<(), PtyError> {
        let pid_file = self.get_pid_dir()?.join(&session.pid_file_name);
        terminate_and_remove_managed_process(
            &session.managed_process,
            &pid_file,
            &format!("PTY cleanup for {session_key}"),
        )
        .await?;
        let _ = session.child.try_wait();
        Ok(())
    }

    async fn terminate_unregistered_session(
        &self,
        session_key: &str,
        session: &mut PtySession,
    ) -> Result<(), PtyError> {
        terminate_managed_process_tree(&session.managed_process, MANAGED_PROCESS_TERM_TIMEOUT)
            .await
            .map_err(|error| {
                PtyError::CleanupFailed(format!(
                    "unregistered PTY cleanup for {session_key}: {error}"
                ))
            })?;
        let _ = session.child.try_wait();
        Ok(())
    }

    async fn terminate_or_retain_unregistered_session(
        &self,
        session_key: &str,
        mut session: PtySession,
    ) -> Result<(), PtyError> {
        if let Err(error) = self
            .terminate_unregistered_session(session_key, &mut session)
            .await
        {
            if let Err(preservation_error) = self
                .retain_failed_unregistered_cleanup(session_key, session)
                .await
            {
                return Err(PtyError::CleanupFailed(format!(
                    "{error}; {preservation_error}"
                )));
            }
            return Err(error);
        }

        Ok(())
    }
    async fn retain_failed_unregistered_cleanup(
        &self,
        base_key: &str,
        mut session: PtySession,
    ) -> Result<(), PtyError> {
        let recovery_key = format!("{base_key}-cleanup-{}", session.instance_id);
        let recovery_pid_file_name = format!("{recovery_key}-pty.pid");
        let metadata_error = match self.get_pid_dir() {
            Ok(pid_dir) => std::fs::create_dir_all(&pid_dir)
                .and_then(|_| {
                    write_managed_process_identity(
                        &pid_dir.join(&recovery_pid_file_name),
                        &session.managed_process,
                    )
                    .map_err(io::Error::other)
                })
                .err()
                .map(|error| error.to_string()),
            Err(error) => Some(error.to_string()),
        };
        if let Some(error) = &metadata_error {
            error!(
                "Failed to preserve recovery metadata for {}: {}",
                recovery_key, error
            );
        }

        session.pid_file_name = recovery_pid_file_name;
        self.sessions
            .lock()
            .await
            .insert(recovery_key.clone(), session);

        if let Some(error) = metadata_error {
            return Err(PtyError::CleanupFailed(format!(
                "failed to preserve recovery metadata for {recovery_key}: {error}"
            )));
        }

        Ok(())
    }

    async fn lifecycle_lock_for(&self, session_key: &str) -> Arc<Mutex<()>> {
        let mut lifecycle_locks = self.lifecycle_locks.lock().await;
        Arc::clone(
            lifecycle_locks
                .entry(session_key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    async fn clear_session_tracking(&self, session_key: &str) {
        self.last_output.lock().await.remove(session_key);
        self.output_buffers.lock().await.remove(session_key);
    }

    async fn spawn_agent_pty<A: AgentPtyProviderAdapter>(
        &self,
        mut adapter: A,
        context: PtySpawnContext<'_>,
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

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");
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

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");

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

    pub async fn write_pty(&self, task_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().await;

        let session = sessions
            .get_mut(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(format!("write_all failed: {}", e)))?;

        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(format!("flush failed: {}", e)))?;

        Ok(())
    }

    /// Resizes the PTY for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `cols` - New terminal width in columns
    /// * `rows` - New terminal height in rows
    pub async fn resize_pty(&self, task_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        session
            .master
            .resize(size)
            .map_err(|e| PtyError::IoError(io::Error::other(e.to_string())))?;

        Ok(())
    }

    /// Kills the PTY process for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn kill_pty(&self, task_id: &str) -> Result<(), PtyError> {
        self.agent_spawn_generations.lock().await.remove(task_id);
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;

        let session = self.sessions.lock().await.remove(task_id);
        if let Some(mut session) = session {
            info!("Killing PTY for task {}", task_id);
            if let Err(error) = self.terminate_session_process(task_id, &mut session).await {
                self.sessions
                    .lock()
                    .await
                    .entry(task_id.to_string())
                    .or_insert(session);
                return Err(error);
            }
            info!("PTY for task {} killed", task_id);
        }
        self.clear_session_tracking(task_id).await;

        Ok(())
    }

    pub async fn kill_shells_for_task(&self, task_id: &str) -> Result<(), PtyError> {
        let mut keys_to_kill: HashSet<String> = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_key, session)| session.kind.is_shell_for_task(task_id))
                .map(|(key, _session)| key.clone())
                .collect()
        };
        keys_to_kill.extend(
            self.pending_shell_spawns
                .iter()
                .filter(|entry| entry.value().0.as_str() == task_id)
                .map(|entry| entry.key().clone()),
        );

        let mut failures = Vec::new();
        for key in keys_to_kill {
            let lifecycle_lock = self.lifecycle_lock_for(&key).await;
            let _lifecycle_guard = lifecycle_lock.lock().await;
            self.agent_spawn_generations.lock().await.remove(&key);
            let session = self.sessions.lock().await.remove(&key);
            let Some(mut session) = session else {
                continue;
            };
            info!("Killing shell PTY for key {}", key);
            if let Err(error) = self.terminate_session_process(&key, &mut session).await {
                self.sessions
                    .lock()
                    .await
                    .entry(key.clone())
                    .or_insert(session);
                failures.push(error.to_string());
                continue;
            }
            self.clear_session_tracking(&key).await;
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(PtyError::CleanupFailed(failures.join("; ")))
        }
    }

    /// Kills all running PTY processes
    pub async fn kill_all(&self) {
        let mut session_keys: HashSet<String> =
            self.sessions.lock().await.keys().cloned().collect();
        session_keys.extend(
            self.pending_shell_spawns
                .iter()
                .map(|entry| entry.key().clone()),
        );
        session_keys.extend(self.agent_spawn_generations.lock().await.keys().cloned());

        let cleanup_results =
            futures::future::join_all(session_keys.into_iter().map(|session_key| {
                let manager = self.clone();
                async move {
                    let result = manager.kill_pty(&session_key).await;
                    (session_key, result)
                }
            }))
            .await;

        for (session_key, result) in cleanup_results {
            if let Err(error) = result {
                error!("Failed to kill PTY for task {}: {}", session_key, error);
            }
        }
    }

    pub async fn interrupt_claude(&self, task_id: &str) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let pid = session
            .child
            .process_id()
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        unsafe {
            libc::kill(pid as i32, libc::SIGINT);
        }

        Ok(())
    }

    pub async fn check_claude_frozen(&self, task_id: &str) -> Option<u64> {
        let pid = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(task_id)?;
            session.child.process_id()?
        };

        let is_alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        if !is_alive {
            return None;
        }

        let times = self.last_output.lock().await;
        let last_output_ms = times.get(task_id)?.load(Ordering::Relaxed);

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;

        frozen_seconds(last_output_ms, now_ms)
    }

    /// Returns the keys of all active PTY sessions.
    pub async fn get_session_keys(&self) -> Vec<String> {
        let sessions = self.sessions.lock().await;
        sessions.keys().cloned().collect()
    }

    /// Returns a read-only snapshot of live PTY roots for diagnostics.
    pub async fn process_diagnostic_sessions(&self) -> Vec<PtyProcessDiagnosticSession> {
        let sessions = self.sessions.lock().await;
        let mut diagnostics: Vec<PtyProcessDiagnosticSession> = sessions
            .iter()
            .map(|(session_key, session)| PtyProcessDiagnosticSession {
                session_key: session_key.clone(),
                task_id: session
                    .kind
                    .task_id_for_session_key(session_key)
                    .to_string(),
                session_kind: session.kind.diagnostic_kind().to_string(),
                pid: session.child.process_id(),
                pty_instance_id: session.instance_id,
                pid_file_name: session.pid_file_name.clone(),
            })
            .collect();
        diagnostics.sort_by(|left, right| {
            left.task_id
                .cmp(&right.task_id)
                .then_with(|| left.session_key.cmp(&right.session_key))
                .then_with(|| left.pty_instance_id.cmp(&right.pty_instance_id))
        });
        diagnostics
    }

    pub async fn get_pty_buffer(&self, task_id: &str) -> Option<String> {
        let buffers = self.output_buffers.lock().await;
        let buffer = buffers.get(task_id)?;
        let buf = buffer.lock().unwrap();
        let content = buf.snapshot();
        if content.is_empty() {
            None
        } else {
            Some(content)
        }
    }
}

// ============================================================================
// Freeze Detection
// ============================================================================

pub(super) fn frozen_seconds(last_output_ms: u64, now_ms: u64) -> Option<u64> {
    if last_output_ms == 0 {
        return None;
    }
    let elapsed_secs = now_ms.saturating_sub(last_output_ms) / 1000;
    if elapsed_secs >= 15 {
        Some(elapsed_secs)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
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

    #[test]
    fn claude_adapter_owns_provider_specific_spawn_details() {
        let adapter = ClaudeCodePtyAdapter::new(
            "implement this",
            Some("claude-session"),
            true,
            Path::new("/tmp/claude-settings.json"),
            Some("plan"),
        );

        assert_eq!(adapter.label(), "Claude");
        assert_eq!(adapter.command_name(), "claude");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--resume",
                "claude-session",
                "implement this",
                "--permission-mode",
                "plan",
                "--settings",
                "/tmp/claude-settings.json",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-claude.pid");
        assert!(adapter.track_last_output());

        let env = adapter.extra_env("task-1", 42);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("CLAUDE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(
            env.get("OPENFORGE_PTY_INSTANCE_ID"),
            Some(&"42".to_string())
        );
        assert!(!env.contains_key("OPENFORGE_HTTP_PORT"));
    }

    #[test]
    fn opencode_adapter_owns_provider_specific_spawn_details() {
        let adapter = OpenCodePtyAdapter::new(
            "fix it",
            Some("opencode-session"),
            false,
            Some("build"),
            Some("anthropic/claude-sonnet-4"),
        );

        assert_eq!(adapter.label(), "OpenCode");
        assert_eq!(adapter.command_name(), "opencode");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--session",
                "opencode-session",
                "--agent",
                "build",
                "--model",
                "anthropic/claude-sonnet-4",
                "--prompt",
                "fix it",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-pty.pid");
        assert!(adapter.track_last_output());

        let env = adapter.extra_env("task-1", 7);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID"), Some(&"7".to_string()));
        assert!(env.contains_key("OPENFORGE_HTTP_PORT"));
        assert!(!env.contains_key("CLAUDE_TASK_ID"));
    }

    #[test]
    fn codex_adapter_owns_provider_specific_spawn_details() {
        let adapter = CodexPtyAdapter::new("continue work", Some("codex-session"), false);

        assert_eq!(adapter.label(), "Codex");
        assert_eq!(adapter.command_name(), "codex");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--profile",
                "openforge-lifecycle",
                "resume",
                "codex-session",
                "continue work",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-pty.pid");
        assert!(adapter.track_last_output());

        let env = adapter.extra_env("task-1", 8);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID"), Some(&"8".to_string()));
        assert!(env.contains_key("OPENFORGE_HTTP_PORT"));
        assert!(!env.contains_key("CLAUDE_TASK_ID"));
    }

    #[test]
    fn pi_adapter_owns_provider_specific_spawn_details() {
        let adapter = PiPtyAdapter::new(
            "continue work",
            Some("pi-session"),
            true,
            Some(PathBuf::from("/tmp/openforge-pi-extension")),
        );

        assert_eq!(adapter.label(), "Pi");
        assert_eq!(adapter.command_name(), "pi");
        assert_eq!(
            adapter.command_args(),
            vec![
                "-e",
                "/tmp/openforge-pi-extension",
                "--approve",
                "--session",
                "pi-session",
                "continue work",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-pty.pid");
        assert!(!adapter.track_last_output());

        let env = adapter.extra_env("task-1", 9);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID"), Some(&"9".to_string()));
        assert!(env.contains_key("OPENFORGE_HTTP_PORT"));
        assert!(!env.contains_key("CLAUDE_TASK_ID"));
    }

    #[test]
    fn pi_node_cwd_preflight_maps_failures_to_clear_workspace_error() {
        let cwd = Path::new("/tmp/Open Forge Workspace");
        let env = HashMap::from([("PATH".to_string(), "/test/bin".to_string())]);
        let mut preflight_called = false;

        let result = verify_pi_node_cwd_access_with(cwd, &env, |preflight_cwd, preflight_env| {
            preflight_called = true;
            assert_eq!(preflight_cwd, cwd);
            assert_eq!(preflight_env.get("PATH"), Some(&"/test/bin".to_string()));
            Err(
                "Error: EPERM: process.cwd failed with error operation not permitted, uv_cwd"
                    .to_string(),
            )
        });

        assert!(preflight_called);
        match result {
            Err(PtyError::InvalidWorkspaceCwd { path, reason }) => {
                assert!(path.contains("/tmp/Open Forge Workspace"));
                assert!(reason.contains("Pi/Node"));
                assert!(reason.contains("uv_cwd"));
            }
            other => panic!("expected clear Pi/Node workspace cwd failure, got {other:?}"),
        }
    }

    #[test]
    fn pi_adapter_prepare_runs_node_cwd_preflight() {
        static PREFLIGHT_CALLED: std::sync::atomic::AtomicBool =
            std::sync::atomic::AtomicBool::new(false);

        fn recording_preflight(_cwd: &Path, _env: &HashMap<String, String>) -> Result<(), String> {
            PREFLIGHT_CALLED.store(true, Ordering::SeqCst);
            Ok(())
        }

        PREFLIGHT_CALLED.store(false, Ordering::SeqCst);
        let mut adapter = PiPtyAdapter {
            prompt: String::new(),
            resume_session_id: None,
            continue_session: false,
            extension_path: Some(PathBuf::from("/tmp/openforge-pi-extension")),
            node_cwd_preflight: recording_preflight,
        };

        adapter
            .prepare(Path::new("/tmp"))
            .expect("Pi prepare should succeed when preflight succeeds");

        assert!(PREFLIGHT_CALLED.load(Ordering::SeqCst));
    }

    #[test]
    fn pi_adapter_prepare_stops_before_extension_install_when_node_cwd_preflight_fails() {
        fn failing_preflight(_cwd: &Path, _env: &HashMap<String, String>) -> Result<(), String> {
            Err("uv_cwd EPERM".to_string())
        }

        let mut adapter = PiPtyAdapter {
            prompt: String::new(),
            resume_session_id: None,
            continue_session: false,
            extension_path: None,
            node_cwd_preflight: failing_preflight,
        };

        let result = adapter.prepare(Path::new("/tmp"));

        assert!(
            matches!(result, Err(PtyError::InvalidWorkspaceCwd { reason, .. }) if reason.contains("Pi/Node") && reason.contains("uv_cwd EPERM"))
        );
        assert!(adapter.extension_path.is_none());
    }
}
