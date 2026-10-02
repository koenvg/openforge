use crate::support::{agent_config, raw_request, request, sidecar, sidecar_response, Fixture};
use openforge_session_protocol::{Error, SidecarEndpoint};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

#[test]
fn scoped_agent_keeps_its_scope_bound_config_instead_of_receiving_task_credentials() {
    use openforge_session_host::{PreparedCommand, TerminalOwner};
    let fixture = Fixture::new();
    let client = fixture.connect();
    let session = client.spawn("scoped-config", &openforge_session_protocol::ShellCommand {
        owner: TerminalOwner::Agent { task_id: format!("scoped-agent-v1-{}", "a".repeat(64)) },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf '%s\\n' \"$OPENFORGE_AGENT_CONFIG\" \"$OPENFORGE_PTY_INSTANCE_ID\" \"${OPENFORGE_BACKEND_TOKEN-unset}\" > receipt.tmp; mv receipt.tmp receipt; exec sleep 120".into()],
            cwd: fixture.0.path().into(),
            env: [("OPENFORGE_AGENT_CONFIG".into(), "/scoped/session.json".into()), ("OPENFORGE_BACKEND_TOKEN".into(), "controller-secret".into())].into(),
        },
        columns: 80, rows: 24, image_protocol: None,
    }).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let receipt = loop {
        if let Ok(receipt) = std::fs::read_to_string(fixture.0.path().join("receipt")) {
            break receipt;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(
        receipt,
        format!(
            "/scoped/session.json\n{}\nunset\n",
            session.pty.instance.value()
        )
    );
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

#[test]
fn mock_sidecar_waits_for_delayed_fragmented_request_headers() {
    let (endpoint, served) = sidecar("{\"ok\":true}");
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", endpoint.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    // Accept must be safe before the sender supplies any bytes, including on macOS
    // where an accepted socket can inherit the listener's nonblocking mode.
    std::thread::sleep(Duration::from_millis(100));
    for part in [
        "GET /projects HTTP/1.1\r\nHost: 127.0.0.1\r\n",
        "Authorization: Bearer private-sidecar-token\r\n",
        "X-OpenForge-Agent-Task: T-fixture\r\nConnection: close\r\n\r\n",
    ] {
        stream.write_all(part.as_bytes()).unwrap();
        std::thread::sleep(Duration::from_millis(25));
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    served.join().unwrap();
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(response.ends_with("{\"ok\":true}"));
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

#[test]
fn authenticated_agent_can_forward_single_dependency_removal() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let (session, config) = agent_config(&fixture, &client);
    let (endpoint, served) = sidecar("{\"task_id\":\"KVG-5232\",\"status\":\"updated\"}");
    client.register_sidecar(Some(endpoint)).unwrap();
    let response = raw_request(
        &config,
        "POST",
        "/remove_task_dependency",
        "Content-Type: application/json\r\n",
        "{\"task_id\":\"KVG-5232\",\"depends_on\":\"KVG-5266\"}",
    );
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    let body: serde_json::Value =
        serde_json::from_str(response.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"task_id": "KVG-5232", "status": "updated"})
    );
    served.join().unwrap();
    client.terminate("cleanup", &session.pty).unwrap();
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
