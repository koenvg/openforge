use crate::support::{agent_config, raw_request, request, Fixture};
use openforge_session_protocol::SidecarEndpoint;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

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
        (
            "POST",
            "/remove_task_dependency",
            "x-openforge-agent-task: forged\r\n",
            "{}".into(),
            "403",
        ),
        ("GET", "/remove_task_dependency", "", String::new(), "403"),
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
