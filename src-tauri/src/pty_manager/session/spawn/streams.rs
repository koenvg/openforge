//! Registration and startup of PTY output streams.

use crate::app_events::RuntimeEventPublisher;
use crate::terminal_model::TerminalModelFeeder;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use super::super::super::attachment::{PtyAttachmentHub, COMPANION_ATTACHMENT_EVENT_CAPACITY};
use super::super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    PtyOutputReceiver, RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::super::{PtyError, PtyManager};
use super::super::lifecycle::LifecycleLockLease;
use super::arbitration::AgentSpawnToken;

pub(super) struct AgentStreamState {
    pub(super) last_output_time: Option<Arc<AtomicU64>>,
    pub(super) ring_buffer: SharedRingBuffer,
    pub(super) attachment_hub: Arc<PtyAttachmentHub>,
}

impl AgentStreamState {
    pub(super) fn new(instance_id: u64, track_last_output: bool) -> Self {
        Self {
            last_output_time: track_last_output.then(|| Arc::new(AtomicU64::new(0))),
            ring_buffer: Arc::new(std::sync::Mutex::new(RingBuffer::new(
                CLAUDE_BUFFER_CAPACITY,
            ))),
            attachment_hub: Arc::new(PtyAttachmentHub::new(
                instance_id,
                CLAUDE_BUFFER_CAPACITY,
                COMPANION_ATTACHMENT_EVENT_CAPACITY,
            )),
        }
    }
}
pub(super) struct AgentEventStreamRequest<'a> {
    pub(super) task_id: &'a str,
    pub(super) token: AgentSpawnToken,
    pub(super) instance_id: u64,
    pub(super) output: PtyOutputReceiver,
    pub(super) stream_state: AgentStreamState,
    pub(super) lifecycle_lock: LifecycleLockLease,
    pub(super) pid_file: PathBuf,
    pub(super) event_publisher: RuntimeEventPublisher,
}

pub(super) struct ShellStreamState {
    last_output_time: Arc<AtomicU64>,
    ring_buffer: SharedRingBuffer,
}

pub(super) struct ShellEventStreamRequest {
    pub(super) session_key: String,
    pub(super) instance_id: u64,
    pub(super) reader: Box<dyn Read + Send>,
    pub(super) terminal_model_feeder: Option<TerminalModelFeeder>,
    pub(super) stream_state: ShellStreamState,
    pub(super) lifecycle_lock: LifecycleLockLease,
    pub(super) pid_file: PathBuf,
    pub(super) event_publisher: RuntimeEventPublisher,
}

impl PtyManager {
    async fn remove_output_buffer_if_registered(
        &self,
        session_key: &str,
        registered_buffer: &SharedRingBuffer,
    ) {
        let mut buffers = self.terminal_sessions.output_buffers.lock().await;
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
        let mut hubs = self.terminal_sessions.attachment_hubs.lock().await;
        if hubs
            .get(session_key)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_hub))
        {
            hubs.remove(session_key);
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

        let mut times = self.terminal_sessions.last_output.lock().await;
        if times
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_last_output))
        {
            times.remove(task_id);
        }
    }

    pub(super) async fn start_agent_output_reader(
        &self,
        task_id: &str,
        reader: Box<dyn Read + Send>,
        terminal_model_feeder: Option<TerminalModelFeeder>,
        stream_state: &AgentStreamState,
    ) -> Result<PtyOutputReceiver, PtyError> {
        #[cfg(test)]
        let ready_gate = self
            .agent_output_reader_ready_gate
            .lock()
            .expect("output reader ready gate lock should not be poisoned")
            .take();
        spawn_pty_output_reader(
            reader,
            task_id.to_string(),
            stream_state.last_output_time.as_ref().map(Arc::clone),
            Some(Arc::clone(&stream_state.attachment_hub)),
            terminal_model_feeder,
            #[cfg(test)]
            ready_gate,
        )
        .wait_until_ready()
        .await
    }

    pub(super) async fn register_agent_stream_state(
        &self,
        task_id: &str,
        token: AgentSpawnToken,
        instance_id: u64,
        stream_state: &AgentStreamState,
    ) -> Result<(), PtyError> {
        if let Err(error) = self
            .require_current_agent_spawn_and_session(
                task_id,
                token,
                instance_id,
                "before stream state registration started",
            )
            .await
        {
            self.remove_agent_stream_state_if_registered(task_id, stream_state)
                .await;
            return Err(error);
        }
        if let Some(last_output_time) = &stream_state.last_output_time {
            self.terminal_sessions
                .last_output
                .lock()
                .await
                .insert(task_id.to_string(), Arc::clone(last_output_time));
        }
        self.terminal_sessions
            .output_buffers
            .lock()
            .await
            .insert(task_id.to_string(), Arc::clone(&stream_state.ring_buffer));
        self.terminal_sessions.attachment_hubs.lock().await.insert(
            task_id.to_string(),
            Arc::clone(&stream_state.attachment_hub),
        );

        if let Err(error) = self
            .require_current_agent_spawn_and_session(
                task_id,
                token,
                instance_id,
                "before stream state registration completed",
            )
            .await
        {
            self.remove_agent_stream_state_if_registered(task_id, stream_state)
                .await;
            return Err(error);
        }

        Ok(())
    }

    #[cfg(test)]
    pub(super) fn pause_before_agent_event_stream_start(&self) {
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

    pub(super) async fn start_agent_event_stream(
        &self,
        request: AgentEventStreamRequest<'_>,
    ) -> Result<(), PtyError> {
        let AgentEventStreamRequest {
            task_id,
            token,
            instance_id,
            output,
            stream_state,
            lifecycle_lock,
            pid_file,
            event_publisher,
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

        spawn_batched_pty_event_emitter(
            output,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                event_publisher,
                ring_buffer: stream_state.ring_buffer,
                attachment_hub: Some(stream_state.attachment_hub),
                terminal_sessions: self.terminal_sessions.clone(),
                exit_action: PtyExitAction::Cleanup {
                    lifecycle_lock,
                    pid_file,
                    emit_agent_exit: true,
                },
            },
        );
        Ok(())
    }

    pub(super) async fn register_shell_stream_state(&self, session_key: &str) -> ShellStreamState {
        let last_output_time = Arc::new(AtomicU64::new(0));
        self.terminal_sessions
            .last_output
            .lock()
            .await
            .insert(session_key.to_string(), Arc::clone(&last_output_time));
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        self.terminal_sessions
            .output_buffers
            .lock()
            .await
            .insert(session_key.to_string(), Arc::clone(&ring_buffer));
        ShellStreamState {
            last_output_time,
            ring_buffer,
        }
    }

    pub(super) fn start_shell_event_stream(&self, request: ShellEventStreamRequest) {
        let ShellEventStreamRequest {
            session_key,
            instance_id,
            reader,
            terminal_model_feeder,
            stream_state,
            lifecycle_lock,
            pid_file,
            event_publisher,
        } = request;
        let rx = spawn_pty_output_reader(
            reader,
            session_key.clone(),
            Some(Arc::clone(&stream_state.last_output_time)),
            None,
            terminal_model_feeder,
            #[cfg(test)]
            None,
        )
        .into_receiver();
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key,
                instance_id,
                event_publisher,
                ring_buffer: stream_state.ring_buffer,
                attachment_hub: None,
                terminal_sessions: self.terminal_sessions.clone(),
                exit_action: PtyExitAction::Cleanup {
                    lifecycle_lock,
                    pid_file,
                    emit_agent_exit: false,
                },
            },
        );
    }
}

#[cfg(test)]
#[path = "tests/streams.rs"]
mod tests;
