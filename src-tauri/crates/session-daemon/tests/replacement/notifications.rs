//! Retained authenticated ingress, Sidecar registration and durable notification retries.
use super::support::Fixture;
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_protocol::*;
use serde_json::{json, Value};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

#[test]
fn notification_receipts_and_registered_sidecar_survive_real_exec() {
    let (mut fixture, client) = Fixture::new();
    let request = ShellCommand {
        owner: TerminalOwner::Agent {
            task_id: "notification-replacement".into(),
        },
        command: PreparedCommand {
            program: "/bin/sleep".into(),
            args: vec!["120".into()],
            cwd: fixture.root().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let session = client.spawn("agent", &request).unwrap();
    fixture.track_process(session.pid);
    let runtime = RuntimeDirectory::open(fixture.root()).unwrap();
    let path = std::fs::read_dir(runtime.path())
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| entry.file_name().to_string_lossy().starts_with("agent-"))
        .unwrap()
        .path();
    let original = std::fs::read(&path).unwrap();
    let config: AgentConfig = serde_json::from_slice(&original).unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    client
        .register_sidecar(Some(SidecarEndpoint {
            port: listener.local_addr().unwrap().port(),
            token: "retained-sidecar".into(),
        }))
        .unwrap();
    let notification = json!({"id":"retained-notification", "payload":{"provider":"pi","task_id":"notification-replacement","pty_instance_id":session.pty.instance.value(),"kind":"became_busy"}});
    let receipt = submit(&config, &notification);
    let executor = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    let operation = OperationId::parse("replace-notifications").unwrap();
    executor
        .block_on(openforge_session_host::PtyHost::replacement(
            &client,
            client.controller(),
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2").into(),
            },
        ))
        .unwrap();
    executor
        .block_on(openforge_session_host::PtyHost::replacement(
            &client,
            client.controller(),
            operation,
            ReplacementPhase::Commit,
        ))
        .unwrap();
    assert!(
        std::fs::read(path).unwrap() == original,
        "agent credential rotated"
    );
    assert_eq!(
        submit(&config, &notification),
        receipt,
        "durable ingress retry changed its receipt"
    );
    let database = rusqlite::Connection::open_with_flags(
        runtime.path().join("notifications.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut deliveries = 0;
    loop {
        let acknowledged: i64 = database
            .query_row("SELECT acknowledged FROM journal", [], |row| row.get(0))
            .unwrap();
        if acknowledged == receipt.position as i64 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "retained Sidecar registration did not deliver and acknowledge"
        );
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let Some((headers, body)) = http_message(&mut stream) else {
                    continue;
                };
                assert!(headers.starts_with("POST /internal/agent-notifications "));
                assert!(headers
                    .to_ascii_lowercase()
                    .contains("authorization: bearer retained-sidecar"));
                let delivery: NotificationDelivery = serde_json::from_slice(&body).unwrap();
                assert_eq!(delivery.journal_id, receipt.journal_id);
                assert_eq!(delivery.position, receipt.position);
                assert_eq!(delivery.pty, session.pty);
                assert_eq!(delivery.envelope.id, "retained-notification");
                let body = serde_json::to_string(&receipt).unwrap();
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                deliveries += 1;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(error) => panic!("{error}"),
        }
    }
    assert!(deliveries > 0);
    assert_eq!(
        submit(&config, &notification),
        receipt,
        "acknowledgment lost the original retry receipt"
    );
    assert!(matches!(client.inventory(), Err(Error::StaleController)));
}

fn submit(config: &AgentConfig, notification: &Value) -> NotificationReceipt {
    let mut stream = TcpStream::connect(("127.0.0.1", config.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let body = notification.to_string();
    write!(stream, "POST /notifications/agent-lifecycle HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", config.token, body.len()).unwrap();
    let (headers, body) = http_message(&mut stream).expect("notification response");
    assert!(
        headers.starts_with("HTTP/1.1 202"),
        "notification was not durably accepted"
    );
    serde_json::from_slice(&body).unwrap()
}
fn http_message(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    super::http::read(stream, 16 * 1024, 32 * 1024)
}
