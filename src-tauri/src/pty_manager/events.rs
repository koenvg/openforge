use crate::app_events::RuntimeEventPublisher;
use crate::terminal_model::TerminalModelFeeder;
use log::{info, warn};
use std::io::Read;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::attachment::PtyAttachmentHub;
use super::session::{LifecycleLockLease, PassiveExitOutcome, TerminalSessions};

#[cfg(test)]
pub(super) struct PtyExitCleanupContext<'a> {
    pub(super) terminal_sessions: &'a TerminalSessions,
    pub(super) lifecycle_lock: &'a tokio::sync::Mutex<()>,
    pub(super) pid_file: &'a Path,
}

#[cfg(test)]
pub(super) async fn finalize_pty_exit(
    context: PtyExitCleanupContext<'_>,
    session_key: &str,
    instance_id: u64,
    remove_output_buffer: bool,
) -> bool {
    matches!(
        context
            .terminal_sessions
            .finalize_exit(
                session_key,
                instance_id,
                context.lifecycle_lock,
                context.pid_file,
                remove_output_buffer,
            )
            .await,
        PassiveExitOutcome::Finalized {
            process_succeeded: true
        }
    )
}

// ============================================================================
// Ring Buffer
// ============================================================================

pub(super) const CLAUDE_BUFFER_CAPACITY: usize = 262_144; // 256KB

pub(super) struct RingBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl RingBuffer {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity),
            capacity,
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
        if self.data.len() > self.capacity {
            let mut remove = self.data.len() - self.capacity;
            while remove < self.data.len() && self.data[remove] & 0b1100_0000 == 0b1000_0000 {
                remove += 1;
            }
            self.data.drain(0..remove);
        }
    }

    pub(super) fn snapshot(&self) -> String {
        String::from_utf8_lossy(&self.data).to_string()
    }

    pub(super) fn snapshot_bytes(&self) -> Vec<u8> {
        String::from_utf8_lossy(&self.data)
            .into_owned()
            .into_bytes()
    }
}

pub(super) type SharedRingBuffer = Arc<std::sync::Mutex<RingBuffer>>;

// ============================================================================
// PTY Output Reader and Event Batching
// ============================================================================

pub(super) const PTY_READ_BUFFER_SIZE: usize = 8192;
const PTY_FLUSH_INTERVAL_MS: u64 = 16;
const PTY_MAX_BATCH_SIZE: usize = 65_536;
// Each message comes from one 8 KiB read plus at most three carried UTF-8 bytes.
// Even with worst-case lossy UTF-8 expansion, queued string payload stays below 769 KiB.
pub(super) const PTY_OUTPUT_QUEUE_CAPACITY: usize = 32;

type PtyOutputMessage = Option<String>;
type PtyOutputSender = tokio::sync::mpsc::Sender<PtyOutputMessage>;
pub(super) type PtyOutputReceiver = tokio::sync::mpsc::Receiver<PtyOutputMessage>;

pub(super) fn pty_output_channel() -> (PtyOutputSender, PtyOutputReceiver) {
    tokio::sync::mpsc::channel(PTY_OUTPUT_QUEUE_CAPACITY)
}
type PtyEmitResult = Result<(), String>;

fn now_ms() -> u64 {
    crate::unix_timestamp::milliseconds(std::time::SystemTime::now()).unwrap_or_default()
}

fn decode_pty_output(bytes: &[u8], incomplete_utf8: &mut Vec<u8>) -> String {
    let mut combined = std::mem::take(incomplete_utf8);
    combined.extend_from_slice(bytes);
    let mut remaining = combined.as_slice();
    let mut output = String::with_capacity(combined.len());

    loop {
        match std::str::from_utf8(remaining) {
            Ok(valid) => {
                output.push_str(valid);
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                let valid = std::str::from_utf8(&remaining[..valid_up_to])
                    .expect("Utf8Error::valid_up_to must delimit valid UTF-8");
                output.push_str(valid);

                let Some(error_len) = error.error_len() else {
                    incomplete_utf8.extend_from_slice(&remaining[valid_up_to..]);
                    break;
                };
                output.push(char::REPLACEMENT_CHARACTER);
                remaining = &remaining[valid_up_to + error_len..];
            }
        }
    }

    debug_assert!(incomplete_utf8.len() < 4);
    output
}

fn finish_pty_output(tx: &PtyOutputSender, incomplete_utf8: &mut Vec<u8>) {
    if !incomplete_utf8.is_empty() {
        let trailing = String::from_utf8_lossy(incomplete_utf8).into_owned();
        incomplete_utf8.clear();
        if tx.blocking_send(Some(trailing)).is_err() {
            return;
        }
    }
    let _ = tx.blocking_send(None);
}

pub(super) fn read_pty_output_loop<R: Read + ?Sized>(
    reader: &mut R,
    tx: PtyOutputSender,
    session_key: &str,
    last_output: Option<Arc<AtomicU64>>,
    attachment_hub: Option<Arc<PtyAttachmentHub>>,
    terminal_model_feeder: Option<TerminalModelFeeder>,
) {
    let mut buffer = [0u8; PTY_READ_BUFFER_SIZE];
    let mut incomplete_utf8: Vec<u8> = Vec::new();

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                info!("[PTY] key={} closed (EOF)", session_key);
                finish_pty_output(&tx, &mut incomplete_utf8);
                break;
            }
            Ok(n) => {
                if let Some(terminal_model_feeder) = &terminal_model_feeder {
                    terminal_model_feeder.feed(&buffer[..n]);
                }
                if let Some(hub) = &attachment_hub {
                    hub.publish_output(&buffer[..n]);
                }
                if let Some(last_output) = &last_output {
                    last_output.store(now_ms(), Ordering::Relaxed);
                }

                let text = decode_pty_output(&buffer[..n], &mut incomplete_utf8);
                if !text.is_empty() && tx.blocking_send(Some(text)).is_err() {
                    info!("[PTY] key={} channel closed, reader exiting", session_key);
                    break;
                }
            }
            Err(e) => {
                info!("[PTY] key={} read error: {}", session_key, e);
                finish_pty_output(&tx, &mut incomplete_utf8);
                break;
            }
        }
    }
}

pub(super) fn spawn_pty_output_reader(
    mut reader: Box<dyn Read + Send>,
    session_key: String,
    last_output: Option<Arc<AtomicU64>>,
    attachment_hub: Option<Arc<PtyAttachmentHub>>,
    terminal_model_feeder: Option<TerminalModelFeeder>,
) -> PtyOutputReceiver {
    let (tx, rx) = pty_output_channel();
    tokio::task::spawn_blocking(move || {
        read_pty_output_loop(
            &mut reader,
            tx,
            &session_key,
            last_output,
            attachment_hub,
            terminal_model_feeder,
        );
    });
    rx
}

pub(super) struct PtyOutputBatcher {
    session_key: String,
    instance_id: u64,
    ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
    pending: String,
    max_buffer_size: usize,
}

impl PtyOutputBatcher {
    pub(super) fn new(
        session_key: String,
        instance_id: u64,
        ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
        max_buffer_size: usize,
    ) -> Self {
        Self {
            session_key,
            instance_id,
            ring_buffer,
            pending: String::new(),
            max_buffer_size,
        }
    }

    pub(super) fn push_output<E>(&mut self, text: &str, emit: &mut E) -> bool
    where
        E: FnMut(&str, &serde_json::Value) -> PtyEmitResult,
    {
        self.pending.push_str(text);
        if self.pending.len() >= self.max_buffer_size {
            self.flush_pending(emit)
        } else {
            false
        }
    }

    pub(super) fn flush_pending<E>(&mut self, emit: &mut E) -> bool
    where
        E: FnMut(&str, &serde_json::Value) -> PtyEmitResult,
    {
        if self.pending.is_empty() {
            return false;
        }

        let data = std::mem::take(&mut self.pending);
        if let Ok(mut buf) = self.ring_buffer.lock() {
            buf.push(data.as_bytes());
        }

        let event_name = format!("pty-output-{}", self.session_key);
        let payload = serde_json::json!({
            "shell_session_key": &self.session_key,
            "data": &data,
            "instance_id": self.instance_id,
        });
        if let Err(e) = emit(&event_name, &payload) {
            warn!("[PTY] Failed to emit {}: {}", event_name, e);
        }
        true
    }
}

pub(super) enum PtyExitAction {
    Cleanup {
        lifecycle_lock: LifecycleLockLease,
        pid_file: PathBuf,
        emit_agent_exit: bool,
    },
}

pub(super) struct PtyEventEmitterConfig {
    pub(super) session_key: String,
    pub(super) instance_id: u64,
    pub(super) event_publisher: RuntimeEventPublisher,
    pub(super) ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
    pub(super) attachment_hub: Option<Arc<PtyAttachmentHub>>,
    pub(super) terminal_sessions: TerminalSessions,
    pub(super) exit_action: PtyExitAction,
}

pub(super) fn spawn_batched_pty_event_emitter(
    mut rx: PtyOutputReceiver,
    config: PtyEventEmitterConfig,
) {
    tokio::spawn(async move {
        let PtyEventEmitterConfig {
            session_key,
            instance_id,
            event_publisher,
            ring_buffer,
            attachment_hub,
            terminal_sessions,
            exit_action,
        } = config;
        let mut batcher = PtyOutputBatcher::new(
            session_key.clone(),
            instance_id,
            ring_buffer,
            PTY_MAX_BATCH_SIZE,
        );
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_millis(PTY_FLUSH_INTERVAL_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut emit_pty_event = |event_name: &str, payload: &serde_json::Value| {
            event_publisher.publish(event_name, payload);
            Ok(())
        };

        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(Some(text)) => {
                            if terminal_sessions
                                .accepts_passive_output(&session_key, instance_id)
                                .await
                            {
                                batcher.push_output(&text, &mut emit_pty_event);
                            }
                        }
                        Some(None) | None => break,
                    }
                }
                _ = interval.tick() => {
                    batcher.flush_pending(&mut emit_pty_event);
                }
            }
        }

        batcher.flush_pending(&mut emit_pty_event);
        let (exit_outcome, emit_agent_exit) = match exit_action {
            PtyExitAction::Cleanup {
                lifecycle_lock,
                pid_file,
                emit_agent_exit,
            } => {
                let outcome = terminal_sessions
                    .finalize_exit(
                        &session_key,
                        instance_id,
                        &lifecycle_lock,
                        &pid_file,
                        !emit_agent_exit,
                    )
                    .await;
                (outcome, emit_agent_exit)
            }
        };
        if let Some(hub) = attachment_hub.as_ref() {
            hub.publish_exit(instance_id);
        }
        if matches!(exit_outcome, PassiveExitOutcome::IgnoredStale) {
            info!(
                "[PTY] key={} ignored stale exit for instance={}",
                session_key, instance_id
            );
            return;
        }

        info!("[PTY] key={} emitter received exit signal", session_key);
        let exit_event_name = format!("pty-exit-{}", session_key);
        let exit_payload = serde_json::json!({"instance_id": instance_id});
        event_publisher.publish(&exit_event_name, &exit_payload);
        if emit_agent_exit {
            let success = matches!(
                exit_outcome,
                PassiveExitOutcome::Finalized {
                    process_succeeded: true
                }
            );
            let payload = serde_json::json!({
                "task_id": &session_key,
                "success": success,
                "instance_id": instance_id
            });
            event_publisher.publish("agent-pty-exited", &payload);
        }
    });
}

// ============================================================================
// UTF-8 Boundary Detection
// ============================================================================

#[cfg(test)]
/// Finds the last valid UTF-8 boundary in a byte slice.
/// Returns the index up to which bytes are valid UTF-8.
/// If the buffer ends with an incomplete multi-byte sequence, returns the index before it.
pub(super) fn find_utf8_boundary(bytes: &[u8]) -> usize {
    let len = bytes.len();

    // Fast path: check if entire buffer is valid UTF-8
    if std::str::from_utf8(bytes).is_ok() {
        return len;
    }

    // Scan from the end to find incomplete multi-byte sequence
    // UTF-8 continuation bytes start with 0b10xxxxxx
    // Multi-byte sequences start with 0b11xxxxxx
    for i in (0..len).rev().take(4) {
        let byte = bytes[i];

        // Check if this is the start of a multi-byte sequence
        if byte & 0b1100_0000 == 0b1100_0000 {
            // This is a start byte, check if the sequence is complete
            let expected_len = if byte & 0b1110_0000 == 0b1100_0000 {
                2 // 110xxxxx
            } else if byte & 0b1111_0000 == 0b1110_0000 {
                3 // 1110xxxx
            } else if byte & 0b1111_1000 == 0b1111_0000 {
                4 // 11110xxx
            } else {
                continue;
            };

            let actual_len = len - i;
            if actual_len < expected_len {
                // Incomplete sequence, return index before it
                return i;
            }
        }
    }

    // Fallback: use std::str::from_utf8 to find valid boundary
    std::str::from_utf8(bytes)
        .err()
        .map(|e| e.valid_up_to())
        .unwrap_or(len)
}
