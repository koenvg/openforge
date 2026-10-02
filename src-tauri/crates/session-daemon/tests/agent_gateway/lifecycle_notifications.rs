use crate::support::{agent_config, raw_request, Fixture};
use openforge_session_protocol::SidecarEndpoint;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

#[test]
fn notification_is_accepted_during_outage_and_duplicate_keeps_its_position() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (session, config) = agent_config(&fixture, &client);
    let body = serde_json::json!({
        "id": "completion-1",
        "payload": {
            "provider": "pi", "task_id": "T-fixture",
            "pty_instance_id": session.pty.instance.value(), "kind": "ended"
        }
    })
    .to_string();
    let accepted = raw_request(
        &config,
        "POST",
        "/notifications/agent-lifecycle",
        "Content-Type: application/json\r\n",
        &body,
    );
    assert!(accepted.starts_with("HTTP/1.1 202"), "{accepted}");
    let receipt: serde_json::Value =
        serde_json::from_str(accepted.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(receipt["position"], 1);
    let replacement = fixture.connect();
    let duplicate = raw_request(
        &config,
        "POST",
        "/notifications/agent-lifecycle",
        "Content-Type: application/json\r\n",
        &body,
    );
    let repeated: serde_json::Value =
        serde_json::from_str(duplicate.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(receipt, repeated);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    replacement
        .register_sidecar(Some(SidecarEndpoint {
            port: listener.local_addr().unwrap().port(),
            token: "private-notification-token".into(),
        }))
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    for attempt in 0..2 {
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    break stream;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "notification was not replayed"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let (header_end, length) = loop {
            let mut buf = [0; 4096];
            let count = stream.read(&mut buf).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buf[..count]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                assert!(headers.starts_with("post /internal/agent-notifications "));
                assert!(headers.contains("authorization: bearer private-notification-token"));
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                break (end + 4, length);
            }
        };
        while bytes.len() < header_end + length {
            let mut buf = [0; 4096];
            let count = stream.read(&mut buf).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buf[..count]);
        }
        let delivery: serde_json::Value =
            serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
        assert_eq!(delivery["journalId"], receipt["journalId"]);
        assert_eq!(delivery["position"], receipt["position"]);
        assert_eq!(delivery["envelope"]["id"], "completion-1");
        if attempt == 1 {
            let body = receipt.to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
        // The first response is lost. The same durable delivery must be retried.
    }
    replacement.terminate("done", &session.pty).unwrap();
}

#[test]
fn notification_ingress_rejects_invalid_envelopes_and_identity_conflicts() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (session, config) = agent_config(&fixture, &client);
    let valid = serde_json::json!({"id":"same-id", "payload":{"provider":"pi", "task_id":"T-fixture", "pty_instance_id":session.pty.instance.value(), "kind":"requested_permission"}});
    for (field, value, expected) in [
        ("kind", serde_json::json!("approve"), "400"),
        ("provider", serde_json::json!("unknown"), "400"),
        ("task_id", serde_json::json!("forged-task"), "403"),
        ("pty_instance_id", serde_json::json!(1), "403"),
        (
            "activity_snapshot",
            serde_json::json!("x".repeat(16384)),
            "413",
        ),
    ] {
        let mut payload = valid.clone();
        payload["payload"][field] = value;
        let response = raw_request(
            &config,
            "POST",
            "/notifications/agent-lifecycle",
            "",
            &payload.to_string(),
        );
        assert!(
            response.starts_with(&format!("HTTP/1.1 {expected}")),
            "{response}"
        );
    }
    let accepted = raw_request(
        &config,
        "POST",
        "/notifications/agent-lifecycle",
        "",
        &valid.to_string(),
    );
    assert!(accepted.starts_with("HTTP/1.1 202"), "{accepted}");
    let mut conflict = valid;
    conflict["payload"]["kind"] = serde_json::json!("ended");
    assert!(raw_request(
        &config,
        "POST",
        "/notifications/agent-lifecycle",
        "",
        &conflict.to_string()
    )
    .starts_with("HTTP/1.1 409"));
    client.terminate("cleanup", &session.pty).unwrap();
}
