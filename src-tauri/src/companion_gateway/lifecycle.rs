#[cfg(test)]
pub(super) use super::listener_runtime::unique_offered_endpoints;
pub(crate) use super::listener_runtime::CompanionGatewayEndpoint;
#[cfg(test)]
use super::{
    action_palette::UnavailableCompanionActionPaletteService,
    attention::UnavailableCompanionAttentionSource,
    project_board::UnavailableCompanionProjectBoardSource,
    tailscale::FixedTailscaleHostnameProvider, task_actions::UnavailableCompanionTaskActionService,
    task_creation::UnavailableCompanionTaskCreator,
    task_detail::UnavailableCompanionTaskDetailSource, task_start::UnavailableCompanionTaskStarter,
};
use super::{
    action_palette::{CompanionActionPaletteService, DatabaseCompanionActionPaletteService},
    advertisement::{CompanionAdvertisement, CompanionAdvertiser, MdnsCompanionAdvertiser},
    attention::{CompanionAttentionSource, DatabaseCompanionAttentionSource},
    contract,
    devices::{CompanionDeviceStore, DatabaseCompanionDeviceStore},
    identity::{CompanionHostIdentity, CompanionIdentityStore, KeychainCompanionIdentityStore},
    identity_lifecycle::{CompanionIdentityLifecycle, IdentityResetError},
    listener_runtime::{start_tls_listeners, CompanionGatewayRouteSources, RunningGateway},
    live_events::{CompanionStreamAccess, PairingCompanionStreamAccess},
    network::{CompanionEndpointKind, CompanionEndpointProvider, PrivateInterfaceEndpointProvider},
    pairing::{PairingBootstrap, PairingCoordinator, PairingDecision, PairingSessionStatus},
    project_board::{CompanionProjectBoardSource, DatabaseCompanionProjectBoardSource},
    tailscale::{
        DetectedTailscaleHostname, LocalTailscaleHostnameProvider, TailscaleHostnameProvider,
    },
    task_actions::CompanionTaskActionService,
    task_creation::{CompanionTaskCreationService, DatabaseCompanionTaskCreator},
    task_detail::{CompanionTaskDetailSource, DatabaseCompanionTaskDetailSource},
    task_start::CompanionTaskStarter,
};
use crate::{
    app_events::AppEventBus,
    task_claims::TaskClaims,
    terminal_task_completion::{PtyTerminalTaskRuntime, TerminalTaskCompletionService},
};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

const DEFAULT_COMPANION_GATEWAY_PORT: u16 = 17_424;
const COMPANION_GATEWAY_PORT_ENV: &str = "OPENFORGE_COMPANION_PORT";
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
                .map(RunningGateway::offered_endpoints)
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
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
    action_palette: Arc<dyn CompanionActionPaletteService>,
    task_creator: Arc<dyn CompanionTaskCreationService>,
    task_start: Arc<dyn CompanionTaskStarter>,
    pty_manager: crate::pty_manager::PtyManager,
    events: AppEventBus,
}

#[derive(Clone)]
pub(crate) struct CompanionGatewayManager {
    runtime: Arc<tokio::sync::Mutex<GatewayRuntime>>,
    operation_lock: Arc<tokio::sync::Mutex<()>>,
    identity_lifecycle: CompanionIdentityLifecycle,
    tailscale_detection_notify: Arc<tokio::sync::Notify>,
    endpoint_provider: Arc<dyn CompanionEndpointProvider>,
    tailscale_hostname_provider: Arc<dyn TailscaleHostnameProvider>,
    advertiser: Arc<dyn CompanionAdvertiser>,
    pairing: Arc<PairingCoordinator>,
    attention: Arc<dyn CompanionAttentionSource>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    task_detail: Arc<dyn CompanionTaskDetailSource>,
    task_actions: Arc<dyn CompanionTaskActionService>,
    action_palette: Arc<dyn CompanionActionPaletteService>,
    task_creator: Arc<dyn CompanionTaskCreationService>,
    task_start: Arc<dyn CompanionTaskStarter>,
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
        github_client: crate::github_client::GitHubClient,
        app: Option<crate::backend_runtime::AppHandle>,
        task_claims: TaskClaims,
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
        let task_actions = Arc::new(TerminalTaskCompletionService::new(
            Arc::clone(&database),
            PtyTerminalTaskRuntime::new(Some(pty_manager.clone())),
            task_claims.clone(),
            None,
            Some(events.clone()),
            None,
        ));
        let task_creator = Arc::new(DatabaseCompanionTaskCreator::new(
            Arc::clone(&database),
            events.clone(),
        ));
        let action_palette = Arc::new(DatabaseCompanionActionPaletteService::production(
            Arc::clone(&database),
            github_client,
            pty_manager.clone(),
            app.clone(),
            Some(events.sender()),
        ));
        let task_start = Arc::new(crate::task_start::TaskStartService::new(
            app,
            Arc::clone(&database),
            Some(pty_manager.clone()),
            Some(events.sender()),
            task_claims,
            crate::task_start::default_worktree_root(),
        ));
        Self::new_with_sources(
            Arc::new(KeychainCompanionIdentityStore),
            Arc::new(DatabaseCompanionDeviceStore::new(Arc::clone(&database))),
            CompanionGatewayDomainSources {
                attention: Arc::new(DatabaseCompanionAttentionSource::new(Arc::clone(&database))),
                project_board: Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
                    &database,
                ))),
                task_detail: Arc::new(DatabaseCompanionTaskDetailSource::new(Arc::clone(
                    &database,
                ))),
                task_actions,
                action_palette,
                task_creator,
                task_start,
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
                project_board: Arc::new(UnavailableCompanionProjectBoardSource),
                task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
                task_actions: Arc::new(UnavailableCompanionTaskActionService),
                action_palette: Arc::new(UnavailableCompanionActionPaletteService),
                task_creator: Arc::new(UnavailableCompanionTaskCreator),
                task_start: Arc::new(UnavailableCompanionTaskStarter),
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
                project_board: Arc::new(UnavailableCompanionProjectBoardSource),
                task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
                task_actions: Arc::new(UnavailableCompanionTaskActionService),
                action_palette: Arc::new(UnavailableCompanionActionPaletteService),
                task_creator: Arc::new(UnavailableCompanionTaskCreator),
                task_start: Arc::new(UnavailableCompanionTaskStarter),
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
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator,
            task_start,
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
            identity_lifecycle: CompanionIdentityLifecycle::new(identity_store),
            tailscale_detection_notify: Arc::new(tokio::sync::Notify::new()),
            endpoint_provider,
            tailscale_hostname_provider,
            advertiser,
            pairing,
            attention,
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator,
            task_start,
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

    #[cfg(test)]
    pub(crate) async fn status_after_operations_settle(&self) -> CompanionGatewayStatus {
        let _operation = self.operation_lock.lock().await;
        let runtime = self.runtime.lock().await;
        runtime.status()
    }

    pub(crate) async fn enable(&self) -> Result<CompanionGatewayStatus, String> {
        let _operation = self.operation_lock.lock().await;
        self.enable_locked().await
    }

    async fn enable_locked(&self) -> Result<CompanionGatewayStatus, String> {
        if self.identity_lifecycle.is_cancelled() {
            return Err("Companion Gateway is shutting down".to_string());
        }
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

        {
            let mut runtime = self.runtime.lock().await;
            runtime.enabled = true;
            runtime.error = None;
            runtime.phase = GatewayPhase::Starting;
        }
        self.pairing.mark_gateway_not_accepting_streams();

        let startup_material = async {
            let identity = self.identity_lifecycle.load_or_create().await?;
            let endpoint_provider = Arc::clone(&self.endpoint_provider);
            let bind_endpoints =
                tokio::task::spawn_blocking(move || endpoint_provider.bind_endpoints())
                    .await
                    .map_err(|error| format!("Companion Gateway startup task failed: {error}"))??;
            Ok::<_, String>((identity, bind_endpoints))
        }
        .await;
        let (identity, bind_endpoints) = match startup_material {
            Ok(material) => material,
            Err(error) => {
                let mut runtime = self.runtime.lock().await;
                runtime.phase = GatewayPhase::Error;
                runtime.error = Some(error.clone());
                return Err(error);
            }
        };
        let mut runtime = self.runtime.lock().await;
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
                project_board: Arc::clone(&self.project_board),
                task_detail: Arc::clone(&self.task_detail),
                task_actions: Arc::clone(&self.task_actions),
                action_palette: Arc::clone(&self.action_palette),
                task_creator: Arc::clone(&self.task_creator),
                task_start: Arc::clone(&self.task_start),
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
            running.apply_tailscale_hostname(Some(&hostname));
        }
        let advertisement = CompanionAdvertisement {
            host_id: identity.host_id.clone(),
            protocol_version: contract::PROTOCOL_VERSION,
            addresses: running
                .addresses()
                .iter()
                .map(|address| address.ip())
                .collect(),
            port: running
                .advertised_port()
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
        running.attach_advertisement(advertisement_handle);
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

    /// Restore a persisted opt-in after the core loopback bridge is ready.
    ///
    /// Server lifecycle runs this in a background task, so waiting for platform
    /// trust initialization cannot delay core readiness. Do not wrap `enable` in
    /// a cancellation timeout: macOS Keychain can exceed a short cold-start budget,
    /// and cancelling midway can leave an enabled gateway unavailable until a user
    /// retries it manually.
    pub(crate) async fn restore(&self) -> CompanionGatewayStatus {
        match self.enable().await {
            Ok(status) => status,
            Err(_) => self.status().await,
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
        // Wake a blocked macOS Keychain authorization read before waiting for the
        // serialized gateway operation. Status remains available through `runtime`.
        self.identity_lifecycle.cancel_pending_operations();
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
                running
                    .offered_endpoints()
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
            running.apply_tailscale_hostname(effective_hostname.as_deref());
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

    pub(crate) async fn remove_revoked_device(&self, device_id: &str) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.pairing.remove_revoked(device_id)?;
        log::info!("[companion_gateway] revoked device removed device_id={device_id}");
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
        let reset = match self.identity_lifecycle.reset(&self.pairing).await {
            Ok(reset) => reset,
            Err(IdentityResetError::Recoverable(message)) => return Err(message),
            Err(IdentityResetError::RequiresGatewayStop(message)) => {
                self.disable_locked().await;
                return Err(message);
            }
        };
        let identity = reset.identity;
        let revoked_device_count = reset.revoked_device_count;
        self.disable_locked().await;
        {
            let mut runtime = self.runtime.lock().await;
            runtime.identity = Some(identity.clone());
        }
        log::info!(
            "[companion_gateway] host identity reset host_id={} revoked_devices={}",
            identity.host_id,
            revoked_device_count
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
