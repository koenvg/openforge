//! Registration and startup of PTY output streams.

use crate::app_events::AppEventSender;
use crate::terminal_model::ShadowTerminalFeeder;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use super::super::super::attachment::{PtyAttachmentHub, COMPANION_ATTACHMENT_EVENT_CAPACITY};
use super::super::super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::super::super::{PtyError, PtyManager};
use super::super::lifecycle::LifecycleLockLease;
use super::arbitration::AgentSpawnToken;

pub(super) struct PtyEventSink {
    pub(super) app_handle: Option<crate::backend_runtime::AppHandle>,
    pub(super) app_event_tx: Option<AppEventSender>,
}

pub(super) struct AgentStreamState {
    pub(super) last_output_time: Option<Arc<AtomicU64>>,
    pub(super) ring_buffer: SharedRingBuffer,
    pub(super) attachment_hub: Arc<PtyAttachmentHub>,
}

pub(super) struct AgentEventStreamRequest<'a> {
    pub(super) task_id: &'a str,
    pub(super) token: AgentSpawnToken,
    pub(super) instance_id: u64,
    pub(super) reader: Box<dyn Read + Send>,
    pub(super) shadow_feeder: Option<ShadowTerminalFeeder>,
    pub(super) stream_state: AgentStreamState,
    pub(super) lifecycle_lock: LifecycleLockLease,
    pub(super) pid_file: PathBuf,
    pub(super) event_sink: PtyEventSink,
}

pub(super) struct ShellStreamState {
    last_output_time: Arc<AtomicU64>,
    ring_buffer: SharedRingBuffer,
}

pub(super) struct ShellEventStreamRequest {
    pub(super) session_key: String,
    pub(super) instance_id: u64,
    pub(super) reader: Box<dyn Read + Send>,
    pub(super) shadow_feeder: Option<ShadowTerminalFeeder>,
    pub(super) stream_state: ShellStreamState,
    pub(super) lifecycle_lock: LifecycleLockLease,
    pub(super) pid_file: PathBuf,
    pub(super) event_sink: PtyEventSink,
}

impl PtyManager {
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

    async fn remove_agent_last_output_if_registered(
        &self,
        task_id: &str,
        registered_last_output: Option<&Arc<AtomicU64>>,
    ) {
        let Some(registered_last_output) = registered_last_output else {
            return;
        };

        let mut times = self.last_output.lock().await;
        if times
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, registered_last_output))
        {
            times.remove(task_id);
        }
    }

    pub(super) async fn register_agent_last_output_tracking(
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
            self.remove_agent_last_output_if_registered(task_id, last_output_time.as_ref())
                .await;
            return Err(error);
        }

        Ok(last_output_time)
    }

    pub(super) async fn register_agent_stream_state(
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
            self.remove_agent_last_output_if_registered(task_id, last_output_time.as_ref())
                .await;
            self.remove_output_buffer_if_registered(task_id, &ring_buffer)
                .await;
            self.remove_attachment_hub_if_registered(task_id, &attachment_hub)
                .await;
            return Err(error);
        }

        Ok(AgentStreamState {
            last_output_time,
            ring_buffer,
            attachment_hub,
        })
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
            reader,
            shadow_feeder,
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
            shadow_feeder,
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

    pub(super) async fn register_shell_stream_state(&self, session_key: &str) -> ShellStreamState {
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

    pub(super) fn start_shell_event_stream(&self, request: ShellEventStreamRequest) {
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
}

#[cfg(test)]
#[path = "tests/streams.rs"]
mod tests;
