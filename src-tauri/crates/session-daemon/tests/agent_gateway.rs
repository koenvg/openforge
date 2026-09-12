use openforge_session_client::Client;
use openforge_session_protocol::{Error, SidecarEndpoint};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

struct Fixture(tempfile::TempDir);
impl Fixture {
    fn new() -> Self {
        Self(
            tempfile::Builder::new()
                .prefix("of-agent-")
                .tempdir_in("/tmp")
                .unwrap(),
        )
    }
    fn connect(&self) -> Client {
        Client::launch(
            std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            self.0.path(),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Ok(client) = Client::connect(self.0.path()) {
            if let Ok(inventory) = client.inventory() {
                for session in inventory.sessions {
                    let _ = client
                        .terminate(&format!("cleanup-{}", session.pty.instance), &session.pty);
                }
            }
            let _ = client.shutdown_empty();
        }
    }
}

#[test]
fn registration_is_controller_fenced_and_cleared_on_replacement() {
    let fixture = Fixture::new();
    let first = fixture.connect();
    let endpoint = SidecarEndpoint {
        port: 12345,
        token: "private-sidecar-token".into(),
    };
    first.register_sidecar(Some(endpoint.clone())).unwrap();
    let second = fixture.connect();
    assert!(matches!(
        first.register_sidecar(Some(endpoint.clone())),
        Err(Error::StaleController)
    ));
    second.register_sidecar(Some(endpoint.clone())).unwrap();
    second.register_sidecar(None).unwrap();
    assert!(!format!("{endpoint:?}").contains("private-sidecar-token"));
}

fn agent_config(
    fixture: &Fixture,
    client: &Client,
) -> (openforge_session_protocol::Session, serde_json::Value) {
    use openforge_session_host::{PreparedCommand, TerminalOwner};
    let session = client
        .spawn(
            "agent-fixture",
            &openforge_session_protocol::ShellCommand {
                owner: TerminalOwner::Agent {
                    task_id: "T-fixture".into(),
                },
                command: PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec![
                        "-c".into(),
                        "printf '%s' \"$OPENFORGE_AGENT_CONFIG\" > config-path.tmp && mv config-path.tmp config-path; exec sleep 120"
                            .into(),
                    ],
                    cwd: fixture.0.path().into(),
                    env: Default::default(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
        )
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let path = loop {
        if let Ok(path) = std::fs::read_to_string(fixture.0.path().join("config-path")) {
            assert!(
                !path.is_empty(),
                "daemon must supply stable private agent configuration"
            );
            break path;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    };
    let config = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    (session, config)
}

fn request(config: &serde_json::Value, path: &str) -> String {
    let mut stream =
        std::net::TcpStream::connect(("127.0.0.1", config["port"].as_u64().unwrap() as u16))
            .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n", config["token"].as_str().unwrap()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

fn sidecar(body: &'static str) -> (SidecarEndpoint, std::thread::JoinHandle<()>) {
    sidecar_response("200 OK", body)
}

fn sidecar_response(
    status: &'static str,
    body: &'static str,
) -> (SidecarEndpoint, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = SidecarEndpoint {
        port: listener.local_addr().unwrap().port(),
        token: "private-sidecar-token".into(),
    };
    listener.set_nonblocking(true).unwrap();
    let thread = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "gateway did not forward"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0; 8192];
        let count = stream.read(&mut bytes).unwrap();
        let headers = String::from_utf8_lossy(&bytes[..count]).to_ascii_lowercase();
        assert!(headers.contains("authorization: bearer private-sidecar-token"));
        assert!(headers.contains("x-openforge-agent-task: t-fixture"));
        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    (endpoint, thread)
}

#[test]
fn launched_agent_configuration_survives_sidecar_replacement_without_replay() {
    let fixture = Fixture::new();
    let first = fixture.connect();
    let (session, config) = agent_config(&fixture, &first);
    let (endpoint, served) = sidecar("{\"version\":1}");
    first.register_sidecar(Some(endpoint)).unwrap();
    assert!(request(&config, "/projects").contains("{\"version\":1}"));
    served.join().unwrap();
    let second = fixture.connect();
    let unavailable = request(&config, "/projects");
    assert!(unavailable.contains("notExecuted"));
    assert!(unavailable.contains("retry"));
    let (endpoint, served) = sidecar("{\"version\":2}");
    second.register_sidecar(Some(endpoint)).unwrap();
    assert!(request(&config, "/projects").contains("{\"version\":2}"));
    served.join().unwrap();
    assert_eq!(second.inventory().unwrap().sessions[0].pty, session.pty);
    let log = std::fs::read_to_string(fixture.0.path().join("session-v1/daemon.log")).unwrap();
    assert!(!log.contains(config["token"].as_str().unwrap()));
    let replay = second.recover(&session.pty).unwrap();
    assert!(!String::from_utf8_lossy(&replay.compatibility_replay)
        .contains(config["token"].as_str().unwrap()));
}

fn raw_request(
    config: &serde_json::Value,
    method: &str,
    path: &str,
    extra: &str,
    body: &str,
) -> String {
    let mut stream =
        std::net::TcpStream::connect(("127.0.0.1", config["port"].as_u64().unwrap() as u16))
            .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", config["token"].as_str().unwrap(), body.len()).unwrap();
    let mut result = String::new();
    stream.read_to_string(&mut result).unwrap();
    result
}

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
                Ok((stream, _)) => break stream,
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

#[test]
fn ingress_rejects_forgery_stale_credentials_foreign_installations_and_invalid_requests() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (session, config) = agent_config(&fixture, &client);
    client
        .register_sidecar(Some(SidecarEndpoint {
            port: 1,
            token: "private-sidecar-token".into(),
        }))
        .unwrap();
    for (method, path, headers, body, status) in [
        ("GET", "/app/invoke", "", String::new(), "403"),
        ("POST", "/hooks/agent-lifecycle", "", "{}".into(), "403"),
        (
            "GET",
            "/projects",
            "x-openforge-agent-task: forged\r\n",
            String::new(),
            "403",
        ),
        ("POST", "/create_task", "", "not-json".into(), "400"),
        ("POST", "/create_task", "", "x".repeat(65537), "413"),
        (
            "GET",
            "/projects",
            "Authorization: Bearer duplicate\r\n",
            String::new(),
            "401",
        ),
    ] {
        let response = raw_request(&config, method, path, headers, &body);
        assert!(
            response.starts_with(&format!("HTTP/1.1 {status}")),
            "{response}"
        );
        assert!(response.contains("notExecuted"));
    }
    let mut forged = config.clone();
    forged["token"] = serde_json::json!("stale");
    assert!(request(&forged, "/projects").starts_with("HTTP/1.1 401"));
    let foreign = Fixture::new();
    let foreign_client = foreign.connect();
    let (_, foreign_config) = agent_config(&foreign, &foreign_client);
    forged["token"] = foreign_config["token"].clone();
    assert!(request(&forged, "/projects").starts_with("HTTP/1.1 401"));
    let runtime =
        openforge_session_client::runtime::RuntimeDirectory::open(fixture.0.path()).unwrap();
    forged["token"] = serde_json::json!(runtime.credentials().token);
    assert!(request(&forged, "/projects").starts_with("HTTP/1.1 401"));
    client.terminate("stop-agent", &session.pty).unwrap();
    assert!(request(&config, "/projects").starts_with("HTTP/1.1 401"));
}

#[test]
fn forwarded_mutation_with_dropped_reply_is_unknown_and_never_replayed() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    client
        .register_sidecar(Some(SidecarEndpoint {
            port: listener.local_addr().unwrap().port(),
            token: "private-sidecar-token".into(),
        }))
        .unwrap();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0; 8192];
        assert!(stream.read(&mut bytes).unwrap() > 0);
        drop(stream);
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert!(listener.accept().is_err(), "mutation was replayed");
    });
    let response = raw_request(&config, "POST", "/create_task", "", "{}");
    assert!(response.contains("\"outcome\":\"unknown\""), "{response}");
    assert!(!response.contains("notExecuted"));
    assert!(response.contains("do not automatically retry"));
    thread.join().unwrap();
}

#[test]
fn diagnostics_never_return_transport_credentials() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    let (endpoint, thread) = sidecar("{\"diagnostic\":\"private-sidecar-token\"}");
    client.register_sidecar(Some(endpoint)).unwrap();
    let response = request(&config, "/debug/process-memory");
    assert!(!response.contains("private-sidecar-token"));
    thread.join().unwrap();
}

#[test]
fn connection_capacity_rejects_without_queueing_work() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    let held: Vec<_> = (0..32)
        .map(|_| {
            std::net::TcpStream::connect(("127.0.0.1", config["port"].as_u64().unwrap() as u16))
                .unwrap()
        })
        .collect();
    let response = request(&config, "/projects");
    assert!(response.starts_with("HTTP/1.1 503"));
    assert!(response.contains("notExecuted"));
    assert!(response.contains("retry"));
    drop(held);
}

#[test]
fn http_parser_rejections_explicitly_report_not_executed() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    // A listening endpoint proves malformed requests never reach the domain server.
    let sidecar = TcpListener::bind("127.0.0.1:0").unwrap();
    sidecar.set_nonblocking(true).unwrap();
    client
        .register_sidecar(Some(SidecarEndpoint {
            port: sidecar.local_addr().unwrap().port(),
            token: "private-sidecar-token".into(),
        }))
        .unwrap();
    for (headers, expected_status) in [
        (format!("X-Oversized: {}\r\n", "x".repeat(17_000)), "431"),
        ("Content-Length: invalid\r\n".into(), "400"),
        ("Content-Length: 1\r\nContent-Length: 2\r\n".into(), "400"),
    ] {
        let mut stream =
            std::net::TcpStream::connect(("127.0.0.1", config["port"].as_u64().unwrap() as u16))
                .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream, "POST /create_task HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\n{headers}Connection: close\r\n\r\n", config["token"].as_str().unwrap()).unwrap();
        let mut bytes = Vec::new();
        // Some platforms reset after rejecting unread input. Retain and inspect the reply.
        if let Err(error) = stream.read_to_end(&mut bytes) {
            assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
        }
        let response = String::from_utf8(bytes).unwrap();
        assert!(
            response.starts_with(&format!("HTTP/1.1 {expected_status}")),
            "{response}"
        );
        let (_, body) = response
            .split_once("\r\n\r\n")
            .expect("HTTP response headers");
        let body: serde_json::Value =
            serde_json::from_str(body).expect("explicit gateway failure envelope");
        assert_eq!(body["outcome"], "notExecuted");
        assert!(body["retry"]
            .as_str()
            .is_some_and(|text| text.contains("retry")));
        assert!(
            sidecar.accept().is_err(),
            "malformed request reached the Sidecar"
        );
    }
}

#[test]
fn forwarded_sidecar_errors_are_not_reclassified_as_parser_rejections() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    let (endpoint, served) = sidecar_response(
        "400 Bad Request",
        "{\"error\":\"domain rejected after processing\"}",
    );
    client.register_sidecar(Some(endpoint)).unwrap();
    let response = raw_request(&config, "POST", "/create_task", "", "{}");
    assert!(response.starts_with("HTTP/1.1 400"));
    assert_eq!(
        response.split_once("\r\n\r\n").unwrap().1,
        "{\"error\":\"domain rejected after processing\"}"
    );
    assert!(!response.contains("notExecuted"));
    served.join().unwrap();
}

#[test]
fn incomplete_headers_time_out_with_not_executed_guidance() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (_, config) = agent_config(&fixture, &client);
    let mut stream =
        std::net::TcpStream::connect(("127.0.0.1", config["port"].as_u64().unwrap() as u16))
            .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(b"POST /create_task HTTP/1.1\r\n").unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 408"), "{response}");
    assert!(response.contains("notExecuted"));
    assert!(response.contains("retry"));
}
