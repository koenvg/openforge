//! Shared PTY process creation and session publication primitives.

use crate::app_events::{publish_app_event, AppEventSender};
use crate::terminal_model::{
    ShadowTerminalFeeder, ShadowTerminalSession, TerminalModelEvent, TerminalModelEventSink,
    TerminalModelOptions,
};
use crate::user_environment::user_environment;
use base64::Engine;
use log::{info, warn};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use super::super::attachment::PtyAttachmentHub;
use super::super::events::SharedRingBuffer;
use super::super::managed_process::{force_kill_unverified_spawn, ManagedProcessIdentity};
use super::super::pids::write_managed_process_identity;
use super::super::{terminal_environment, PtyError, PtyManager, TerminalImageProtocol};
use super::invalid_workspace_cwd;
use super::lifecycle::{PtySession, PtySessionKind};

mod agent;
mod shell;

#[cfg(test)]
mod tests;

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

struct SpawnedPty {
    reader: Box<dyn Read + Send>,
    session: PtySession,
    pid_file: PathBuf,
    shadow_feeder: Option<ShadowTerminalFeeder>,
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
    session_key: String,
    cols: u16,
    rows: u16,
    instance_id: u64,
    description: String,
    pid_file_name: String,
    kind: PtySessionKind,
    app_event_tx: Option<AppEventSender>,
}

struct SessionRegistrationRequest<'a> {
    session_key: &'a str,
    generation: u64,
    session: PtySession,
    replacement_label: &'a str,
    stale_error: PtyError,
}

struct PtyEventSink {
    app_handle: Option<crate::backend_runtime::AppHandle>,
    app_event_tx: Option<AppEventSender>,
}

fn terminal_model_event_sink(
    session_key: &str,
    app_event_tx: Option<AppEventSender>,
) -> Option<TerminalModelEventSink> {
    let sender = Some(app_event_tx?);
    let output_event_name = format!("pty-model-output-{session_key}");
    let disabled_event_name = format!("pty-model-disabled-{session_key}");
    Some(Arc::new(move |event| match event {
        TerminalModelEvent::Output(frame) => publish_app_event(
            &sender,
            &output_event_name,
            &serde_json::json!({
                "instance_id": frame.instance_id,
                "sequence": frame.sequence,
                "data": base64::engine::general_purpose::STANDARD.encode(frame.bytes),
            }),
        ),
        TerminalModelEvent::Disabled { instance_id } => publish_app_event(
            &sender,
            &disabled_event_name,
            &serde_json::json!({ "instance_id": instance_id }),
        ),
    }))
}

impl PtyManager {
    async fn is_current_spawn(&self, session_key: &str, generation: u64) -> bool {
        let generations = self.agent_spawn_generations.lock().await;
        generations
            .get(session_key)
            .map(|current| *current == generation)
            .unwrap_or(false)
    }

    async fn remove_output_buffer_if_registered(
        &self,
        session_key: &str,
        registered_buffer: &SharedRingBuffer,
    ) {
        let mut buffers = self.output_buffers.lock().await;
        if buffers
            .get(session_key)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_buffer))
        {
            buffers.remove(session_key);
        }
    }

    async fn remove_attachment_hub_if_registered(
        &self,
        session_key: &str,
        registered_hub: &Arc<PtyAttachmentHub>,
    ) {
        let mut hubs = self.attachment_hubs.lock().await;
        if hubs
            .get(session_key)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_hub))
        {
            hubs.remove(session_key);
        }
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

        let (shadow_model, shadow_feeder) = if self.terminal_model_enabled() {
            let options = TerminalModelOptions::new(request.cols, request.rows);
            let started =
                match terminal_model_event_sink(&request.session_key, request.app_event_tx.clone())
                {
                    Some(event_sink) => ShadowTerminalSession::start_with_event_sink(
                        request.session_key.clone(),
                        request.instance_id,
                        options,
                        event_sink,
                    ),
                    None => ShadowTerminalSession::start(
                        request.session_key.clone(),
                        request.instance_id,
                        options,
                    ),
                };
            match started {
                Ok((session, feeder)) => (Some(session), Some(feeder)),
                Err(error) => {
                    warn!(
                        "[terminal-shadow] key={} instance={} phase=create disabled: {}",
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
                master: pair.master,
                writer,
                instance_id: request.instance_id,
                kind: request.kind,
                pid_file_name: request.pid_file_name,
                shadow_model,
                managed_process,
            },
            pid_file,
            shadow_feeder,
        })
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
}
