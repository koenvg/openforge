use super::*;
use super::super::TerminalModelOptions;
use std::sync::{Arc, Mutex};

#[test]
fn restored_continuation_tracks_only_the_current_sequence_after_ground_is_crossed() {
    let (session, feeder) = TerminalModelSession::start_with_event_sink(
        "continuation-ground".into(), 46, TerminalModelOptions::new(80, 24), Arc::new(|_| {}),
    ).unwrap();
    feeder.feed(b"AB\x1b[3");
    let saved = session.checkpoint().unwrap();
    drop(session);
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&events);
    let (session, feeder) = TerminalModelSession::restore_with_event_sink(
        "continuation-ground".into(), saved,
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    feeder.feed(b"1mC\x1b[6n\x1b[3");
    let snapshot = session.portable_snapshot().unwrap();
    assert_eq!(snapshot.continuation, b"\x1b[3");
    let saved = session.checkpoint().unwrap();
    drop(session);
    let observed = Arc::clone(&events);
    let (session, _) = TerminalModelSession::restore_with_event_sink(
        "continuation-ground".into(), saved,
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    assert_eq!(session.portable_snapshot().unwrap(), snapshot);
    assert_eq!(events.lock().unwrap().iter().filter(|event| matches!(event, TerminalModelEvent::ProtocolReply { .. })).count(), 1);
}

#[test]
fn repeated_checkpoints_preserve_an_incomplete_parser_without_waiting_for_idle_or_new_output() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&events);
    let (mut session, feeder) = TerminalModelSession::start_with_event_sink(
        "repeated-checkpoint".into(), 45, TerminalModelOptions::new(80, 24),
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    feeder.feed(b"AB\x1b[3");
    let mut saved = session.checkpoint().unwrap();
    for iteration in 0..3 {
        let before = session.portable_snapshot().unwrap();
        drop(session);
        let observed = Arc::clone(&events);
        let (resumed, feeder) = TerminalModelSession::restore_with_event_sink(
            "repeated-checkpoint".into(), saved,
            Arc::new(move |event| observed.lock().unwrap().push(event)),
        ).unwrap();
        session = resumed;
        assert_eq!(session.portable_snapshot().unwrap(), before);
        session.checkpoint().expect("a second replacement must not require another output byte");
        feeder.feed(b"1");
        session.resize(81, 25);
        let before = session.portable_snapshot().unwrap();
        saved = session.checkpoint().unwrap();
        assert_eq!(before.watermark, iteration + 2);
    }
    drop(session);
    let observed = Arc::clone(&events);
    let (session, feeder) = TerminalModelSession::restore_with_event_sink(
        "repeated-checkpoint".into(), saved,
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    feeder.feed(b"mCD\x1b[6n");
    let snapshot = session.portable_snapshot().unwrap();
    assert_eq!(snapshot.watermark, 5);
    assert!(snapshot.continuation.is_empty());
    let events = events.lock().unwrap();
    let replies: Vec<_> = events.iter().filter_map(|event| match event {
        TerminalModelEvent::ProtocolReply { bytes, .. } => Some(bytes.as_slice()),
        _ => None,
    }).collect();
    assert_eq!(replies, [b"\x1b[1;5R".as_slice()]);
}

#[test]
fn restoration_refuses_exhausted_output_positions_without_changing_the_serving_model() {
    let (session, feeder) = TerminalModelSession::start_with_event_sink(
        "checkpoint-limit".into(), 44, TerminalModelOptions::new(80, 24), Arc::new(|_| {}),
    ).unwrap();
    feeder.feed(b"live");
    let before = session.portable_snapshot().unwrap();
    let mut checkpoint = serde_json::to_value(session.checkpoint().unwrap()).unwrap();
    checkpoint["watermark"] = serde_json::json!(u64::MAX);
    assert!(TerminalModelSession::restore_with_event_sink(
        "checkpoint-limit".into(), serde_json::from_value(checkpoint).unwrap(), Arc::new(|_| {}),
    ).is_err());
    assert_eq!(session.portable_snapshot().unwrap(), before);
}

#[test]
fn checkpoint_waits_for_earlier_protocol_reply_delivery() {
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let release_rx = Mutex::new(release_rx);
    let (session, feeder) = TerminalModelSession::start_with_event_sink(
        "checkpoint-replies".into(), 43, TerminalModelOptions::new(80, 24),
        Arc::new(move |event| {
            if matches!(event, TerminalModelEvent::ProtocolReply { .. }) {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }
        }),
    ).unwrap();
    let session = Arc::new(session);
    feeder.feed(b"reply\x1b[6n");
    entered_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
    let requester = Arc::clone(&session);
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
    let requester = std::thread::spawn(move || done_tx.send(requester.checkpoint()).unwrap());
    let early = done_rx.recv_timeout(std::time::Duration::from_millis(50));
    release_tx.send(()).unwrap();
    requester.join().unwrap();
    assert!(matches!(early, Err(std::sync::mpsc::RecvTimeoutError::Timeout)), "checkpoint crossed an undelivered reply");
    let checkpoint = done_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap().unwrap();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::clone(&observed);
    let (resumed, _feeder) = TerminalModelSession::restore_with_event_sink(
        "checkpoint-replies".into(), checkpoint,
        Arc::new(move |event| events.lock().unwrap().push(event)),
    ).unwrap();
    assert_eq!(resumed.portable_snapshot().unwrap().watermark, 1);
    assert!(observed.lock().unwrap().is_empty());
}

#[test]
fn checkpoint_restores_parser_image_replay_and_output_position_without_replaying_replies() {
    let old_events = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&old_events);
    let (session, feeder) = TerminalModelSession::start_with_event_sink(
        "checkpoint-actor".into(), 42, TerminalModelOptions::new(80, 24),
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    const BEFORE: &[u8] = b"PRIMARY\x1b]1337;File=inline=1:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC\x07\x1b[?1049h\x1b[HALT\x1b[31";
    feeder.feed(BEFORE);
    let before = session.portable_snapshot().unwrap();
    assert_eq!(before.watermark, 1);
    assert_eq!(before.continuation, b"\x1b[31");
    let checkpoint = session.checkpoint().unwrap();
    let checkpoint = serde_json::from_slice(&serde_json::to_vec(&checkpoint).unwrap()).unwrap();
    drop(feeder);
    drop(session);

    let new_events = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&new_events);
    let (resumed, feeder) = TerminalModelSession::restore_with_event_sink(
        "checkpoint-actor".into(), checkpoint,
        Arc::new(move |event| observed.lock().unwrap().push(event)),
    ).unwrap();
    assert_eq!(resumed.portable_snapshot().unwrap(), before);
    assert!(new_events.lock().unwrap().is_empty(), "restore must emit neither old output nor replies");
    feeder.feed(b"mRED\x1b[6n");
    let after = resumed.portable_snapshot().unwrap();
    assert_eq!(after.watermark, 2);
    assert!(after.compatibility_replay.starts_with(BEFORE));
    assert!(after.continuation.is_empty());
    let events = new_events.lock().unwrap();
    assert!(matches!(&events[0], TerminalModelEvent::Output(frame) if frame.instance_id == 42 && frame.sequence == 2));
    let replies: Vec<_> = events.iter().filter_map(|event| match event {
        TerminalModelEvent::ProtocolReply { bytes, .. } => Some(bytes.clone()),
        _ => None,
    }).collect();
    assert_eq!(replies, [b"\x1b[1;7R".to_vec()]);
    assert!(old_events.lock().unwrap().iter().all(|event| !matches!(event, TerminalModelEvent::ProtocolReply { .. })));
}
