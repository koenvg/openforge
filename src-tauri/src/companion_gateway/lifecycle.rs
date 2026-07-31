use super::{
    contract::{self, CompanionHostStatus},
    devices::{CompanionDeviceStore, DatabaseCompanionDeviceStore},
    identity::{
        load_or_create_host_identity, CompanionHostIdentity, CompanionIdentityStore,
        KeychainCompanionIdentityStore,
    },
    network::{CompanionEndpointKind, CompanionEndpointProvider, PrivateInterfaceEndpointProvider},
    pairing::{PairingBootstrap, PairingCoordinator, PairingDecision, PairingSessionStatus},
};
use axum_server::{tls_rustls::RustlsConfig, Handle};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};

const DEFAULT_COMPANION_GATEWAY_PORT: u16 = 17_424;
const COMPANION_GATEWAY_PORT_ENV: &str = "OPENFORGE_COMPANION_PORT";
const LISTENER_START_TIMEOUT: Duration = Duration::from_secs(2);
const LISTENER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(1);
const CONNECTION_DRAIN_TIMEOUT: Duration = Duration::from_millis(250);
const RESTORE_STARTUP_TIMEOUT: Duration = Duration::from_secs(4);
const PAIRING_SESSION_TTL: Duration = Duration::from_secs(2 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum GatewayPhase {
    Disabled,
    Starting,
    Running,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionGatewayEndpoint {
    pub(crate) kind: CompanionEndpointKind,
    pub(crate) url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionGatewayStatus {
    pub(crate) enabled: bool,
    pub(crate) phase: GatewayPhase,
    pub(crate) host_id: Option<String>,
    pub(crate) certificate_fingerprint: Option<String>,
    pub(crate) endpoints: Vec<CompanionGatewayEndpoint>,
    pub(crate) error: Option<String>,
}

struct GatewayListener {
    handle: Handle,
    task: Option<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl GatewayListener {
    fn is_finished(&self) -> bool {
        self.task.as_ref().is_some_and(|task| task.is_finished())
    }
}

impl Drop for GatewayListener {
    fn drop(&mut self) {
        self.handle.shutdown();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

struct RunningGateway {
    listeners: Vec<GatewayListener>,
    endpoints: Vec<CompanionGatewayEndpoint>,
}

impl RunningGateway {
    fn is_finished(&self) -> bool {
        self.listeners.iter().any(GatewayListener::is_finished)
    }

    async fn stop(mut self) {
        for listener in &self.listeners {
            listener
                .handle
                .graceful_shutdown(Some(CONNECTION_DRAIN_TIMEOUT));
        }
        let graceful = tokio::time::timeout(
            LISTENER_SHUTDOWN_TIMEOUT,
            futures::future::join_all(
                self.listeners
                    .iter_mut()
                    .filter_map(|listener| listener.task.as_mut()),
            ),
        )
        .await;
        if graceful.is_err() {
            for listener in &mut self.listeners {
                if let Some(task) = listener.task.as_mut() {
                    task.abort();
                }
            }
            futures::future::join_all(
                self.listeners
                    .iter_mut()
                    .filter_map(|listener| listener.task.as_mut()),
            )
            .await;
        }
        for listener in &mut self.listeners {
            listener.task = None;
        }
    }
}

struct GatewayRuntime {
    enabled: bool,
    phase: GatewayPhase,
    identity: Option<CompanionHostIdentity>,
    running: Option<RunningGateway>,
    error: Option<String>,
}

impl Default for GatewayRuntime {
    fn default() -> Self {
        Self {
            enabled: false,
            phase: GatewayPhase::Disabled,
            identity: None,
            running: None,
            error: None,
        }
    }
}

impl GatewayRuntime {
    fn status(&self) -> CompanionGatewayStatus {
        CompanionGatewayStatus {
            enabled: self.enabled,
            phase: self.phase,
            host_id: self
                .identity
                .as_ref()
                .map(|identity| identity.host_id.clone()),
            certificate_fingerprint: self
                .identity
                .as_ref()
                .map(|identity| identity.certificate_fingerprint.clone()),
            endpoints: self
                .running
                .as_ref()
                .map(|running| running.endpoints.clone())
                .unwrap_or_default(),
            error: self.error.clone(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct CompanionGatewayManager {
    runtime: Arc<tokio::sync::Mutex<GatewayRuntime>>,
    identity_store: Arc<dyn CompanionIdentityStore>,
    endpoint_provider: Arc<dyn CompanionEndpointProvider>,
    pairing: Arc<PairingCoordinator>,
    port: u16,
}

impl CompanionGatewayManager {
    pub(crate) fn production(database: Arc<std::sync::Mutex<crate::db::Database>>) -> Self {
        let port = std::env::var(COMPANION_GATEWAY_PORT_ENV)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_COMPANION_GATEWAY_PORT);
        Self::new(
            Arc::new(KeychainCompanionIdentityStore),
            Arc::new(DatabaseCompanionDeviceStore::new(database)),
            Arc::new(PrivateInterfaceEndpointProvider),
            port,
        )
    }

    pub(crate) fn new(
        identity_store: Arc<dyn CompanionIdentityStore>,
        device_store: Arc<dyn CompanionDeviceStore>,
        endpoint_provider: Arc<dyn CompanionEndpointProvider>,
        port: u16,
    ) -> Self {
        Self {
            runtime: Arc::new(tokio::sync::Mutex::new(GatewayRuntime::default())),
            identity_store,
            endpoint_provider,
            pairing: Arc::new(PairingCoordinator::new(device_store, PAIRING_SESSION_TTL)),
            port,
        }
    }

    pub(crate) async fn status(&self) -> CompanionGatewayStatus {
        let mut runtime = self.runtime.lock().await;
        if runtime
            .running
            .as_ref()
            .is_some_and(RunningGateway::is_finished)
        {
            if let Some(running) = runtime.running.take() {
                running.stop().await;
            }
            runtime.phase = GatewayPhase::Error;
            runtime.error = Some("Companion TLS listener stopped unexpectedly".to_string());
        }
        runtime.status()
    }

    pub(crate) async fn enable(&self) -> Result<CompanionGatewayStatus, String> {
        let mut runtime = self.runtime.lock().await;
        runtime.enabled = true;
        runtime.error = None;
        if runtime.running.is_some() {
            runtime.phase = GatewayPhase::Running;
            return Ok(runtime.status());
        }
        runtime.phase = GatewayPhase::Starting;

        let identity_store = Arc::clone(&self.identity_store);
        let endpoint_provider = Arc::clone(&self.endpoint_provider);
        let startup_material = tokio::task::spawn_blocking(move || {
            let identity = load_or_create_host_identity(identity_store.as_ref())?;
            let bind_endpoints = endpoint_provider.bind_endpoints()?;
            Ok::<_, String>((identity, bind_endpoints))
        })
        .await
        .map_err(|error| format!("Companion Gateway startup task failed: {error}"));
        let (identity, bind_endpoints) = match startup_material {
            Ok(Ok(material)) => material,
            Ok(Err(error)) | Err(error) => {
                runtime.phase = GatewayPhase::Error;
                runtime.error = Some(error.clone());
                return Err(error);
            }
        };
        runtime.identity = Some(identity.clone());

        let running = match start_tls_listeners(
            &identity,
            bind_endpoints,
            self.port,
            Arc::clone(&self.pairing),
        )
        .await
        {
            Ok(running) => running,
            Err(error) => {
                runtime.phase = GatewayPhase::Error;
                runtime.error = Some(error.clone());
                return Err(error);
            }
        };
        runtime.running = Some(running);
        runtime.phase = GatewayPhase::Running;
        Ok(runtime.status())
    }

    pub(crate) async fn restore(&self) -> CompanionGatewayStatus {
        match tokio::time::timeout(RESTORE_STARTUP_TIMEOUT, self.enable()).await {
            Ok(Ok(status)) => status,
            Ok(Err(_)) => self.status().await,
            Err(_) => {
                let mut runtime = self.runtime.lock().await;
                if runtime.running.is_none() {
                    runtime.phase = GatewayPhase::Error;
                    runtime.error = Some(format!(
                        "Companion Gateway restore timed out after {:?}",
                        RESTORE_STARTUP_TIMEOUT
                    ));
                }
                runtime.status()
            }
        }
    }

    pub(crate) async fn disable(&self) -> CompanionGatewayStatus {
        let mut runtime = self.runtime.lock().await;
        runtime.enabled = false;
        runtime.phase = GatewayPhase::Disabled;
        runtime.error = None;
        let _ = self.pairing.clear();
        if let Some(running) = runtime.running.take() {
            running.stop().await;
        }
        runtime.status()
    }

    pub(crate) async fn shutdown(&self) {
        let mut runtime = self.runtime.lock().await;
        runtime.phase = GatewayPhase::Stopped;
        runtime.error = None;
        let _ = self.pairing.clear();
        if let Some(running) = runtime.running.take() {
            running.stop().await;
        }
    }

    pub(crate) async fn start_pairing(&self) -> Result<PairingSessionStatus, String> {
        let runtime = self.runtime.lock().await;
        if runtime.phase != GatewayPhase::Running {
            return Err("Companion Gateway must be running before pairing".to_string());
        }
        let identity = runtime
            .identity
            .as_ref()
            .ok_or_else(|| "Companion host identity is unavailable".to_string())?;
        let endpoints = runtime
            .running
            .as_ref()
            .map(|running| {
                running
                    .endpoints
                    .iter()
                    .map(|endpoint| endpoint.url.clone())
                    .collect()
            })
            .unwrap_or_default();
        self.pairing.start(PairingBootstrap {
            protocol_version: contract::PROTOCOL_VERSION,
            host_id: identity.host_id.clone(),
            certificate_sha256: identity.certificate_fingerprint.clone(),
            endpoint_candidates: endpoints,
        })
    }

    pub(crate) fn pairing_status(&self) -> Result<Option<PairingSessionStatus>, String> {
        self.pairing.status()
    }

    pub(crate) fn cancel_pairing(&self, session_id: &str) -> Result<(), String> {
        self.pairing.cancel(session_id)
    }

    pub(crate) fn decide_pairing(
        &self,
        request_id: &str,
        decision: PairingDecision,
    ) -> Result<(), String> {
        self.pairing.decide(request_id, decision)
    }

    pub(crate) fn devices(&self) -> Result<Vec<super::devices::CompanionPairedDevice>, String> {
        self.pairing.devices()
    }

    pub(crate) fn revoke_device(&self, device_id: &str) -> Result<(), String> {
        self.pairing.revoke(device_id)
    }
}

fn endpoint_url(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(_) => format!("https://{}:{}", address.ip(), address.port()),
        SocketAddr::V6(_) => format!("https://[{}]:{}", address.ip(), address.port()),
    }
}

async fn start_tls_listeners(
    identity: &CompanionHostIdentity,
    bind_endpoints: Vec<(CompanionEndpointKind, std::net::IpAddr)>,
    port: u16,
    pairing: Arc<PairingCoordinator>,
) -> Result<RunningGateway, String> {
    let tls_config = RustlsConfig::from_pem(
        identity.certificate_pem.clone().into_bytes(),
        identity.private_key_pem.clone().into_bytes(),
    )
    .await
    .map_err(|error| format!("failed to configure Companion TLS: {error}"))?;
    let router = contract::create_router(
        CompanionHostStatus::new(identity.host_id.clone()),
        pairing.clone(),
        pairing,
    );
    let mut bound_listeners = Vec::with_capacity(bind_endpoints.len());
    for (kind, address) in bind_endpoints {
        let requested_address = SocketAddr::new(address, port);
        let listener = std::net::TcpListener::bind(requested_address).map_err(|error| {
            format!("failed to bind Companion TLS listener on {requested_address}: {error}")
        })?;
        let local_address = listener.local_addr().map_err(|error| {
            format!("failed to inspect Companion TLS listener on {requested_address}: {error}")
        })?;
        bound_listeners.push((kind, listener, local_address));
    }

    let mut running = RunningGateway {
        listeners: Vec::with_capacity(bound_listeners.len()),
        endpoints: Vec::with_capacity(bound_listeners.len()),
    };
    for (kind, listener, local_address) in bound_listeners {
        let handle = Handle::new();
        let server_handle = handle.clone();
        let server_router = router.clone();
        let server_tls_config = tls_config.clone();
        let task = tokio::spawn(async move {
            axum_server::from_tcp_rustls(listener, server_tls_config)
                .handle(server_handle)
                .serve(server_router.into_make_service_with_connect_info::<std::net::SocketAddr>())
                .await
        });
        running.listeners.push(GatewayListener {
            handle,
            task: Some(task),
        });
        running.endpoints.push(CompanionGatewayEndpoint {
            kind,
            url: endpoint_url(local_address),
        });
    }

    for index in 0..running.listeners.len() {
        let listening = tokio::time::timeout(
            LISTENER_START_TIMEOUT,
            running.listeners[index].handle.listening(),
        )
        .await
        .map_err(|_| {
            format!(
                "timed out starting Companion TLS listener at {}",
                running.endpoints[index].url
            )
        })?
        .ok_or_else(|| {
            format!(
                "Companion TLS listener failed to start at {}",
                running.endpoints[index].url
            )
        });
        match listening {
            Ok(address) => running.endpoints[index].url = endpoint_url(address),
            Err(error) => {
                running.stop().await;
                return Err(error);
            }
        }
    }

    Ok(running)
}
