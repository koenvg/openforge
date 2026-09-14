use super::daemon_fixture::DaemonFixture;
use super::*;
use crate::app_events::AppEventEnvelope;
use base64::Engine;
use std::time::Duration;
use tokio::sync::broadcast::Receiver;

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
    tokio::time::timeout(Duration::from_secs(5), async {
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
    let session = client.inventory().unwrap().sessions.remove(0);
    client
        .write(
            "while-absent",
            &session.pty,
            session.next_io_sequence.unwrap(),
            format!("{}\n", print_command("ABSENT_MARKER")).as_bytes(),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
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

    // Stall only this owned daemon's request loop. PTY output continues on its reader,
    // overflowing the bounded journal while the bridge cannot poll it.
    invoke_ok(&second, "pty_write", json!({"shellSessionKey":key, "data":format!("while [ ! -e run-burst ]; do sleep 0.01; done; head -c 700000 /dev/zero; {}; exit 19\n", print_command("GAP_FINAL"))})).await;
    let root = fixture.0.path().to_owned();
    let blocker = tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let runtime = openforge_session_client::runtime::RuntimeDirectory::open(&root).unwrap();
        let mut sockets = Vec::new();
        for _ in 0..3 {
            let mut socket =
                std::os::unix::net::UnixStream::connect(runtime.socket_path()).unwrap();
            socket.write_all(&[0]).unwrap();
            sockets.push(socket);
        }
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(root.join("run-burst"), b"go").unwrap();
        std::thread::sleep(Duration::from_millis(3100));
        drop(sockets);
    });
    let mut gap = false;
    let mut forwarded_bytes = 0;
    let mut tail = String::new();
    let exit_name = format!("pty-exit-{key}");
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_name.starts_with("pty-model-output-") {
                let data = base64::engine::general_purpose::STANDARD
                    .decode(event.payload["data"].as_str().unwrap())
                    .unwrap();
                forwarded_bytes += data.len();
                tail = String::from_utf8_lossy(&data)
                    .chars()
                    .rev()
                    .take(200)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
            }
            gap |= event.event_name == "openforge-app-events-reconnected";
            if event.event_name == exit_name {
                assert_eq!(event.payload["instance_id"], instance);
                break;
            }
        }
    })
    .await
    .unwrap();
    blocker.await.unwrap();
    assert!(gap, "journal overflow did not request existing transport reconciliation; forwarded={forwarded_bytes}; tail={tail:?}");
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
    let vt = base64::engine::general_purpose::STANDARD
        .decode(snapshot["snapshot"]["data"].as_str().unwrap())
        .unwrap();
    assert!(String::from_utf8_lossy(&vt).contains("GAP_FINAL"));
    drop(second);
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
    tokio::time::timeout(Duration::from_secs(5), async {
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
