use log::warn;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const DIAGNOSTIC_CAPACITY: usize = 32;
const REPLY_CAPACITY: usize = 64;
const REPLY_BYTES_CAPACITY: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TerminalModelDiagnostic {
    pub(crate) session_key: String,
    pub(crate) instance_id: u64,
    pub(crate) phase: &'static str,
    pub(crate) message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TerminalModelOutputFrame {
    pub(crate) instance_id: u64,
    pub(crate) sequence: u64,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TerminalModelEvent {
    Output(TerminalModelOutputFrame),
    ProtocolReply { instance_id: u64, bytes: Vec<u8> },
    Disabled { instance_id: u64 },
}

pub(crate) type TerminalModelEventSink = Arc<dyn Fn(TerminalModelEvent) + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PortableTerminalSnapshot {
    pub(crate) instance_id: u64,
    pub(crate) watermark: u64,
    pub(crate) portable_vt: Vec<u8>,
}

pub(super) struct TerminalModelState {
    disabled: AtomicBool,
    #[cfg(test)]
    queue_saturated: AtomicBool,
    diagnostics: Mutex<VecDeque<TerminalModelDiagnostic>>,
    replies: Mutex<VecDeque<Vec<u8>>>,
    reply_bytes: Mutex<usize>,
    event_sink: Option<TerminalModelEventSink>,
}

impl TerminalModelState {
    pub(super) fn new(event_sink: Option<TerminalModelEventSink>) -> Self {
        Self {
            disabled: AtomicBool::new(false),
            #[cfg(test)]
            queue_saturated: AtomicBool::new(false),
            diagnostics: Mutex::new(VecDeque::new()),
            replies: Mutex::new(VecDeque::new()),
            reply_bytes: Mutex::new(0),
            event_sink,
        }
    }

    pub(super) fn is_disabled(&self) -> bool {
        self.disabled.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(super) fn mark_queue_saturated(&self) {
        self.queue_saturated.store(true, Ordering::Release);
    }

    #[cfg(test)]
    pub(super) fn queue_saturated(&self) -> bool {
        self.queue_saturated.load(Ordering::Acquire)
    }

    pub(super) fn disable(
        &self,
        session_key: &str,
        instance_id: u64,
        phase: &'static str,
        message: String,
    ) {
        if self.disabled.swap(true, Ordering::AcqRel) {
            return;
        }
        warn!(
            "[terminal-model] key={} instance={} phase={} disabled: {}",
            session_key, instance_id, phase, message
        );
        if let Some(event_sink) = &self.event_sink {
            event_sink(TerminalModelEvent::Disabled { instance_id });
        }
        let mut diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if diagnostics.len() == DIAGNOSTIC_CAPACITY {
            diagnostics.pop_front();
        }
        diagnostics.push_back(TerminalModelDiagnostic {
            session_key: session_key.to_string(),
            instance_id,
            phase,
            message,
        });
    }

    pub(super) fn publish_output(&self, instance_id: u64, sequence: u64, bytes: Vec<u8>) {
        if let Some(event_sink) = &self.event_sink {
            event_sink(TerminalModelEvent::Output(TerminalModelOutputFrame {
                instance_id,
                sequence,
                bytes,
            }));
        }
    }

    pub(super) fn publish_replies(&self, instance_id: u64, replies: Vec<Vec<u8>>) {
        if let Some(event_sink) = &self.event_sink {
            for bytes in replies {
                event_sink(TerminalModelEvent::ProtocolReply { instance_id, bytes });
            }
            return;
        }
        self.capture_replies(replies);
    }

    fn capture_replies(&self, replies: Vec<Vec<u8>>) {
        let mut stored = self
            .replies
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut stored_bytes = self
            .reply_bytes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for reply in replies {
            while !stored.is_empty()
                && (stored.len() == REPLY_CAPACITY
                    || stored_bytes.saturating_add(reply.len()) > REPLY_BYTES_CAPACITY)
            {
                if let Some(removed) = stored.pop_front() {
                    *stored_bytes = stored_bytes.saturating_sub(removed.len());
                }
            }
            if reply.len() <= REPLY_BYTES_CAPACITY {
                *stored_bytes += reply.len();
                stored.push_back(reply);
            }
        }
    }

    #[cfg(test)]
    pub(super) fn take_protocol_replies(&self) -> Vec<Vec<u8>> {
        self.replies
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect()
    }

    #[cfg(test)]
    pub(super) fn diagnostics(&self) -> Vec<TerminalModelDiagnostic> {
        self.diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}
