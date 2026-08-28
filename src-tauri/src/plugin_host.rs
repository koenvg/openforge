mod callbacks;
mod command_callbacks;
mod filesystem_callbacks;
mod host_app_event_callbacks;
mod lifecycle;
mod process_signals;
mod project_callbacks;
mod rpc_transport;
mod runtime_command;
mod shell_callbacks;
mod storage_config_callbacks;
mod task_callbacks;

#[cfg(test)]
mod tests;

use crate::{app_events::AppEventSender, backend_runtime::AppHandle, http_server::TaskClaims};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

use lifecycle::HostRuntime;
use rpc_transport::PluginTransportState;

pub use lifecycle::SidecarState;

pub struct PluginHost {
    runtime: Arc<Mutex<HostRuntime>>,
    transport: Arc<Mutex<PluginTransportState>>,
    state_change: Arc<Notify>,
    app_handle: AppHandle,
    app_event_tx: Option<AppEventSender>,
    frontend_host_requests: crate::frontend_host_request_transport::FrontendHostRequestTransport,
    task_claims: TaskClaims,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginHostProcessDiagnostics {
    pub state: String,
    pub pid: Option<u32>,
}

impl Clone for PluginHost {
    fn clone(&self) -> Self {
        Self {
            runtime: Arc::clone(&self.runtime),
            transport: Arc::clone(&self.transport),
            state_change: Arc::clone(&self.state_change),
            app_handle: self.app_handle.clone(),
            app_event_tx: self.app_event_tx.clone(),
            frontend_host_requests: self.frontend_host_requests.clone(),
            task_claims: self.task_claims.clone(),
        }
    }
}

impl PluginHost {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            runtime: Arc::new(Mutex::new(HostRuntime::default())),
            transport: Arc::new(Mutex::new(PluginTransportState::default())),
            state_change: Arc::new(Notify::new()),
            app_handle,
            app_event_tx: None,
            frontend_host_requests:
                crate::frontend_host_request_transport::FrontendHostRequestTransport::production(
                    None,
                ),
            task_claims: TaskClaims::new(),
        }
    }

    #[cfg(test)]
    pub fn with_app_event_sender(
        app_handle: AppHandle,
        app_event_tx: Option<AppEventSender>,
    ) -> Self {
        Self::with_app_event_sender_and_task_claims(app_handle, app_event_tx, TaskClaims::new())
    }

    pub fn with_app_event_sender_and_task_claims(
        app_handle: AppHandle,
        app_event_tx: Option<AppEventSender>,
        task_claims: TaskClaims,
    ) -> Self {
        let mut host = Self::new(app_handle);
        host.frontend_host_requests =
            crate::frontend_host_request_transport::FrontendHostRequestTransport::production(
                app_event_tx.clone(),
            );
        host.app_event_tx = app_event_tx;
        host.task_claims = task_claims;
        host
    }

    pub(in crate::plugin_host) fn database_state_for_host(
        &self,
    ) -> Result<Arc<Mutex<crate::db::Database>>, String> {
        self.app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .map(|state| Arc::clone(state.inner()))
            .ok_or_else(|| "plugin host database state is not available".to_string())
    }

    pub(in crate::plugin_host) fn app_state_for_host_callback(
        &self,
    ) -> Result<crate::http_server::AppState, String> {
        let db = self.database_state_for_host()?;
        let pty_manager = self
            .app_handle
            .try_state::<crate::pty_manager::PtyManager>()
            .map(|state| state.inner().clone());
        let github_client = self
            .app_handle
            .try_state::<crate::github_client::GitHubClient>()
            .map(|state| state.inner().clone())
            .unwrap_or_default();

        Ok(crate::http_server::AppState {
            app: Some(self.app_handle.clone()),
            db,
            backend_token: None,
            pty_manager,
            github_client,
            frontend_host_requests: self.frontend_host_requests.clone(),
            plugin_host: Some(self.clone()),
            plugin_lifecycle_locks: crate::plugin_platform::PluginLifecycleLocks::new(),
            app_event_tx: self.app_event_tx.clone(),
            app_event_bus: None,
            whisper: None,
            sidecar_readiness: crate::http_server::SidecarReadinessState::default(),
            companion_gateway: None,
            task_claims: self.task_claims.clone(),
            task_start_worktree_root: crate::task_start::default_worktree_root(),
            poll_context: crate::github_poller::PollContext::new(),
        })
    }

    pub(crate) fn frontend_host_requests(
        &self,
    ) -> crate::frontend_host_request_transport::FrontendHostRequestTransport {
        self.frontend_host_requests.clone()
    }

    pub(in crate::plugin_host) fn runtime_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HostRuntime>, String> {
        self.runtime
            .lock()
            .map_err(|_| "plugin host state lock poisoned".to_string())
    }

    pub(in crate::plugin_host) fn transport_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, PluginTransportState>, String> {
        self.transport
            .lock()
            .map_err(|_| "plugin host transport lock poisoned".to_string())
    }

    pub fn runtime_process_diagnostics(&self) -> Result<PluginHostProcessDiagnostics, String> {
        let runtime = self.runtime_lock()?;
        Ok(PluginHostProcessDiagnostics {
            state: format!("{:?}", runtime.state),
            pid: runtime.pid,
        })
    }
}
