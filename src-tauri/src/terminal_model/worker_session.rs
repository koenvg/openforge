use super::super::{GhosttyTerminalModel, TerminalModel, TerminalModelError, TerminalModelOptions};
#[cfg(test)]
use super::event_state::TerminalModelDiagnostic;
use super::event_state::{PortableTerminalSnapshot, TerminalModelEventSink, TerminalModelState};
use log::info;
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

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

pub(super) const COMMAND_QUEUE_CAPACITY: usize = 64;
const MAX_FEED_BYTES: usize = 8 * 1024;
pub(super) const QUEUE_CATCH_UP_TIMEOUT: Duration = Duration::from_millis(50);
#[cfg(test)]
pub(crate) const TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY: usize =
    COMMAND_QUEUE_CAPACITY * MAX_FEED_BYTES;
const CHECKPOINT_INTERVAL_BYTES: usize = 8 * 1024 * 1024;
const CHECKPOINT_IDLE_INTERVAL: Duration = Duration::from_millis(50);
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

enum TerminalModelCommand {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerminalModelQueuePolicy {
    Backpressure,
    DisableAfterTimeout,
}

#[derive(Clone)]
pub(crate) struct TerminalModelFeeder {
    session_key: Arc<str>,
    instance_id: u64,
    tx: mpsc::SyncSender<TerminalModelCommand>,
    queue_policy: TerminalModelQueuePolicy,
    state: Arc<TerminalModelState>,
}

impl TerminalModelFeeder {
    pub(crate) fn feed(&self, bytes: &[u8]) {
        if self.state.is_disabled() {
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
        let mut command = TerminalModelCommand::Feed(bytes.to_vec());
        loop {
            match self.tx.try_send(command) {
                Ok(()) => return,
                Err(mpsc::TrySendError::Full(returned))
                    if self.queue_policy == TerminalModelQueuePolicy::Backpressure =>
                {
                    if self.tx.send(returned).is_err() {
                        self.state.disable(
                            &self.session_key,
                            self.instance_id,
                            "feed",
                            "model worker disconnected".to_string(),
                        );
                    }
                    return;
                }
                Err(mpsc::TrySendError::Full(returned)) if std::time::Instant::now() < deadline => {
                    command = returned;
                    std::thread::sleep(Duration::from_micros(50));
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

pub(crate) struct TerminalModelSession {
    session_key: Arc<str>,
    instance_id: u64,
    tx: mpsc::SyncSender<TerminalModelCommand>,
    queue_policy: TerminalModelQueuePolicy,
    state: Arc<TerminalModelState>,
    worker: Option<JoinHandle<()>>,
}

impl TerminalModelSession {
    pub(crate) fn start(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, None)
    }

    pub(crate) fn start_with_event_sink(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: TerminalModelEventSink,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, Some(event_sink))
    }

    fn start_internal(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: Option<TerminalModelEventSink>,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        let session_key: Arc<str> = Arc::from(session_key);
        let queue_policy = if event_sink.is_some() {
            TerminalModelQueuePolicy::Backpressure
        } else {
            TerminalModelQueuePolicy::DisableAfterTimeout
        };
        let state = Arc::new(TerminalModelState::new(event_sink));
        let (tx, rx) = mpsc::sync_channel(COMMAND_QUEUE_CAPACITY);
        let worker_key = Arc::clone(&session_key);
        let worker_state = Arc::clone(&state);
        let worker = std::thread::Builder::new()
            .name(format!("terminal-model-{instance_id}"))
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
        let feeder = TerminalModelFeeder {
            session_key: Arc::clone(&session_key),
            instance_id,
            tx: tx.clone(),
            queue_policy,
            state: Arc::clone(&state),
        };
        Ok((
            Self {
                session_key,
                instance_id,
                tx,
                queue_policy,
                state,
                worker: Some(worker),
            },
            feeder,
        ))
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        if self.state.is_disabled() {
            return;
        }
        let result = match self.queue_policy {
            TerminalModelQueuePolicy::Backpressure => self
                .tx
                .send(TerminalModelCommand::Resize { cols, rows })
                .map_err(|error| error.to_string()),
            TerminalModelQueuePolicy::DisableAfterTimeout => self
                .tx
                .try_send(TerminalModelCommand::Resize { cols, rows })
                .map_err(|error| error.to_string()),
        };
        if let Err(error) = result {
            self.state.disable(
                &self.session_key,
                self.instance_id,
                "resize",
                format!("failed to queue resize: {error}"),
            );
        }
    }

    pub(crate) fn portable_snapshot(&self) -> Result<PortableTerminalSnapshot, String> {
        request_portable_snapshot(&self.tx, &self.state)
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> Result<Vec<u8>, String> {
        self.request(TerminalModelCommand::Snapshot)
    }

    #[cfg(test)]
    pub(crate) fn portable_vt(&self) -> Result<Vec<u8>, String> {
        self.request(TerminalModelCommand::PortableVt)
    }

    #[cfg(test)]
    fn request(
        &self,
        command: impl FnOnce(mpsc::SyncSender<Result<Vec<u8>, String>>) -> TerminalModelCommand,
    ) -> Result<Vec<u8>, String> {
        if self.state.is_disabled() {
            return Err("terminal model is disabled".to_string());
        }
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        self.tx
            .send(command(response_tx))
            .map_err(|error| format!("terminal model request failed: {error}"))?;
        response_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| format!("terminal model response failed: {error}"))?
    }

    #[cfg(test)]
    pub(crate) fn take_protocol_replies(&self) -> Vec<Vec<u8>> {
        self.state.take_protocol_replies()
    }

    #[cfg(test)]
    pub(crate) fn diagnostics(&self) -> Vec<TerminalModelDiagnostic> {
        self.state.diagnostics()
    }
}

fn request_portable_snapshot(
    tx: &mpsc::SyncSender<TerminalModelCommand>,
    state: &TerminalModelState,
) -> Result<PortableTerminalSnapshot, String> {
    if state.is_disabled() {
        return Err("terminal model is disabled".to_string());
    }
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    tx.send(TerminalModelCommand::PortableSnapshot(response_tx))
        .map_err(|error| format!("terminal model snapshot request failed: {error}"))?;
    response_rx
        .recv_timeout(REQUEST_TIMEOUT)
        .map_err(|error| format!("terminal model snapshot response failed: {error}"))?
}

impl Drop for TerminalModelSession {
    fn drop(&mut self) {
        if !self.state.is_disabled() {
            let _ = self.tx.send(TerminalModelCommand::Shutdown);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        info!(
            "[terminal-model] key={} instance={} disposed",
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
    rx: mpsc::Receiver<TerminalModelCommand>,
    state: Arc<TerminalModelState>,
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
        if state.is_disabled() {
            return;
        }
        let result = match command {
            TerminalModelCommand::Feed(bytes) => {
                bytes_since_checkpoint = bytes_since_checkpoint.saturating_add(bytes.len());
                let result = model.feed(&bytes);
                if result.is_ok() {
                    output_sequence = output_sequence.saturating_add(1);
                    state.publish_output(instance_id, output_sequence, bytes);
                }
                result
            }
            TerminalModelCommand::Resize { cols, rows } => model.resize(cols, rows),
            TerminalModelCommand::PortableSnapshot(response) => {
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
            TerminalModelCommand::Snapshot(response) => {
                let result = model.encode_snapshot().map_err(model_error);
                let _ = response.send(result);
                continue;
            }
            #[cfg(test)]
            TerminalModelCommand::PortableVt(response) => {
                let result = model.format_portable_vt().map_err(model_error);
                let _ = response.send(result);
                continue;
            }
            TerminalModelCommand::Shutdown => return,
        };
        if let Err(error) = result {
            state.disable(&session_key, instance_id, "command", model_error(error));
            return;
        }
        state.publish_replies(instance_id, model.take_protocol_replies());
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
