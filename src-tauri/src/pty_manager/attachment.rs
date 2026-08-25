use portable_pty::PtySize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, Mutex as AsyncMutex};

use super::events::RingBuffer;
use super::session::PtySessionKind;
use super::PtyManager;

pub(super) const COMPANION_ATTACHMENT_EVENT_CAPACITY: usize = 64;
pub(super) const MAX_ITERM_IMAGE_SEQUENCE_BYTES: usize = 1024 * 1024;
pub(super) type PtyAttachmentHubs = Arc<AsyncMutex<HashMap<String, Arc<PtyAttachmentHub>>>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentTerminalEvent {
    Output(Vec<u8>),
    ProtocolError,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionOutputSanitizerError {
    MalformedUtf8,
    ImageSequenceTooLarge,
    UnterminatedImageSequence,
}

#[derive(Default)]
struct CompanionOutputSanitizer {
    prefix: Vec<u8>,
    utf8_pending: Vec<u8>,
    in_image: bool,
    image_escape: bool,
    image_sequence_bytes: usize,
}

impl CompanionOutputSanitizer {
    fn push(&mut self, input: &[u8]) -> Result<Vec<u8>, CompanionOutputSanitizerError> {
        let mut output = Vec::with_capacity(input.len().min(4096));
        let mut consumed = 0;

        if !self.utf8_pending.is_empty() {
            while consumed < input.len() {
                self.utf8_pending.push(input[consumed]);
                consumed += 1;
                match std::str::from_utf8(&self.utf8_pending) {
                    Ok(_) => {
                        let completed = std::mem::take(&mut self.utf8_pending);
                        self.push_valid_utf8(&completed, &mut output)?;
                        break;
                    }
                    Err(error) if error.error_len().is_some() => {
                        return Err(CompanionOutputSanitizerError::MalformedUtf8);
                    }
                    Err(_) => {}
                }
            }
            if !self.utf8_pending.is_empty() {
                return Ok(output);
            }
        }

        let remaining = &input[consumed..];
        match std::str::from_utf8(remaining) {
            Ok(_) => self.push_valid_utf8(remaining, &mut output)?,
            Err(error) if error.error_len().is_some() => {
                return Err(CompanionOutputSanitizerError::MalformedUtf8);
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                self.push_valid_utf8(&remaining[..valid_up_to], &mut output)?;
                self.utf8_pending
                    .extend_from_slice(&remaining[valid_up_to..]);
            }
        }
        Ok(output)
    }

    fn push_valid_utf8(
        &mut self,
        input: &[u8],
        output: &mut Vec<u8>,
    ) -> Result<(), CompanionOutputSanitizerError> {
        for &byte in input {
            if self.in_image {
                self.image_sequence_bytes = self
                    .image_sequence_bytes
                    .checked_add(1)
                    .ok_or(CompanionOutputSanitizerError::ImageSequenceTooLarge)?;
                if self.image_sequence_bytes > MAX_ITERM_IMAGE_SEQUENCE_BYTES {
                    return Err(CompanionOutputSanitizerError::ImageSequenceTooLarge);
                }
                if byte == 0x07 || (self.image_escape && byte == b'\\') {
                    output.extend_from_slice(MOBILE_IMAGE_MARKER);
                    self.in_image = false;
                    self.image_escape = false;
                    self.image_sequence_bytes = 0;
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
                self.image_sequence_bytes = ITERM_IMAGE_PREFIX.len();
            }
        }
        Ok(())
    }

    fn finish(&mut self) -> Result<Vec<u8>, CompanionOutputSanitizerError> {
        if !self.utf8_pending.is_empty() {
            return Err(CompanionOutputSanitizerError::MalformedUtf8);
        }
        if self.in_image {
            return Err(CompanionOutputSanitizerError::UnterminatedImageSequence);
        }
        Ok(std::mem::take(&mut self.prefix))
    }
}

struct PtyAttachmentHubState {
    replay: RingBuffer,
    sanitizer: CompanionOutputSanitizer,
    failed: bool,
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
                sanitizer: CompanionOutputSanitizer::default(),
                failed: false,
                events,
            }),
        }
    }

    pub(super) fn instance_id(&self) -> u64 {
        self.instance_id
    }

    #[cfg(test)]
    pub(super) fn attach(&self) -> (Vec<u8>, broadcast::Receiver<AgentTerminalEvent>) {
        let (replay, receiver, _) = self.attach_with_status();
        (replay, receiver)
    }

    fn attach_with_status(&self) -> (Vec<u8>, broadcast::Receiver<AgentTerminalEvent>, bool) {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let receiver = state.events.subscribe();
        (state.replay.snapshot_bytes(), receiver, state.failed)
    }

    pub(super) fn publish_output(&self, output: &[u8]) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.failed {
            return;
        }
        match state.sanitizer.push(output) {
            Ok(filtered) => Self::publish_filtered(&mut state, filtered),
            Err(_) => Self::publish_protocol_error(&mut state),
        }
    }

    fn publish_filtered(state: &mut PtyAttachmentHubState, output: Vec<u8>) {
        if output.is_empty() {
            return;
        }
        state.replay.push(&output);
        let _ = state.events.send(AgentTerminalEvent::Output(output));
    }

    fn publish_protocol_error(state: &mut PtyAttachmentHubState) {
        state.failed = true;
        let _ = state.events.send(AgentTerminalEvent::ProtocolError);
    }

    pub(super) fn publish_exit(&self, instance_id: u64) {
        if instance_id != self.instance_id {
            return;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.failed {
            return;
        }
        match state.sanitizer.finish() {
            Ok(filtered) => {
                Self::publish_filtered(&mut state, filtered);
                let _ = state.events.send(AgentTerminalEvent::Exited);
            }
            Err(_) => Self::publish_protocol_error(&mut state),
        }
    }
}

pub(crate) struct AgentTerminalAttachment {
    task_id: String,
    instance_id: u64,
    replay: Vec<u8>,
    protocol_error_pending: bool,
    events: broadcast::Receiver<AgentTerminalEvent>,
    manager: PtyManager,
}

impl AgentTerminalAttachment {
    pub(crate) fn has_protocol_error(&self) -> bool {
        self.protocol_error_pending
    }

    pub(crate) fn replay(&self) -> &[u8] {
        &self.replay
    }

    pub(crate) async fn recv(
        &mut self,
    ) -> Result<AgentTerminalEvent, AgentTerminalAttachmentError> {
        if self.protocol_error_pending {
            self.protocol_error_pending = false;
            return Ok(AgentTerminalEvent::ProtocolError);
        }
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
        let (replay, events, protocol_error_pending) = hub.attach_with_status();
        Ok(AgentTerminalAttachment {
            task_id: task_id.to_string(),
            instance_id,
            replay,
            protocol_error_pending,
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
            .write_user_input(task_id, instance_id, input)
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
