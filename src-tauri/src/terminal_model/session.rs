mod event_state;
mod worker_session;

pub(crate) use event_state::{TerminalModelEvent, TerminalModelEventSink};
pub(crate) use worker_session::{TerminalModelFeeder, TerminalModelSession};
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
        released: AtomicBool,
    }

    impl FirstOutputBlockingSink {
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
                released: AtomicBool::new(false),
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

        fn try_unblock(&self) -> Result<(), mpsc::SendError<()>> {
            if self.released.swap(true, Ordering::AcqRel) {
                return Ok(());
            }
            self.release_tx.send(())
        }

        fn unblock(&self) {
            self.try_unblock()
                .expect("test should unblock the model worker");
        }
    }

    struct BlockedTerminalModelWorker {
        session: Option<Arc<TerminalModelSession>>,
        feeder: Option<TerminalModelFeeder>,
        blocked_sink: FirstOutputBlockingSink,
    }

    impl BlockedTerminalModelWorker {
        fn start(session_key: &str, instance_id: u64) -> Self {
            Self::with_event_observer(session_key, instance_id, |_| {})
        }

        fn with_event_observer(
            session_key: &str,
            instance_id: u64,
            observer: impl Fn(&TerminalModelEvent) + Send + Sync + 'static,
        ) -> Self {
            let mut blocked_sink = FirstOutputBlockingSink::with_event_observer(observer);
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

            Self {
                session: Some(Arc::new(session)),
                feeder: Some(feeder),
                blocked_sink,
            }
        }

        fn session(&self) -> &Arc<TerminalModelSession> {
            self.session
                .as_ref()
                .expect("blocked worker session should still be available")
        }

        fn feeder(&self) -> &TerminalModelFeeder {
            self.feeder
                .as_ref()
                .expect("blocked worker feeder should still be available")
        }

        fn take_session(&mut self) -> Arc<TerminalModelSession> {
            self.session
                .take()
                .expect("blocked worker session should only be taken once")
        }

        fn take_feeder(&mut self) -> TerminalModelFeeder {
            self.feeder
                .take()
                .expect("blocked worker feeder should only be taken once")
        }

        fn unblock(&self) {
            self.blocked_sink.unblock();
        }

        fn run_session_operation<T: Send + 'static>(
            &self,
            operation_name: &str,
            operation: impl FnOnce(Arc<TerminalModelSession>) -> T + Send + 'static,
        ) -> Result<T, mpsc::RecvTimeoutError> {
            let session = Arc::clone(self.session());
            let (result_tx, result_rx) = mpsc::sync_channel(1);
            let operation_thread = std::thread::spawn(move || {
                let _ = result_tx.send(operation(session));
            });

            let result =
                result_rx.recv_timeout(COMMAND_SUBMISSION_TIMEOUT + Duration::from_millis(200));
            self.unblock();
            operation_thread
                .join()
                .unwrap_or_else(|_| panic!("{operation_name} thread should not panic"));
            result
        }
    }

    impl Drop for BlockedTerminalModelWorker {
        fn drop(&mut self) {
            let _ = self.blocked_sink.try_unblock();
        }
    }

    type TestRequest = fn(&TerminalModelSession) -> Result<Vec<u8>, String>;

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
        let worker = BlockedTerminalModelWorker::start("burst-shell", 92);
        let tail_feeder = worker.feeder().clone();
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
        worker.unblock();
        if !completed_while_model_was_blocked {
            tail_complete_rx
                .recv_timeout(REQUEST_TIMEOUT)
                .expect("tail feed should finish after the model catches up");
        }
        tail_feed.join().expect("tail feeder should not panic");

        assert!(!completed_while_model_was_blocked);
        worker
            .session()
            .portable_snapshot()
            .expect("authoritative model should remain available after the burst");
    }

    #[test]
    fn dropping_a_session_is_bounded_when_the_worker_and_command_queue_are_blocked() {
        let (worker_disconnected_tx, worker_disconnected_rx) = mpsc::sync_channel(1);
        let (worker_dropped_tx, worker_dropped_rx) = mpsc::sync_channel(1);
        let worker_drop_signal = DropSignal(worker_dropped_tx);
        let mut worker = BlockedTerminalModelWorker::with_event_observer(
            "blocked-drop-shell",
            93,
            move |event| {
                let _worker_drop_signal = &worker_drop_signal;
                if matches!(event, TerminalModelEvent::Disabled { .. }) {
                    let _ = worker_disconnected_tx.send(());
                }
            },
        );
        let session = worker.take_session();
        let feeder = worker.take_feeder();
        let (drop_complete_tx, drop_complete_rx) = mpsc::sync_channel(1);
        let drop_thread = std::thread::spawn(move || {
            drop(session);
            let _ = drop_complete_tx.send(());
        });
        let drop_completed_within_deadline = drop_complete_rx
            .recv_timeout(Duration::from_millis(250))
            .is_ok();

        worker.unblock();
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
        let worker = BlockedTerminalModelWorker::start("resize-shell", 94);
        let completed_within_deadline = worker
            .run_session_operation("resize", |session| session.resize(120, 40))
            .is_ok();
        assert!(
            completed_within_deadline,
            "resize must not wait indefinitely for a saturated authoritative queue"
        );
        assert!(worker.session().diagnostics().iter().any(|diagnostic| {
            diagnostic.phase == "resize" && diagnostic.message.contains("timed out")
        }));
    }

    #[test]
    fn portable_snapshot_submission_times_out_when_authoritative_queue_is_saturated() {
        let worker = BlockedTerminalModelWorker::start("portable-snapshot-shell", 95);
        let result = worker
            .run_session_operation("portable snapshot", |session| session.portable_snapshot());

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
            let worker = BlockedTerminalModelWorker::start(
                &format!("test-request-{index}"),
                96 + index as u64,
            );
            let result =
                worker.run_session_operation(request_name, move |session| request(&session));

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

        let bootstrap = b"bootstrap\x1b]1337;File=size=3;inline=1:AAAA\x07";
        feeder.feed(bootstrap);
        let snapshot = session
            .portable_snapshot()
            .expect("portable snapshot should be available");
        feeder.feed(b"later");
        let final_snapshot = session
            .portable_snapshot()
            .expect("later feed should cross the actor barrier");

        assert_eq!(snapshot.instance_id, 77);
        assert_eq!(snapshot.watermark, 1);
        assert_eq!(snapshot.compatibility_replay, bootstrap);
        assert!(snapshot
            .portable_vt
            .windows(b"bootstrap".len())
            .any(|part| part == b"bootstrap"));
        assert!(!snapshot
            .portable_vt
            .windows(b"later".len())
            .any(|part| part == b"later"));
        assert_eq!(final_snapshot.watermark, 2);
        assert!(final_snapshot.compatibility_replay.ends_with(b"later"));

        let events = captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(
            events.as_slice(),
            [
                TerminalModelEvent::Output(TerminalModelOutputFrame {
                    instance_id: 77,
                    sequence: 1,
                    bytes: bootstrap.to_vec(),
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
    fn concurrent_continuation_overflow_defers_checkpoints_until_parsers_recover() {
        const SESSION_COUNT: usize = 4;
        const CONTINUATION_LIMIT: usize = 1024;

        let workers = (0..SESSION_COUNT)
            .map(|index| {
                let mut options = TerminalModelOptions::new(20, 4);
                options.max_continuation_bytes = CONTINUATION_LIMIT;
                let sink: TerminalModelEventSink = Arc::new(|_| {});
                TerminalModelSession::start_with_event_sink(
                    format!("continuation-shell-{index}"),
                    100 + index as u64,
                    options,
                    sink,
                )
                .expect("terminal model worker should start")
            })
            .collect::<Vec<_>>();
        let start = Arc::new(std::sync::Barrier::new(SESSION_COUNT + 1));
        let feed_threads = workers
            .iter()
            .map(|(_, feeder)| {
                let feeder = feeder.clone();
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    feeder.feed(b"\x1b[");
                    feeder.feed(&vec![b'1'; CONTINUATION_LIMIT + 1]);
                })
            })
            .collect::<Vec<_>>();

        start.wait();
        for feed_thread in feed_threads {
            feed_thread
                .join()
                .expect("concurrent terminal feed should not panic");
        }
        for (session, _) in &workers {
            let portable_error = session
                .portable_snapshot()
                .expect_err("overflowed continuation should defer portable snapshots");
            assert!(
                portable_error.contains("continuation is temporarily unavailable"),
                "unexpected portable snapshot error: {portable_error}"
            );
            let error = session
                .snapshot()
                .expect_err("overflowed continuation should defer snapshots");
            assert!(
                error.contains("continuation is temporarily unavailable"),
                "unexpected snapshot error: {error}"
            );
        }

        std::thread::sleep(Duration::from_millis(100));
        for (session, _) in &workers {
            assert!(
                session.diagnostics().is_empty(),
                "transient continuation overflow must not disable the model"
            );
        }

        for (session, feeder) in &workers {
            feeder.feed(b"\x1bcmodel-recovered");
            let snapshot = session
                .portable_snapshot()
                .expect("snapshot should recover after the parser reaches ground");
            assert!(snapshot
                .portable_vt
                .windows(b"model-recovered".len())
                .any(|window| window == b"model-recovered"));
        }
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
