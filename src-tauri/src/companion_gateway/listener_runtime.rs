use super::{
    action_palette::CompanionActionPaletteService,
    advertisement::CompanionAdvertisementHandle,
    attention::CompanionAttentionSource,
    contract::{self, CompanionHostStatus, CompanionRouterSources},
    identity::CompanionHostIdentity,
    live_events::CompanionStreamAccess,
    network::CompanionEndpointKind,
    pairing::PairingCoordinator,
    project_board::CompanionProjectBoardSource,
    task_actions::CompanionTaskActionService,
    task_creation::CompanionTaskCreationService,
    task_detail::CompanionTaskDetailSource,
    task_start::CompanionTaskStarter,
};
use crate::app_events::AppEventBus;
use axum_server::{tls_rustls::RustlsConfig, Handle};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, net::SocketAddr, sync::Arc, time::Duration};

const LISTENER_START_TIMEOUT: Duration = Duration::from_secs(2);
const LISTENER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(1);
const CONNECTION_DRAIN_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionGatewayEndpoint {
    pub(crate) kind: CompanionEndpointKind,
    pub(crate) url: String,
}

#[derive(Clone)]
pub(super) struct CompanionGatewayRouteSources {
    pub(super) pairing: Arc<PairingCoordinator>,
    pub(super) attention: Arc<dyn CompanionAttentionSource>,
    pub(super) project_board: Arc<dyn CompanionProjectBoardSource>,
    pub(super) task_detail: Arc<dyn CompanionTaskDetailSource>,
    pub(super) task_actions: Arc<dyn CompanionTaskActionService>,
    pub(super) action_palette: Arc<dyn CompanionActionPaletteService>,
    pub(super) task_creator: Arc<dyn CompanionTaskCreationService>,
    pub(super) task_start: Arc<dyn CompanionTaskStarter>,
    pub(super) pty_manager: crate::pty_manager::PtyManager,
    pub(super) events: AppEventBus,
    pub(super) stream_access: Arc<dyn CompanionStreamAccess>,
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

pub(super) struct RunningGateway {
    listeners: Vec<GatewayListener>,
    endpoints: Vec<CompanionGatewayEndpoint>,
    addresses: Vec<SocketAddr>,
    advertisement: Option<Box<dyn CompanionAdvertisementHandle>>,
}

impl RunningGateway {
    pub(super) fn is_finished(&self) -> bool {
        self.listeners.iter().any(GatewayListener::is_finished)
    }

    pub(super) fn offered_endpoints(&self) -> Vec<CompanionGatewayEndpoint> {
        unique_offered_endpoints(&self.endpoints)
    }

    pub(super) fn addresses(&self) -> &[SocketAddr] {
        &self.addresses
    }

    pub(super) fn advertised_port(&self) -> Option<u16> {
        self.addresses.first().map(SocketAddr::port)
    }

    pub(super) fn attach_advertisement(
        &mut self,
        advertisement: Box<dyn CompanionAdvertisementHandle>,
    ) {
        self.advertisement = Some(advertisement);
    }

    pub(super) fn apply_tailscale_hostname(&mut self, hostname: Option<&str>) {
        for (endpoint, address) in self.endpoints.iter_mut().zip(&self.addresses) {
            if endpoint.kind == CompanionEndpointKind::Tailscale {
                endpoint.url = hostname.map_or_else(
                    || endpoint_url(*address),
                    |hostname| format!("https://{hostname}:{}", address.port()),
                );
            }
        }
    }

    pub(super) async fn stop(mut self) {
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

fn endpoint_url(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(_) => format!("https://{}:{}", address.ip(), address.port()),
        SocketAddr::V6(_) => format!("https://[{}]:{}", address.ip(), address.port()),
    }
}

pub(super) async fn start_tls_listeners(
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
        project_board,
        task_detail,
        task_actions,
        action_palette,
        task_creator,
        task_start,
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
            project_board,
            task_detail,
            task_actions,
            action_palette,
            task_creator,
            task_start,
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
