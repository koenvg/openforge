//! Shell PTY spawning, pending-spawn arbitration, and stream-state ownership.

use crate::terminal_model::ShadowTerminalFeeder;
use log::info;
use portable_pty::CommandBuilder;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::super::super::commands::get_shell_path;
use super::super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::super::pids::{pid_file_name_for_session_key, shell_session_key};
use super::super::super::{PtyError, PtyManager, PtySpawnContext, TerminalImageProtocol};
use super::super::lifecycle::{LifecycleLockLease, PtySessionKind, NEXT_INSTANCE_ID};
use super::{
    resolve_pty_cwd, PtyEventSink, PtyProcessRequest, SessionRegistrationRequest, SpawnedPty,
    NEXT_SPAWN_GENERATION,
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

struct ShellProcessRequest<'a> {
    task_id: &'a str,
    session_key: &'a str,
    cwd: &'a Path,
    cols: u16,
    rows: u16,
    terminal_image_protocol: Option<TerminalImageProtocol>,
    command: CommandBuilder,
    app_event_tx: Option<crate::app_events::AppEventSender>,
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
    shadow_feeder: Option<ShadowTerminalFeeder>,
    stream_state: ShellStreamState,
    lifecycle_lock: LifecycleLockLease,
    pid_file: PathBuf,
    event_sink: PtyEventSink,
}

impl PtyManager {
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
            app_event_tx,
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
            app_event_tx,
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
            shadow_feeder,
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
            shadow_feeder,
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
            app_event_tx: app_event_tx.clone(),
        })?;
        let instance_id = spawned.instance_id();
        let managed_process = spawned.managed_process().clone();
        let SpawnedPty {
            reader,
            session,
            pid_file,
            shadow_feeder,
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
            shadow_feeder,
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
