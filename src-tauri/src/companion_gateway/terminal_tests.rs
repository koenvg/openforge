use super::{
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router, create_router_with_sources_event_access_and_pty, AllowAllAuthorizer,
        CompanionAuthorizer, CompanionErrorCode, CompanionHostStatus, CompanionRouterSources,
        PairingUnavailableAuthorizer, PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    live_events::{CompanionStreamAccess, CompanionStreamTermination},
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    task_detail::UnavailableCompanionTaskDetailSource,
};
use axum::{body::Body, http::Request};
use futures::{SinkExt, StreamExt};
use std::sync::Mutex as StdMutex;
use std::{sync::Arc, time::Duration};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use tower::ServiceExt;

fn pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
}

fn upgrade_request(protocol_version: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .uri("/companion/v1/tasks/KVG-3018/agent-terminal")
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==");
    if let Some(version) = protocol_version {
        request = request.header(PROTOCOL_VERSION_HEADER, version);
    }
    request.body(Body::empty()).expect("upgrade request")
}

type TestTerminalSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_terminal(address: std::net::SocketAddr) -> TestTerminalSocket {
    let mut request = format!("ws://{address}/companion/v1/tasks/KVG-3018/agent-terminal")
        .into_client_request()
        .expect("WebSocket request");
    request.headers_mut().insert(
        axum::http::header::AUTHORIZATION,
        "Bearer paired-device-credential"
            .parse()
            .expect("authorization"),
    );
    request.headers_mut().insert(
        PROTOCOL_VERSION_HEADER,
        "1".parse().expect("protocol version"),
    );
    tokio_tungstenite::connect_async(request)
        .await
        .expect("WebSocket upgrade")
        .0
}

async fn attach_and_wait_until_ready(socket: &mut TestTerminalSocket) {
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");
    loop {
        let frame = socket
            .next()
            .await
            .expect("ready response")
            .expect("ready frame");
        if let Message::Text(control) = frame {
            let control: serde_json::Value = serde_json::from_str(&control).expect("control JSON");
            if control["type"] == "ready" {
                return;
            }
        }
    }
}

#[tokio::test]
async fn agent_terminal_upgrade_requires_device_authorization_and_protocol_version() {
    let unauthorized = create_router(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        pairing(),
    )
    .oneshot(upgrade_request(Some("1")))
    .await
    .expect("unauthorized response");
    assert_eq!(unauthorized.status(), axum::http::StatusCode::UNAUTHORIZED);

    let incompatible = create_router(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing(),
    )
    .oneshot(upgrade_request(None))
    .await
    .expect("incompatible response");
    assert_eq!(incompatible.status(), axum::http::StatusCode::CONFLICT);

    let accepted = create_router(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing(),
    )
    .oneshot(upgrade_request(Some("1")))
    .await
    .expect("upgrade response");
    // tower::oneshot has no hyper OnUpgrade extension; reaching 426 proves
    // authorization and protocol validation passed before transport extraction.
    assert_eq!(accepted.status(), axum::http::StatusCode::UPGRADE_REQUIRED);
}

#[derive(Debug)]
struct BearerAuthorizer;

impl CompanionAuthorizer for BearerAuthorizer {
    fn authorize(
        &self,
        headers: &axum::http::HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        let authorized = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == "Bearer paired-device-credential");
        if !authorized {
            return Err(CompanionErrorCode::Unauthenticated);
        }
        Ok(CompanionAuthenticatedDevice {
            device_id: "device-a".to_string(),
        })
    }
}

#[derive(Default)]
struct CancellationAccess {
    sender: StdMutex<Option<tokio::sync::mpsc::UnboundedSender<CompanionStreamTermination>>>,
}

impl CancellationAccess {
    fn cancel(&self, termination: CompanionStreamTermination) {
        self.sender
            .lock()
            .expect("cancellation sender lock")
            .as_ref()
            .expect("open terminal stream")
            .send(termination)
            .expect("terminal cancellation");
    }
}

impl CompanionStreamAccess for CancellationAccess {
    fn open(
        &self,
        _headers: &axum::http::HeaderMap,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode>
    {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        *self.sender.lock().expect("cancellation sender lock") = Some(sender);
        Ok(receiver)
    }

    fn gateway_closing(&self) {}
}

#[tokio::test]
async fn authenticated_websocket_revalidates_no_active_agent_terminal() {
    let router = create_router(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("test server");
    });
    let mut request = format!("ws://{address}/companion/v1/tasks/KVG-3018/agent-terminal")
        .into_client_request()
        .expect("WebSocket request");
    request.headers_mut().insert(
        axum::http::header::AUTHORIZATION,
        "Bearer paired-device-credential"
            .parse()
            .expect("authorization"),
    );
    request.headers_mut().insert(
        PROTOCOL_VERSION_HEADER,
        "1".parse().expect("protocol version"),
    );

    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("WebSocket upgrade");
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");
    let response = socket
        .next()
        .await
        .expect("terminal response")
        .expect("terminal frame");
    let Message::Text(response) = response else {
        panic!("expected terminal control");
    };
    let response: serde_json::Value = serde_json::from_str(&response).expect("control JSON");
    assert_eq!(response["type"], "error");
    assert_eq!(response["code"], "no_active_agent_terminal");
    assert!(!response.to_string().contains("instance"));

    server.abort();
}

#[tokio::test]
async fn terminal_websocket_rejects_oversized_text_and_binary_frames() {
    let router = create_router(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("test server");
    });

    for oversized in [
        Message::Text("x".repeat(4_097)),
        Message::Binary(vec![0; 4_097]),
    ] {
        let mut request = format!("ws://{address}/companion/v1/tasks/KVG-3018/agent-terminal")
            .into_client_request()
            .expect("WebSocket request");
        request.headers_mut().insert(
            axum::http::header::AUTHORIZATION,
            "Bearer paired-device-credential"
                .parse()
                .expect("authorization"),
        );
        request.headers_mut().insert(
            PROTOCOL_VERSION_HEADER,
            "1".parse().expect("protocol version"),
        );
        let (mut socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("WebSocket upgrade");
        socket.send(oversized).await.expect("oversized frame send");
        let result = tokio::time::timeout(Duration::from_secs(1), socket.next())
            .await
            .expect("oversized frame response");
        assert!(
            matches!(result, None | Some(Err(_)) | Some(Ok(Message::Close(_)))),
            "oversized input must close the socket, got {result:?}"
        );
    }

    server.abort();
}

#[tokio::test]
async fn terminal_websocket_gates_and_validates_binary_utf8_input() {
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    pty_manager.set_pid_dir(temp_dir.path().to_path_buf());
    pty_manager
        .spawn_companion_test_agent_pty(
            "KVG-3018",
            temp_dir.path(),
            r#"stty -echo; IFS= read -r line; printf 'received:%s' "$line"; sleep 5"#,
        )
        .await
        .expect("test Agent PTY");
    let access = Arc::new(CancellationAccess::default());
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            pty_manager: pty_manager.clone(),
            events: crate::app_events::AppEventBus::new(16, 8),
            stream_access: access,
        },
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("test server");
    });

    for pre_ready in [
        Message::Binary(b"early".to_vec()),
        Message::Text(r#"{"type":"resize","columns":100,"rows":30}"#.to_string()),
    ] {
        let mut early = connect_terminal(address).await;
        early
            .feed(Message::Text(
                r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
            ))
            .await
            .expect("queued attach control");
        early.feed(pre_ready).await.expect("queued pre-ready frame");
        early.flush().await.expect("flush pre-ready frames");
        let early_error = early
            .next()
            .await
            .expect("early response")
            .expect("early control");
        assert!(
            matches!(early_error, Message::Text(control) if control.contains("protocol_error")),
            "pre-ready frame must be rejected"
        );
    }

    let mut malformed = connect_terminal(address).await;
    attach_and_wait_until_ready(&mut malformed).await;
    malformed
        .send(Message::Binary(vec![0xff]))
        .await
        .expect("malformed binary frame");
    let malformed_error = malformed
        .next()
        .await
        .expect("malformed response")
        .expect("malformed control");
    assert!(
        matches!(malformed_error, Message::Text(control) if control.contains("protocol_error"))
    );

    let mut interactive = connect_terminal(address).await;
    attach_and_wait_until_ready(&mut interactive).await;
    interactive
        .send(Message::Binary("héllo\n".as_bytes().to_vec()))
        .await
        .expect("valid UTF-8 terminal input");
    let mut output = String::new();
    while !output.contains("received:héllo") {
        let frame = tokio::time::timeout(Duration::from_secs(2), interactive.next())
            .await
            .expect("terminal input response timeout")
            .expect("terminal input response")
            .expect("terminal input frame");
        if let Message::Binary(bytes) = frame {
            output.push_str(std::str::from_utf8(&bytes).expect("valid terminal output"));
        }
    }

    server.abort();
    pty_manager.kill_pty("KVG-3018").await.expect("PTY cleanup");
}

#[tokio::test]
async fn revocation_after_ready_prevents_further_terminal_input() {
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    pty_manager.set_pid_dir(temp_dir.path().to_path_buf());
    pty_manager
        .spawn_companion_test_agent_pty(
            "KVG-3018",
            temp_dir.path(),
            r#"stty -echo; IFS= read -r line; printf 'received:%s' "$line"; sleep 5"#,
        )
        .await
        .expect("test Agent PTY");
    let access = Arc::new(CancellationAccess::default());
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            pty_manager: pty_manager.clone(),
            events: crate::app_events::AppEventBus::new(16, 8),
            stream_access: access.clone(),
        },
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("test server");
    });
    let mut socket = connect_terminal(address).await;
    attach_and_wait_until_ready(&mut socket).await;

    access.cancel(CompanionStreamTermination::AuthorizationRevoked);
    socket
        .send(Message::Binary(b"must-not-cross\n".to_vec()))
        .await
        .expect("post-revocation input frame");
    let response = socket
        .next()
        .await
        .expect("revocation response")
        .expect("revocation control");
    assert!(matches!(
        response,
        Message::Text(control) if control.contains("authorization_revoked")
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let attachment = pty_manager
        .attach_agent_terminal("KVG-3018")
        .await
        .expect("active Agent terminal");
    assert!(
        !attachment
            .replay()
            .windows(b"must-not-cross".len())
            .any(|window| window == b"must-not-cross"),
        "revoked input reached the Agent PTY"
    );

    server.abort();
    pty_manager.kill_pty("KVG-3018").await.expect("PTY cleanup");
}

#[tokio::test]
async fn revocation_before_attach_cannot_receive_active_terminal_replay() {
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    pty_manager.set_pid_dir(temp_dir.path().to_path_buf());
    pty_manager
        .spawn_companion_test_agent_pty(
            "KVG-3018",
            temp_dir.path(),
            "printf sensitive-replay; sleep 5",
        )
        .await
        .expect("test Agent PTY");
    loop {
        let attachment = pty_manager
            .attach_agent_terminal("KVG-3018")
            .await
            .expect("active Agent terminal");
        if attachment.replay() == b"sensitive-replay" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let access = Arc::new(CancellationAccess::default());
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            pty_manager: pty_manager.clone(),
            events: crate::app_events::AppEventBus::new(16, 8),
            stream_access: access.clone(),
        },
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("test server");
    });
    let mut request = format!("ws://{address}/companion/v1/tasks/KVG-3018/agent-terminal")
        .into_client_request()
        .expect("WebSocket request");
    request.headers_mut().insert(
        axum::http::header::AUTHORIZATION,
        "Bearer paired-device-credential"
            .parse()
            .expect("authorization"),
    );
    request.headers_mut().insert(
        PROTOCOL_VERSION_HEADER,
        "1".parse().expect("protocol version"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("WebSocket upgrade");

    access.cancel(CompanionStreamTermination::AuthorizationRevoked);
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");
    let response = socket
        .next()
        .await
        .expect("revocation response")
        .expect("revocation frame");
    let Message::Text(response) = response else {
        panic!("terminal replay crossed a revoked channel");
    };
    let response: serde_json::Value = serde_json::from_str(&response).expect("control JSON");
    assert_eq!(response["type"], "authorization_revoked");
    while let Ok(Some(Ok(frame))) =
        tokio::time::timeout(Duration::from_millis(100), socket.next()).await
    {
        assert!(!matches!(frame, Message::Binary(_)));
        if matches!(frame, Message::Close(_)) {
            break;
        }
    }

    server.abort();
    pty_manager.kill_pty("KVG-3018").await.expect("PTY cleanup");
}

fn authenticated_terminal_request(address: std::net::SocketAddr) -> axum::http::Request<()> {
    let mut request = format!("ws://{address}/companion/v1/tasks/KVG-3018/agent-terminal")
        .into_client_request()
        .expect("WebSocket request");
    request.headers_mut().insert(
        axum::http::header::AUTHORIZATION,
        "Bearer paired-device-credential"
            .parse()
            .expect("authorization"),
    );
    request.headers_mut().insert(
        PROTOCOL_VERSION_HEADER,
        "1".parse().expect("protocol version"),
    );
    request
}

fn terminal_router(pty_manager: crate::pty_manager::PtyManager) -> axum::Router {
    create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        Arc::new(BearerAuthorizer),
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            pty_manager,
            events: crate::app_events::AppEventBus::new(16, 8),
            stream_access: Arc::new(CancellationAccess::default()),
        },
    )
}

#[tokio::test]
async fn terminal_websocket_sanitizes_replay_and_live_images_before_binary_frames() {
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    pty_manager.set_pid_dir(temp_dir.path().to_path_buf());
    pty_manager
        .spawn_companion_test_agent_pty(
            "KVG-3018",
            temp_dir.path(),
            "printf 'replay-before\\033]1337;File=size=12;inline=1:REPLAY_SECRET\\007replay-after'; sleep 2; printf 'live-before\\033]1337;File=size=10;inline=1:LIVE_SECRET\\007live-after'; sleep 5",
        )
        .await
        .expect("test Agent PTY");

    let replay_expected = b"replay-before\r\n[Image unavailable on mobile]\r\nreplay-after";
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let attachment = pty_manager
                .attach_agent_terminal("KVG-3018")
                .await
                .expect("active Agent terminal");
            if attachment.replay() == replay_expected {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("sanitized replay");

    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let cleanup_manager = pty_manager.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, terminal_router(pty_manager))
            .await
            .expect("test server");
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(authenticated_terminal_request(address))
        .await
        .expect("WebSocket upgrade");
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");

    let mut output = Vec::new();
    let mut ready = false;
    tokio::time::timeout(Duration::from_secs(4), async {
        loop {
            let frame = socket
                .next()
                .await
                .expect("terminal frame")
                .expect("valid terminal frame");
            match frame {
                Message::Binary(bytes) => {
                    std::str::from_utf8(&bytes).expect("UTF-8 terminal frame");
                    output.extend_from_slice(&bytes);
                }
                Message::Text(control) => {
                    let control: serde_json::Value =
                        serde_json::from_str(&control).expect("control JSON");
                    if control["type"] == "ready" {
                        ready = true;
                    }
                }
                _ => {}
            }
            if ready && output.ends_with(b"live-after") {
                break;
            }
        }
    })
    .await
    .expect("sanitized live output");

    let output = std::str::from_utf8(&output).expect("UTF-8 collected output");
    assert_eq!(
        output,
        "replay-before\r\n[Image unavailable on mobile]\r\nreplay-afterlive-before\r\n[Image unavailable on mobile]\r\nlive-after"
    );
    assert!(!output.contains("REPLAY_SECRET"));
    assert!(!output.contains("LIVE_SECRET"));

    server.abort();
    cleanup_manager
        .kill_pty("KVG-3018")
        .await
        .expect("PTY cleanup");
}

#[tokio::test]
async fn terminal_websocket_rejects_malformed_pty_utf8_with_safe_protocol_error() {
    let mut pty_manager = crate::pty_manager::PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    pty_manager.set_pid_dir(temp_dir.path().to_path_buf());
    pty_manager
        .spawn_companion_test_agent_pty(
            "KVG-3018",
            temp_dir.path(),
            "printf 'safe-replay'; printf '\\377'; sleep 5",
        )
        .await
        .expect("test Agent PTY");

    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let attachment = pty_manager
                .attach_agent_terminal("KVG-3018")
                .await
                .expect("active Agent terminal");
            if attachment.has_protocol_error() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("malformed output failure");

    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("test listener");
    let address = listener.local_addr().expect("listener address");
    let cleanup_manager = pty_manager.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, terminal_router(pty_manager))
            .await
            .expect("test server");
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(authenticated_terminal_request(address))
        .await
        .expect("WebSocket upgrade");
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");

    let mut saw_ready = false;
    let error = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let frame = socket
                .next()
                .await
                .expect("terminal frame")
                .expect("valid terminal frame");
            match frame {
                Message::Binary(bytes) => {
                    panic!(
                        "failed attachment sent {} replay bytes before its error",
                        bytes.len()
                    );
                }
                Message::Text(control) => {
                    let control: serde_json::Value =
                        serde_json::from_str(&control).expect("control JSON");
                    if control["type"] == "ready" {
                        saw_ready = true;
                    } else if control["type"] == "error" {
                        break control;
                    }
                }
                _ => {}
            }
        }
    })
    .await
    .expect("safe protocol error");

    assert!(
        !saw_ready,
        "failed attachments must not advertise readiness"
    );
    assert_eq!(error["code"], "protocol_error");
    assert_eq!(error["message"], "Invalid terminal protocol frame");
    assert!(!error.to_string().contains("377"));
    assert!(!error.to_string().contains("safe-replay"));

    server.abort();
    cleanup_manager
        .kill_pty("KVG-3018")
        .await
        .expect("PTY cleanup");
}
