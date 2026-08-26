use super::*;

use std::io::{self, Write};
use std::sync::{Arc, Mutex};

#[test]
fn missing_root_pid_runs_emergency_child_cleanup() {
    let cleanup_called = std::cell::Cell::new(false);

    let result = require_root_pid_or_cleanup(None, "Shell PTY for task T-1", || {
        cleanup_called.set(true);
        Ok(())
    });

    assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
    assert!(
        cleanup_called.get(),
        "a spawned child without a PID must still receive emergency cleanup"
    );
}

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

#[test]
fn terminal_model_bridge_routes_ghostty_reply_through_scoped_writer() {
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let writer = Arc::new(
        OrderedPtyWriter::start(
            "reply-shell".to_string(),
            31,
            Box::new(RecordingWriter {
                bytes: Arc::clone(&bytes),
            }),
        )
        .expect("ordered writer should start"),
    );
    let sink = terminal_model_event_sink("reply-shell", None, None, writer);

    sink(TerminalModelEvent::ProtocolReply {
        instance_id: 31,
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
