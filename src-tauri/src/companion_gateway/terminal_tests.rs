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
