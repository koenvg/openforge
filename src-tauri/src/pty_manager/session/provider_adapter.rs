use crate::user_environment::{find_tool_on_path, user_environment, user_tool_path};
use log::info;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::super::commands::{
    build_claude_args, build_codex_args, build_grok_args, build_opencode_tui_args, build_pi_args,
    PiSessionTarget,
};
use super::super::PtyError;
use super::invalid_workspace_cwd;

pub(super) trait AgentPtyProviderAdapter {
    fn label(&self) -> &'static str;
    fn command_name(&self) -> &str;
    fn command_args(&self) -> Vec<String>;
    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError>;
    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String>;
    fn removed_env(&self) -> &'static [&'static str] {
        &[]
    }
    fn base_environment(&self) -> Option<&HashMap<String, String>> {
        None
    }
    fn pid_file_name(&self, task_id: &str) -> String;
}

pub(crate) enum ProviderPtyAdapter {
    ClaudeCode(ClaudeCodePtyAdapter),
    Codex(CodexPtyAdapter),
    OpenCode(OpenCodePtyAdapter),
    Pi(PiPtyAdapter),
    Grok(GrokPtyAdapter),
}

impl ProviderPtyAdapter {
    pub(crate) fn claude_code(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        hooks_settings_path: &Path,
        permission_mode: Option<&str>,
    ) -> Self {
        Self::ClaudeCode(ClaudeCodePtyAdapter::new(
            prompt,
            resume_session_id,
            continue_session,
            hooks_settings_path,
            permission_mode,
        ))
    }

    pub(crate) fn codex(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
    ) -> Self {
        Self::Codex(CodexPtyAdapter::new(
            prompt,
            resume_session_id,
            continue_session,
        ))
    }

    pub(crate) fn opencode(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        agent: Option<&str>,
        model: Option<&str>,
    ) -> Self {
        Self::OpenCode(OpenCodePtyAdapter::new(
            prompt,
            resume_session_id,
            continue_session,
            agent,
            model,
        ))
    }

    pub(crate) fn pi(prompt: &str, session_target: PiSessionTarget) -> Self {
        Self::Pi(PiPtyAdapter::new(prompt, session_target, None))
    }

    pub(crate) fn grok(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        permission_mode: Option<&str>,
        model: Option<&str>,
    ) -> Self {
        Self::Grok(GrokPtyAdapter::new(
            prompt,
            resume_session_id,
            continue_session,
            permission_mode,
            model,
        ))
    }
}

impl AgentPtyProviderAdapter for ProviderPtyAdapter {
    fn label(&self) -> &'static str {
        match self {
            Self::ClaudeCode(adapter) => adapter.label(),
            Self::Codex(adapter) => adapter.label(),
            Self::OpenCode(adapter) => adapter.label(),
            Self::Pi(adapter) => adapter.label(),
            Self::Grok(adapter) => adapter.label(),
        }
    }

    fn command_name(&self) -> &str {
        match self {
            Self::ClaudeCode(adapter) => adapter.command_name(),
            Self::Codex(adapter) => adapter.command_name(),
            Self::OpenCode(adapter) => adapter.command_name(),
            Self::Pi(adapter) => adapter.command_name(),
            Self::Grok(adapter) => adapter.command_name(),
        }
    }

    fn command_args(&self) -> Vec<String> {
        match self {
            Self::ClaudeCode(adapter) => adapter.command_args(),
            Self::Codex(adapter) => adapter.command_args(),
            Self::OpenCode(adapter) => adapter.command_args(),
            Self::Pi(adapter) => adapter.command_args(),
            Self::Grok(adapter) => adapter.command_args(),
        }
    }

    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError> {
        match self {
            Self::ClaudeCode(adapter) => adapter.prepare(cwd),
            Self::Codex(adapter) => adapter.prepare(cwd),
            Self::OpenCode(adapter) => adapter.prepare(cwd),
            Self::Pi(adapter) => adapter.prepare(cwd),
            Self::Grok(adapter) => adapter.prepare(cwd),
        }
    }

    fn extra_env(&self, session_key: &str, instance_id: u64) -> HashMap<String, String> {
        match self {
            Self::ClaudeCode(adapter) => adapter.extra_env(session_key, instance_id),
            Self::Codex(adapter) => adapter.extra_env(session_key, instance_id),
            Self::OpenCode(adapter) => adapter.extra_env(session_key, instance_id),
            Self::Pi(adapter) => adapter.extra_env(session_key, instance_id),
            Self::Grok(adapter) => adapter.extra_env(session_key, instance_id),
        }
    }

    fn removed_env(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode(adapter) => adapter.removed_env(),
            Self::Codex(adapter) => adapter.removed_env(),
            Self::OpenCode(adapter) => adapter.removed_env(),
            Self::Pi(adapter) => adapter.removed_env(),
            Self::Grok(adapter) => adapter.removed_env(),
        }
    }

    fn base_environment(&self) -> Option<&HashMap<String, String>> {
        match self {
            Self::ClaudeCode(adapter) => adapter.base_environment(),
            Self::Codex(adapter) => adapter.base_environment(),
            Self::OpenCode(adapter) => adapter.base_environment(),
            Self::Pi(adapter) => adapter.base_environment(),
            Self::Grok(adapter) => adapter.base_environment(),
        }
    }

    fn pid_file_name(&self, session_key: &str) -> String {
        match self {
            Self::ClaudeCode(adapter) => adapter.pid_file_name(session_key),
            Self::Codex(adapter) => adapter.pid_file_name(session_key),
            Self::OpenCode(adapter) => adapter.pid_file_name(session_key),
            Self::Pi(adapter) => adapter.pid_file_name(session_key),
            Self::Grok(adapter) => adapter.pid_file_name(session_key),
        }
    }
}

pub(super) struct ScopedAgentPtyAdapter<A> {
    inner: A,
    scoped_session_id: String,
    credential_path: PathBuf,
}

impl<A> ScopedAgentPtyAdapter<A> {
    pub(super) fn new(inner: A, scoped_session_id: &str, credential_path: PathBuf) -> Self {
        Self {
            inner,
            scoped_session_id: scoped_session_id.to_string(),
            credential_path,
        }
    }
}

impl<A: AgentPtyProviderAdapter> AgentPtyProviderAdapter for ScopedAgentPtyAdapter<A> {
    fn label(&self) -> &'static str {
        self.inner.label()
    }

    fn command_name(&self) -> &str {
        self.inner.command_name()
    }

    fn command_args(&self) -> Vec<String> {
        self.inner.command_args()
    }

    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError> {
        self.inner.prepare(cwd)
    }

    fn extra_env(&self, _session_key: &str, instance_id: u64) -> HashMap<String, String> {
        HashMap::from([
            ("OPENFORGE_TASK_ID".to_string(), String::new()),
            (
                "OPENFORGE_SCOPED_SESSION_ID".to_string(),
                self.scoped_session_id.clone(),
            ),
            (
                "OPENFORGE_AGENT_CONFIG".to_string(),
                self.credential_path.to_string_lossy().into_owned(),
            ),
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

    fn removed_env(&self) -> &'static [&'static str] {
        &[
            "CLAUDE_TASK_ID",
            "OPENFORGE_AGENT_CONFIG",
            "OPENFORGE_AGENT_TOKEN",
            "OPENFORGE_BACKEND_TOKEN",
            "OPENFORGE_TASK_ID",
        ]
    }

    fn base_environment(&self) -> Option<&HashMap<String, String>> {
        self.inner.base_environment()
    }

    fn pid_file_name(&self, session_key: &str) -> String {
        self.inner.pid_file_name(session_key)
    }
}

pub(crate) struct ClaudeCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    hooks_settings_path: PathBuf,
    permission_mode: Option<String>,
}

impl ClaudeCodePtyAdapter {
    pub(super) fn new(
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
            ("OPENFORGE_SCOPED_SESSION_ID".to_string(), String::new()),
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
}

pub(crate) struct OpenCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    agent: Option<String>,
    model: Option<String>,
}

impl OpenCodePtyAdapter {
    pub(super) fn new(
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
}

pub(crate) struct CodexPtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
}

impl CodexPtyAdapter {
    pub(super) fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
    ) -> Self {
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
}

type PiNodeCwdPreflight = fn(&Path, &HashMap<String, String>) -> Result<(), String>;

pub(crate) struct PiPtyAdapter {
    prompt: String,
    session_target: PiSessionTarget,
    extension_path: Option<PathBuf>,
    node_cwd_preflight: PiNodeCwdPreflight,
}

impl PiPtyAdapter {
    pub(super) fn new(
        prompt: &str,
        session_target: PiSessionTarget,
        extension_path: Option<PathBuf>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            session_target,
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
            &self.session_target,
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
}

pub(crate) struct GrokPtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    permission_mode: Option<String>,
    model: Option<String>,
}

impl GrokPtyAdapter {
    pub(super) fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        permission_mode: Option<&str>,
        model: Option<&str>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            permission_mode: permission_mode.map(str::to_string),
            model: model.map(str::to_string),
        }
    }
}

impl AgentPtyProviderAdapter for GrokPtyAdapter {
    fn label(&self) -> &'static str {
        "Grok"
    }

    fn command_name(&self) -> &'static str {
        "grok"
    }

    fn command_args(&self) -> Vec<String> {
        build_grok_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            self.permission_mode.as_deref(),
            self.model.as_deref(),
        )
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        // Non-fatal, mirroring ClaudeCodePtyAdapter::prepare: the hook is only
        // status telemetry (reports agent lifecycle back to OpenForge), so an
        // unwritable ~/.grok (root-owned, read-only mount, non-writable
        // GROK_HOME, ...) must not block the Grok task from launching at all.
        // Consequence of a failure here: status reporting for this task
        // degrades (OpenForge won't see busy/idle/permission-request events),
        // but the `grok` agent itself still runs normally.
        if let Err(e) = crate::grok_hooks::install_openforge_hook() {
            info!("[PTY] Warning: Failed to install Grok hook: {}", e);
        }
        Ok(())
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }
}

fn openforge_agent_env(task_id: &str, instance_id: u64) -> HashMap<String, String> {
    HashMap::from([
        ("OPENFORGE_TASK_ID".to_string(), task_id.to_string()),
        ("OPENFORGE_SCOPED_SESSION_ID".to_string(), String::new()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn grok_adapter_label_and_command_name() {
        let a = GrokPtyAdapter::new("", None, false, Some("acceptEdits"), None);
        assert_eq!(a.label(), "Grok");
        assert_eq!(a.command_name(), "grok");
    }

    #[test]
    fn grok_adapter_command_args_appends_double_dash_and_prompt_last() {
        let a = GrokPtyAdapter::new(
            "fix the bug",
            Some("grok-session"),
            false,
            Some("acceptEdits"),
            Some("grok-build"),
        );
        assert_eq!(
            a.command_args(),
            vec![
                "--resume",
                "grok-session",
                "--permission-mode",
                "acceptEdits",
                "--model",
                "grok-build",
                "--",
                "fix the bug",
            ]
        );
    }

    #[test]
    fn grok_adapter_extra_env_sets_openforge_task_id() {
        let a = GrokPtyAdapter::new("", None, false, None, None);
        let env = a.extra_env("T-1", 7);
        assert_eq!(env.get("OPENFORGE_TASK_ID").unwrap(), "T-1");
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID").unwrap(), "7");
    }

    #[test]
    fn scoped_owner_reuses_normal_adapter_and_replaces_task_credentials() {
        let adapter = ScopedAgentPtyAdapter::new(
            CodexPtyAdapter::new("continue", None, true),
            "sas-1",
            PathBuf::from("/tmp/scoped-agent.json"),
        );

        assert_eq!(adapter.command_name(), "codex");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--profile",
                crate::codex_hooks::OPENFORGE_CODEX_PROFILE_NAME,
                "resume",
                "--last",
                "continue",
            ]
        );
        let env = adapter.extra_env("scoped-key", 17);
        assert_eq!(
            env.get("OPENFORGE_SCOPED_SESSION_ID").map(String::as_str),
            Some("sas-1")
        );
        assert_eq!(
            env.get("OPENFORGE_AGENT_CONFIG").map(String::as_str),
            Some("/tmp/scoped-agent.json")
        );
        assert_eq!(
            env.get("OPENFORGE_PTY_INSTANCE_ID").map(String::as_str),
            Some("17")
        );
        assert_eq!(env.get("OPENFORGE_TASK_ID").map(String::as_str), Some(""));
        assert!(adapter.removed_env().contains(&"OPENFORGE_TASK_ID"));
        assert!(adapter.removed_env().contains(&"OPENFORGE_BACKEND_TOKEN"));
    }

    #[test]
    fn every_provider_keeps_its_normal_command_under_scoped_ownership() {
        let hooks = PathBuf::from("/tmp/openforge-hooks.json");
        let adapters = vec![
            ProviderPtyAdapter::claude_code(
                "continue",
                Some("provider-session"),
                false,
                &hooks,
                None,
            ),
            ProviderPtyAdapter::codex("continue", Some("provider-session"), false),
            ProviderPtyAdapter::opencode("continue", Some("provider-session"), false, None, None),
            ProviderPtyAdapter::pi(
                "continue",
                PiSessionTarget::Existing("provider-session".to_string()),
            ),
            ProviderPtyAdapter::grok("continue", Some("provider-session"), false, None, None),
        ];

        for normal in adapters {
            let command_name = normal.command_name().to_string();
            let command_args = normal.command_args();
            let scoped = ScopedAgentPtyAdapter::new(
                normal,
                "sas-provider-matrix",
                PathBuf::from("/tmp/scoped-agent.json"),
            );

            assert_eq!(scoped.command_name(), command_name);
            assert_eq!(scoped.command_args(), command_args);
            assert!(command_args.iter().any(|arg| arg == "provider-session"));
            let env = scoped.extra_env("scoped-key", 73);
            assert_eq!(
                env.get("OPENFORGE_SCOPED_SESSION_ID").map(String::as_str),
                Some("sas-provider-matrix")
            );
            assert_eq!(env.get("OPENFORGE_TASK_ID").map(String::as_str), Some(""));
        }
    }

    #[test]
    fn grok_adapter_prepare_is_non_fatal() {
        // Fix 2 regression guard: prepare() must always return Ok(()), even
        // when the Grok hook install fails (unwritable ~/.grok, read-only
        // mount, non-writable GROK_HOME, ...), because the hook is only
        // status telemetry — grok itself still runs fine without it.
        let mut a = GrokPtyAdapter::new("", None, false, None, None);
        assert!(a.prepare(Path::new("/tmp")).is_ok());
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
            PiSessionTarget::Existing("pi-session".to_string()),
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
            session_target: PiSessionTarget::ContinueLatest,
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
            session_target: PiSessionTarget::ContinueLatest,
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
