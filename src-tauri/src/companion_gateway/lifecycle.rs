use super::{
    advertisement::{
        CompanionAdvertisement, CompanionAdvertisementHandle, CompanionAdvertiser,
        MdnsCompanionAdvertiser,
    },
    attention::{CompanionAttentionSource, DatabaseCompanionAttentionSource},
    contract::{self, CompanionHostStatus, CompanionRouterSources},
    devices::{CompanionDeviceStore, DatabaseCompanionDeviceStore},
    identity::{
        generate_host_identity, load_or_create_host_identity, CompanionHostIdentity,
        CompanionIdentityStore, KeychainCompanionIdentityStore,
    },
    live_events::{CompanionStreamAccess, PairingCompanionStreamAccess},
    network::{CompanionEndpointKind, CompanionEndpointProvider, PrivateInterfaceEndpointProvider},
    pairing::{PairingBootstrap, PairingCoordinator, PairingDecision, PairingSessionStatus},
    tailscale::{
        DetectedTailscaleHostname, LocalTailscaleHostnameProvider, TailscaleHostnameProvider,
    },
    task_detail::{CompanionTaskDetailSource, DatabaseCompanionTaskDetailSource},
};
#[cfg(test)]
use super::{
    attention::UnavailableCompanionAttentionSource, tailscale::FixedTailscaleHostnameProvider,
    task_detail::UnavailableCompanionTaskDetailSource,
};
use crate::app_events::AppEventBus;
use axum_server::{tls_rustls::RustlsConfig, Handle};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, net::SocketAddr, sync::Arc, time::Duration};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTailscaleStatus {
    pub(crate) detected_hostname: Option<String>,
    pub(crate) configured_hostname: Option<String>,
    pub(crate) effective_hostname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionGatewayStatus {
    pub(crate) enabled: bool,
    pub(crate) phase: GatewayPhase,
    pub(crate) host_id: Option<String>,
    pub(crate) certificate_fingerprint: Option<String>,
    pub(crate) endpoints: Vec<CompanionGatewayEndpoint>,
    pub(crate) tailscale: CompanionTailscaleStatus,
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
    addresses: Vec<SocketAddr>,
    advertisement: Option<Box<dyn CompanionAdvertisementHandle>>,
}

impl RunningGateway {
    fn is_finished(&self) -> bool {
        self.listeners.iter().any(GatewayListener::is_finished)
    }

    async fn stop(mut self) {
        if let Some(advertisement) = self.advertisement.take() {
            let _ = tokio::task::spawn_blocking(move || drop(advertisement)).await;
        }
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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
enum TailscaleDetection {
    #[default]
    NotAttempted,
    Detecting,
    Unavailable,
    Detected(String),
}

impl TailscaleDetection {
    fn hostname(&self) -> Option<&str> {
        match self {
            Self::Detected(hostname) => Some(hostname),
            Self::NotAttempted | Self::Detecting | Self::Unavailable => None,
        }
    }
}

struct GatewayRuntime {
    enabled: bool,
    phase: GatewayPhase,
    identity: Option<CompanionHostIdentity>,
    running: Option<RunningGateway>,
    tailscale_detection: TailscaleDetection,
    configured_tailscale_hostname: Option<String>,
    error: Option<String>,
}

impl Default for GatewayRuntime {
    fn default() -> Self {
        Self {
            enabled: false,
            phase: GatewayPhase::Disabled,
            identity: None,
            running: None,
            tailscale_detection: TailscaleDetection::NotAttempted,
            configured_tailscale_hostname: None,
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
                .map(|running| unique_offered_endpoints(&running.endpoints))
                .unwrap_or_default(),
            tailscale: CompanionTailscaleStatus {
                detected_hostname: self.tailscale_detection.hostname().map(str::to_string),
                configured_hostname: self.configured_tailscale_hostname.clone(),
                effective_hostname: self
                    .configured_tailscale_hostname
                    .clone()
                    .or_else(|| self.tailscale_detection.hostname().map(str::to_string)),
            },
            error: self.error.clone(),
        }
    }
}

struct CompanionGatewayNetwork {
    endpoint_provider: Arc<dyn CompanionEndpointProvider>,
    tailscale_hostname_provider: Arc<dyn TailscaleHostnameProvider>,
    advertiser: Arc<dyn CompanionAdvertiser>,
    port: u16,
}

struct CompanionGatewayDomainSources {
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    pty_manager: crate::pty_manager::PtyManager,
    events: AppEventBus,
}

#[derive(Clone)]
struct CompanionGatewayRouteSources {
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    pty_manager: crate::pty_manager::PtyManager,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
}

#[derive(Clone)]
pub(crate) struct CompanionGatewayManager {
    runtime: Arc<tokio::sync::Mutex<GatewayRuntime>>,
    operation_lock: Arc<tokio::sync::Mutex<()>>,
    tailscale_detection_notify: Arc<tokio::sync::Notify>,
    identity_store: Arc<dyn CompanionIdentityStore>,
    endpoint_provider: Arc<dyn CompanionEndpointProvider>,
    tailscale_hostname_provider: Arc<dyn TailscaleHostnameProvider>,
    advertiser: Arc<dyn CompanionAdvertiser>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    pty_manager: crate::pty_manager::PtyManager,
    events: AppEventBus,
    stream_access: Arc<dyn CompanionStreamAccess>,
    port: u16,
}

impl CompanionGatewayManager {
    pub(crate) fn production(
        database: Arc<std::sync::Mutex<crate::db::Database>>,
        events: AppEventBus,
        pty_manager: crate::pty_manager::PtyManager,
    ) -> Self {
        let port = std::env::var(COMPANION_GATEWAY_PORT_ENV)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_COMPANION_GATEWAY_PORT);
        let configured_tailscale_hostname = {
            let database = crate::db::acquire_db(&database);
            super::tailscale_hostname_preference(&database)
                .ok()
                .flatten()
        };
        Self::new_with_sources(
            Arc::new(KeychainCompanionIdentityStore),
            Arc::new(DatabaseCompanionDeviceStore::new(Arc::clone(&database))),
            CompanionGatewayDomainSources {
                attention: Arc::new(DatabaseCompanionAttentionSource::new(Arc::clone(&database))),
                task_detail: Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
                events,
                pty_manager,
            },
            CompanionGatewayNetwork {
                endpoint_provider: Arc::new(PrivateInterfaceEndpointProvider),
                tailscale_hostname_provider: Arc::new(LocalTailscaleHostnameProvider),
                advertiser: Arc::new(MdnsCompanionAdvertiser),
                port,
            },
            configured_tailscale_hostname,
        )
    }

    #[cfg(test)]
    pub(crate) fn new(
        identity_store: Arc<dyn CompanionIdentityStore>,
        device_store: Arc<dyn CompanionDeviceStore>,
        endpoint_provider: Arc<dyn CompanionEndpointProvider>,
        advertiser: Arc<dyn CompanionAdvertiser>,
        port: u16,
    ) -> Self {
        Self::new_with_sources(
            identity_store,
            device_store,
            CompanionGatewayDomainSources {
                attention: Arc::new(UnavailableCompanionAttentionSource),
                task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
                events: AppEventBus::new(16, 8),
                pty_manager: crate::pty_manager::PtyManager::new(),
            },
            CompanionGatewayNetwork {
                endpoint_provider,
                tailscale_hostname_provider: Arc::new(FixedTailscaleHostnameProvider::unavailable()),
                advertiser,
                port,
            },
            None,
        )
    }

    #[cfg(test)]
    pub(crate) fn new_with_tailscale(
        identity_store: Arc<dyn CompanionIdentityStore>,
        device_store: Arc<dyn CompanionDeviceStore>,
        endpoint_provider: Arc<dyn CompanionEndpointProvider>,
        advertiser: Arc<dyn CompanionAdvertiser>,
        tailscale_hostname_provider: Arc<dyn TailscaleHostnameProvider>,
        configured_tailscale_hostname: Option<String>,
        port: u16,
    ) -> Self {
        Self::new_with_sources(
            identity_store,
            device_store,
            CompanionGatewayDomainSources {
                attention: Arc::new(UnavailableCompanionAttentionSource),
                task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
                events: AppEventBus::new(16, 8),
                pty_manager: crate::pty_manager::PtyManager::new(),
            },
            CompanionGatewayNetwork {
                endpoint_provider,
                tailscale_hostname_provider,
                advertiser,
                port,
            },
            configured_tailscale_hostname,
        )
    }

    fn new_with_sources(
        identity_store: Arc<dyn CompanionIdentityStore>,
        device_store: Arc<dyn CompanionDeviceStore>,
        sources: CompanionGatewayDomainSources,
        network: CompanionGatewayNetwork,
        configured_tailscale_hostname: Option<String>,
    ) -> Self {
        let CompanionGatewayDomainSources {
            attention,
            task_detail,
            pty_manager,
            events,
        } = sources;
        let CompanionGatewayNetwork {
            endpoint_provider,
            tailscale_hostname_provider,
            advertiser,
            port,
        } = network;
        let pairing = Arc::new(PairingCoordinator::new(device_store, PAIRING_SESSION_TTL));
        let stream_access = Arc::new(PairingCompanionStreamAccess::new(pairing.clone()));
        let runtime = GatewayRuntime {
            configured_tailscale_hostname,
            ..GatewayRuntime::default()
        };
        Self {
            runtime: Arc::new(tokio::sync::Mutex::new(runtime)),
            operation_lock: Arc::new(tokio::sync::Mutex::new(())),
            tailscale_detection_notify: Arc::new(tokio::sync::Notify::new()),
            identity_store,
            endpoint_provider,
            tailscale_hostname_provider,
            advertiser,
            pairing,
            attention,
            task_detail,
            events,
            pty_manager,
            stream_access,
            port,
        }
    }

    async fn detect_tailscale_hostname(&self) -> Option<String> {
        let endpoint_provider = Arc::clone(&self.endpoint_provider);
        let tailscale_hostname_provider = Arc::clone(&self.tailscale_hostname_provider);
        tokio::task::spawn_blocking(move || {
            let bind_endpoints = endpoint_provider.bind_endpoints().ok()?;
            confirmed_tailscale_hostname(
                &bind_endpoints,
                tailscale_hostname_provider.detect().ok().flatten(),
            )
        })
        .await
        .ok()
        .flatten()
    }

    async fn ensure_tailscale_detection(&self) {
        loop {
            let notified = self.tailscale_detection_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let should_spawn = {
                let mut runtime = self.runtime.lock().await;
                match runtime.tailscale_detection {
                    TailscaleDetection::NotAttempted => {
                        runtime.tailscale_detection = TailscaleDetection::Detecting;
                        true
                    }
                    TailscaleDetection::Detecting => false,
                    TailscaleDetection::Unavailable | TailscaleDetection::Detected(_) => return,
                }
            };
            if should_spawn {
                let manager = self.clone();
                tokio::spawn(async move {
                    let detected_hostname = manager.detect_tailscale_hostname().await;
                    let mut runtime = manager.runtime.lock().await;
                    if runtime.tailscale_detection == TailscaleDetection::Detecting {
                        runtime.tailscale_detection = detected_hostname.map_or(
                            TailscaleDetection::Unavailable,
                            TailscaleDetection::Detected,
                        );
                    }
                    drop(runtime);
                    manager.tailscale_detection_notify.notify_waiters();
                });
            }
            notified.await;
        }
    }

    pub(crate) async fn status(&self) -> CompanionGatewayStatus {
        self.ensure_tailscale_detection().await;
        let mut runtime = self.runtime.lock().await;
        if runtime
            .running
            .as_ref()
            .is_some_and(RunningGateway::is_finished)
        {
            self.stream_access.gateway_closing();
            if let Some(running) = runtime.running.take() {
                running.stop().await;
            }
            runtime.phase = GatewayPhase::Error;
            runtime.error = Some("Companion TLS listener stopped unexpectedly".to_string());
        }
        runtime.status()
    }

    pub(crate) async fn enable(&self) -> Result<CompanionGatewayStatus, String> {
        let _operation = self.operation_lock.lock().await;
        self.enable_locked().await
    }

    async fn enable_locked(&self) -> Result<CompanionGatewayStatus, String> {
        {
            let mut runtime = self.runtime.lock().await;
            runtime.enabled = true;
            runtime.error = None;
            if runtime.running.is_some() {
                runtime.phase = GatewayPhase::Running;
                self.pairing.notify_gateway_running();
                return Ok(runtime.status());
            }
            if runtime.tailscale_detection == TailscaleDetection::Unavailable {
                runtime.tailscale_detection = TailscaleDetection::NotAttempted;
            }
        }
        self.ensure_tailscale_detection().await;

        let mut runtime = self.runtime.lock().await;
        runtime.enabled = true;
        runtime.error = None;
        runtime.phase = GatewayPhase::Starting;
        self.pairing.mark_gateway_not_accepting_streams();

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
        let tailscale_hostname = runtime
            .configured_tailscale_hostname
            .as_deref()
            .or(runtime.tailscale_detection.hostname())
            .map(str::to_string);

        let mut running = match start_tls_listeners(
            &identity,
            bind_endpoints,
            self.port,
            CompanionGatewayRouteSources {
                pairing: Arc::clone(&self.pairing),
                attention: Arc::clone(&self.attention),
                task_detail: Arc::clone(&self.task_detail),
                pty_manager: self.pty_manager.clone(),
                events: self.events.clone(),
                stream_access: Arc::clone(&self.stream_access),
            },
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
        if let Some(hostname) = tailscale_hostname {
            apply_tailscale_hostname(&mut running, Some(&hostname));
        }
        let advertisement = CompanionAdvertisement {
            host_id: identity.host_id.clone(),
            protocol_version: contract::PROTOCOL_VERSION,
            addresses: running
                .addresses
                .iter()
                .map(|address| address.ip())
                .collect(),
            port: running
                .addresses
                .first()
                .map(SocketAddr::port)
                .ok_or_else(|| "Companion Gateway has no LAN endpoints to advertise".to_string())?,
        };
        let advertiser = Arc::clone(&self.advertiser);
        let advertisement_handle =
            tokio::task::spawn_blocking(move || advertiser.advertise(advertisement))
                .await
                .map_err(|error| format!("Companion mDNS startup task failed: {error}"));
        let advertisement_handle = match advertisement_handle {
            Ok(Ok(handle)) => handle,
            Ok(Err(error)) | Err(error) => {
                running.stop().await;
                runtime.phase = GatewayPhase::Error;
                runtime.error = Some(error.clone());
                return Err(error);
            }
        };
        running.advertisement = Some(advertisement_handle);
        runtime.running = Some(running);
        runtime.phase = GatewayPhase::Running;
        self.pairing.notify_gateway_running();
        let status = runtime.status();
        log::info!(
            "[companion_gateway] gateway running host_id={} endpoints={}",
            identity.host_id,
            status.endpoints.len()
        );
        Ok(status)
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
        let _operation = self.operation_lock.lock().await;
        self.disable_locked().await
    }

    async fn disable_locked(&self) -> CompanionGatewayStatus {
        let mut runtime = self.runtime.lock().await;
        runtime.enabled = false;
        runtime.phase = GatewayPhase::Disabled;
        runtime.error = None;
        let _ = self.pairing.clear();
        if runtime.running.is_some() {
            log::info!("[companion_gateway] gateway disabled");
        } else {
            self.pairing.mark_gateway_not_accepting_streams();
        }
        if let Some(running) = runtime.running.take() {
            self.stream_access.gateway_closing();
            running.stop().await;
        }
        runtime.status()
    }

    pub(crate) async fn shutdown(&self) {
        let _operation = self.operation_lock.lock().await;
        let mut runtime = self.runtime.lock().await;
        runtime.phase = GatewayPhase::Stopped;
        runtime.error = None;
        let _ = self.pairing.clear();
        if runtime.running.is_some() {
            log::info!("[companion_gateway] gateway shutting down");
        } else {
            self.pairing.mark_gateway_not_accepting_streams();
        }
        if let Some(running) = runtime.running.take() {
            self.stream_access.gateway_closing();
            running.stop().await;
        }
    }

    pub(crate) async fn start_pairing(&self) -> Result<PairingSessionStatus, String> {
        let _operation = self.operation_lock.lock().await;
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
                unique_offered_endpoints(&running.endpoints)
                    .into_iter()
                    .map(|endpoint| endpoint.url)
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

    pub(crate) async fn configure_tailscale_hostname(
        &self,
        hostname: String,
    ) -> CompanionGatewayStatus {
        let _operation = self.operation_lock.lock().await;
        let mut runtime = self.runtime.lock().await;
        runtime.configured_tailscale_hostname = Some(hostname);
        let effective_hostname = runtime
            .configured_tailscale_hostname
            .clone()
            .or_else(|| runtime.tailscale_detection.hostname().map(str::to_string));
        if let Some(running) = runtime.running.as_mut() {
            apply_tailscale_hostname(running, effective_hostname.as_deref());
        }
        let _ = self.pairing.clear();
        runtime.status()
    }

    pub(crate) fn pairing_status(&self) -> Result<Option<PairingSessionStatus>, String> {
        self.pairing.status()
    }

    pub(crate) async fn cancel_pairing(&self, session_id: &str) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.pairing.cancel(session_id)
    }

    pub(crate) async fn decide_pairing(
        &self,
        request_id: &str,
        decision: PairingDecision,
    ) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.pairing.decide(request_id, decision)
    }

    pub(crate) fn devices(&self) -> Result<Vec<super::devices::CompanionPairedDevice>, String> {
        self.pairing.devices()
    }

    #[cfg(test)]
    pub(crate) fn subscribe_stream_terminations(
        &self,
    ) -> tokio::sync::broadcast::Receiver<super::pairing::CompanionStreamTermination> {
        self.pairing.subscribe_stream_terminations()
    }

    pub(crate) async fn revoke_device(&self, device_id: &str) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.pairing.revoke(device_id)?;
        log::info!("[companion_gateway] device revoked device_id={device_id}");
        Ok(())
    }

    pub(crate) async fn reset_host_identity(&self) -> Result<CompanionGatewayStatus, String> {
        let manager = self.clone();
        tokio::spawn(async move { manager.reset_host_identity_owned().await })
            .await
            .map_err(|error| format!("Companion identity reset task failed: {error}"))?
    }

    async fn reset_host_identity_owned(&self) -> Result<CompanionGatewayStatus, String> {
        let _operation = self.operation_lock.lock().await;
        let was_enabled = self.runtime.lock().await.enabled;
        let identity = tokio::task::spawn_blocking(generate_host_identity)
            .await
            .map_err(|error| format!("Companion identity generation task failed: {error}"))??;
        let revoked_devices = self.pairing.revoke_all()?;

        let identity_store = Arc::clone(&self.identity_store);
        let identity_to_save = identity.clone();
        if let Err(save_error) =
            tokio::task::spawn_blocking(move || identity_store.save(&identity_to_save))
                .await
                .map_err(|error| format!("Companion identity persistence task failed: {error}"))
                .and_then(|result| result)
        {
            if let Err(rollback_error) = self.pairing.rollback_revoke_all(&revoked_devices) {
                self.disable_locked().await;
                return Err(format!(
                    "{save_error}; failed to restore paired-device trust: {rollback_error}"
                ));
            }
            return Err(save_error);
        }
        self.pairing.notify_all_devices_revoked();
        self.disable_locked().await;
        {
            let mut runtime = self.runtime.lock().await;
            runtime.identity = Some(identity.clone());
        }
        log::info!(
            "[companion_gateway] host identity reset host_id={} revoked_devices={}",
            identity.host_id,
            revoked_devices.len()
        );

        if was_enabled {
            if let Err(error) = self.enable_locked().await {
                log::warn!(
                    "[companion_gateway] host identity reset completed but gateway restart failed: {error}"
                );
            }
        }
        Ok(self.status().await)
    }
}

pub(super) fn unique_offered_endpoints(
    endpoints: &[CompanionGatewayEndpoint],
) -> Vec<CompanionGatewayEndpoint> {
    let mut seen_urls = HashSet::new();
    endpoints
        .iter()
        .filter(|endpoint| seen_urls.insert(endpoint.url.clone()))
        .cloned()
        .collect()
}

fn confirmed_tailscale_hostname(
    bind_endpoints: &[(CompanionEndpointKind, std::net::IpAddr)],
    detected: Option<DetectedTailscaleHostname>,
) -> Option<String> {
    detected
        .filter(|detected| {
            detected.addresses.iter().any(|address| {
                bind_endpoints.iter().any(|(kind, bound_address)| {
                    *kind == CompanionEndpointKind::Tailscale && bound_address == address
                })
            })
        })
        .map(|detected| detected.hostname)
}

fn apply_tailscale_hostname(running: &mut RunningGateway, hostname: Option<&str>) {
    for (endpoint, address) in running.endpoints.iter_mut().zip(&running.addresses) {
        if endpoint.kind == CompanionEndpointKind::Tailscale {
            endpoint.url = hostname.map_or_else(
                || endpoint_url(*address),
                |hostname| format!("https://{hostname}:{}", address.port()),
            );
        }
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
    sources: CompanionGatewayRouteSources,
) -> Result<RunningGateway, String> {
    let tls_config = RustlsConfig::from_pem(
        identity.certificate_pem.clone().into_bytes(),
        identity.private_key_pem.clone().into_bytes(),
    )
    .await
    .map_err(|error| format!("failed to configure Companion TLS: {error}"))?;
    let CompanionGatewayRouteSources {
        pairing,
        attention,
        task_detail,
        pty_manager,
        events,
        stream_access,
    } = sources;
    let router = contract::create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new(identity.host_id.clone()),
        pairing.clone(),
        pairing,
        CompanionRouterSources {
            attention,
            task_detail,
            events,
            stream_access,
            pty_manager,
        },
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
        addresses: Vec::with_capacity(bound_listeners.len()),
        advertisement: None,
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
        running.addresses.push(local_address);
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
            Ok(address) => {
                running.endpoints[index].url = endpoint_url(address);
                running.addresses[index] = address;
            }
            Err(error) => {
                running.stop().await;
                return Err(error);
            }
        }
    }

    Ok(running)
}
