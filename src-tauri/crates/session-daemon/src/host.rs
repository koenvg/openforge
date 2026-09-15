//! Wire dispatch around the canonical host, not a second ownership ledger.
#[path = "host_checkpoint.rs"]
mod checkpoint;
pub(crate) use checkpoint::{HostCheckpoint, HostPause};
#[cfg(test)]
#[path = "host_checkpoint_tests.rs"]
mod checkpoint_tests;
use crate::{backend::Backend, journal::lock};
use base64::Engine;
use openforge_session_host::{HostLimits, HostState, InProcessHost, IoRequest, PtyHost};
use openforge_session_protocol::*;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct Host {
    host: InProcessHost<Backend>,
    pub backend: Backend,
    state: Arc<Mutex<HostState>>,
    runtime: tokio::runtime::Runtime,
    pub sidecar: crate::agent_gateway::Registration,
    pub shutdown: bool,
    pub ingress_gate: Arc<crate::quiescence::Gate>,
    restore_ingress_pause: Option<crate::quiescence::Paused>,
}
impl Host {
    pub fn new(
        installation: InstallationId,
        agent_runtime: crate::agent_config::AgentRuntime,
    ) -> Result<Self, Error> {
        let state = HostState::with_limits(HostLimits {
            live_sessions: 32,
            retained_sessions: 128,
            exit_history: 128,
            cleanup_reserve: 128,
            ..HostLimits::default()
        });
        let backend = Backend::new(
            installation.clone(),
            state.lifetime().clone(),
            agent_runtime,
        );
        let state = Arc::new(Mutex::new(state));
        let host = InProcessHost::new(backend.clone(), installation, Arc::clone(&state));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(|e| Error::Host(e.to_string()))?;
        Ok(Self {
            host,
            backend,
            state,
            runtime,
            sidecar: Default::default(),
            shutdown: false,
            ingress_gate: Default::default(),
            restore_ingress_pause: None,
        })
    }
    pub fn poll(&self) -> Result<(), Error> {
        self.backend.poll()
    }
    pub fn validate_replacement_controller(&self, controller: &Controller) -> Result<(), Error> {
        self.runtime.block_on(self.host.reconcile(controller)).map(|_| ()).map_err(Error::from)
    }
    fn inventory(&self, controller: &Controller) -> Result<Inventory, Error> {
        let hosted = self.runtime.block_on(self.host.reconcile(controller))?;
        let sessions: Vec<_> = hosted
            .iter()
            .map(|session| self.backend.session(session))
            .collect::<Result<_, _>>()?;
        let capacity = self
            .runtime
            .block_on(async { self.state.lock().await.capacity() });
        Ok(Inventory {
            controller: controller.clone(),
            cursor: lock(&self.backend.journal).cursor,
            capacity: Capacity {
                operation_receipts: capacity.operations.min(capacity.limits.operations),
                operation_limit: capacity.limits.operations,
                cleanup_receipts: capacity
                    .operations
                    .saturating_sub(capacity.limits.operations),
                cleanup_limit: capacity.limits.cleanup_reserve,
                retained_request_bytes: capacity.retained_request_bytes,
                request_byte_limit: capacity.limits.retained_request_bytes,
                live_sessions: sessions.iter().filter(|s| s.exit_code.is_none()).count(),
                live_limit: capacity.limits.live_sessions,
                retained_sessions: sessions.len(),
                session_limit: capacity.limits.retained_sessions,
            },
            sessions,
        })
    }
    pub fn handle(&mut self, command: Command) -> Result<Response, Error> {
        match command {
            Command::Capabilities | Command::Replacement { .. } | Command::ReplacementStatus { .. } => Err(Error::UnsupportedReplacement),
            Command::RegisterSidecar {
                controller,
                endpoint,
            } => {
                self.runtime.block_on(self.host.reconcile(&controller))?;
                if let Some(endpoint) = &endpoint {
                    endpoint.validate()?;
                }
                *self.sidecar.write().map_err(|_| Error::OutcomeUnknown)? = endpoint.map(Arc::new);
                Ok(Response::Done)
            }
            Command::Connect { installation } => {
                let connection = self.runtime.block_on(self.host.connect(&installation))?;
                *self.sidecar.write().map_err(|_| Error::OutcomeUnknown)? = None;
                Ok(Response::Inventory(self.inventory(&connection.controller)?))
            }
            Command::Inventory { controller } => {
                Ok(Response::Inventory(self.inventory(&controller)?))
            }
            Command::Spawn {
                controller,
                operation,
                command,
            } => {
                let pty =
                    self.runtime
                        .block_on(self.host.spawn(&controller, operation, command))?;
                let session = self
                    .inventory(&controller)?
                    .sessions
                    .into_iter()
                    .find(|s| s.pty == pty)
                    .ok_or(Error::StalePty)?;
                Ok(Response::Spawned(session))
            }
            Command::Io {
                controller,
                operation,
                pty,
                sequence,
                action,
            } => {
                self.runtime.block_on(self.host.io(
                    &controller,
                    operation,
                    IoRequest {
                        pty,
                        sequence,
                        action,
                    },
                ))?;
                Ok(Response::Done)
            }
            Command::Terminate {
                controller,
                operation,
                pty,
            } => {
                self.runtime
                    .block_on(self.host.terminate(&controller, operation, &pty))?;
                Ok(Response::Done)
            }
            Command::Recover { controller, pty } => {
                let cursor = lock(&self.backend.journal).cursor;
                let attachment =
                    self.runtime
                        .block_on(self.host.attach_recover(&controller, &pty, None))?;
                let snapshot = attachment.snapshot;
                let encoding = base64::engine::general_purpose::STANDARD;
                let decode = |data: &str| {
                    encoding
                        .decode(data)
                        .map_err(|_| Error::RecoveryUnavailable)
                };
                Ok(Response::Recovery(Recovery {
                    pty,
                    watermark: snapshot.watermark,
                    cursor,
                    portable_vt: decode(&snapshot.data)?,
                    compatibility_replay: decode(&snapshot.compatibility_data)?,
                    continuation: decode(&snapshot.continuation_data)?,
                }))
            }
            Command::Events { controller, after } => {
                self.runtime.block_on(self.host.reconcile(&controller))?;
                Ok(Response::Events(lock(&self.backend.journal).events(after)?))
            }
            Command::ShutdownEmpty { controller } => {
                self.runtime.block_on(self.host.reconcile(&controller))?;
                if !self.backend.empty()? {
                    return Err(Error::InvalidRequest);
                }
                self.shutdown = true;
                Ok(Response::Done)
            }
        }
    }
}
