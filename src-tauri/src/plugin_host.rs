mod callbacks;
mod filesystem_callbacks;
mod lifecycle;
mod rpc_transport;
mod task_callbacks;

#[cfg(test)]
mod tests;

use crate::{
    app_events::AppEventSender, backend_runtime::AppHandle, http_server::StartImplementationClaims,
};
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
    start_implementation_claims: StartImplementationClaims,
}

impl Clone for PluginHost {
    fn clone(&self) -> Self {
        Self {
            runtime: Arc::clone(&self.runtime),
            transport: Arc::clone(&self.transport),
            state_change: Arc::clone(&self.state_change),
            app_handle: self.app_handle.clone(),
            app_event_tx: self.app_event_tx.clone(),
            start_implementation_claims: self.start_implementation_claims.clone(),
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
            start_implementation_claims: StartImplementationClaims::new(),
        }
    }

    #[cfg(test)]
    pub fn with_app_event_sender(
        app_handle: AppHandle,
        app_event_tx: Option<AppEventSender>,
    ) -> Self {
        Self::with_app_event_sender_and_start_claims(
            app_handle,
            app_event_tx,
            StartImplementationClaims::new(),
        )
    }

    pub fn with_app_event_sender_and_start_claims(
        app_handle: AppHandle,
        app_event_tx: Option<AppEventSender>,
        start_implementation_claims: StartImplementationClaims,
    ) -> Self {
        let mut host = Self::new(app_handle);
        host.app_event_tx = app_event_tx;
        host.start_implementation_claims = start_implementation_claims;
        host
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
}
