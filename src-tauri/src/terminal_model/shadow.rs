use super::{GhosttyTerminalModel, TerminalModel, TerminalModelError, TerminalModelOptions};
use log::{info, warn};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const COMMAND_QUEUE_CAPACITY: usize = 64;
const MAX_FEED_BYTES: usize = 8 * 1024;
const QUEUE_CATCH_UP_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(50);
#[cfg(test)]
pub(crate) const SHADOW_BUFFERED_BYTES_CAPACITY: usize = COMMAND_QUEUE_CAPACITY * MAX_FEED_BYTES;
const DIAGNOSTIC_CAPACITY: usize = 32;
const REPLY_CAPACITY: usize = 64;
const REPLY_BYTES_CAPACITY: usize = 64 * 1024;
const CHECKPOINT_INTERVAL_BYTES: usize = 8 * 1024 * 1024;
const CHECKPOINT_IDLE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ShadowMode {
    Enabled,
    #[default]
    Disabled,
}

impl ShadowMode {
    pub(crate) fn from_environment() -> Self {
        match std::env::var("OPENFORGE_GHOSTTY_SHADOW") {
            Ok(value) if matches!(value.as_str(), "1" | "true" | "TRUE") => Self::Enabled,
            _ => Self::Disabled,
        }
    }

    pub(crate) fn is_enabled(self) -> bool {
        self == Self::Enabled
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShadowDiagnostic {
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
    Disabled { instance_id: u64 },
}

pub(crate) type TerminalModelEventSink = Arc<dyn Fn(TerminalModelEvent) + Send + Sync>;
pub(crate) type TerminalModelReplySink =
    Arc<dyn Fn(&str, u64, &[u8]) -> Result<(), String> + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PortableTerminalSnapshot {
    pub(crate) instance_id: u64,
    pub(crate) watermark: u64,
    pub(crate) portable_vt: Vec<u8>,
}

struct ShadowState {
    disabled: AtomicBool,
    diagnostics: Mutex<VecDeque<ShadowDiagnostic>>,
    replies: Mutex<VecDeque<Vec<u8>>>,
    reply_bytes: Mutex<usize>,
    event_sink: Option<TerminalModelEventSink>,
    reply_sink: Option<TerminalModelReplySink>,
}

impl ShadowState {
    fn new(
        event_sink: Option<TerminalModelEventSink>,
        reply_sink: Option<TerminalModelReplySink>,
    ) -> Self {
        Self {
            disabled: AtomicBool::new(false),
            diagnostics: Mutex::new(VecDeque::new()),
            replies: Mutex::new(VecDeque::new()),
            reply_bytes: Mutex::new(0),
            event_sink,
            reply_sink,
        }
    }
    fn disable(&self, session_key: &str, instance_id: u64, phase: &'static str, message: String) {
        if self.disabled.swap(true, Ordering::AcqRel) {
            return;
        }
        warn!(
            "[terminal-shadow] key={} instance={} phase={} disabled: {}",
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
        diagnostics.push_back(ShadowDiagnostic {
            session_key: session_key.to_string(),
            instance_id,
            phase,
            message,
        });
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
}

enum ShadowCommand {
    Feed(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
    },
    PortableSnapshot(mpsc::SyncSender<Result<PortableTerminalSnapshot, String>>),
    #[cfg(test)]
    Snapshot(mpsc::SyncSender<Result<Vec<u8>, String>>),
    #[cfg(test)]
    PortableVt(mpsc::SyncSender<Result<Vec<u8>, String>>),
    Shutdown,
}

#[derive(Clone)]
pub(crate) struct ShadowTerminalFeeder {
    session_key: Arc<str>,
    instance_id: u64,
    tx: mpsc::SyncSender<ShadowCommand>,
    state: Arc<ShadowState>,
}

impl ShadowTerminalFeeder {
    pub(crate) fn feed(&self, bytes: &[u8]) {
        if self.state.disabled.load(Ordering::Acquire) {
            return;
        }
        if bytes.len() > MAX_FEED_BYTES {
            self.state.disable(
                &self.session_key,
                self.instance_id,
                "feed",
                format!("PTY read exceeded {MAX_FEED_BYTES} bytes"),
            );
            return;
        }
        let deadline = std::time::Instant::now() + QUEUE_CATCH_UP_TIMEOUT;
        let mut command = ShadowCommand::Feed(bytes.to_vec());
        loop {
            match self.tx.try_send(command) {
                Ok(()) => return,
                Err(mpsc::TrySendError::Full(returned)) if std::time::Instant::now() < deadline => {
                    command = returned;
                    std::thread::sleep(std::time::Duration::from_micros(50));
                }
                Err(mpsc::TrySendError::Full(_)) => {
                    self.state.disable(
                        &self.session_key,
                        self.instance_id,
                        "feed",
                        format!(
                            "bounded command queue remained full for {} ms",
                            QUEUE_CATCH_UP_TIMEOUT.as_millis()
                        ),
                    );
                    return;
                }
                Err(mpsc::TrySendError::Disconnected(_)) => {
                    self.state.disable(
                        &self.session_key,
                        self.instance_id,
                        "feed",
                        "model worker disconnected".to_string(),
                    );
                    return;
                }
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct TerminalModelSnapshotClient {
    tx: mpsc::SyncSender<ShadowCommand>,
    state: Arc<ShadowState>,
}

impl TerminalModelSnapshotClient {
    pub(crate) fn portable_snapshot(&self) -> Result<PortableTerminalSnapshot, String> {
        request_portable_snapshot(&self.tx, &self.state)
    }
}

pub(crate) struct ShadowTerminalSession {
    session_key: Arc<str>,
    instance_id: u64,
    tx: mpsc::SyncSender<ShadowCommand>,
    state: Arc<ShadowState>,
    worker: Option<JoinHandle<()>>,
}

impl ShadowTerminalSession {
    pub(crate) fn start(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
    ) -> Result<(Self, ShadowTerminalFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, None, None)
    }

    pub(crate) fn start_with_event_sink(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: TerminalModelEventSink,
    ) -> Result<(Self, ShadowTerminalFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, Some(event_sink), None)
    }

    pub(crate) fn start_authoritative(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: Option<TerminalModelEventSink>,
        reply_sink: TerminalModelReplySink,
    ) -> Result<(Self, ShadowTerminalFeeder), std::io::Error> {
        Self::start_internal(
            session_key,
            instance_id,
            options,
            event_sink,
            Some(reply_sink),
        )
    }

    fn start_internal(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: Option<TerminalModelEventSink>,
        reply_sink: Option<TerminalModelReplySink>,
    ) -> Result<(Self, ShadowTerminalFeeder), std::io::Error> {
        let session_key: Arc<str> = Arc::from(session_key);
        let state = Arc::new(ShadowState::new(event_sink, reply_sink));
        let (tx, rx) = mpsc::sync_channel(COMMAND_QUEUE_CAPACITY);
        let worker_key = Arc::clone(&session_key);
        let worker_state = Arc::clone(&state);
        let worker = std::thread::Builder::new()
            .name(format!("terminal-shadow-{instance_id}"))
            .spawn(move || {
                let panic_key = Arc::clone(&worker_key);
                let panic_state = Arc::clone(&worker_state);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_worker(worker_key, instance_id, options, rx, worker_state);
                }));
                if let Err(payload) = result {
                    let message = payload
                        .downcast_ref::<&str>()
                        .map(|message| (*message).to_string())
                        .or_else(|| payload.downcast_ref::<String>().cloned())
                        .unwrap_or_else(|| "unknown model worker panic".to_string());
                    panic_state.disable(&panic_key, instance_id, "panic", message);
                }
            })?;
        let feeder = ShadowTerminalFeeder {
            session_key: Arc::clone(&session_key),
            instance_id,
            tx: tx.clone(),
            state: Arc::clone(&state),
        };
        Ok((
            Self {
                session_key,
                instance_id,
                tx,
                state,
                worker: Some(worker),
            },
            feeder,
        ))
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        if self.state.disabled.load(Ordering::Acquire) {
            return;
        }
        if let Err(error) = self.tx.try_send(ShadowCommand::Resize { cols, rows }) {
            self.state.disable(
                &self.session_key,
                self.instance_id,
                "resize",
                format!("failed to queue resize: {error}"),
            );
        }
    }

    #[cfg(test)]
    pub(crate) fn portable_snapshot(&self) -> Result<PortableTerminalSnapshot, String> {
        request_portable_snapshot(&self.tx, &self.state)
    }

    pub(crate) fn snapshot_client(&self) -> TerminalModelSnapshotClient {
        TerminalModelSnapshotClient {
            tx: self.tx.clone(),
            state: Arc::clone(&self.state),
        }
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> Result<Vec<u8>, String> {
        self.request(ShadowCommand::Snapshot)
    }

    #[cfg(test)]
    pub(crate) fn portable_vt(&self) -> Result<Vec<u8>, String> {
        self.request(ShadowCommand::PortableVt)
    }

    #[cfg(test)]
    fn request(
        &self,
        command: impl FnOnce(mpsc::SyncSender<Result<Vec<u8>, String>>) -> ShadowCommand,
    ) -> Result<Vec<u8>, String> {
        if self.state.disabled.load(Ordering::Acquire) {
            return Err("shadow model is disabled".to_string());
        }
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        self.tx
            .send(command(response_tx))
            .map_err(|error| format!("shadow model request failed: {error}"))?;
        response_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| format!("shadow model response failed: {error}"))?
    }

    #[cfg(test)]
    pub(crate) fn take_protocol_replies(&self) -> Vec<Vec<u8>> {
        self.state
            .replies
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn diagnostics(&self) -> Vec<ShadowDiagnostic> {
        self.state
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

fn request_portable_snapshot(
    tx: &mpsc::SyncSender<ShadowCommand>,
    state: &ShadowState,
) -> Result<PortableTerminalSnapshot, String> {
    if state.disabled.load(Ordering::Acquire) {
        return Err("terminal model is disabled".to_string());
    }
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    tx.send(ShadowCommand::PortableSnapshot(response_tx))
        .map_err(|error| format!("terminal model snapshot request failed: {error}"))?;
    response_rx
        .recv_timeout(REQUEST_TIMEOUT)
        .map_err(|error| format!("terminal model snapshot response failed: {error}"))?
}

impl Drop for ShadowTerminalSession {
    fn drop(&mut self) {
        if !self.state.disabled.load(Ordering::Acquire) {
            let _ = self.tx.send(ShadowCommand::Shutdown);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        info!(
            "[terminal-shadow] key={} instance={} disposed",
            self.session_key, self.instance_id
        );
    }
}

fn model_error(error: TerminalModelError) -> String {
    error.to_string()
}

fn run_worker(
    session_key: Arc<str>,
    instance_id: u64,
    options: TerminalModelOptions,
    rx: mpsc::Receiver<ShadowCommand>,
    state: Arc<ShadowState>,
) {
    let mut model = match GhosttyTerminalModel::new(options) {
        Ok(model) => model,
        Err(error) => {
            state.disable(&session_key, instance_id, "create", model_error(error));
            return;
        }
    };

    let mut bytes_since_checkpoint = 0usize;
    let mut checkpoint_due = true;
    let mut output_sequence = 0u64;
    loop {
        let command = match rx.recv_timeout(CHECKPOINT_IDLE_INTERVAL) {
            Ok(command) => command,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if checkpoint_due {
                    if let Err(error) = validate_checkpoint(&model) {
                        state.disable(&session_key, instance_id, "snapshot", model_error(error));
                        return;
                    }
                    checkpoint_due = false;
                    bytes_since_checkpoint = 0;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        if state.disabled.load(Ordering::Acquire) {
            return;
        }
        let result = match command {
            ShadowCommand::Feed(bytes) => {
                bytes_since_checkpoint = bytes_since_checkpoint.saturating_add(bytes.len());
                let result = model.feed(&bytes);
                if result.is_ok() {
                    output_sequence = output_sequence.saturating_add(1);
                    if let Some(event_sink) = &state.event_sink {
                        event_sink(TerminalModelEvent::Output(TerminalModelOutputFrame {
                            instance_id,
                            sequence: output_sequence,
                            bytes,
                        }));
                    }
                }
                result
            }
            ShadowCommand::Resize { cols, rows } => model.resize(cols, rows),
            ShadowCommand::PortableSnapshot(response) => {
                let result = model
                    .format_portable_vt()
                    .map(|portable_vt| PortableTerminalSnapshot {
                        instance_id,
                        watermark: output_sequence,
                        portable_vt,
                    })
                    .map_err(model_error);
                let _ = response.send(result);
                continue;
            }
            #[cfg(test)]
            ShadowCommand::Snapshot(response) => {
                let result = model.encode_snapshot().map_err(model_error);
                let _ = response.send(result);
                continue;
            }
            #[cfg(test)]
            ShadowCommand::PortableVt(response) => {
                let result = model.format_portable_vt().map_err(model_error);
                let _ = response.send(result);
                continue;
            }
            ShadowCommand::Shutdown => return,
        };
        if let Err(error) = result {
            state.disable(&session_key, instance_id, "command", model_error(error));
            return;
        }
        let replies = model.take_protocol_replies();
        if let Some(reply_sink) = &state.reply_sink {
            for reply in replies {
                if let Err(error) = reply_sink(&session_key, instance_id, &reply) {
                    state.disable(&session_key, instance_id, "reply", error);
                    return;
                }
            }
        } else {
            state.capture_replies(replies);
        }
        if bytes_since_checkpoint >= CHECKPOINT_INTERVAL_BYTES {
            checkpoint_due = true;
        }
    }
}

fn validate_checkpoint(model: &GhosttyTerminalModel) -> Result<(), TerminalModelError> {
    let snapshot = model.encode_snapshot()?;
    let restored = GhosttyTerminalModel::decode_snapshot(&snapshot)?;
    let _portable_vt = restored.format_portable_vt()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_preserves_raw_chunk_order_and_captures_replies() {
        let (session, feeder) = ShadowTerminalSession::start(
            "task-shell-0".to_string(),
            42,
            TerminalModelOptions::new(20, 4),
        )
        .expect("shadow worker should start");

        feeder.feed(b"before \xF0\x9F");
        feeder.feed(b"\x98\x80\r\n\x1b[6n");
        let snapshot = session.snapshot().expect("snapshot should be available");
        let portable = session
            .portable_vt()
            .expect("portable VT should be available");

        assert!(snapshot.starts_with(b"GHOSTSNP"));
        assert!(portable
            .windows(b"before".len())
            .any(|part| part == b"before"));
        assert_eq!(session.take_protocol_replies().len(), 1);
        assert!(session.diagnostics().is_empty());
    }

    #[test]
    fn authoritative_replies_are_forwarded_once_with_session_scope() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let captured_replies = Arc::clone(&captured);
        let reply_sink: TerminalModelReplySink =
            Arc::new(move |session_key, instance_id, bytes| {
                captured_replies
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push((session_key.to_string(), instance_id, bytes.to_vec()));
                Ok(())
            });
        let (session, feeder) = ShadowTerminalSession::start_authoritative(
            "authoritative-shell".to_string(),
            73,
            TerminalModelOptions::new(80, 24),
            None,
            reply_sink,
        )
        .expect("authoritative terminal model should start");

        for byte in b"\x1b[6n\x1b[c\x1b[>c\x1b[=c\x1b[>q" {
            feeder.feed(std::slice::from_ref(byte));
        }
        session
            .portable_snapshot()
            .expect("snapshot should cross the model command barrier");
        session
            .portable_snapshot()
            .expect("second snapshot should not repeat drained replies");

        let replies = captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(replies.len(), 5);
        assert!(replies
            .iter()
            .all(|(key, instance_id, bytes)| key == "authoritative-shell"
                && *instance_id == 73
                && !bytes.is_empty()));
    }

    #[test]
    fn reply_routing_failure_disables_only_the_affected_model() {
        let captured_events = Arc::new(Mutex::new(Vec::new()));
        let failure_events = Arc::clone(&captured_events);
        let event_sink: TerminalModelEventSink = Arc::new(move |event| {
            failure_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });
        let failing_sink: TerminalModelReplySink =
            Arc::new(|_, _, _| Err("ordered writer unavailable".to_string()));
        let (failed_session, failed_feeder) = ShadowTerminalSession::start_authoritative(
            "failed-shell".to_string(),
            91,
            TerminalModelOptions::new(80, 24),
            Some(event_sink),
            failing_sink,
        )
        .expect("failing model path should start");

        failed_feeder.feed(b"\x1b[6n");
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while failed_session.diagnostics().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }

        assert_eq!(failed_session.diagnostics()[0].phase, "reply");
        assert!(captured_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(&TerminalModelEvent::Disabled { instance_id: 91 }));

        let (healthy_session, healthy_feeder) = ShadowTerminalSession::start(
            "healthy-shell".to_string(),
            92,
            TerminalModelOptions::new(80, 24),
        )
        .expect("independent model path should start");
        healthy_feeder.feed(b"\x1b[6n");
        healthy_session
            .portable_snapshot()
            .expect("healthy model should remain available");
        assert_eq!(healthy_session.take_protocol_replies().len(), 1);
    }

    #[test]
    fn disposed_authoritative_model_cannot_route_late_replies() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let captured_replies = Arc::clone(&captured);
        let reply_sink: TerminalModelReplySink = Arc::new(move |_, _, bytes| {
            captured_replies
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(bytes.to_vec());
            Ok(())
        });
        let (session, feeder) = ShadowTerminalSession::start_authoritative(
            "disposed-shell".to_string(),
            100,
            TerminalModelOptions::new(80, 24),
            None,
            reply_sink,
        )
        .expect("authoritative model should start");

        drop(session);
        feeder.feed(b"\x1b[6n");

        assert!(captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
    }

    #[test]
    fn portable_snapshot_watermark_separates_bootstrap_from_later_frames() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&captured);
        let sink: TerminalModelEventSink = Arc::new(move |event| {
            captured_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });
        let (session, feeder) = ShadowTerminalSession::start_with_event_sink(
            "cutover-shell".to_string(),
            77,
            TerminalModelOptions::new(20, 4),
            sink,
        )
        .expect("terminal model worker should start");

        feeder.feed(b"bootstrap");
        let snapshot = session
            .portable_snapshot()
            .expect("portable snapshot should be available");
        feeder.feed(b"later");
        let final_snapshot = session
            .portable_snapshot()
            .expect("later feed should cross the actor barrier");

        assert_eq!(snapshot.instance_id, 77);
        assert_eq!(snapshot.watermark, 1);
        assert!(snapshot
            .portable_vt
            .windows(b"bootstrap".len())
            .any(|part| part == b"bootstrap"));
        assert!(!snapshot
            .portable_vt
            .windows(b"later".len())
            .any(|part| part == b"later"));
        assert_eq!(final_snapshot.watermark, 2);

        let events = captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(
            events.as_slice(),
            [
                TerminalModelEvent::Output(TerminalModelOutputFrame {
                    instance_id: 77,
                    sequence: 1,
                    bytes: b"bootstrap".to_vec(),
                }),
                TerminalModelEvent::Output(TerminalModelOutputFrame {
                    instance_id: 77,
                    sequence: 2,
                    bytes: b"later".to_vec(),
                }),
            ]
        );
    }

    #[test]
    fn stale_instance_feeder_cannot_mutate_successor_model() {
        let (old_session, old_feeder) = ShadowTerminalSession::start(
            "shared-key".to_string(),
            10,
            TerminalModelOptions::new(20, 4),
        )
        .expect("old shadow worker should start");
        old_feeder.feed(b"old-instance");
        drop(old_session);

        let (new_session, new_feeder) = ShadowTerminalSession::start(
            "shared-key".to_string(),
            11,
            TerminalModelOptions::new(20, 4),
        )
        .expect("new shadow worker should start");
        old_feeder.feed(b"stale-output");
        new_feeder.feed(b"new-instance");

        let portable = new_session
            .portable_vt()
            .expect("successor VT should format");
        assert!(portable
            .windows(b"new-instance".len())
            .any(|part| part == b"new-instance"));
        assert!(!portable
            .windows(b"stale-output".len())
            .any(|part| part == b"stale-output"));
    }
}
