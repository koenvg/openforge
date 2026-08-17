use super::process_signals::{exit_status_signal, force_kill_process, send_terminate_signal};
use super::runtime_command::{resolve_entrypoint, resolve_sidecar_runtime};
use super::PluginHost;
use crate::app_events::publish_app_event;
use log::{error, info, warn};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout};

const MAX_RESTART_RETRIES: u32 = 3;
const RESTART_BACKOFFS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const FORCE_KILL_TIMEOUT: Duration = Duration::from_secs(1);
pub(super) const SIDECAR_EXITED_EVENT: &str = "plugin:sidecar-exited";
pub(super) const SIDECAR_FAILED_EVENT: &str = "plugin:sidecar-failed";

fn is_diagnostic_plugin_id(plugin_id: &str) -> bool {
    let mut characters = plugin_id.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }

    let mut previous_was_separator = false;
    for character in characters {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            previous_was_separator = false;
        } else if matches!(character, '.' | '_' | '-') && !previous_was_separator {
            previous_was_separator = true;
        } else {
            return false;
        }
    }
    !previous_was_separator
}

/// Formats plugin-host stderr for desktop diagnostics under a content-minimizing policy.
/// Only canonical `[plugin:<id>] <message>` lines retain context. Retained context uses the
/// shared log redactor, escapes control characters, and is character-bounded; all other
/// stderr content is suppressed and represented only by its byte count.
pub(super) fn format_sidecar_stderr_diagnostic(line: &str) -> String {
    let is_plugin_tagged = line
        .strip_prefix("[plugin:")
        .and_then(|rest| rest.split_once("] "))
        .is_some_and(|(plugin_id, message)| {
            is_diagnostic_plugin_id(plugin_id) && !message.is_empty()
        });
    if !is_plugin_tagged {
        return format!(
            "[plugin_host] sidecar stderr line suppressed bytes={}",
            line.len()
        );
    }

    const MAX_CONTEXT_CHARS: usize = 2_000;
    const TRUNCATION_MARKER: &str = "… [truncated]";

    let sanitized = crate::sidecar_logger::sanitize_log_message(line);
    let mut normalized = String::with_capacity(sanitized.len());
    for character in sanitized.chars() {
        if character.is_control() {
            normalized.extend(character.escape_default());
        } else {
            normalized.push(character);
        }
    }
    let mut chars = normalized.chars();
    let bounded: String = chars.by_ref().take(MAX_CONTEXT_CHARS).collect();
    let bounded = if chars.next().is_some() {
        format!("{bounded}{TRUNCATION_MARKER}")
    } else {
        bounded
    };
    format!("[plugin_host] sidecar stderr line {bounded}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Crashed,
}

#[derive(Debug, Clone, Serialize)]
struct SidecarExitPayload {
    code: Option<i32>,
    signal: Option<i32>,
    pid: Option<u32>,
    retry_attempts: u32,
}

#[derive(Debug, Clone, Serialize)]
struct SidecarFailurePayload {
    error: Option<String>,
    retry_attempts: u32,
}

#[derive(Debug)]
pub(in crate::plugin_host) struct HostRuntime {
    pub(in crate::plugin_host) state: SidecarState,
    pub(in crate::plugin_host) pid: Option<u32>,
    pub(in crate::plugin_host) desired_running: bool,
    pub(in crate::plugin_host) retry_attempts: u32,
    pub(in crate::plugin_host) session_id: u64,
    pub(in crate::plugin_host) process_token: u64,
}

impl Default for HostRuntime {
    fn default() -> Self {
        Self {
            state: SidecarState::Stopped,
            pid: None,
            desired_running: false,
            retry_attempts: 0,
            session_id: 0,
            process_token: 0,
        }
    }
}

impl HostRuntime {
    fn next_restart_delay(&mut self) -> Option<Duration> {
        let delay = RESTART_BACKOFFS
            .get(self.retry_attempts as usize)
            .copied()?;
        self.retry_attempts += 1;
        Some(delay)
    }

    fn mark_running(&mut self, pid: u32) {
        self.state = SidecarState::Running;
        self.pid = Some(pid);
        self.retry_attempts = 0;
    }
}
impl PluginHost {
    pub async fn start_sidecar(&self) -> Result<(), String> {
        let session_id = {
            let mut runtime = self.runtime_lock()?;

            match runtime.state {
                SidecarState::Running | SidecarState::Starting if runtime.desired_running => {
                    return Ok(());
                }
                SidecarState::Stopping => {
                    return Err("plugin sidecar is stopping".to_string());
                }
                _ => {}
            }

            runtime.desired_running = true;
            runtime.retry_attempts = 0;
            runtime.pid = None;
            runtime.session_id += 1;
            runtime.state = SidecarState::Starting;
            runtime.session_id
        };

        self.state_change.notify_waiters();
        self.spawn_sidecar_for_session(session_id).await
    }

    pub async fn stop_sidecar(&self) -> Result<(), String> {
        let pid = {
            let mut runtime = self.runtime_lock()?;
            runtime.desired_running = false;
            runtime.retry_attempts = 0;

            match runtime.state {
                SidecarState::Stopped => return Ok(()),
                SidecarState::Crashed if runtime.pid.is_none() => {
                    runtime.state = SidecarState::Stopped;
                    runtime.pid = None;
                    self.state_change.notify_waiters();
                    return Ok(());
                }
                _ => {
                    runtime.state = SidecarState::Stopping;
                    runtime.pid
                }
            }
        };

        self.state_change.notify_waiters();

        if let Some(pid) = pid {
            send_terminate_signal(pid)?;
        }

        if timeout(STOP_TIMEOUT, self.wait_for_stopped()).await.is_ok() {
            return Ok(());
        }

        let pid = self.runtime_lock()?.pid;
        if let Some(pid) = pid {
            warn!(
                "[plugin_host] sidecar PID {} did not stop gracefully, force killing",
                pid
            );
            force_kill_process(pid)?;
        }

        if timeout(FORCE_KILL_TIMEOUT, self.wait_for_stopped())
            .await
            .is_ok()
        {
            return Ok(());
        }

        let mut runtime = self.runtime_lock()?;
        runtime.pid = None;
        runtime.state = SidecarState::Stopped;
        self.state_change.notify_waiters();
        Ok(())
    }

    pub fn is_sidecar_running(&self) -> bool {
        matches!(self.get_state(), SidecarState::Running)
    }

    pub fn get_state(&self) -> SidecarState {
        match self.runtime.lock() {
            Ok(runtime) => runtime.state.clone(),
            Err(_) => SidecarState::Crashed,
        }
    }

    async fn spawn_sidecar_for_session(&self, session_id: u64) -> Result<(), String> {
        let entrypoint = resolve_entrypoint(&self.app_handle)?;
        let runtime = resolve_sidecar_runtime(&entrypoint)?;

        info!(
            "[plugin_host] starting plugin sidecar runtime_kind={} entrypoint_extension={}",
            runtime.kind(),
            entrypoint
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("none")
        );

        let mut command = Command::new(&runtime.command);
        command
            .args(&runtime.args)
            .envs(&runtime.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);

        if let Some(parent) = entrypoint.parent() {
            command.current_dir(parent);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("failed to spawn plugin sidecar: {error}");
                self.mark_crashed_if_current(session_id)?;
                return Err(message);
            }
        };

        let pid = child
            .id()
            .ok_or_else(|| "failed to read plugin sidecar pid".to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to capture plugin sidecar stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to capture plugin sidecar stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to capture plugin sidecar stderr".to_string())?;

        let process_token = {
            let mut runtime = self.runtime_lock()?;
            if session_id != runtime.session_id || !runtime.desired_running {
                drop(runtime);
                send_terminate_signal(pid)?;
                return Ok(());
            }

            runtime.process_token += 1;
            runtime.mark_running(pid);
            runtime.process_token
        };

        {
            let mut transport = self.transport_lock()?;
            transport.writer = Some(Arc::new(tokio::sync::Mutex::new(stdin)));
            transport.pending.clear();
            transport.session_id = session_id;
            transport.process_token = process_token;
        }

        self.state_change.notify_waiters();

        let stdout_host = (*self).clone();
        tokio::spawn(async move {
            stdout_host
                .read_sidecar_stdout(stdout, session_id, process_token)
                .await;
        });

        tokio::spawn(async move {
            let mut stderr_lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = stderr_lines.next_line().await {
                warn!("{}", format_sidecar_stderr_diagnostic(&line));
            }
        });

        let host = (*self).clone();
        tokio::spawn(async move {
            host.monitor_sidecar(child, session_id, process_token).await;
        });

        Ok(())
    }

    async fn monitor_sidecar(&self, mut child: Child, session_id: u64, process_token: u64) {
        let status = match child.wait().await {
            Ok(status) => status,
            Err(error) => {
                error!("[plugin_host] failed waiting for sidecar exit: {}", error);
                let retry = match self.record_crash_and_plan_restart(session_id, process_token) {
                    Ok(retry) => retry,
                    Err(lock_error) => {
                        error!("[plugin_host] failed to record crash state: {}", lock_error);
                        None
                    }
                };

                self.emit_sidecar_exited(None, None, None);
                self.schedule_restart_or_emit_failure(session_id, retry, Some(error.to_string()));
                return;
            }
        };

        let code = status.code();
        let signal = exit_status_signal(&status);
        let retry = match self.record_exit_state(session_id, process_token) {
            Ok(retry) => retry,
            Err(error) => {
                error!(
                    "[plugin_host] failed to update sidecar exit state: {}",
                    error
                );
                None
            }
        };

        if retry.is_none() && !matches!(self.get_state(), SidecarState::Crashed) {
            return;
        }

        self.emit_sidecar_exited(code, signal, child.id());
        self.schedule_restart_or_emit_failure(session_id, retry, None);
    }

    fn record_exit_state(
        &self,
        session_id: u64,
        process_token: u64,
    ) -> Result<Option<Duration>, String> {
        let mut runtime = self.runtime_lock()?;

        if runtime.session_id != session_id || runtime.process_token != process_token {
            return Ok(None);
        }

        runtime.pid = None;
        drop(runtime);
        self.reset_transport(session_id, process_token, "plugin sidecar exited");
        let mut runtime = self.runtime_lock()?;

        if !runtime.desired_running || matches!(runtime.state, SidecarState::Stopping) {
            runtime.state = SidecarState::Stopped;
            runtime.retry_attempts = 0;
            self.state_change.notify_waiters();
            return Ok(None);
        }

        runtime.state = SidecarState::Crashed;
        let retry = runtime.next_restart_delay();
        self.state_change.notify_waiters();
        Ok(retry)
    }

    fn record_crash_and_plan_restart(
        &self,
        session_id: u64,
        process_token: u64,
    ) -> Result<Option<Duration>, String> {
        let mut runtime = self.runtime_lock()?;

        if runtime.session_id != session_id || runtime.process_token != process_token {
            return Ok(None);
        }

        runtime.pid = None;
        drop(runtime);
        self.reset_transport(session_id, process_token, "plugin sidecar crashed");
        let mut runtime = self.runtime_lock()?;
        runtime.state = SidecarState::Crashed;
        let retry = runtime.next_restart_delay();
        self.state_change.notify_waiters();
        Ok(retry)
    }

    fn mark_crashed_if_current(&self, session_id: u64) -> Result<(), String> {
        let mut runtime = self.runtime_lock()?;
        if runtime.session_id == session_id && runtime.desired_running {
            runtime.pid = None;
            runtime.state = SidecarState::Crashed;
            drop(runtime);
            self.reset_transport(session_id, 0, "plugin sidecar failed to start");
            self.state_change.notify_waiters();
        }
        Ok(())
    }
    fn schedule_restart_or_emit_failure(
        &self,
        session_id: u64,
        retry: Option<Duration>,
        error: Option<String>,
    ) {
        if let Some(delay) = retry {
            let host = (*self).clone();
            tokio::spawn(async move {
                host.restart_after_delay(session_id, delay).await;
            });
            return;
        }

        self.emit_sidecar_failed(error);
    }

    async fn restart_after_delay(&self, session_id: u64, delay: Duration) {
        sleep(delay).await;

        let should_restart = match self.runtime_lock() {
            Ok(runtime) => {
                runtime.session_id == session_id
                    && runtime.desired_running
                    && matches!(runtime.state, SidecarState::Crashed)
            }
            Err(error) => {
                error!("[plugin_host] failed to inspect restart state: {}", error);
                false
            }
        };

        if !should_restart {
            return;
        }

        if let Ok(mut runtime) = self.runtime_lock() {
            if runtime.session_id == session_id && runtime.desired_running {
                runtime.state = SidecarState::Starting;
                self.state_change.notify_waiters();
            }
        }

        if let Err(error) = self.spawn_sidecar_for_session(session_id).await {
            warn!("[plugin_host] restart attempt failed: {}", error);

            let next_retry = match self.runtime_lock() {
                Ok(mut runtime) => {
                    if runtime.session_id != session_id || !runtime.desired_running {
                        None
                    } else {
                        runtime.state = SidecarState::Crashed;
                        self.state_change.notify_waiters();
                        runtime.next_restart_delay()
                    }
                }
                Err(lock_error) => {
                    error!(
                        "[plugin_host] failed to update restart state: {}",
                        lock_error
                    );
                    None
                }
            };

            self.schedule_restart_or_emit_failure(session_id, next_retry, Some(error));
        }
    }

    async fn wait_for_stopped(&self) {
        loop {
            if matches!(self.get_state(), SidecarState::Stopped) {
                return;
            }

            self.state_change.notified().await;
        }
    }

    pub(super) fn emit_sidecar_exited(
        &self,
        code: Option<i32>,
        signal: Option<i32>,
        pid: Option<u32>,
    ) {
        let retry_attempts = self
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.retry_attempts)
            .unwrap_or(MAX_RESTART_RETRIES);

        let payload = SidecarExitPayload {
            code,
            signal,
            pid,
            retry_attempts,
        };

        self.publish_sidecar_event(SIDECAR_EXITED_EVENT, &payload);
    }

    pub(super) fn emit_sidecar_failed(&self, error: Option<String>) {
        let retry_attempts = self
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.retry_attempts)
            .unwrap_or(MAX_RESTART_RETRIES);

        let payload = SidecarFailurePayload {
            error,
            retry_attempts,
        };

        self.publish_sidecar_event(SIDECAR_FAILED_EVENT, &payload);
    }

    fn publish_sidecar_event<T: Serialize>(&self, event_name: &str, payload: &T) {
        match serde_json::to_value(payload) {
            Ok(value) => publish_app_event(&self.app_event_tx, event_name, &value),
            Err(error) => warn!(
                "[plugin_host] failed to serialize sidecar event {}: {}",
                event_name, error
            ),
        }
    }

    #[cfg(test)]
    pub(super) fn mark_running_for_test(&self, pid: u32) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.desired_running = true;
            runtime.mark_running(pid);
        }
    }

    #[cfg(test)]
    pub(super) fn mark_stopping_for_test(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.state = SidecarState::Stopping;
        }
    }

    #[cfg(test)]
    pub(super) fn complete_stop_for_test(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.state = SidecarState::Stopped;
            runtime.pid = None;
            runtime.desired_running = false;
        }
    }

    #[cfg(test)]
    pub(super) fn handle_unexpected_exit_for_test(&self) -> Option<Duration> {
        match self.runtime.lock() {
            Ok(mut runtime) => {
                runtime.state = SidecarState::Crashed;
                runtime.pid = None;
                runtime.desired_running = true;
                runtime.next_restart_delay()
            }
            Err(_) => None,
        }
    }
}
