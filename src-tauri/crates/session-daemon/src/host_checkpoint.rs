use super::*;
use crate::{
    backend::BackendCheckpoint,
    quiescence::{Gate, Paused},
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HostCheckpoint {
    format: u32,
    ledger: Vec<u8>,
    backend: BackendCheckpoint,
    sidecar: Option<SidecarEndpoint>,
}
pub(crate) struct HostPause {
    _readers: Vec<Paused>,
    _ingress: Paused,
}
impl HostCheckpoint {
    pub fn verify_credentials(
        &self,
        runtime: &crate::agent_config::AgentRuntime,
        deadline: &crate::pause_deadline::PauseDeadline,
    ) -> Result<(), Error> {
        self.backend.verify_credentials(runtime, Some(deadline))
    }
    pub fn validate_for_image(
        &self,
        installation: &InstallationId,
        runtime: &crate::agent_config::AgentRuntime,
    ) -> Result<(), Error> {
        if self.format != 1 {
            return Err(Error::Version);
        }
        if let Some(endpoint) = &self.sidecar {
            endpoint.validate()?;
        }
        let state = HostState::restore_checkpoint(&self.ledger)?;
        self.backend
            .validate_for_image(installation, &state, runtime)
    }
    pub fn descriptors(&self) -> Vec<i32> {
        self.backend.descriptors()
    }
}
impl Host {
    pub fn checkpoint(
        &self,
        deadline: &crate::pause_deadline::PauseDeadline,
    ) -> Result<(HostCheckpoint, HostPause), Error> {
        // Ingress drains before ledger/table gates; forwarding may itself need the table.
        let ingress = self.ingress_gate.pause(deadline.remaining()?)?;
        let state = self.runtime.block_on(async {
            tokio::time::timeout(deadline.remaining()?, self.state.lock())
                .await
                .map_err(|_| crate::pause_deadline::PauseDeadline::expired())
        })?;
        let (backend, readers) = self.backend.checkpoint(deadline)?;
        let ledger = state.checkpoint_before(deadline.instant())?;
        let sidecar = self
            .sidecar
            .read()
            .map_err(|_| Error::OutcomeUnknown)?
            .as_ref()
            .map(|endpoint| (**endpoint).clone());
        deadline.check()?;
        Ok((
            HostCheckpoint {
                format: 1,
                ledger,
                backend,
                sidecar,
            },
            HostPause {
                _readers: readers,
                _ingress: ingress,
            },
        ))
    }
    pub fn restore(
        saved: HostCheckpoint,
        installation: InstallationId,
        agent_runtime: crate::agent_config::AgentRuntime,
    ) -> Result<Self, Error> {
        if saved.format != 1 {
            return Err(Error::Version);
        }
        if let Some(endpoint) = &saved.sidecar {
            endpoint.validate()?;
        }
        let mut state = HostState::restore_checkpoint(&saved.ledger)?;
        saved.backend.validate_ledger(&installation, &state)?;
        let backend = Backend::restore(
            saved.backend,
            &installation,
            state.lifetime(),
            agent_runtime,
        )?;
        let limits = scaled_limits();
        state.expand_session_limits(
            limits.live_sessions,
            limits.retained_sessions,
            limits.exit_history,
            limits.cleanup_reserve,
        )?;
        let state = Arc::new(Mutex::new(state));
        let host = InProcessHost::new(backend.clone(), installation, Arc::clone(&state));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(|error| Error::Host(error.to_string()))?;
        let ingress_gate = Arc::new(Gate::default());
        let restore_ingress_pause = ingress_gate.pause(Duration::ZERO)?;
        Ok(Self {
            host,
            backend,
            state,
            runtime,
            sidecar: Arc::new(std::sync::RwLock::new(saved.sidecar.map(Arc::new))),
            ingress_gate,
            restore_ingress_pause: Some(restore_ingress_pause),
            shutdown: false,
        })
    }
    /// # Safety
    /// Only the post-exec image may activate reconstructed resources, once, after all
    /// retained descriptors have been validated and initialization can no longer fail.
    pub unsafe fn activate_restored(&mut self) -> Result<(), Error> {
        // SAFETY: caller establishes the image boundary; backend validates descriptor uniqueness.
        unsafe {
            self.backend.activate_restored()?;
        }
        self.restore_ingress_pause.take();
        Ok(())
    }
}
