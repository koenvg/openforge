mod event_state;
mod worker_session;

pub(crate) use event_state::{TerminalModelEvent, TerminalModelEventSink};
pub(crate) use worker_session::{ShadowMode, TerminalModelFeeder, TerminalModelSession};
#[cfg(test)]
pub(crate) use worker_session::{
    TERMINAL_MODEL_BUFFERED_BYTES_CAPACITY, TERMINAL_MODEL_QUEUE_SATURATION_TEST_BYTES,
};

#[cfg(test)]
use super::TerminalModelOptions;
#[cfg(test)]
use event_state::TerminalModelOutputFrame;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::{mpsc, Arc, Mutex};
#[cfg(test)]
use std::time::Duration;
#[cfg(test)]
use worker_session::{
    COMMAND_QUEUE_CAPACITY, COMMAND_SUBMISSION_TIMEOUT, QUEUE_CATCH_UP_TIMEOUT, REQUEST_TIMEOUT,
};

#[cfg(test)]
mod tests {
    use super::*;

    struct DropSignal(mpsc::SyncSender<()>);

    impl Drop for DropSignal {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }

    struct FirstOutputBlockingSink {
        sink: Option<TerminalModelEventSink>,
        entered_rx: mpsc::Receiver<()>,
        release_tx: mpsc::SyncSender<()>,
    }

    impl FirstOutputBlockingSink {
        fn new() -> Self {
            Self::with_event_observer(|_| {})
        }

        fn with_event_observer(
            observer: impl Fn(&TerminalModelEvent) + Send + Sync + 'static,
        ) -> Self {
            let first_output = AtomicBool::new(true);
            let (entered_tx, entered_rx) = mpsc::sync_channel(1);
            let (release_tx, release_rx) = mpsc::sync_channel(1);
            let release_rx = Mutex::new(release_rx);
            let callback_lock = Mutex::new(());
            let sink = Arc::new(move |event| {
                let _callback_guard = callback_lock
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                observer(&event);
                if matches!(event, TerminalModelEvent::Output(_))
                    && first_output.swap(false, Ordering::AcqRel)
                {
                    let _ = entered_tx.send(());
                    let _ = release_rx
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .recv();
                }
            });

            Self {
                sink: Some(sink),
                entered_rx,
                release_tx,
            }
        }

        fn take_sink(&mut self) -> TerminalModelEventSink {
            self.sink
                .take()
                .expect("event sink should only be installed once")
        }

        fn wait_until_entered(&self) {
            self.entered_rx
                .recv_timeout(REQUEST_TIMEOUT)
                .expect("event sink should block the model worker");
        }

        fn release(&self) {
            self.release_tx
                .send(())
                .expect("test should release the model worker");
        }
    }

    type TestRequest = fn(&TerminalModelSession) -> Result<Vec<u8>, String>;

    fn start_worker_with_saturated_queue(
        session_key: &str,
        instance_id: u64,
    ) -> (Arc<TerminalModelSession>, FirstOutputBlockingSink) {
        let mut blocked_sink = FirstOutputBlockingSink::new();
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            session_key.to_string(),
            instance_id,
            TerminalModelOptions::new(80, 24),
            blocked_sink.take_sink(),
        )
        .expect("terminal model worker should start");

        feeder.feed(b"first");
        blocked_sink.wait_until_entered();
        for _ in 0..COMMAND_QUEUE_CAPACITY {
            feeder.feed(b"queued");
        }

        (Arc::new(session), blocked_sink)
    }

    #[test]
    fn worker_preserves_raw_chunk_order_and_captures_replies() {
        let (session, feeder) = TerminalModelSession::start(
            "task-shell-0".to_string(),
            42,
            TerminalModelOptions::new(20, 4),
        )
        .expect("terminal model worker should start");

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
    fn authoritative_worker_publishes_ghostty_protocol_replies() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&captured);
        let sink: TerminalModelEventSink = Arc::new(move |event| {
            captured_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            "reply-shell".to_string(),
            91,
            TerminalModelOptions::new(80, 24),
            sink,
        )
        .expect("terminal model worker should start");

        feeder.feed(b"\x1b[6n");
        session
            .portable_snapshot()
            .expect("snapshot request should cross the worker barrier");

        let events = captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(events.iter().any(|event| matches!(
            event,
            TerminalModelEvent::ProtocolReply { instance_id: 91, bytes }
                if bytes.starts_with(b"\x1b[") && bytes.ends_with(b"R")
        )));
    }

    #[test]
    fn authoritative_feeder_applies_backpressure_instead_of_disabling_on_output_bursts() {
        let mut blocked_sink = FirstOutputBlockingSink::new();
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            "burst-shell".to_string(),
            92,
            TerminalModelOptions::new(80, 24),
            blocked_sink.take_sink(),
        )
        .expect("terminal model worker should start");

        feeder.feed(b"first");
        blocked_sink.wait_until_entered();
        for _ in 0..COMMAND_QUEUE_CAPACITY {
            feeder.feed(b"queued");
        }
        let tail_feeder = feeder.clone();
        let (tail_started_tx, tail_started_rx) = mpsc::sync_channel(1);
        let (tail_complete_tx, tail_complete_rx) = mpsc::sync_channel(1);
        let tail_feed = std::thread::spawn(move || {
            let _ = tail_started_tx.send(());
            tail_feeder.feed(b"tail");
            let _ = tail_complete_tx.send(());
        });
        tail_started_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .expect("tail feeder should start");

        let completed_while_model_was_blocked = tail_complete_rx
            .recv_timeout(QUEUE_CATCH_UP_TIMEOUT + Duration::from_millis(50))
            .is_ok();
        blocked_sink.release();
        if !completed_while_model_was_blocked {
            tail_complete_rx
                .recv_timeout(REQUEST_TIMEOUT)
                .expect("tail feed should finish after the model catches up");
        }
        tail_feed.join().expect("tail feeder should not panic");

        assert!(!completed_while_model_was_blocked);
        session
            .portable_snapshot()
            .expect("authoritative model should remain available after the burst");
    }

    #[test]
    fn dropping_a_session_is_bounded_when_the_worker_and_command_queue_are_blocked() {
        let (worker_disconnected_tx, worker_disconnected_rx) = mpsc::sync_channel(1);
        let (worker_dropped_tx, worker_dropped_rx) = mpsc::sync_channel(1);
        let worker_drop_signal = DropSignal(worker_dropped_tx);
        let mut blocked_sink = FirstOutputBlockingSink::with_event_observer(move |event| {
            let _worker_drop_signal = &worker_drop_signal;
            if matches!(event, TerminalModelEvent::Disabled { .. }) {
                let _ = worker_disconnected_tx.send(());
            }
        });
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
            "blocked-drop-shell".to_string(),
            93,
            TerminalModelOptions::new(80, 24),
            blocked_sink.take_sink(),
        )
        .expect("terminal model worker should start");

        feeder.feed(b"first");
        blocked_sink.wait_until_entered();
        for _ in 0..COMMAND_QUEUE_CAPACITY {
            feeder.feed(b"queued");
        }

        let (drop_complete_tx, drop_complete_rx) = mpsc::sync_channel(1);
        let drop_thread = std::thread::spawn(move || {
            drop(session);
            let _ = drop_complete_tx.send(());
        });
        let drop_completed_within_deadline = drop_complete_rx
            .recv_timeout(Duration::from_millis(250))
            .is_ok();

        blocked_sink.release();
        drop_thread
            .join()
            .expect("session drop thread should not panic");

        assert!(
            drop_completed_within_deadline,
            "session drop must not wait indefinitely for a full queue or blocked event sink"
        );

        let feeder_probe = std::thread::spawn(move || feeder.feed(b"after-drop"));
        feeder_probe.join().expect("feeder probe should not panic");
        worker_disconnected_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .expect("worker should disconnect retained feeders after shutdown");
        worker_dropped_rx
            .recv_timeout(REQUEST_TIMEOUT)
            .expect("released worker should finish orderly cleanup");
    }

    #[test]
    fn resize_submission_is_bounded_when_authoritative_queue_is_saturated() {
        let (session, blocked_sink) = start_worker_with_saturated_queue("resize-shell", 94);
        let resize_session = Arc::clone(&session);
        let (resize_complete_tx, resize_complete_rx) = mpsc::sync_channel(1);
        let resize_thread = std::thread::spawn(move || {
            resize_session.resize(120, 40);
            let _ = resize_complete_tx.send(());
        });

        let completed_within_deadline = resize_complete_rx
            .recv_timeout(COMMAND_SUBMISSION_TIMEOUT + Duration::from_millis(200))
            .is_ok();
        blocked_sink.release();
        resize_thread
            .join()
            .expect("resize thread should not panic");

        assert!(
            completed_within_deadline,
            "resize must not wait indefinitely for a saturated authoritative queue"
        );
        assert!(session.diagnostics().iter().any(|diagnostic| {
            diagnostic.phase == "resize" && diagnostic.message.contains("timed out")
        }));
    }

    #[test]
    fn portable_snapshot_submission_times_out_when_authoritative_queue_is_saturated() {
        let (session, blocked_sink) =
            start_worker_with_saturated_queue("portable-snapshot-shell", 95);
        let snapshot_session = Arc::clone(&session);
        let (snapshot_result_tx, snapshot_result_rx) = mpsc::sync_channel(1);
        let snapshot_thread = std::thread::spawn(move || {
            let _ = snapshot_result_tx.send(snapshot_session.portable_snapshot());
        });

        let result = snapshot_result_rx
            .recv_timeout(COMMAND_SUBMISSION_TIMEOUT + Duration::from_millis(200));
        blocked_sink.release();
        snapshot_thread
            .join()
            .expect("portable snapshot thread should not panic");

        assert!(matches!(
            result,
            Ok(Err(error)) if error.contains("command submission timed out")
        ));
    }

    #[test]
    fn snapshot_and_portable_vt_submissions_time_out_when_authoritative_queue_is_saturated() {
        let requests: [(&str, TestRequest); 2] = [
            ("snapshot", TerminalModelSession::snapshot),
            ("portable VT", TerminalModelSession::portable_vt),
        ];

        for (index, (request_name, request)) in requests.into_iter().enumerate() {
            let (session, blocked_sink) = start_worker_with_saturated_queue(
                &format!("test-request-{index}"),
                96 + index as u64,
            );
            let request_session = Arc::clone(&session);
            let (request_result_tx, request_result_rx) = mpsc::sync_channel(1);
            let request_thread = std::thread::spawn(move || {
                let _ = request_result_tx.send(request(&request_session));
            });

            let result = request_result_rx
                .recv_timeout(COMMAND_SUBMISSION_TIMEOUT + Duration::from_millis(200));
            blocked_sink.release();
            request_thread
                .join()
                .unwrap_or_else(|_| panic!("{request_name} request thread should not panic"));

            assert!(
                matches!(
                    result,
                    Ok(Err(error)) if error.contains("command submission timed out")
                ),
                "{request_name} submission should return the timeout error"
            );
        }
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
        let (session, feeder) = TerminalModelSession::start_with_event_sink(
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
        let (old_session, old_feeder) = TerminalModelSession::start(
            "shared-key".to_string(),
            10,
            TerminalModelOptions::new(20, 4),
        )
        .expect("old terminal model worker should start");
        old_feeder.feed(b"old-instance");
        drop(old_session);

        let (new_session, new_feeder) = TerminalModelSession::start(
            "shared-key".to_string(),
            11,
            TerminalModelOptions::new(20, 4),
        )
        .expect("new terminal model worker should start");
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
