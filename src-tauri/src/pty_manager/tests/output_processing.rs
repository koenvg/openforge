use super::*;

#[test]
fn test_ring_buffer_push_within_capacity() {
    let mut buf = RingBuffer::new(100);
    buf.push(b"hello");
    buf.push(b" world");
    assert_eq!(buf.snapshot(), "hello world");
}

#[test]
fn test_ring_buffer_push_exceeds_capacity() {
    let mut buf = RingBuffer::new(5);
    buf.push(b"hello");
    buf.push(b"world");
    let result = buf.snapshot();
    assert_eq!(result.len(), 5);
    assert_eq!(result, "world");
}

#[test]
fn test_find_utf8_boundary_complete() {
    let data = b"Hello, world!";
    assert_eq!(find_utf8_boundary(data), data.len());
}

#[test]
fn test_find_utf8_boundary_incomplete() {
    // UTF-8 sequence for "é" is [0xC3, 0xA9]
    // If we only have the first byte, it should be detected as incomplete
    let data = b"Hello\xC3";
    assert_eq!(find_utf8_boundary(data), 5); // Should stop before 0xC3

    // Complete sequence should be valid
    let data = b"Hello\xC3\xA9";
    assert_eq!(find_utf8_boundary(data), data.len());
}

#[test]
fn test_find_utf8_boundary_three_byte() {
    // UTF-8 sequence for "€" is [0xE2, 0x82, 0xAC]
    let data = b"Price\xE2\x82"; // Incomplete 3-byte sequence
    assert_eq!(find_utf8_boundary(data), 5);

    let data = b"Price\xE2\x82\xAC"; // Complete
    assert_eq!(find_utf8_boundary(data), data.len());
}

struct ChunkedReader {
    chunks: std::collections::VecDeque<Vec<u8>>,
}

impl ChunkedReader {
    fn new(chunks: Vec<&[u8]>) -> Self {
        Self {
            chunks: chunks.into_iter().map(|chunk| chunk.to_vec()).collect(),
        }
    }
}

impl Read for ChunkedReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let Some(chunk) = self.chunks.pop_front() else {
            return Ok(0);
        };
        let len = chunk.len().min(buf.len());
        buf[..len].copy_from_slice(&chunk[..len]);
        Ok(len)
    }
}

struct RepeatingReader {
    remaining_reads: usize,
    byte: u8,
}

impl Read for RepeatingReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.remaining_reads == 0 {
            return Ok(0);
        }

        buf.fill(self.byte);
        self.remaining_reads -= 1;
        Ok(buf.len())
    }
}

fn spawn_repeating_reader(
    read_count: usize,
    byte: u8,
    session_key: &'static str,
) -> (
    PtyOutputReceiver,
    Arc<AtomicBool>,
    std::thread::JoinHandle<()>,
) {
    let (tx, rx) = pty_output_channel();
    let reader_finished = Arc::new(AtomicBool::new(false));
    let finished = Arc::clone(&reader_finished);
    let reader_thread = std::thread::spawn(move || {
        let mut reader = RepeatingReader {
            remaining_reads: read_count,
            byte,
        };
        read_pty_output_loop(&mut reader, tx, session_key, None, None, None);
        finished.store(true, Ordering::Release);
    });

    (rx, reader_finished, reader_thread)
}

fn assert_reader_is_backpressured(
    rx: &PtyOutputReceiver,
    reader_finished: &AtomicBool,
    message: &str,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while rx.len() < PTY_OUTPUT_QUEUE_CAPACITY && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }

    assert_eq!(rx.len(), PTY_OUTPUT_QUEUE_CAPACITY);
    assert!(!reader_finished.load(Ordering::Acquire), "{message}");
}

#[test]
fn test_pty_output_queue_bounds_sustained_output_and_preserves_exit() {
    const READ_COUNT: usize = 4_096;

    let (mut rx, reader_finished, reader_thread) =
        spawn_repeating_reader(READ_COUNT, b'x', "stress-reader");
    assert_reader_is_backpressured(
        &rx,
        &reader_finished,
        "the reader should backpressure instead of buffering all sustained output",
    );

    let mut received_reads = 0;
    let mut received_bytes = 0;
    let mut max_queue_len = rx.len();
    loop {
        max_queue_len = max_queue_len.max(rx.len());
        match rx
            .blocking_recv()
            .expect("reader should deliver an exit signal")
        {
            Some(output) => {
                assert!(output.bytes().all(|byte| byte == b'x'));
                received_reads += 1;
                received_bytes += output.len();
            }
            None => break,
        }
    }
    reader_thread.join().expect("reader thread should finish");

    assert!(max_queue_len <= PTY_OUTPUT_QUEUE_CAPACITY);
    assert_eq!(received_reads, READ_COUNT);
    assert_eq!(received_bytes, READ_COUNT * PTY_READ_BUFFER_SIZE);
    assert!(reader_finished.load(Ordering::Acquire));
}

#[test]
fn test_pty_output_queue_bounds_sustained_malformed_utf8() {
    const READ_COUNT: usize = 1_024;

    let (mut rx, reader_finished, reader_thread) =
        spawn_repeating_reader(READ_COUNT, 0xff, "malformed-stress-reader");
    assert_reader_is_backpressured(
        &rx,
        &reader_finished,
        "malformed output should remain bounded by the same backpressure",
    );

    let mut received_reads = 0;
    while let Some(message) = rx.blocking_recv() {
        let Some(output) = message else {
            break;
        };
        assert_eq!(output.len(), PTY_READ_BUFFER_SIZE * 3);
        assert!(output.chars().all(|character| character == '\u{fffd}'));
        received_reads += 1;
    }
    reader_thread.join().expect("reader thread should finish");

    assert_eq!(received_reads, READ_COUNT);
}
#[test]
fn test_read_pty_output_loop_preserves_utf8_split_across_reads() {
    let mut reader = ChunkedReader::new(vec![b"hello \xC3", b"\xA9 world"]);
    let (tx, mut rx) = pty_output_channel();

    read_pty_output_loop(&mut reader, tx, "task-reader", None, None, None);

    assert_eq!(rx.blocking_recv(), Some(Some("hello ".to_string())));
    assert_eq!(rx.blocking_recv(), Some(Some("é world".to_string())));
    assert_eq!(rx.blocking_recv(), Some(None));
}

#[test]
fn test_read_pty_output_loop_flushes_incomplete_utf8_before_exit() {
    let mut reader = ChunkedReader::new(vec![b"hello \xC3"]);
    let (tx, mut rx) = pty_output_channel();

    read_pty_output_loop(&mut reader, tx, "task-reader", None, None, None);

    assert_eq!(rx.blocking_recv(), Some(Some("hello ".to_string())));
    assert_eq!(
        rx.blocking_recv(),
        Some(Some(char::REPLACEMENT_CHARACTER.to_string())),
    );
    assert_eq!(rx.blocking_recv(), Some(None));
}

#[test]
fn test_read_pty_output_loop_rejects_malformed_utf8_only_for_companion() {
    let hub = Arc::new(PtyAttachmentHub::new(1, 1024, 8));
    let (_, mut companion_events) = hub.attach();
    let mut reader = ChunkedReader::new(vec![b"desktop", &[0xff], b"tail"]);
    let (tx, mut rx) = pty_output_channel();

    read_pty_output_loop(
        &mut reader,
        tx,
        "task-reader",
        None,
        Some(Arc::clone(&hub)),
        None,
    );

    assert_eq!(rx.blocking_recv(), Some(Some("desktop".to_string())));
    assert_eq!(
        companion_events.blocking_recv().expect("safe output"),
        AgentTerminalEvent::Output(b"desktop".to_vec())
    );
    assert_eq!(
        companion_events.blocking_recv().expect("protocol failure"),
        AgentTerminalEvent::ProtocolError
    );
    assert!(companion_events.try_recv().is_err());
    assert_eq!(
        rx.blocking_recv(),
        Some(Some(char::REPLACEMENT_CHARACTER.to_string())),
        "desktop output should replace malformed UTF-8 without retaining it",
    );
    assert_eq!(rx.blocking_recv(), Some(Some("tail".to_string())));
    assert_eq!(rx.blocking_recv(), Some(None));
}

#[test]
fn test_read_pty_output_loop_updates_last_output_time() {
    let mut reader = ChunkedReader::new(vec![b"output"]);
    let (tx, mut rx) = pty_output_channel();
    let last_output = Arc::new(AtomicU64::new(0));

    read_pty_output_loop(
        &mut reader,
        tx,
        "task-reader",
        Some(Arc::clone(&last_output)),
        None,
        None,
    );

    assert_eq!(rx.blocking_recv(), Some(Some("output".to_string())));
    assert!(last_output.load(Ordering::Relaxed) > 0);
}

#[test]
fn test_pty_output_batcher_flushes_at_threshold_to_event_and_ring_buffer() {
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    let mut batcher = PtyOutputBatcher::new("task-batch".to_string(), 42, Arc::clone(&ring), 5);
    let mut emitted = Vec::new();

    batcher.push_output("he", &mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    });
    assert!(
        emitted.is_empty(),
        "partial batch should not emit before threshold"
    );

    batcher.push_output("llo", &mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    });

    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].0, "pty-output-task-batch");
    assert_eq!(emitted[0].1["shell_session_key"], "task-batch");
    assert_eq!(emitted[0].1["data"], "hello");
    assert_eq!(emitted[0].1["instance_id"], 42);
    assert_eq!(ring.lock().unwrap().snapshot(), "hello");
}

#[test]
fn pty_output_batcher_recovers_poisoned_ring_buffer_before_writing() {
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    let mut batcher = PtyOutputBatcher::new("task-poisoned".to_string(), 43, Arc::clone(&ring), 64);
    let mut emitted = Vec::new();

    batcher.push_output("retained output", &mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    });

    let poisoned_ring = Arc::clone(&ring);
    assert!(
        std::thread::spawn(move || {
            let _guard = poisoned_ring
                .lock()
                .expect("buffer lock should start healthy");
            panic!("poison buffer lock");
        })
        .join()
        .is_err(),
        "poisoning thread should panic"
    );

    assert!(batcher.flush_pending(&mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    }));

    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].1["data"], "retained output");
    assert_eq!(
        ring.lock()
            .expect("write recovery should clear the poison state")
            .snapshot(),
        "retained output"
    );
}

#[test]
fn test_pty_output_batcher_flush_pending_returns_false_for_empty_buffer() {
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    let mut batcher = PtyOutputBatcher::new("task-empty".to_string(), 7, ring, 10);
    let mut emitted = Vec::new();

    assert!(!batcher.flush_pending(&mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    }));
    assert!(emitted.is_empty());

    batcher.push_output("data", &mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    });
    assert!(emitted.is_empty());
    assert!(batcher.flush_pending(&mut |event_name, payload| {
        emitted.push((event_name.to_string(), payload.clone()));
        Ok(())
    }));
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].1["data"], "data");
}

#[test]
fn test_ring_buffer_snapshot_does_not_clear() {
    let mut buf = RingBuffer::new(100);
    buf.push(b"hello world");
    let snap1 = buf.snapshot();
    assert_eq!(snap1, "hello world");
    let snap2 = buf.snapshot();
    assert_eq!(snap2, "hello world", "snapshot must not clear buffer");
}

#[test]
fn test_ring_buffer_snapshot_with_overflow() {
    let mut buf = RingBuffer::new(10);
    buf.push(b"abcdefghijklmno"); // 15 bytes, capacity 10
    let snap = buf.snapshot();
    assert_eq!(snap, "fghijklmno");
    assert_eq!(snap.len(), 10);
    // Original buffer still intact
    let snap2 = buf.snapshot();
    assert_eq!(snap2, "fghijklmno");
}

#[tokio::test]
async fn test_spawn_pty_populates_output_buffer() {
    let manager = PtyManager::new();

    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(
        CLAUDE_BUFFER_CAPACITY,
    )));
    {
        let mut buf = ring.lock().unwrap();
        buf.push(b"opencode output data");
    }
    {
        let mut buffers = manager.output_buffers.lock().await;
        buffers.insert("opencode-task-123".to_string(), Arc::clone(&ring));
    }

    let result = manager.get_pty_buffer("opencode-task-123").await;
    assert_eq!(result, Some("opencode output data".to_string()));

    let result2 = manager.get_pty_buffer("opencode-task-123").await;
    assert_eq!(
        result2,
        Some("opencode output data".to_string()),
        "buffer must be replayable on re-attach"
    );
}

#[tokio::test]
async fn get_pty_buffer_recovers_content_from_a_poisoned_lock() {
    let manager = PtyManager::new();
    let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(
        CLAUDE_BUFFER_CAPACITY,
    )));
    ring.lock()
        .expect("buffer lock should start healthy")
        .push(b"recoverable output");

    manager
        .output_buffers
        .lock()
        .await
        .insert("poisoned-buffer".to_string(), Arc::clone(&ring));

    let poisoned_ring = Arc::clone(&ring);
    assert!(
        std::thread::spawn(move || {
            let _guard = poisoned_ring
                .lock()
                .expect("buffer lock should start healthy");
            panic!("poison buffer lock");
        })
        .join()
        .is_err(),
        "poisoning thread should panic"
    );

    assert_eq!(
        manager.get_pty_buffer("poisoned-buffer").await.as_deref(),
        Some("recoverable output")
    );

    ring.lock()
        .expect("recovery should clear the poison state")
        .push(b" after recovery");
    assert_eq!(
        manager.get_pty_buffer("poisoned-buffer").await.as_deref(),
        Some("recoverable output after recovery")
    );
}

#[test]
fn shadow_mode_observes_raw_bytes_without_changing_desktop_output() {
    let (shadow, feeder) = crate::terminal_model::TerminalModelSession::start(
        "task-reader".to_string(),
        42,
        crate::terminal_model::TerminalModelOptions::new(20, 4),
    )
    .expect("shadow terminal should start");
    let mut reader = ChunkedReader::new(vec![b"before \xF0\x9F", b"\x98\x80\r\n\x1b[6n"]);
    let (tx, mut rx) = pty_output_channel();

    read_pty_output_loop(&mut reader, tx, "task-reader", None, None, Some(feeder));

    let mut desktop_output = String::new();
    while let Some(message) = rx.blocking_recv() {
        let Some(output) = message else {
            break;
        };
        desktop_output.push_str(&output);
    }
    assert_eq!(
        desktop_output.as_bytes(),
        b"before \xF0\x9F\x98\x80\r\n\x1b[6n"
    );

    let snapshot = shadow.snapshot().expect("shadow snapshot should encode");
    let portable = shadow.portable_vt().expect("shadow VT should format");
    assert!(snapshot.starts_with(b"GHOSTSNP"));
    assert!(portable
        .windows(b"before".len())
        .any(|part| part == b"before"));
    assert_eq!(shadow.take_protocol_replies().len(), 1);
}

#[test]
fn shadow_creation_failure_does_not_change_desktop_output() {
    let (shadow, feeder) = crate::terminal_model::TerminalModelSession::start(
        "failed-shadow".to_string(),
        7,
        crate::terminal_model::TerminalModelOptions::new(0, 0),
    )
    .expect("shadow worker thread should start");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    while shadow.diagnostics().is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert_eq!(shadow.diagnostics()[0].phase, "create");

    let mut reader = ChunkedReader::new(vec![b"renderer-output"]);
    let (tx, mut rx) = pty_output_channel();
    read_pty_output_loop(&mut reader, tx, "failed-shadow", None, None, Some(feeder));

    assert_eq!(
        rx.blocking_recv(),
        Some(Some("renderer-output".to_string()))
    );
    assert_eq!(rx.blocking_recv(), Some(None));
    assert!(shadow.snapshot().is_err());
}

fn measure_sustained_output(
    terminal_model_feeder: Option<crate::terminal_model::TerminalModelFeeder>,
) -> (std::time::Duration, usize) {
    const READ_COUNT: usize = 64;
    let mut reader = RepeatingReader {
        remaining_reads: READ_COUNT,
        byte: b'x',
    };
    let (tx, mut rx) = pty_output_channel();
    let consumer = std::thread::spawn(move || {
        let mut bytes = 0usize;
        while let Some(Some(output)) = rx.blocking_recv() {
            bytes += output.len();
        }
        bytes
    });
    let started = std::time::Instant::now();
    read_pty_output_loop(
        &mut reader,
        tx,
        "throughput-guard",
        None,
        None,
        terminal_model_feeder,
    );
    let elapsed = started.elapsed();
    let bytes = consumer.join().expect("output consumer should finish");
    (elapsed, bytes)
}

#[test]
fn shadow_mode_sustained_output_stays_bounded_and_responsive() {
    let (baseline_elapsed, baseline_bytes) = measure_sustained_output(None);
    let (shadow, feeder) = crate::terminal_model::TerminalModelSession::start(
        "throughput-guard".to_string(),
        99,
        crate::terminal_model::TerminalModelOptions::new(80, 24),
    )
    .expect("shadow worker should start");
    let (shadow_elapsed, shadow_bytes) = measure_sustained_output(Some(feeder));

    assert_eq!(baseline_bytes, 64 * PTY_READ_BUFFER_SIZE);
    assert_eq!(shadow_bytes, baseline_bytes);
    assert_eq!(
        crate::terminal_model::TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY,
        512 * 1024,
    );
    let allowed = baseline_elapsed
        .saturating_mul(10)
        .saturating_add(std::time::Duration::from_millis(250));
    assert!(
        shadow_elapsed <= allowed,
        "shadow output path took {shadow_elapsed:?}; baseline was {baseline_elapsed:?}, gate was {allowed:?}",
    );
    let diagnostics = shadow.diagnostics();
    assert!(
        diagnostics.is_empty(),
        "shadow diagnostics: {diagnostics:?}"
    );
}
