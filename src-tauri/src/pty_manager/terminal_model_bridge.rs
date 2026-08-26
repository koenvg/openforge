//! Bridges Ghostty terminal-model events to OpenForge runtime transports.

use crate::app_events::RuntimeEventPublisher;
use crate::terminal_model::{TerminalModelEvent, TerminalModelEventSink};
use base64::Engine;
use log::warn;
use std::sync::Arc;

use super::ordered_writer::OrderedPtyWriter;

pub(super) struct TerminalModelEventBridge {
    session_key: String,
    event_publisher: RuntimeEventPublisher,
    writer: Arc<OrderedPtyWriter>,
}

impl TerminalModelEventBridge {
    pub(super) fn new(
        session_key: String,
        event_publisher: RuntimeEventPublisher,
        writer: Arc<OrderedPtyWriter>,
    ) -> Self {
        Self {
            session_key,
            event_publisher,
            writer,
        }
    }

    pub(super) fn into_event_sink(self) -> TerminalModelEventSink {
        let output_event_name = format!("pty-model-output-{}", self.session_key);
        let disabled_event_name = format!("pty-model-disabled-{}", self.session_key);
        Arc::new(move |event| match event {
            TerminalModelEvent::Output(frame) => self.event_publisher.publish(
                &output_event_name,
                &serde_json::json!({
                    "instance_id": frame.instance_id,
                    "sequence": frame.sequence,
                    "data": base64::engine::general_purpose::STANDARD.encode(frame.bytes),
                }),
            ),
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
            TerminalModelEvent::Disabled { instance_id } => self.event_publisher.publish(
                &disabled_event_name,
                &serde_json::json!({ "instance_id": instance_id }),
            ),
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
            ),
            bytes,
        )
    }

    #[test]
    fn output_event_publishes_base64_transport_frame() {
        let (event_tx, mut events) = tokio::sync::broadcast::channel(4);
        let (bridge, _bytes) = bridge("model-shell", 31, Some(event_tx));
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            "model-shell".to_string(),
            31,
            TerminalModelOptions::new(80, 24),
            bridge.into_event_sink(),
        )
        .expect("terminal model should start");

        feeder.feed(b"model output");
        session
            .portable_snapshot()
            .expect("snapshot should synchronize model output");

        let event = events.try_recv().expect("model output should be published");
        assert_eq!(event.event_name, "pty-model-output-model-shell");
        assert_eq!(event.payload["instance_id"], 31);
        assert_eq!(event.payload["sequence"], 1);
        assert_eq!(event.payload["data"], "bW9kZWwgb3V0cHV0");
    }

    #[test]
    fn disabled_event_is_scoped_to_session_and_instance() {
        let (event_tx, mut events) = tokio::sync::broadcast::channel(4);
        let (bridge, _bytes) = bridge("disabled-shell", 41, Some(event_tx));
        let sink = bridge.into_event_sink();

        sink(TerminalModelEvent::Disabled { instance_id: 41 });

        let event = events
            .try_recv()
            .expect("model disabled event should be published");
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
