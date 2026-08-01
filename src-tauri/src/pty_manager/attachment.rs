use portable_pty::PtySize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, Mutex as AsyncMutex};

use super::events::RingBuffer;
use super::session::PtySessionKind;
use super::PtyManager;

pub(super) const COMPANION_ATTACHMENT_EVENT_CAPACITY: usize = 64;
pub(super) type PtyAttachmentHubs = Arc<AsyncMutex<HashMap<String, Arc<PtyAttachmentHub>>>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentTerminalEvent {
    Output(Vec<u8>),
    Exited,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentTerminalAttachmentError {
    NoActiveAgentTerminal,
    SlowConsumer,
    Closed,
    StaleAttachment,
    InvalidUtf8,
    InvalidDimensions,
    WriteFailed,
    ResizeFailed,
}

const ITERM_IMAGE_PREFIX: &[u8] = b"\x1b]1337;File=";
const MOBILE_IMAGE_MARKER: &[u8] = b"\r\n[Image unavailable on mobile]\r\n";

#[derive(Default)]
struct CompanionOutputFilter {
    prefix: Vec<u8>,
    in_image: bool,
    image_escape: bool,
}

impl CompanionOutputFilter {
    fn push(&mut self, input: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(input.len().min(4096));
        for &byte in input {
            if self.in_image {
                if byte == 0x07 || (self.image_escape && byte == b'\\') {
                    output.extend_from_slice(MOBILE_IMAGE_MARKER);
                    self.in_image = false;
                    self.image_escape = false;
                } else {
                    self.image_escape = byte == 0x1b;
                }
                continue;
            }

            self.prefix.push(byte);
            while !ITERM_IMAGE_PREFIX.starts_with(&self.prefix) {
                output.push(self.prefix.remove(0));
            }
            if self.prefix.len() == ITERM_IMAGE_PREFIX.len() {
                self.prefix.clear();
                self.in_image = true;
            }
        }
        output
    }

    fn finish(&mut self) -> Vec<u8> {
        let output = if self.in_image {
            MOBILE_IMAGE_MARKER.to_vec()
        } else {
            std::mem::take(&mut self.prefix)
        };
        self.prefix.clear();
        self.in_image = false;
        self.image_escape = false;
        output
    }
}

struct PtyAttachmentHubState {
    replay: RingBuffer,
    filter: CompanionOutputFilter,
    events: broadcast::Sender<AgentTerminalEvent>,
}

pub(super) struct PtyAttachmentHub {
    instance_id: u64,
    state: Mutex<PtyAttachmentHubState>,
}

impl PtyAttachmentHub {
    pub(super) fn new(instance_id: u64, replay_capacity: usize, event_capacity: usize) -> Self {
        let (events, _) = broadcast::channel(event_capacity);
        Self {
            instance_id,
            state: Mutex::new(PtyAttachmentHubState {
                replay: RingBuffer::new(replay_capacity),
                filter: CompanionOutputFilter::default(),
                events,
            }),
        }
    }

    pub(super) fn instance_id(&self) -> u64 {
        self.instance_id
    }

    pub(super) fn attach(&self) -> (Vec<u8>, broadcast::Receiver<AgentTerminalEvent>) {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let receiver = state.events.subscribe();
        (state.replay.snapshot_bytes(), receiver)
    }

    pub(super) fn publish_output(&self, output: &[u8]) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let filtered = state.filter.push(output);
        Self::publish_filtered(&mut state, filtered);
    }

    fn publish_filtered(state: &mut PtyAttachmentHubState, output: Vec<u8>) {
        if output.is_empty() {
            return;
        }
        state.replay.push(&output);
        let _ = state.events.send(AgentTerminalEvent::Output(output));
    }

    pub(super) fn publish_exit(&self, instance_id: u64) {
        if instance_id != self.instance_id {
            return;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let filtered = state.filter.finish();
        Self::publish_filtered(&mut state, filtered);
        let _ = state.events.send(AgentTerminalEvent::Exited);
    }
}

pub(crate) struct AgentTerminalAttachment {
    task_id: String,
    instance_id: u64,
    replay: Vec<u8>,
    events: broadcast::Receiver<AgentTerminalEvent>,
    manager: PtyManager,
}

impl AgentTerminalAttachment {
    pub(crate) fn replay(&self) -> &[u8] {
        &self.replay
    }

    pub(crate) async fn recv(
        &mut self,
    ) -> Result<AgentTerminalEvent, AgentTerminalAttachmentError> {
        match self.events.recv().await {
            Ok(event) => Ok(event),
            Err(broadcast::error::RecvError::Lagged(_)) => {
                Err(AgentTerminalAttachmentError::SlowConsumer)
            }
            Err(broadcast::error::RecvError::Closed) => Err(AgentTerminalAttachmentError::Closed),
        }
    }
    pub(crate) async fn write_input(
        &self,
        input: &[u8],
    ) -> Result<(), AgentTerminalAttachmentError> {
        std::str::from_utf8(input).map_err(|_| AgentTerminalAttachmentError::InvalidUtf8)?;
        self.manager
            .write_agent_attachment(&self.task_id, self.instance_id, input)
            .await
    }

    pub(crate) async fn resize(
        &self,
        columns: u16,
        rows: u16,
    ) -> Result<(), AgentTerminalAttachmentError> {
        if columns == 0 || rows == 0 {
            return Err(AgentTerminalAttachmentError::InvalidDimensions);
        }
        self.manager
            .resize_agent_attachment(&self.task_id, self.instance_id, columns, rows)
            .await
    }
}

impl PtyManager {
    pub(crate) async fn agent_terminal_available(&self, task_id: &str) -> bool {
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let instance_id = {
            let sessions = self.sessions.lock().await;
            sessions.get(task_id).and_then(|session| {
                matches!(session.kind, PtySessionKind::Agent).then_some(session.instance_id)
            })
        };
        let Some(instance_id) = instance_id else {
            return false;
        };
        self.attachment_hubs
            .lock()
            .await
            .get(task_id)
            .is_some_and(|hub| hub.instance_id() == instance_id)
    }

    pub(crate) async fn attach_agent_terminal(
        &self,
        task_id: &str,
    ) -> Result<AgentTerminalAttachment, AgentTerminalAttachmentError> {
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let instance_id = {
            let sessions = self.sessions.lock().await;
            let session = sessions
                .get(task_id)
                .ok_or(AgentTerminalAttachmentError::NoActiveAgentTerminal)?;
            if !matches!(session.kind, PtySessionKind::Agent) {
                return Err(AgentTerminalAttachmentError::NoActiveAgentTerminal);
            }
            session.instance_id
        };
        let hub = self
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .filter(|hub| hub.instance_id() == instance_id)
            .cloned()
            .ok_or(AgentTerminalAttachmentError::NoActiveAgentTerminal)?;
        let (replay, events) = hub.attach();
        Ok(AgentTerminalAttachment {
            task_id: task_id.to_string(),
            instance_id,
            replay,
            events,
            manager: self.clone(),
        })
    }
    async fn write_agent_attachment(
        &self,
        task_id: &str,
        instance_id: u64,
        input: &[u8],
    ) -> Result<(), AgentTerminalAttachmentError> {
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(task_id)
            .ok_or(AgentTerminalAttachmentError::StaleAttachment)?;
        if session.instance_id != instance_id || !matches!(session.kind, PtySessionKind::Agent) {
            return Err(AgentTerminalAttachmentError::StaleAttachment);
        }
        session
            .writer
            .write_all(input)
            .and_then(|()| session.writer.flush())
            .map_err(|_| AgentTerminalAttachmentError::WriteFailed)
    }

    async fn resize_agent_attachment(
        &self,
        task_id: &str,
        instance_id: u64,
        columns: u16,
        rows: u16,
    ) -> Result<(), AgentTerminalAttachmentError> {
        let lifecycle_lock = self.lifecycle_lock_for(task_id).await;
        let _lifecycle_guard = lifecycle_lock.lock().await;
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(task_id)
            .ok_or(AgentTerminalAttachmentError::StaleAttachment)?;
        if session.instance_id != instance_id || !matches!(session.kind, PtySessionKind::Agent) {
            return Err(AgentTerminalAttachmentError::StaleAttachment);
        }
        session
            .master
            .resize(PtySize {
                rows,
                cols: columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| AgentTerminalAttachmentError::ResizeFailed)
    }
}
