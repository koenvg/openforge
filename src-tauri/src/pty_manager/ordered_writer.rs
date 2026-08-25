use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

const WRITE_QUEUE_CAPACITY: usize = 64;

#[derive(Clone, Copy, Debug)]
pub(super) enum PtyWriteSource {
    UserInput,
    ModelReply,
}

impl std::fmt::Display for PtyWriteSource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UserInput => formatter.write_str("user input"),
            Self::ModelReply => formatter.write_str("terminal model reply"),
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

    pub(super) fn model_reply_writer(&self) -> TerminalModelReplyWriter {
        TerminalModelReplyWriter {
            shared: Arc::clone(&self.shared),
        }
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

#[derive(Clone)]
pub(super) struct TerminalModelReplyWriter {
    shared: Arc<OrderedPtyWriterShared>,
}

impl TerminalModelReplyWriter {
    pub(super) fn write(
        &self,
        session_key: &str,
        instance_id: u64,
        bytes: &[u8],
    ) -> Result<(), OrderedPtyWriteError> {
        self.shared
            .write(session_key, instance_id, PtyWriteSource::ModelReply, bytes)
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
    fn user_input_and_model_replies_are_serialized_as_distinct_writes() {
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
        let reply_writer = writer.model_reply_writer();
        let barrier = Arc::new(Barrier::new(3));

        let user_writer = Arc::clone(&writer);
        let user_barrier = Arc::clone(&barrier);
        let user = std::thread::spawn(move || {
            user_barrier.wait();
            user_writer
                .write_user_input("task-shell-0", 41, b"user")
                .expect("user input should write");
        });
        let reply_barrier = Arc::clone(&barrier);
        let reply = std::thread::spawn(move || {
            reply_barrier.wait();
            reply_writer
                .write("task-shell-0", 41, b"reply")
                .expect("model reply should write");
        });

        barrier.wait();
        user.join().expect("user writer should join");
        reply.join().expect("reply writer should join");
        let actual = bytes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        assert!(actual == b"userreply" || actual == b"replyuser");
    }

    #[test]
    fn stale_or_disposed_model_reply_writers_cannot_write_to_a_successor() {
        let old_bytes = Arc::new(Mutex::new(Vec::new()));
        let old_writer = OrderedPtyWriter::start(
            "shared-shell".to_string(),
            10,
            Box::new(RecordingWriter {
                bytes: Arc::clone(&old_bytes),
            }),
        )
        .expect("old ordered writer should start");
        let stale_reply_writer = old_writer.model_reply_writer();
        drop(old_writer);

        let successor_bytes = Arc::new(Mutex::new(Vec::new()));
        let successor_writer = OrderedPtyWriter::start(
            "shared-shell".to_string(),
            11,
            Box::new(RecordingWriter {
                bytes: Arc::clone(&successor_bytes),
            }),
        )
        .expect("successor ordered writer should start");
        let successor_reply_writer = successor_writer.model_reply_writer();

        assert!(stale_reply_writer
            .write("shared-shell", 10, b"stale")
            .is_err());
        assert!(stale_reply_writer
            .write("shared-shell", 11, b"wrong-instance")
            .is_err());
        successor_reply_writer
            .write("shared-shell", 11, b"current")
            .expect("current reply should write");

        assert!(old_bytes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
        assert_eq!(
            successor_bytes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_slice(),
            b"current"
        );
    }
}
