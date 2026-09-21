#[cfg(test)]
use super::super::TerminalModelQueueSaturationGate;
use super::super::{GhosttyTerminalModel, TerminalModel, TerminalModelError, TerminalModelOptions};
use super::checkpoint::{RetainedChange, TerminalModelCheckpoint};
#[cfg(test)]
use super::event_state::TerminalModelDiagnostic;
use super::event_state::{PortableTerminalSnapshot, TerminalModelEventSink, TerminalModelState};
use log::{info, warn};
use openforge_session_host::TerminalColorProfile;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub(super) const COMMAND_QUEUE_CAPACITY: usize = 64;
const MAX_FEED_BYTES: usize = 8 * 1024;
pub(super) const QUEUE_CATCH_UP_TIMEOUT: Duration = Duration::from_millis(50);
#[cfg(test)]
pub(crate) const TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY: usize =
    COMMAND_QUEUE_CAPACITY * MAX_FEED_BYTES;
#[cfg(test)]
pub(crate) const TERMINAL_MODEL_QUEUE_SATURATION_TEST_BYTES: usize = 3 * MAX_FEED_BYTES;
const CHECKPOINT_INTERVAL_BYTES: usize = 8 * 1024 * 1024;
const CHECKPOINT_IDLE_INTERVAL: Duration = Duration::from_millis(50);
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const WORKER_JOIN_TIMEOUT: Duration = Duration::from_millis(100);
pub(super) const COMMAND_SUBMISSION_TIMEOUT: Duration = Duration::from_millis(50);

fn send_command_with_timeout(
    tx: &mpsc::SyncSender<TerminalModelCommand>,
    mut command: TerminalModelCommand,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + COMMAND_SUBMISSION_TIMEOUT;
    loop {
        match tx.try_send(command) {
            Ok(()) => return Ok(()),
            Err(mpsc::TrySendError::Full(returned)) if std::time::Instant::now() < deadline => {
                command = returned;
                std::thread::sleep(Duration::from_micros(50));
            }
            Err(mpsc::TrySendError::Full(_)) => {
                return Err(format!(
                    "command submission timed out after {} ms",
                    COMMAND_SUBMISSION_TIMEOUT.as_millis()
                ));
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                return Err("model worker disconnected while submitting command".to_string());
            }
        }
    }
}

const TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY: usize =
    super::super::MAX_SNAPSHOT_CONTINUATION_BYTES;

struct BoundedCompatibilityReplay {
    bytes: VecDeque<u8>,
}

impl BoundedCompatibilityReplay {
    fn new() -> Self {
        Self {
            bytes: VecDeque::with_capacity(TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY),
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        if bytes.len() >= TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY {
            self.bytes.clear();
            self.bytes.extend(
                bytes[bytes.len() - TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY..]
                    .iter()
                    .copied(),
            );
            return;
        }
        let overflow = self
            .bytes
            .len()
            .saturating_add(bytes.len())
            .saturating_sub(TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY);
        self.bytes.drain(..overflow);
        self.bytes.extend(bytes.iter().copied());
    }

    fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }
}

enum TerminalModelCommand {
    Feed(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
    },
    UpdateColorProfile {
        profile: TerminalColorProfile,
        response: mpsc::SyncSender<Result<(), String>>,
    },
    PortableSnapshot(mpsc::SyncSender<Result<PortableTerminalSnapshot, String>>),
    #[allow(dead_code, reason = "Requested by the daemon's shared-source build")]
    Checkpoint(mpsc::SyncSender<Result<TerminalModelCheckpoint, String>>),
    #[cfg(test)]
    Snapshot(mpsc::SyncSender<Result<Vec<u8>, String>>),
    #[cfg(test)]
    PortableVt(mpsc::SyncSender<Result<Vec<u8>, String>>),
    #[cfg(test)]
    ColorProfile(mpsc::SyncSender<TerminalColorProfile>),
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
    #[cfg(test)]
    queue_saturation_gate: Option<TerminalModelQueueSaturationGate>,
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
                    #[cfg(test)]
                    self.state.mark_queue_saturated();
                    #[cfg(test)]
                    if let Some(gate) = &self.queue_saturation_gate {
                        gate.mark_queue_saturated();
                    }
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
    shutdown_requested: Arc<AtomicBool>,
    worker_done: Mutex<mpsc::Receiver<()>>,
    worker: Option<JoinHandle<()>>,
}

impl TerminalModelSession {
    #[cfg(test)]
    pub(crate) fn start(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, None, None)
    }

    pub(crate) fn start_with_event_sink(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: TerminalModelEventSink,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        Self::start_internal(session_key, instance_id, options, Some(event_sink), None)
    }

    #[allow(
        dead_code,
        reason = "Used by the daemon's shared-source build and checkpoint tests"
    )]
    pub(crate) fn restore_with_event_sink(
        session_key: String,
        checkpoint: TerminalModelCheckpoint,
        event_sink: TerminalModelEventSink,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        checkpoint.validate().map_err(std::io::Error::other)?;
        Self::start_internal(
            session_key,
            checkpoint.instance_id,
            TerminalModelOptions::new(1, 1),
            Some(event_sink),
            Some(checkpoint),
        )
    }

    #[allow(
        dead_code,
        reason = "Used by the daemon's shared-source build and checkpoint tests"
    )]
    pub(crate) fn checkpoint(&self) -> Result<TerminalModelCheckpoint, String> {
        if self.state.is_disabled() {
            return Err("terminal model is disabled".into());
        }
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        send_command_with_timeout(&self.tx, TerminalModelCommand::Checkpoint(response_tx))?;
        response_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| format!("terminal checkpoint failed: {error}"))?
    }

    fn start_internal(
        session_key: String,
        instance_id: u64,
        options: TerminalModelOptions,
        event_sink: Option<TerminalModelEventSink>,
        checkpoint: Option<TerminalModelCheckpoint>,
    ) -> Result<(Self, TerminalModelFeeder), std::io::Error> {
        let session_key: Arc<str> = Arc::from(session_key);
        let queue_policy = if event_sink.is_some() {
            TerminalModelQueuePolicy::Backpressure
        } else {
            TerminalModelQueuePolicy::DisableAfterTimeout
        };
        let state = Arc::new(TerminalModelState::new(event_sink));
        #[cfg(test)]
        let queue_saturation_gate =
            if let super::super::TerminalModelTestFault::BlockFirstCommand(gate) =
                &options.test_fault
            {
                Some(gate.clone())
            } else {
                None
            };
        let restoring = checkpoint.is_some();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let (worker_done_tx, worker_done) = mpsc::channel();
        #[cfg(test)]
        let command_queue_capacity = if queue_saturation_gate.is_some() {
            1
        } else {
            COMMAND_QUEUE_CAPACITY
        };
        #[cfg(not(test))]
        let command_queue_capacity = COMMAND_QUEUE_CAPACITY;
        let (tx, rx) = mpsc::sync_channel(command_queue_capacity);
        let worker_key = Arc::clone(&session_key);
        let worker_state = Arc::clone(&state);
        let worker_shutdown_requested = Arc::clone(&shutdown_requested);
        let worker = std::thread::Builder::new()
            .name(format!("terminal-model-{instance_id}"))
            .spawn(move || {
                let panic_key = Arc::clone(&worker_key);
                let panic_state = Arc::clone(&worker_state);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_worker(
                        worker_key,
                        instance_id,
                        options,
                        rx,
                        worker_state,
                        worker_shutdown_requested,
                        checkpoint.map(|checkpoint| (checkpoint, ready_tx)),
                    );
                }));
                if let Err(payload) = result {
                    let message = payload
                        .downcast_ref::<&str>()
                        .map(|message| (*message).to_string())
                        .or_else(|| payload.downcast_ref::<String>().cloned())
                        .unwrap_or_else(|| "unknown model worker panic".to_string());
                    panic_state.disable(&panic_key, instance_id, "panic", message);
                }
                let _ = worker_done_tx.send(());
            })?;
        if restoring {
            let ready = ready_rx
                .recv_timeout(REQUEST_TIMEOUT)
                .map_err(|error| format!("terminal restore failed: {error}"))
                .and_then(|result| result);
            if let Err(error) = ready {
                shutdown_requested.store(true, Ordering::Release);
                return Err(std::io::Error::other(error));
            }
        }
        let feeder = TerminalModelFeeder {
            session_key: Arc::clone(&session_key),
            instance_id,
            tx: tx.clone(),
            queue_policy,
            state: Arc::clone(&state),
            #[cfg(test)]
            queue_saturation_gate,
        };
        Ok((
            Self {
                session_key,
                instance_id,
                tx,
                queue_policy,
                state,
                shutdown_requested,
                worker_done: Mutex::new(worker_done),
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
            TerminalModelQueuePolicy::Backpressure => {
                send_command_with_timeout(&self.tx, TerminalModelCommand::Resize { cols, rows })
            }
            TerminalModelQueuePolicy::DisableAfterTimeout => self
                .tx
                .try_send(TerminalModelCommand::Resize { cols, rows })
                .map_err(|error| error.to_string()),
        };
        if let Err(error) = result {
            self.state.disable_without_blocking_event_sink(
                &self.session_key,
                self.instance_id,
                "resize",
                format!("failed to queue resize: {error}"),
            );
        }
    }

    pub(crate) fn update_color_profile(&self, profile: TerminalColorProfile) -> Result<(), String> {
        if self.state.is_disabled() {
            return Err("terminal model is disabled".to_string());
        }
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        let command = TerminalModelCommand::UpdateColorProfile {
            profile,
            response: response_tx,
        };
        if let Err(error) = send_command_with_timeout(&self.tx, command) {
            self.state.disable_without_blocking_event_sink(
                &self.session_key,
                self.instance_id,
                "update-color-profile",
                format!("failed to queue colour profile update: {error}"),
            );
            return Err(error);
        }
        response_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| format!("terminal colour profile update failed: {error}"))?
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
    pub(crate) fn color_profile(&self) -> TerminalColorProfile {
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        send_command_with_timeout(&self.tx, TerminalModelCommand::ColorProfile(response_tx))
            .expect("test profile request should enter the model queue");
        response_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .expect("test profile request should cross the model actor")
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
        send_command_with_timeout(&self.tx, command(response_tx))
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

    #[cfg(test)]
    pub(crate) fn queue_saturated_for_test(&self) -> bool {
        self.state.queue_saturated()
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
    send_command_with_timeout(tx, TerminalModelCommand::PortableSnapshot(response_tx))
        .map_err(|error| format!("terminal model snapshot request failed: {error}"))?;
    response_rx
        .recv_timeout(REQUEST_TIMEOUT)
        .map_err(|error| format!("terminal model snapshot response failed: {error}"))?
}

impl Drop for TerminalModelSession {
    fn drop(&mut self) {
        self.shutdown_requested.store(true, Ordering::Release);
        let _ = self.tx.try_send(TerminalModelCommand::Shutdown);

        if let Some(worker) = self.worker.take() {
            let worker_done = self
                .worker_done
                .get_mut()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match worker_done.recv_timeout(WORKER_JOIN_TIMEOUT) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = worker.join();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    warn!(
                        "[terminal-model] key={} instance={} worker did not stop within {} ms; detaching",
                        self.session_key,
                        self.instance_id,
                        WORKER_JOIN_TIMEOUT.as_millis()
                    );
                }
            }
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
    shutdown_requested: Arc<AtomicBool>,
    restoration: Option<(
        TerminalModelCheckpoint,
        mpsc::SyncSender<Result<(), String>>,
    )>,
) {
    #[cfg(test)]
    let test_fault = options.test_fault.clone();
    #[cfg(test)]
    if matches!(
        &test_fault,
        super::super::TerminalModelTestFault::CreateFailure
    ) {
        state.disable(
            &session_key,
            instance_id,
            "create",
            "injected terminal model creation failure".to_string(),
        );
        return;
    }

    let (mut model, mut output_sequence, mut compatibility_replay, mut retained_checkpoint) =
        if let Some((checkpoint, ready)) = restoration {
            let model = match checkpoint.decode() {
                Ok(model) => model,
                Err(error) => {
                    let _ = ready.send(Err(error));
                    return;
                }
            };
            let mut replay = BoundedCompatibilityReplay::new();
            replay.push(&checkpoint.compatibility_replay);
            if ready.send(Ok(())).is_err() {
                return;
            }
            (model, checkpoint.watermark, replay, Some(checkpoint))
        } else {
            let model = match GhosttyTerminalModel::new(options) {
                Ok(model) => model,
                Err(error) => {
                    state.disable(&session_key, instance_id, "create", model_error(error));
                    return;
                }
            };
            (model, 0, BoundedCompatibilityReplay::new(), None)
        };

    let mut bytes_since_checkpoint = 0usize;
    let mut checkpoint_due = true;
    #[cfg(test)]
    let mut first_command = true;
    loop {
        if shutdown_requested.load(Ordering::Acquire) {
            return;
        }
        let command = match rx.recv_timeout(CHECKPOINT_IDLE_INTERVAL) {
            Ok(command) => command,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if checkpoint_due {
                    match validate_checkpoint(&model) {
                        Ok(()) => {
                            checkpoint_due = false;
                            bytes_since_checkpoint = 0;
                        }
                        Err(TerminalModelError::ContinuationUnavailable) => {
                            // Retry after later input returns the parser to a snapshotable state.
                        }
                        Err(error) => {
                            state.disable(
                                &session_key,
                                instance_id,
                                "snapshot",
                                model_error(error),
                            );
                            return;
                        }
                    }
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        #[cfg(test)]
        if first_command {
            first_command = false;
            match &test_fault {
                super::super::TerminalModelTestFault::BlockFirstCommand(gate) => {
                    gate.block_first_command();
                }
                super::super::TerminalModelTestFault::PanicOnFirstCommand => {
                    panic!("injected terminal model worker panic");
                }
                super::super::TerminalModelTestFault::None
                | super::super::TerminalModelTestFault::CreateFailure
                | super::super::TerminalModelTestFault::ColorProfileUpdateFailure => {}
            }
        }
        if state.is_disabled() {
            return;
        }
        let result = match command {
            TerminalModelCommand::Feed(bytes) => {
                bytes_since_checkpoint = bytes_since_checkpoint.saturating_add(bytes.len());
                let result = model.feed(&bytes);
                if result.is_ok() {
                    compatibility_replay.push(&bytes);
                    output_sequence = output_sequence.saturating_add(1);
                    TerminalModelCheckpoint::record_change(
                        &mut retained_checkpoint,
                        &model,
                        || RetainedChange::Feed {
                            bytes: bytes.clone(),
                        },
                    );
                    state.publish_output(instance_id, output_sequence, bytes);
                }
                result
            }
            TerminalModelCommand::Resize { cols, rows } => {
                let result = model.resize(cols, rows);
                if result.is_ok() {
                    TerminalModelCheckpoint::record_change(
                        &mut retained_checkpoint,
                        &model,
                        || RetainedChange::Resize { cols, rows },
                    );
                }
                result
            }
            TerminalModelCommand::UpdateColorProfile { profile, response } => {
                #[cfg(test)]
                let result = if matches!(
                    &test_fault,
                    super::super::TerminalModelTestFault::ColorProfileUpdateFailure
                ) {
                    Err("injected terminal colour profile update failure".to_string())
                } else {
                    model.update_color_profile(profile).map_err(model_error)
                };
                #[cfg(not(test))]
                let result = model.update_color_profile(profile).map_err(model_error);

                match result {
                    Ok(()) => {
                        TerminalModelCheckpoint::record_change(
                            &mut retained_checkpoint,
                            &model,
                            || RetainedChange::ColorProfile { profile },
                        );
                        let _ = response.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = response.send(Err(error.clone()));
                        state.disable(&session_key, instance_id, "update-color-profile", error);
                        return;
                    }
                }
                continue;
            }
            TerminalModelCommand::Checkpoint(response) => {
                let result = TerminalModelCheckpoint::capture(
                    instance_id,
                    output_sequence,
                    &model,
                    compatibility_replay.snapshot(),
                    retained_checkpoint.as_ref(),
                );
                let _ = response.send(result);
                continue;
            }
            TerminalModelCommand::PortableSnapshot(response) => {
                let result = model
                    .parser_continuation()
                    .or_else(|error| {
                        if matches!(error, TerminalModelError::ContinuationUnavailable) {
                            if let Some(checkpoint) = &retained_checkpoint {
                                return Ok(checkpoint.continuation.clone());
                            }
                        }
                        Err(error)
                    })
                    .and_then(|continuation| {
                        Ok(PortableTerminalSnapshot {
                            instance_id,
                            watermark: output_sequence,
                            portable_vt: model.format_portable_vt()?,
                            compatibility_replay: compatibility_replay.snapshot(),
                            continuation,
                        })
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
            #[cfg(test)]
            TerminalModelCommand::ColorProfile(response) => {
                let _ = response.send(model.color_profile());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_replay_keeps_only_the_bounded_tail() {
        let mut replay = BoundedCompatibilityReplay::new();
        replay.push(&vec![b'a'; TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY]);
        const IMAGE_SEQUENCE: &[u8] = b"\x1b]1337;File=size=3;inline=1:AAAA\x07";
        replay.push(IMAGE_SEQUENCE);

        let snapshot = replay.snapshot();
        assert_eq!(snapshot.len(), TERMINAL_MODEL_COMPATIBILITY_REPLAY_CAPACITY);
        assert!(snapshot.ends_with(IMAGE_SEQUENCE));
    }
}
