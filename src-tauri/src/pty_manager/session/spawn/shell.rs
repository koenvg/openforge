//! Shell-specific spawn entry points and orchestration.

use portable_pty::CommandBuilder;

use super::super::super::commands::get_shell_path;
use super::super::super::pids::shell_session_key;
use super::super::super::{PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol};
use super::process::{resolve_pty_cwd, ShellProcessRequest, SpawnedPty};
use super::registration::SessionRegistrationRequest;
use super::streams::{PtyEventSink, ShellEventStreamRequest};

impl PtyManager {
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

    pub(super) async fn spawn_shell_pty_with_command(
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
        self.terminal_sessions
            .ensure_no_managed_recovery(&session_key)
            .await?;
        let (token, _pending_spawn, lifecycle_lock) =
            self.begin_shell_spawn(&session_key, task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        if let Err(error) = self
            .terminal_sessions
            .ensure_no_managed_recovery(&session_key)
            .await
        {
            self.finish_shell_spawn(&token).await;
            return Err(error);
        }
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
            app_handle: app_handle.clone(),
            app_event_tx: app_event_tx.clone(),
            command,
        })?;
        let instance_id = spawned.instance_id();
        let managed_process = spawned.managed_process().clone();
        let SpawnedPty {
            reader,
            session,
            pid_file,
            terminal_model_feeder,
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
            terminal_model_feeder,
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
#[path = "tests/shell.rs"]
mod tests;
