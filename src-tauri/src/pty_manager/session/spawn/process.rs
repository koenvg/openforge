//! PTY command configuration and child-process creation.

use crate::app_events::RuntimeEventPublisher;
use crate::terminal_model::{TerminalModelFeeder, TerminalModelOptions, TerminalModelSession};
use crate::user_environment::user_environment;
use log::{info, warn};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::super::super::authority::ParsedStateOwner;
use super::super::super::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use super::super::super::ordered_writer::OrderedPtyWriter;
use super::super::super::pids::pid_file_name_for_session_key;
use super::super::super::terminal_model_bridge::TerminalModelEventBridge;
use super::super::super::{terminal_environment, PtyError, PtyManager, TerminalImageProtocol};
use super::super::invalid_workspace_cwd;
use super::super::lifecycle::{PtySession, PtySessionKind, NEXT_INSTANCE_ID};
use super::super::provider_adapter::AgentPtyProviderAdapter;

pub(super) fn resolve_pty_cwd(cwd: &Path) -> Result<PathBuf, PtyError> {
    let resolved_cwd = std::fs::canonicalize(cwd).map_err(|e| invalid_workspace_cwd(cwd, e))?;
    let metadata = std::fs::metadata(&resolved_cwd).map_err(|e| invalid_workspace_cwd(cwd, e))?;

    if !metadata.is_dir() {
        return Err(invalid_workspace_cwd(cwd, "not a directory"));
    }

    Ok(resolved_cwd)
}

pub(super) struct SpawnedPty {
    pub(super) reader: Box<dyn Read + Send>,
    pub(super) session: PtySession,
    pub(super) pid_file: PathBuf,
    pub(super) terminal_model_feeder: Option<TerminalModelFeeder>,
}

impl SpawnedPty {
    pub(super) fn instance_id(&self) -> u64 {
        self.session.instance_id
    }

    pub(super) fn managed_process(&self) -> &ManagedProcessIdentity {
        &self.session.managed_process
    }
}

struct PtyProcessRequest {
    command: CommandBuilder,
    session_key: String,
    cols: u16,
    rows: u16,
    instance_id: u64,
    description: String,
    pid_file_name: String,
    kind: PtySessionKind,
    event_publisher: RuntimeEventPublisher,
}

pub(super) struct AgentProcessRequest<'a> {
    pub(super) task_id: &'a str,
    pub(super) cwd: &'a Path,
    pub(super) cols: u16,
    pub(super) rows: u16,
    pub(super) terminal_image_protocol: Option<TerminalImageProtocol>,
    pub(super) event_publisher: RuntimeEventPublisher,
}

pub(super) struct ShellProcessRequest<'a> {
    pub(super) task_id: &'a str,
    pub(super) session_key: &'a str,
    pub(super) cwd: &'a Path,
    pub(super) cols: u16,
    pub(super) rows: u16,
    pub(super) terminal_image_protocol: Option<TerminalImageProtocol>,
    pub(super) event_publisher: RuntimeEventPublisher,
    pub(super) command: CommandBuilder,
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

impl PtyManager {
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
        let raw_writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::SpawnFailed(format!("Failed to take writer: {error}")))?;
        let writer = Arc::new(
            OrderedPtyWriter::start(request.session_key.clone(), request.instance_id, raw_writer)
                .map_err(|error| {
                PtyError::SpawnFailed(format!("Failed to start ordered PTY writer: {error}"))
            })?,
        );
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

        let authority = self.terminal_authority_contract();
        let (terminal_model, terminal_model_feeder) = if self.terminal_model_enabled() {
            let options = TerminalModelOptions::new(request.cols, request.rows);
            let started = if authority.parsed_state_owner == ParsedStateOwner::Ghostty {
                TerminalModelSession::start_with_event_sink(
                    request.session_key.clone(),
                    request.instance_id,
                    options,
                    TerminalModelEventBridge::new(
                        request.session_key.clone(),
                        request.event_publisher.clone(),
                        Arc::clone(&writer),
                    )
                    .into_event_sink(),
                )
            } else {
                TerminalModelSession::start(
                    request.session_key.clone(),
                    request.instance_id,
                    options,
                )
            };
            match started {
                Ok((session, feeder)) => (Some(session), Some(feeder)),
                Err(error) => {
                    warn!(
                        "[terminal-model] key={} instance={} phase=create disabled: {}",
                        request.session_key, request.instance_id, error
                    );
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        Ok(SpawnedPty {
            reader,
            session: PtySession {
                child,
                master: Arc::new(std::sync::Mutex::new(pair.master)),
                writer,
                instance_id: request.instance_id,
                authority,
                kind: request.kind,
                pid_file_name: request.pid_file_name,
                terminal_model: terminal_model.map(Arc::new),
                managed_process,
            },
            pid_file,
            terminal_model_feeder,
        })
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
            event_publisher: request.event_publisher,
        })?;
        info!(
            "{} PTY for task {} started (PID: {})",
            adapter.label(),
            request.task_id,
            spawned.managed_process().root_pid
        );
        Ok(spawned)
    }

    pub(super) fn create_shell_process(
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
            event_publisher,
            mut command,
        } = request;
        info!("Spawning shell PTY for task {task_id} ({cols}x{rows})");
        Self::configure_pty_command(&mut command, cwd, terminal_image_protocol);
        let spawned = self.create_pty_process(PtyProcessRequest {
            command,
            session_key: session_key.to_string(),
            cols,
            rows,
            instance_id: NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed),
            description: format!("Shell PTY for task {task_id}"),
            pid_file_name: pid_file_name_for_session_key(session_key),
            kind: PtySessionKind::Shell {
                task_id: task_id.to_string(),
            },
            event_publisher,
        })?;
        info!(
            "Shell PTY for task {} started (PID: {})",
            task_id,
            spawned.managed_process().root_pid
        );
        Ok(spawned)
    }
}

#[cfg(test)]
#[path = "tests/process.rs"]
mod tests;
