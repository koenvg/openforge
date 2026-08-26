use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

const WRITE_QUEUE_CAPACITY: usize = 64;

#[derive(Clone, Copy, Debug)]
pub(super) enum PtyWriteSource {
    UserInput,
    XtermQueryResponse,
    GhosttyQueryResponse,
}

impl std::fmt::Display for PtyWriteSource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UserInput => formatter.write_str("user input"),
            Self::XtermQueryResponse => formatter.write_str("xterm query response"),
            Self::GhosttyQueryResponse => formatter.write_str("Ghostty query response"),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub(super) enum OrderedPtyWriteError {
    #[error("pty writer is disposed")]
    Disposed,
    #[error("pty writer scope does not match key {session_key} instance {instance_id}")]
    ScopeMismatch {
        session_key: String,
        instance_id: u64,
    },
    #[error("{write_source} write failed: {message}")]
    WriteFailed {
        write_source: PtyWriteSource,
        message: String,
    },
}

struct WriteRequest {
    session_key: String,
    instance_id: u64,
    source: PtyWriteSource,
    bytes: Vec<u8>,
    completion: mpsc::SyncSender<Result<(), OrderedPtyWriteError>>,
}

enum WriterCommand {
    Write(WriteRequest),
    Shutdown,
}

struct OrderedPtyWriterShared {
    session_key: Arc<str>,
    instance_id: u64,
    accepting: AtomicBool,
    tx: mpsc::SyncSender<WriterCommand>,
}

impl OrderedPtyWriterShared {
    fn write(
        &self,
        session_key: &str,
        instance_id: u64,
        source: PtyWriteSource,
        bytes: &[u8],
    ) -> Result<(), OrderedPtyWriteError> {
        if session_key != self.session_key.as_ref() || instance_id != self.instance_id {
            return Err(OrderedPtyWriteError::ScopeMismatch {
                session_key: session_key.to_string(),
                instance_id,
            });
        }
        if !self.accepting.load(Ordering::Acquire) {
            return Err(OrderedPtyWriteError::Disposed);
        }

        let (completion, result) = mpsc::sync_channel(1);
        self.tx
            .send(WriterCommand::Write(WriteRequest {
                session_key: session_key.to_string(),
                instance_id,
                source,
                bytes: bytes.to_vec(),
                completion,
            }))
            .map_err(|_| OrderedPtyWriteError::Disposed)?;
        result.recv().unwrap_or(Err(OrderedPtyWriteError::Disposed))
    }
}

pub(super) struct OrderedPtyWriter {
    shared: Arc<OrderedPtyWriterShared>,
    worker: Option<JoinHandle<()>>,
}

impl OrderedPtyWriter {
    pub(super) fn start(
        session_key: String,
        instance_id: u64,
        mut writer: Box<dyn Write + Send>,
    ) -> io::Result<Self> {
        let (tx, rx) = mpsc::sync_channel(WRITE_QUEUE_CAPACITY);
        let shared = Arc::new(OrderedPtyWriterShared {
            session_key: Arc::from(session_key),
            instance_id,
            accepting: AtomicBool::new(true),
            tx,
        });
        let worker_state = Arc::clone(&shared);
        let worker = std::thread::Builder::new()
            .name(format!("pty-writer-{instance_id}"))
            .spawn(move || {
                while let Ok(command) = rx.recv() {
                    let WriterCommand::Write(request) = command else {
                        break;
                    };
                    let result = if !worker_state.accepting.load(Ordering::Acquire)
                        || request.session_key != worker_state.session_key.as_ref()
                        || request.instance_id != worker_state.instance_id
                    {
                        Err(OrderedPtyWriteError::Disposed)
                    } else {
                        writer
                            .write_all(&request.bytes)
                            .and_then(|()| writer.flush())
                            .map_err(|error| OrderedPtyWriteError::WriteFailed {
                                write_source: request.source,
                                message: error.to_string(),
                            })
                    };
                    let _ = request.completion.send(result);
                }
            })?;
        Ok(Self {
            shared,
            worker: Some(worker),
        })
    }

    pub(super) fn write_user_input(
        &self,
        session_key: &str,
        instance_id: u64,
        bytes: &[u8],
    ) -> Result<(), OrderedPtyWriteError> {
        self.shared
            .write(session_key, instance_id, PtyWriteSource::UserInput, bytes)
    }

    pub(super) fn write_xterm_query_response(
        &self,
        session_key: &str,
        instance_id: u64,
        bytes: &[u8],
    ) -> Result<(), OrderedPtyWriteError> {
        self.shared.write(
            session_key,
            instance_id,
            PtyWriteSource::XtermQueryResponse,
            bytes,
        )
    }

    pub(super) fn write_ghostty_query_response(
        &self,
        session_key: &str,
        instance_id: u64,
        bytes: &[u8],
    ) -> Result<(), OrderedPtyWriteError> {
        self.shared.write(
            session_key,
            instance_id,
            PtyWriteSource::GhosttyQueryResponse,
            bytes,
        )
    }
}

impl Drop for OrderedPtyWriter {
    fn drop(&mut self) {
        self.shared.accepting.store(false, Ordering::Release);
        let _ = self.shared.tx.send(WriterCommand::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Write};
    use std::sync::{Arc, Barrier, Mutex};

    struct RecordingWriter {
        bytes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for RecordingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let Some(byte) = buffer.first() else {
                return Ok(0);
            };
            self.bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(*byte);
            std::thread::yield_now();
            Ok(1)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn user_input_and_xterm_query_responses_are_serialized_as_distinct_writes() {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let writer = Arc::new(
            OrderedPtyWriter::start(
                "task-shell-0".to_string(),
                41,
                Box::new(RecordingWriter {
                    bytes: Arc::clone(&bytes),
                }),
            )
            .expect("ordered writer should start"),
        );
        let barrier = Arc::new(Barrier::new(3));

        let user_writer = Arc::clone(&writer);
        let user_barrier = Arc::clone(&barrier);
        let user = std::thread::spawn(move || {
            user_barrier.wait();
            user_writer
                .write_user_input("task-shell-0", 41, b"user")
                .expect("user input should write");
        });
        let response_writer = Arc::clone(&writer);
        let response_barrier = Arc::clone(&barrier);
        let response = std::thread::spawn(move || {
            response_barrier.wait();
            response_writer
                .write_xterm_query_response("task-shell-0", 41, b"response")
                .expect("xterm query response should write");
        });

        barrier.wait();
        user.join().expect("user writer should join");
        response.join().expect("response writer should join");
        let actual = bytes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        assert!(actual == b"userresponse" || actual == b"responseuser");
    }

    #[test]
    fn stale_xterm_query_response_cannot_write_to_a_successor_instance() {
        let successor_bytes = Arc::new(Mutex::new(Vec::new()));
        let successor_writer = OrderedPtyWriter::start(
            "shared-shell".to_string(),
            11,
            Box::new(RecordingWriter {
                bytes: Arc::clone(&successor_bytes),
            }),
        )
        .expect("successor ordered writer should start");

        assert!(successor_writer
            .write_xterm_query_response("shared-shell", 10, b"stale")
            .is_err());
        successor_writer
            .write_xterm_query_response("shared-shell", 11, b"current")
            .expect("current query response should write");

        assert_eq!(
            successor_bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_slice(),
            b"current"
        );
    }
}
