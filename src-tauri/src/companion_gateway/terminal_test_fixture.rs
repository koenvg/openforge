use super::{
    action_palette::UnavailableCompanionActionPaletteService,
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router, create_router_with_sources_event_access_and_pty, CompanionAuthorizer,
        CompanionErrorCode, CompanionHostStatus, CompanionRouterSources, PROTOCOL_VERSION,
        PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    live_events::{CompanionStreamAccess, CompanionStreamTermination},
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    project_board::UnavailableCompanionProjectBoardSource,
    task_actions::UnavailableCompanionTaskActionService,
    task_creation::UnavailableCompanionTaskCreator,
    task_detail::{CompanionTaskDetailSource, UnavailableCompanionTaskDetailSource},
    task_start::UnavailableCompanionTaskStarter,
};
use axum::{http::Request, Router};
use futures::{SinkExt, StreamExt};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};

const TEST_HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";
const TEST_TASK_ID: &str = "KVG-3018";
const TEST_BEARER_CREDENTIAL: &str = "Bearer paired-device-credential";
const FRAME_WAIT: Duration = Duration::from_secs(5);
const SERVER_SHUTDOWN_WAIT: Duration = Duration::from_secs(1);

pub(super) type TestTerminalSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

pub(super) fn pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
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
            .is_some_and(|value| value == TEST_BEARER_CREDENTIAL);
        if !authorized {
            return Err(CompanionErrorCode::Unauthenticated);
        }
        Ok(CompanionAuthenticatedDevice {
            device_id: "device-a".to_string(),
        })
    }
}

#[derive(Default)]
pub(super) struct CancellationAccess {
    sender: std::sync::Mutex<Option<mpsc::UnboundedSender<CompanionStreamTermination>>>,
}

impl CancellationAccess {
    pub(super) fn cancel(&self, termination: CompanionStreamTermination) {
        self.sender
            .lock()
            .expect("cancellation sender lock")
            .as_ref()
            .expect("open terminal stream")
            .send(termination)
            .expect("terminal cancellation");
    }

    pub(super) fn current_sender(
        &self,
    ) -> Option<mpsc::UnboundedSender<CompanionStreamTermination>> {
        self.sender
            .lock()
            .expect("cancellation sender lock")
            .clone()
    }
}

impl CompanionStreamAccess for CancellationAccess {
    fn open(
        &self,
        _headers: &axum::http::HeaderMap,
    ) -> Result<mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode> {
        let (sender, receiver) = mpsc::unbounded_channel();
        *self.sender.lock().expect("cancellation sender lock") = Some(sender);
        Ok(receiver)
    }

    fn gateway_closing(&self) {}
}

pub(super) struct AuthenticatedTerminalServer {
    address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl AuthenticatedTerminalServer {
    pub(super) async fn start() -> Self {
        let router = create_router(
            CompanionHostStatus::new(TEST_HOST_ID.to_string()),
            Arc::new(BearerAuthorizer),
            pairing(),
        );
        Self::start_router(router).await
    }

    pub(super) async fn start_with_pty(
        pty_manager: crate::pty_manager::PtyManager,
        stream_access: Arc<dyn CompanionStreamAccess>,
    ) -> Self {
        Self::start_with_pty_and_detail(
            pty_manager,
            stream_access,
            Arc::new(UnavailableCompanionTaskDetailSource),
        )
        .await
    }

    pub(super) async fn start_with_pty_and_detail(
        pty_manager: crate::pty_manager::PtyManager,
        stream_access: Arc<dyn CompanionStreamAccess>,
        detail: Arc<dyn CompanionTaskDetailSource>,
    ) -> Self {
        let router = create_router_with_sources_event_access_and_pty(
            CompanionHostStatus::new(TEST_HOST_ID.to_string()),
            Arc::new(BearerAuthorizer),
            pairing(),
            CompanionRouterSources {
                attention: Arc::new(UnavailableCompanionAttentionSource),
                project_board: Arc::new(UnavailableCompanionProjectBoardSource),
                task_detail: detail,
                task_actions: Arc::new(UnavailableCompanionTaskActionService),
                action_palette: Arc::new(UnavailableCompanionActionPaletteService),
                task_creator: Arc::new(UnavailableCompanionTaskCreator),
                task_start: Arc::new(UnavailableCompanionTaskStarter),
                pty_manager,
                events: crate::app_events::AppEventBus::new(16, 8),
                stream_access,
            },
        );
        Self::start_router(router).await
    }

    async fn start_router(router: Router) -> Self {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("test listener");
        let address = listener.local_addr().expect("listener address");
        let (shutdown, receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = receiver.await;
                })
                .await
                .expect("test server");
        });
        Self {
            address,
            shutdown: Some(shutdown),
            task: Some(task),
        }
    }

    pub(super) async fn connect(&self) -> TestTerminalSocket {
        self.connect_task(TEST_TASK_ID).await
    }

    pub(super) async fn connect_task(&self, task_id: &str) -> TestTerminalSocket {
        tokio_tungstenite::connect_async(self.request(task_id, false))
            .await
            .expect("WebSocket upgrade")
            .0
    }

    pub(super) async fn connect_task_with_agent_output(&self, task_id: &str) -> TestTerminalSocket {
        tokio_tungstenite::connect_async(self.request(task_id, true))
            .await
            .expect("opted-in WebSocket upgrade")
            .0
    }

    fn request(&self, task_id: &str, include_agent_output: bool) -> Request<()> {
        let mut request = format!(
            "ws://{}/companion/v1/tasks/{task_id}/agent-terminal{}",
            self.address,
            if include_agent_output {
                "?includeAgentOutput=true"
            } else {
                ""
            },
        )
        .into_client_request()
        .expect("WebSocket request");
        request.headers_mut().insert(
            axum::http::header::AUTHORIZATION,
            TEST_BEARER_CREDENTIAL.parse().expect("authorization"),
        );
        request.headers_mut().insert(
            PROTOCOL_VERSION_HEADER,
            PROTOCOL_VERSION
                .to_string()
                .parse()
                .expect("protocol version"),
        );
        request
    }

    pub(super) async fn shutdown(mut self) {
        self.signal_shutdown();
        let mut task = self.task.take().expect("running test server");
        match tokio::time::timeout(SERVER_SHUTDOWN_WAIT, &mut task).await {
            Ok(result) => result.expect("test server task"),
            Err(_) => {
                task.abort();
                let _ = task.await;
            }
        }
    }

    fn signal_shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

impl Drop for AuthenticatedTerminalServer {
    fn drop(&mut self) {
        self.signal_shutdown();
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

pub(super) async fn send_attach(socket: &mut TestTerminalSocket) {
    socket
        .send(Message::Text(
            r#"{"type":"attach","columns":80,"rows":24}"#.to_string(),
        ))
        .await
        .expect("attach control");
}

pub(super) async fn attach_and_wait_until_ready(socket: &mut TestTerminalSocket) {
    send_attach(socket).await;
    tokio::time::timeout(FRAME_WAIT, async {
        loop {
            let frame = socket
                .next()
                .await
                .expect("ready response")
                .expect("ready frame");
            if let Message::Text(control) = frame {
                let control: serde_json::Value =
                    serde_json::from_str(&control).expect("control JSON");
                if control["type"] == "ready" {
                    return;
                }
            }
        }
    })
    .await
    .expect("ready deadline");
}

pub(super) async fn next_frame(socket: &mut TestTerminalSocket, context: &str) -> Message {
    match tokio::time::timeout(FRAME_WAIT, socket.next()).await {
        Err(_) => panic!("{context} deadline"),
        Ok(None) => panic!("{context}: socket closed"),
        Ok(Some(Err(error))) => panic!("{context}: {error}"),
        Ok(Some(Ok(frame))) => frame,
    }
}
