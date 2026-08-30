//! Bridges Ghostty terminal-model events to OpenForge runtime transports.

use crate::app_events::RuntimeEventPublisher;
use crate::terminal_model::{TerminalModelEvent, TerminalModelEventSink};
use base64::Engine;
use log::warn;
use std::sync::Arc;

use super::ordered_writer::OrderedPtyWriter;

type TerminalModelDisabledSink = Arc<dyn Fn(u64) + Send + Sync>;

const TERMINAL_MODEL_EVENT_QUEUE_CAPACITY: usize = 64;
const TERMINAL_MODEL_EVENT_FLUSH_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(16);
const TERMINAL_MODEL_EVENT_MAX_BATCH_BYTES: usize = 64 * 1024;

enum DeferredTerminalModelEvent {
    Output {
        instance_id: u64,
        sequence: u64,
        bytes: Vec<u8>,
    },
    Disabled {
        instance_id: u64,
    },
}

enum DeferredEventReceive {
    Event(DeferredTerminalModelEvent),
    Flush,
    Closed,
}

struct PendingModelOutput {
    instance_id: u64,
    start_sequence: u64,
    sequence: u64,
    bytes: Vec<u8>,
}

impl PendingModelOutput {
    fn new(instance_id: u64, sequence: u64, bytes: Vec<u8>) -> Self {
        Self {
            instance_id,
            start_sequence: sequence,
            sequence,
            bytes,
        }
    }

    fn can_append(&self, instance_id: u64, sequence: u64, bytes_len: usize) -> bool {
        self.instance_id == instance_id
            && sequence == self.sequence.saturating_add(1)
            && self.bytes.len().saturating_add(bytes_len) <= TERMINAL_MODEL_EVENT_MAX_BATCH_BYTES
    }

    fn append(&mut self, sequence: u64, bytes: &[u8]) {
        self.sequence = sequence;
        self.bytes.extend_from_slice(bytes);
    }
}

pub(super) struct TerminalModelEventBridge {
    session_key: String,
    event_publisher: RuntimeEventPublisher,
    writer: Arc<OrderedPtyWriter>,
    disabled_sink: Option<TerminalModelDisabledSink>,
}

fn publish_model_output(
    publisher: &RuntimeEventPublisher,
    event_name: &str,
    output: PendingModelOutput,
) {
    publisher.publish(
        event_name,
        &serde_json::json!({
            "instance_id": output.instance_id,
            "start_sequence": output.start_sequence,
            "sequence": output.sequence,
            "data": base64::engine::general_purpose::STANDARD.encode(output.bytes),
        }),
    );
}

fn run_deferred_event_worker(
    rx: std::sync::mpsc::Receiver<DeferredTerminalModelEvent>,
    publisher: RuntimeEventPublisher,
    output_event_name: String,
    disabled_event_name: String,
    disabled_sink: Option<TerminalModelDisabledSink>,
    flush_interval: std::time::Duration,
) {
    let mut pending: Option<PendingModelOutput> = None;
    let mut flush_deadline: Option<std::time::Instant> = None;
    loop {
        let received = if let Some(deadline) = flush_deadline {
            let now = std::time::Instant::now();
            if now >= deadline {
                DeferredEventReceive::Flush
            } else {
                match rx.recv_timeout(deadline.duration_since(now)) {
                    Ok(event) => DeferredEventReceive::Event(event),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => DeferredEventReceive::Flush,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        DeferredEventReceive::Closed
                    }
                }
            }
        } else {
            match rx.recv() {
                Ok(event) => DeferredEventReceive::Event(event),
                Err(_) => DeferredEventReceive::Closed,
            }
        };

        match received {
            DeferredEventReceive::Event(DeferredTerminalModelEvent::Output {
                instance_id,
                sequence,
                bytes,
            }) => {
                if let Some(current) = pending.as_mut() {
                    if current.can_append(instance_id, sequence, bytes.len()) {
                        current.append(sequence, &bytes);
                        continue;
                    }
                }
                if let Some(current) = pending.take() {
                    publish_model_output(&publisher, &output_event_name, current);
                }
                pending = Some(PendingModelOutput::new(instance_id, sequence, bytes));
                flush_deadline = Some(std::time::Instant::now() + flush_interval);
            }
            DeferredEventReceive::Event(DeferredTerminalModelEvent::Disabled { instance_id }) => {
                if let Some(current) = pending.take() {
                    publish_model_output(&publisher, &output_event_name, current);
                }
                flush_deadline = None;
                publisher.publish(
                    &disabled_event_name,
                    &serde_json::json!({ "instance_id": instance_id }),
                );
                if let Some(disabled_sink) = &disabled_sink {
                    disabled_sink(instance_id);
                }
            }
            DeferredEventReceive::Flush => {
                if let Some(current) = pending.take() {
                    publish_model_output(&publisher, &output_event_name, current);
                }
                flush_deadline = None;
            }
            DeferredEventReceive::Closed => {
                if let Some(current) = pending.take() {
                    publish_model_output(&publisher, &output_event_name, current);
                }
                return;
            }
        }
    }
}

impl TerminalModelEventBridge {
    pub(super) fn new(
        session_key: String,
        event_publisher: RuntimeEventPublisher,
        writer: Arc<OrderedPtyWriter>,
        disabled_sink: Option<TerminalModelDisabledSink>,
    ) -> Self {
        Self {
            session_key,
            event_publisher,
            writer,
            disabled_sink,
        }
    }

    pub(super) fn into_event_sink(self) -> TerminalModelEventSink {
        let output_event_name = format!("pty-model-output-{}", self.session_key);
        let disabled_event_name = format!("pty-model-disabled-{}", self.session_key);
        let (tx, rx) = std::sync::mpsc::sync_channel(TERMINAL_MODEL_EVENT_QUEUE_CAPACITY);
        let worker_publisher = self.event_publisher.clone();
        let worker_output_event_name = output_event_name.clone();
        let worker_disabled_event_name = disabled_event_name.clone();
        let worker_disabled_sink = self.disabled_sink.clone();
        let worker_name = format!("terminal-events-{}", self.session_key);
        if let Err(error) = std::thread::Builder::new()
            .name(worker_name)
            .stack_size(256 * 1024)
            .spawn(move || {
                run_deferred_event_worker(
                    rx,
                    worker_publisher,
                    worker_output_event_name,
                    worker_disabled_event_name,
                    worker_disabled_sink,
                    TERMINAL_MODEL_EVENT_FLUSH_INTERVAL,
                );
            })
        {
            warn!(
                "[terminal-model] key={} failed to start event batcher: {}",
                self.session_key, error
            );
        }

        Arc::new(move |event| match event {
            TerminalModelEvent::Output(frame) => {
                let deferred = DeferredTerminalModelEvent::Output {
                    instance_id: frame.instance_id,
                    sequence: frame.sequence,
                    bytes: frame.bytes,
                };
                if let Err(error) = tx.send(deferred) {
                    let DeferredTerminalModelEvent::Output {
                        instance_id,
                        sequence,
                        bytes,
                    } = error.0
                    else {
                        return;
                    };
                    publish_model_output(
                        &self.event_publisher,
                        &output_event_name,
                        PendingModelOutput::new(instance_id, sequence, bytes),
                    );
                }
            }
            TerminalModelEvent::ProtocolReply { instance_id, bytes } => {
                if let Err(error) =
                    self.writer
                        .write_ghostty_query_response(&self.session_key, instance_id, &bytes)
                {
                    warn!(
                        "[terminal-model] key={} instance={} query response failed: {}",
                        self.session_key, instance_id, error
                    );
                }
            }
            TerminalModelEvent::Disabled { instance_id } => {
                if tx
                    .send(DeferredTerminalModelEvent::Disabled { instance_id })
                    .is_err()
                {
                    self.event_publisher.publish(
                        &disabled_event_name,
                        &serde_json::json!({ "instance_id": instance_id }),
                    );
                    if let Some(disabled_sink) = &self.disabled_sink {
                        disabled_sink(instance_id);
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal_model::{TerminalModelEvent, TerminalModelOptions, TerminalModelSession};
    use std::io::{self, Write};
    use std::sync::Mutex;

    struct RecordingWriter {
        bytes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for RecordingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn bridge(
        session_key: &str,
        instance_id: u64,
        app_event_tx: Option<crate::app_events::AppEventSender>,
    ) -> (TerminalModelEventBridge, Arc<Mutex<Vec<u8>>>) {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let writer = Arc::new(
            OrderedPtyWriter::start(
                session_key.to_string(),
                instance_id,
                Box::new(RecordingWriter {
                    bytes: Arc::clone(&bytes),
                }),
            )
            .expect("ordered writer should start"),
        );
        (
            TerminalModelEventBridge::new(
                session_key.to_string(),
                RuntimeEventPublisher::new(None, app_event_tx),
                writer,
                None,
            ),
            bytes,
        )
    }

    fn receive_event(
        events: &mut tokio::sync::broadcast::Receiver<crate::app_events::AppEventEnvelope>,
    ) -> crate::app_events::AppEventEnvelope {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        loop {
            match events.try_recv() {
                Ok(event) => return event,
                Err(tokio::sync::broadcast::error::TryRecvError::Empty)
                    if std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
                Err(error) => panic!("event should be published: {error}"),
            }
        }
    }
    #[test]
    fn output_events_coalesce_into_one_base64_transport_frame() {
        let (event_tx, mut events) = tokio::sync::broadcast::channel(4);
        let (bridge, _bytes) = bridge("model-shell", 31, Some(event_tx));
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            "model-shell".to_string(),
            31,
            TerminalModelOptions::new(80, 24),
            bridge.into_event_sink(),
        )
        .expect("terminal model should start");

        feeder.feed(b"model ");
        feeder.feed(b"output");
        let snapshot = session
            .portable_snapshot()
            .expect("snapshot should synchronize model output");
        assert_eq!(snapshot.watermark, 2);

        let event = receive_event(&mut events);
        assert_eq!(event.event_name, "pty-model-output-model-shell");
        assert_eq!(event.payload["instance_id"], 31);
        assert_eq!(event.payload["start_sequence"], 1);
        assert_eq!(event.payload["sequence"], 2);
        assert_eq!(event.payload["data"], "bW9kZWwgb3V0cHV0");
        assert!(
            events.try_recv().is_err(),
            "coalesced output should publish once"
        );
    }

    #[test]
    fn backlogged_input_honors_elapsed_flush_deadline() {
        let (deferred_tx, deferred_rx) = std::sync::mpsc::channel();
        for sequence in 1..=4 {
            deferred_tx
                .send(DeferredTerminalModelEvent::Output {
                    instance_id: 33,
                    sequence,
                    bytes: vec![b'0' + sequence as u8],
                })
                .expect("test event should queue");
        }
        drop(deferred_tx);
        let (event_tx, mut events) = tokio::sync::broadcast::channel(8);

        run_deferred_event_worker(
            deferred_rx,
            RuntimeEventPublisher::new(None, Some(event_tx)),
            "pty-model-output-backlogged-shell".to_string(),
            "pty-model-disabled-backlogged-shell".to_string(),
            None,
            std::time::Duration::ZERO,
        );

        let published = std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<_>>();
        assert_eq!(
            published.len(),
            4,
            "an elapsed deadline must flush before another queued event is consumed"
        );
        let mut output = Vec::new();
        for (index, event) in published.iter().enumerate() {
            let sequence = (index + 1) as u64;
            assert_eq!(event.payload["start_sequence"], sequence);
            assert_eq!(event.payload["sequence"], sequence);
            output.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(
                        event.payload["data"]
                            .as_str()
                            .expect("output data should be base64 text"),
                    )
                    .expect("output data should decode"),
            );
        }
        assert_eq!(output, b"1234");
    }

    #[test]
    fn queued_burst_bounds_event_count_without_losing_output() {
        const CHUNK_COUNT: u64 = 512;
        const CHUNK_BYTES: usize = 256;

        let (deferred_tx, deferred_rx) = std::sync::mpsc::channel();
        let mut expected_output = Vec::with_capacity(CHUNK_COUNT as usize * CHUNK_BYTES);
        for sequence in 1..=CHUNK_COUNT {
            let bytes = vec![b'a' + ((sequence - 1) % 26) as u8; CHUNK_BYTES];
            expected_output.extend_from_slice(&bytes);
            deferred_tx
                .send(DeferredTerminalModelEvent::Output {
                    instance_id: 34,
                    sequence,
                    bytes,
                })
                .expect("test event should queue");
        }
        drop(deferred_tx);
        let (event_tx, mut events) = tokio::sync::broadcast::channel(4);

        run_deferred_event_worker(
            deferred_rx,
            RuntimeEventPublisher::new(None, Some(event_tx)),
            "pty-model-output-queued-burst-shell".to_string(),
            "pty-model-disabled-queued-burst-shell".to_string(),
            None,
            std::time::Duration::from_secs(60),
        );

        let published = std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<_>>();
        assert_eq!(
            published.len(),
            2,
            "512 model frames totaling 128 KiB should produce two transport events"
        );
        assert_eq!(published[0].payload["start_sequence"], 1);
        assert_eq!(published[0].payload["sequence"], 256);
        assert_eq!(published[1].payload["start_sequence"], 257);
        assert_eq!(published[1].payload["sequence"], CHUNK_COUNT);

        let actual_output = published
            .iter()
            .flat_map(|event| {
                base64::engine::general_purpose::STANDARD
                    .decode(
                        event.payload["data"]
                            .as_str()
                            .expect("output data should be base64 text"),
                    )
                    .expect("output data should decode")
            })
            .collect::<Vec<_>>();
        assert_eq!(actual_output, expected_output);
    }

    #[test]
    fn disabled_event_is_scoped_to_session_and_instance() {
        let (event_tx, mut events) = tokio::sync::broadcast::channel(4);
        let (bridge, _bytes) = bridge("disabled-shell", 41, Some(event_tx));
        let sink = bridge.into_event_sink();

        sink(TerminalModelEvent::Disabled { instance_id: 41 });

        let event = receive_event(&mut events);
        assert_eq!(event.event_name, "pty-model-disabled-disabled-shell");
        assert_eq!(event.payload, serde_json::json!({ "instance_id": 41 }));
    }

    #[test]
    fn protocol_reply_routes_through_matching_scoped_writer() {
        let (bridge, bytes) = bridge("reply-shell", 51, None);
        let sink = bridge.into_event_sink();

        sink(TerminalModelEvent::ProtocolReply {
            instance_id: 51,
            bytes: b"ghostty-reply".to_vec(),
        });

        assert_eq!(
            bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_slice(),
            b"ghostty-reply"
        );
    }

    #[test]
    fn protocol_reply_rejects_replaced_instance() {
        let (bridge, bytes) = bridge("reply-shell", 61, None);
        let sink = bridge.into_event_sink();

        sink(TerminalModelEvent::ProtocolReply {
            instance_id: 60,
            bytes: b"stale-reply".to_vec(),
        });

        assert!(
            bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_empty(),
            "a reply from a replaced PTY instance must not reach the current process"
        );
    }
}
