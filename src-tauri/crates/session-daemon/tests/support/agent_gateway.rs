use openforge_session_client::Client;
use openforge_session_protocol::SidecarEndpoint;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

const DAEMON_STARTUP_WAIT: Duration = if cfg!(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
)) {
    Duration::from_secs(25) // 5s readiness plus the bounded 20s loader startup
} else {
    Duration::from_secs(5)
};
pub(super) struct Fixture(pub(super) tempfile::TempDir);
impl Fixture {
    pub(super) fn new() -> Self {
        Self(
            tempfile::Builder::new()
                .prefix("of-agent-")
                .tempdir_in("/tmp")
                .unwrap(),
        )
    }
    pub(super) fn connect(&self) -> Client {
        Client::launch_with_timeout(
            std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            self.0.path(),
            DAEMON_STARTUP_WAIT,
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

pub(super) fn agent_config(
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

pub(super) fn request(config: &serde_json::Value, path: &str) -> String {
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

pub(super) fn sidecar(body: &'static str) -> (SidecarEndpoint, std::thread::JoinHandle<()>) {
    sidecar_response("200 OK", body)
}

pub(super) fn sidecar_response(
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
        // macOS accepts this socket with the listener's O_NONBLOCK flag still set.
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            let mut chunk = [0; 1024];
            let count = stream.read(&mut chunk).unwrap();
            assert!(count > 0, "mock Sidecar request ended before its headers");
            bytes.extend_from_slice(&chunk[..count]);
            assert!(
                bytes.len() <= 8192,
                "mock Sidecar headers exceed fixture limit"
            );
        }
        let headers = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        assert!(headers.contains("authorization: bearer private-sidecar-token"));
        assert!(headers.contains("x-openforge-agent-task: t-fixture"));
        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    (endpoint, thread)
}

pub(super) fn raw_request(
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
