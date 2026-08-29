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
use std::{future::Future, net::SocketAddr, path::PathBuf, sync::Mutex, time::Duration};

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

fn process_memory_history_enabled_preference(db: &std::sync::Arc<Mutex<db::Database>>) -> bool {
    crate::process_memory_history::enabled_preference(db).unwrap_or_else(|error| {
        warn!("[process_memory] {error}");
        false
    })
}

fn restore_process_memory_history(state: &AppState, enabled: bool) {
    if enabled {
        state
            .process_memory_history
            .enable(state.process_memory_sampling_context());
    }
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

pub(super) async fn shutdown_sidecar_runtime(
    state: &AppState,
    companion_restore: Option<CompanionGatewayRestoreTask>,
) {
    info!("[http_server] Rust sidecar shutdown cleanup started");

    state.process_memory_history.disable();
    state
        .frontend_host_requests
        .shutdown("OpenForge is shutting down before the frontend host request completed");
    if let Some(companion_restore) = companion_restore {
        companion_restore.abort().await;
    }
    if let Some(companion_gateway) = &state.companion_gateway {
        companion_gateway.shutdown().await;
    }
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

pub(super) async fn run_electron_sidecar_with_cleanup<Serve>(
    serve: Serve,
    state: &AppState,
    companion_restore: Option<CompanionGatewayRestoreTask>,
) -> std::io::Result<()>
where
    Serve: Future<Output = std::io::Result<()>>,
{
    let serve_result = serve.await;

    // Outside the cleanup budget on purpose. A git fetch still running when
    // Electron escalates to SIGKILL is reparented to pid 1 and keeps running
    // across restarts, so signalling it must not depend on the bounded steps
    // below finishing. SIGTERM first: git unlinks its lockfiles on it.
    let signalled_fetches = crate::git_origin_fetch::terminate_active_git_fetches();
    if signalled_fetches > 0 {
        info!(
            "[http_server] Signalled {} running git fetch process group(s) during shutdown",
            signalled_fetches
        );
    }

    if tokio::time::timeout(
        SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
        shutdown_sidecar_runtime(state, companion_restore),
    )
    .await
    .is_err()
    {
        warn!(
            "[http_server] Rust sidecar shutdown cleanup timed out after {:?}",
            SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT
        );
    }

    // Whatever ignored SIGTERM through the whole cleanup window is out of chances.
    let killed_fetches = crate::git_origin_fetch::kill_active_git_fetches();
    if killed_fetches > 0 {
        warn!(
            "[http_server] Killed {} git fetch process group(s) that ignored SIGTERM",
            killed_fetches
        );
    }

    serve_result
}
pub(super) struct CompanionGatewayRestoreTask {
    task: Option<tokio::task::JoinHandle<()>>,
}

impl CompanionGatewayRestoreTask {
    async fn abort(mut self) {
        let Some(task) = self.task.take() else {
            return;
        };
        task.abort();
        if let Err(error) = task.await {
            if !error.is_cancelled() {
                warn!("[companion_gateway] Persisted restore task failed during shutdown: {error}");
            }
        }
    }
}

impl Drop for CompanionGatewayRestoreTask {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

pub(super) fn restore_companion_gateway_in_background(
    manager: crate::companion_gateway::CompanionGatewayManager,
    enabled: bool,
) -> Option<CompanionGatewayRestoreTask> {
    if !enabled {
        return None;
    }
    let task = tokio::spawn(async move {
        let status = manager.restore().await;
        if let Some(error) = status.error {
            warn!("[companion_gateway] Failed to restore enabled gateway: {error}");
        }
    });
    Some(CompanionGatewayRestoreTask { task: Some(task) })
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
    let app_event_bus = AppEventBus::new(1024, 1024);
    let companion_enabled = {
        let database = crate::db::acquire_db(&db);
        match crate::companion_gateway::enabled_preference(&database) {
            Ok(enabled) => enabled,
            Err(error) => {
                warn!("[companion_gateway] {error}");
                false
            }
        }
    };
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
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
    let companion_gateway = crate::companion_gateway::CompanionGatewayManager::production(
        db.clone(),
        app_event_bus.clone(),
        pty_manager.clone(),
        github_client.clone(),
        app.clone(),
        task_claims.clone(),
    );
    let poll_context = crate::github_poller::PollContext::new();
    let plugin_host = PluginHost::with_app_event_sender_and_task_claims(
        app.clone().unwrap_or_default(),
        Some(app_event_tx.clone()),
        task_claims.clone(),
    );
    let frontend_host_requests = plugin_host.frontend_host_requests();
    let process_memory_history = crate::process_memory_history::ProcessMemoryHistory::default();
    let process_memory_history_enabled = process_memory_history_enabled_preference(&db);
    let state = AppState {
        app,
        db: db.clone(),
        backend_token: std::env::var("OPENFORGE_BACKEND_TOKEN").ok(),
        pty_manager: Some(pty_manager),
        github_client: github_client.clone(),
        frontend_host_requests,
        plugin_host: Some(plugin_host),
        plugin_lifecycle_locks: crate::plugin_platform::PluginLifecycleLocks::new(),
        app_event_tx: Some(app_event_tx.clone()),
        app_event_bus: Some(app_event_bus),
        whisper,
        sidecar_readiness,
        companion_gateway: Some(companion_gateway.clone()),
        task_claims,
        task_start_worktree_root: crate::task_start::default_worktree_root(),
        process_memory_history: process_memory_history.clone(),
        poll_context: poll_context.clone(),
    };

    restore_process_memory_history(&state, process_memory_history_enabled);

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
    // Signal that the core loopback bridge is listening before independently
    // restoring the optional Companion Gateway.
    let _ = ready_tx.send(());
    let companion_restore = restore_companion_gateway_in_background(
        companion_gateway,
        companion_enabled && is_electron_sidecar,
    );
    if is_electron_sidecar {
        run_electron_sidecar_with_cleanup(
            async move {
                axum::serve(listener, router)
                    .with_graceful_shutdown(sidecar_shutdown_signal())
                    .await
            },
            &shutdown_state,
            companion_restore,
        )
        .await?;
    } else {
        axum::serve(listener, router).await?;
    }

    Ok(())
}

#[cfg(test)]
mod lifecycle_restore_tests {
    use super::*;

    #[tokio::test]
    async fn optional_companion_restore_does_not_block_core_startup() {
        let manager = crate::companion_gateway::delayed_test_manager(Duration::from_millis(250));
        let started_at = std::time::Instant::now();

        let restore_task = restore_companion_gateway_in_background(manager.clone(), true)
            .expect("enabled persisted gateway should own its background restore");

        assert!(
            started_at.elapsed() < Duration::from_millis(50),
            "optional gateway restoration must return control immediately"
        );
        restore_task.abort().await;
        manager.shutdown().await;
    }

    #[test]
    fn disabled_companion_restore_does_not_spawn_a_task() {
        assert!(restore_companion_gateway_in_background(
            crate::companion_gateway::test_manager(),
            false,
        )
        .is_none());
    }

    #[tokio::test]
    async fn persisted_process_memory_history_preference_restores_sampling_on_startup() {
        let (state, _temp_dir) =
            crate::test_support::test_state("process_memory_history_startup_restore", |_, _| {});
        crate::db::acquire_db(&state.db)
            .set_config(
                crate::process_memory_history::PROCESS_MEMORY_HISTORY_ENABLED_CONFIG,
                "true",
            )
            .expect("persist history preference");

        let enabled = process_memory_history_enabled_preference(&state.db);
        restore_process_memory_history(&state, enabled);

        assert!(state.process_memory_history.snapshot().enabled);
        state.process_memory_history.disable();
    }
}
