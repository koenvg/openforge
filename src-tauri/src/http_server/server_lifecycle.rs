use super::{
    internal_transport, legacy_transport, plugin_management, AppState, SidecarReadinessState,
    TaskClaims,
};
use crate::{
    app_events::{AppEventBus, InMemoryAppEventAdapter},
    db,
    github_client::GitHubClient,
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::WhisperManager,
};
use axum::Router;
use log::{info, warn};
use std::{net::SocketAddr, path::PathBuf, sync::Mutex, time::Duration};

/// Rust-sidecar internal cleanup budget after SIGTERM.
///
/// This must stay below Electron's 7s SIGTERM grace so plugin-sidecar and PTY
/// cleanup can finish before Electron escalates to SIGKILL. See
/// docs/contracts/rust-sidecar-shutdown-budget.md.
pub(super) const SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(5_000);

/// Create the HTTP router with all available routes
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .merge(internal_transport::router())
        .merge(legacy_transport::router())
        .merge(plugin_management::router())
        .with_state(state)
}

pub(super) fn resolve_http_server_port(
    openforge_backend_port: Option<String>,
    ai_command_center_port: Option<String>,
) -> u16 {
    openforge_backend_port
        .or(ai_command_center_port)
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT)
}

/// Start the HTTP server on the configured port
///
/// The server listens on 127.0.0.1 (localhost only) to ensure
/// it's not exposed to the external network.
///
/// The port can be configured via OPENFORGE_BACKEND_PORT for the Electron
/// sidecar contract, or AI_COMMAND_CENTER_PORT for the legacy hook bridge,
/// defaulting to the shared OpenForge HTTP bridge port contract.
pub fn electron_sidecar_app_handle(
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
) -> crate::backend_runtime::AppHandle {
    crate::backend_runtime::AppHandle::with_app_paths(app_data_dir, resource_dir)
}

async fn sidecar_shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            warn!(
                "[http_server] Failed to listen for ctrl-c shutdown signal: {}",
                error
            );
        }
    };

    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    _ = ctrl_c => {},
                    _ = terminate.recv() => {},
                }
            }
            Err(error) => {
                warn!(
                    "[http_server] Failed to listen for SIGTERM shutdown signal: {}",
                    error
                );
                ctrl_c.await;
            }
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

pub(super) async fn shutdown_sidecar_runtime(state: &AppState) {
    info!("[http_server] Rust sidecar shutdown cleanup started");

    if let Some(plugin_host) = &state.plugin_host {
        if let Err(error) = plugin_host.stop_sidecar().await {
            warn!(
                "[http_server] Failed to stop plugin sidecar during shutdown: {}",
                error
            );
        }
    }

    if let Some(pty_manager) = &state.pty_manager {
        pty_manager.kill_all().await;
    }

    info!("[http_server] Rust sidecar shutdown cleanup completed");
}

pub async fn start_http_sidecar_server(
    app: crate::backend_runtime::AppHandle,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    whisper: std::sync::Arc<WhisperManager>,
    sidecar_readiness: SidecarReadinessState,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    start_http_server_with_app_state(
        Some(app),
        db,
        pty_manager,
        Some(whisper),
        sidecar_readiness,
        true,
        ready_tx,
    )
    .await
}

async fn start_http_server_with_app_state(
    app: Option<crate::backend_runtime::AppHandle>,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    whisper: Option<std::sync::Arc<WhisperManager>>,
    sidecar_readiness: SidecarReadinessState,
    is_electron_sidecar: bool,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = resolve_http_server_port(
        std::env::var("OPENFORGE_BACKEND_PORT").ok(),
        std::env::var("AI_COMMAND_CENTER_PORT").ok(),
    );

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let app_event_bus = AppEventBus::new(1024, 1024);
    let app_event_tx = app_event_bus.sender();
    if let Some(app) = app.as_ref() {
        app.set_app_event_adapter(std::sync::Arc::new(InMemoryAppEventAdapter::new(
            app_event_bus.clone(),
        )));
    }
    let github_client = app
        .as_ref()
        .and_then(|app| app.try_state::<GitHubClient>())
        .map(|state| state.inner().clone())
        .unwrap_or_default();
    let task_claims = TaskClaims::new();
    let poll_context = crate::github_poller::PollContext::new();
    let plugin_host = Some(PluginHost::with_app_event_sender_and_task_claims(
        app.clone().unwrap_or_default(),
        Some(app_event_tx.clone()),
        task_claims.clone(),
    ));
    let state = AppState {
        app,
        db: db.clone(),
        backend_token: std::env::var("OPENFORGE_BACKEND_TOKEN").ok(),
        pty_manager: Some(pty_manager),
        github_client: github_client.clone(),
        plugin_host,
        plugin_lifecycle_locks: crate::plugin_platform::PluginLifecycleLocks::new(),
        app_event_tx: Some(app_event_tx.clone()),
        app_event_bus: Some(app_event_bus),
        whisper,
        sidecar_readiness,
        task_claims,
        poll_context: poll_context.clone(),
    };

    if is_electron_sidecar {
        tokio::spawn(crate::github_poller::start_github_poller_for_sidecar(
            db,
            github_client,
            Some(app_event_tx),
            poll_context,
        ));
    }

    let shutdown_state = state.clone();
    let router = create_router(state);

    info!("[http_server] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Signal that the server is listening before entering the serve loop
    let _ = ready_tx.send(());
    if is_electron_sidecar {
        axum::serve(listener, router)
            .with_graceful_shutdown(sidecar_shutdown_signal())
            .await?;

        if tokio::time::timeout(
            SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
            shutdown_sidecar_runtime(&shutdown_state),
        )
        .await
        .is_err()
        {
            warn!(
                "[http_server] Rust sidecar shutdown cleanup timed out after {:?}",
                SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT
            );
        }
    } else {
        axum::serve(listener, router).await?;
    }

    Ok(())
}
