use super::daemon_fixture::DaemonFixture;
use super::*;
use crate::app_events::AppEventEnvelope;
use base64::Engine;
use tokio::sync::broadcast::Receiver;
mod subscription_gate;
use subscription_gate::SubscriptionGate;
const JOURNAL_OVERFLOW_BYTES: usize = 540_000;

struct Consumer {
    instance: serde_json::Value,
    watermark: u64,
    last: u64,
    bytes: Vec<u8>,
}
impl Consumer {
    fn new(snapshot: &serde_json::Value, instance: serde_json::Value) -> Self {
        let watermark = snapshot["snapshot"]["watermark"].as_u64().unwrap();
        Self {
            instance,
            watermark,
            last: watermark,
            bytes: Vec::new(),
        }
    }
    fn apply(&mut self, event: &AppEventEnvelope) {
        if !event.event_name.starts_with("pty-model-output-") {
            return;
        }
        assert_eq!(event.payload["instance_id"], self.instance);
        let sequence = event.payload["sequence"].as_u64().unwrap();
        if sequence <= self.watermark {
            return;
        }
        assert_eq!(
            event.payload["start_sequence"],
            self.last + 1,
            "duplicate or discontinuous forwarded output"
        );
        self.last = sequence;
        self.bytes.extend(
            base64::engine::general_purpose::STANDARD
                .decode(event.payload["data"].as_str().unwrap())
                .unwrap(),
        );
    }
}
fn print_command(marker: &str) -> String {
    let escaped: String = marker.bytes().map(|byte| format!("\\{byte:03o}")).collect();
    format!("printf '{escaped}\\n'")
}
async fn receive_marker(
    receiver: &mut Receiver<AppEventEnvelope>,
    consumer: &mut Consumer,
    marker: &str,
) {
    tokio::time::timeout(DAEMON_SHELL_CONTRACT_TIMEOUT, async {
        loop {
            consumer.apply(&receiver.recv().await.unwrap());
            if String::from_utf8_lossy(&consumer.bytes).contains(marker) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&consumer.bytes)
            .matches(marker)
            .count(),
        1
    );
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn daemon_bridge_forwards_ordered_output_and_reconciles_gap_and_exit_after_replacement() {
    let fixture = DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-events-ipc-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let key = "T-events-shell-0";
    let (mut first, _db1) = test_state("daemon-events-first");
    let (sender, mut events) = tokio::sync::broadcast::channel(2048);
    first.app_event_tx = Some(sender);
    first.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable.clone(),
        key.into(),
    );
    let instance = invoke_ok(&first, "pty_spawn_shell", json!({"taskId":"T-events", "terminalIndex":0, "cwd":fixture.0.path(), "cols":80, "rows":24})).await;
    let snapshot = invoke_ok(&first, "get_pty_buffer", json!({"shellSessionKey":key})).await;
    let mut consumer = Consumer::new(&snapshot, instance.clone());
    invoke_ok(
        &first,
        "pty_write",
        json!({"shellSessionKey":key, "data":format!("{}\n", print_command("LIVE_ONE"))}),
    )
    .await;
    receive_marker(&mut events, &mut consumer, "LIVE_ONE").await;
    drop(first);

    let client = openforge_session_client::Client::connect(fixture.0.path()).unwrap();
    client.enable_operation_retirement().unwrap();
    let session = client.inventory().unwrap().sessions.remove(0);
    client
        .write_ordered(
            &session.pty,
            session.next_io_sequence.unwrap(),
            format!("{}\n", print_command("ABSENT_MARKER")).as_bytes(),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let transport = SubscriptionGate::new(fixture.0.path());
    let (mut second, _db2) = test_state("daemon-events-second");
    let (sender, mut events) = tokio::sync::broadcast::channel(2048);
    second.app_event_tx = Some(sender);
    second.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        key.into(),
    );
    let snapshot = invoke_ok(&second, "get_pty_buffer", json!({"shellSessionKey":key})).await;
    assert_eq!(snapshot["instanceId"], instance);
    assert_eq!(snapshot["isLive"], true);
    let reattached = invoke_ok(&second, "pty_spawn_shell", json!({"taskId":"T-events", "terminalIndex":0, "cwd":fixture.0.path(), "cols":80, "rows":24})).await;
    assert_eq!(
        reattached, instance,
        "replacement must reuse the live session"
    );
    let vt = base64::engine::general_purpose::STANDARD
        .decode(snapshot["snapshot"]["data"].as_str().unwrap())
        .unwrap();
    assert!(String::from_utf8_lossy(&vt).contains("ABSENT_MARKER"));
    let mut consumer = Consumer::new(&snapshot, instance.clone());
    invoke_ok(
        &second,
        "pty_write",
        json!({"shellSessionKey":key, "data":format!("{}\n", print_command("LIVE_TWO"))}),
    )
    .await;
    receive_marker(&mut events, &mut consumer, "LIVE_TWO").await;

    let exit_name = format!("pty-exit-{key}");
    let raw_gap = tokio::time::timeout(DAEMON_SHELL_CONTRACT_TIMEOUT, async {
        let pause = transport.pause_next_batch();
        // Wake the real pushed stream, then wait for a complete delivered prefix.
        invoke_ok(&second, "pty_write", json!({"shellSessionKey":key, "data":"\n"})).await;
        let prefix = pause.parked.await.unwrap();
        assert!(!prefix.gap);
        let prefix_sequence = prefix.events.iter().filter_map(|event| match event {
            openforge_session_protocol::Event::Output { pty, sequence, .. } => {
                assert_eq!(pty, &session.pty);
                Some(*sequence)
            }
            _ => None,
        }).max().unwrap();
        while consumer.last < prefix_sequence {
            consumer.apply(&events.recv().await.unwrap());
        }
        assert_eq!(consumer.last, prefix_sequence);

        // The subscription is now interrupted at prefix.cursor. Commands and PTY
        // output remain live; journal overflow cannot depend on subscriber speed.
        invoke_ok(&second, "pty_write", json!({"shellSessionKey":key, "data":format!("head -c {JOURNAL_OVERFLOW_BYTES} /dev/zero; {}; exit 19\n", print_command("GAP_FINAL"))})).await;
        loop {
            let inventory = invoke_ok(&second, "get_restart_terminal_inventory", json!({})).await;
            assert_eq!(inventory["sessions"].as_array().unwrap().len(), 1);
            assert_eq!(inventory["sessions"][0]["key"], key);
            assert_eq!(inventory["sessions"][0]["instanceId"], instance);
            if inventory["sessions"][0]["isLive"] == false {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        pause.release.send(()).unwrap();
        let raw_gap = pause.resumed.await.unwrap();
        assert!(raw_gap.gap, "the real daemon must report the missing prefix");
        assert!(raw_gap.cursor > prefix.cursor);
        let mut reconciled = false;
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name.starts_with("pty-") {
                assert!(event.event_name.ends_with(key), "unselected session was routed");
                assert_eq!(event.payload["instance_id"], instance);
            }
            if event.event_name.starts_with("pty-model-output-") {
                assert!(!reconciled, "gap suffix must not be forwarded as ordered output");
                consumer.apply(&event);
            }
            if event.event_name == "openforge-app-events-reconnected" {
                assert!(!reconciled, "gap requested reconciliation twice");
                reconciled = true;
            }
            if event.event_name == exit_name {
                assert!(reconciled, "exit must follow genuine gap reconciliation");
                break;
            }
        }
        raw_gap
    }).await.unwrap();
    let mut suffix = Vec::new();
    let mut last = None;
    let mut exits = 0;
    for event in raw_gap.events {
        match event {
            openforge_session_protocol::Event::Output {
                pty,
                sequence,
                data,
            } => {
                assert_eq!(pty, session.pty);
                if let Some(previous) = last {
                    assert_eq!(sequence, previous + 1);
                } else {
                    assert!(
                        sequence > consumer.last + 1,
                        "a genuine prefix must be missing"
                    );
                }
                assert_eq!(exits, 0, "daemon output followed exit");
                last = Some(sequence);
                suffix.extend(data);
            }
            openforge_session_protocol::Event::Exited { pty, code } => {
                assert_eq!(pty, session.pty);
                assert_eq!(code, 19);
                exits += 1;
            }
            _ => {}
        }
    }
    assert_eq!(exits, 1);
    assert!(String::from_utf8_lossy(&suffix).contains("GAP_FINAL"));
    assert!(!String::from_utf8_lossy(&consumer.bytes).contains("GAP_FINAL"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    while let Ok(event) = events.try_recv() {
        assert!(
            !event.event_name.starts_with("pty-model-output-"),
            "output forwarded after exit publication"
        );
        assert_ne!(
            event.event_name, exit_name,
            "exit was forwarded twice after a gap"
        );
    }
    // The same recovery call used by the Terminal Runtime replaces a missing prefix.
    let snapshot = invoke_ok(&second, "get_pty_buffer", json!({"shellSessionKey":key})).await;
    assert_eq!(snapshot["instanceId"], instance);
    assert_eq!(snapshot["isLive"], false);
    assert_eq!(snapshot["snapshot"]["watermark"].as_u64(), last);
    assert!(snapshot["snapshot"]["watermark"].as_u64().unwrap() > consumer.last);
    let vt = base64::engine::general_purpose::STANDARD
        .decode(snapshot["snapshot"]["data"].as_str().unwrap())
        .unwrap();
    assert!(String::from_utf8_lossy(&vt).contains("GAP_FINAL"));
    drop(second);
    drop(transport);
}

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn daemon_replacement_routes_only_selected_sessions_and_does_not_revive_old_controller() {
    let fixture = DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-routing-ipc-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let selected = "T-routing-shell-0";
    let excluded = "T-routing-shell-1";
    let (mut first, _db1) = test_state("daemon-routing-first");
    first.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable.clone(),
        "*".into(),
    );
    let mut instances = Vec::new();
    for index in 0..2 {
        instances.push(
            invoke_ok(
                &first,
                "pty_spawn_shell",
                json!({
                    "taskId": "T-routing", "terminalIndex": index,
                    "cwd": fixture.0.path(), "cols": 80, "rows": 24,
                }),
            )
            .await,
        );
    }
    invoke_ok(&first, "pty_write", json!({
        "shellSessionKey": excluded,
        "data": format!("while [ ! -e route ]; do sleep 0.01; done; {}; touch excluded-done; exit 8\n", print_command("EXCLUDED_OUTPUT")),
    })).await;

    let (mut second, _db2) = test_state("daemon-routing-second");
    let (sender, mut events) = tokio::sync::broadcast::channel(2048);
    second.app_event_tx = Some(sender);
    second.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        selected.into(),
    );
    let inventory = invoke_ok(&second, "get_restart_terminal_inventory", json!({})).await;
    assert_eq!(
        inventory["sessions"],
        json!([{
            "key": selected, "instanceId": instances[0], "isLive": true,
        }])
    );
    // Keep the old bridge alive. Neither commands nor polling may reclaim control.
    let error = invoke(
        &first,
        "pty_write",
        json!({
            "shellSessionKey": selected, "data": "must-not-arrive\n",
        }),
    )
    .await
    .unwrap_err();
    assert!(error.1.contains("controller"), "{error:?}");
    invoke_ok(&second, "pty_write", json!({
        "shellSessionKey": selected,
        "data": format!("touch route; while [ ! -e excluded-done ]; do sleep 0.01; done; {}; exit 9\n", print_command("SELECTED_OUTPUT")),
    })).await;
    let mut output = Vec::new();
    tokio::time::timeout(DAEMON_SHELL_CONTRACT_TIMEOUT, async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name.starts_with("pty-") {
                assert!(
                    event.event_name.ends_with(selected),
                    "unexpected route: {}",
                    event.event_name
                );
                assert_eq!(event.payload["instance_id"], instances[0]);
            }
            if event.event_name == format!("pty-model-output-{selected}") {
                output.extend(
                    base64::engine::general_purpose::STANDARD
                        .decode(event.payload["data"].as_str().unwrap())
                        .unwrap(),
                );
            }
            if event.event_name == format!("pty-exit-{selected}") {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert!(String::from_utf8_lossy(&output).contains("SELECTED_OUTPUT"));
    assert!(!String::from_utf8_lossy(&output).contains("EXCLUDED_OUTPUT"));
    let snapshot = invoke_ok(
        &second,
        "get_pty_buffer",
        json!({"shellSessionKey": selected}),
    )
    .await;
    assert_eq!(snapshot["instanceId"], instances[0]);
    assert_eq!(snapshot["isLive"], false);
    let inventory = invoke_ok(&second, "get_restart_terminal_inventory", json!({})).await;
    assert_eq!(
        inventory["sessions"],
        json!([{
            "key": selected, "instanceId": instances[0], "isLive": false,
        }])
    );
    drop(first);
    drop(second);
}
