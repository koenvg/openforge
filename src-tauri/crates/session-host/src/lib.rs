//! Opt-in terminal host contract. The Sidecar remains the only production PTY owner.
//! Legacy renderer/plugin operations deliberately do not acquire controller generations.
//! Only calls through this interface participate in its fencing and retry contract.

mod backend;
mod identity;
mod io;
pub use io::{ControllerFence, HostAttachment};
mod operation_window;
pub use operation_window::OperationWindow;
mod state;
mod terminal_color_profile;
mod types;
pub use backend::{
    BackendAttachment, BackendOutput, BackendOutputStream, BackendSession, HostBackend,
};
pub use identity::*;
pub use state::{HostState, MAX_HOST_CHECKPOINT_BYTES};
pub use terminal_color_profile::{
    TerminalColorProfile, TerminalRgbColor, TERMINAL_COLOR_PROFILE_VERSION,
};
pub use types::*;

use state::{Mutation, Receipt};
use std::future::Future;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A transport-independent boundary, not a mirror of PtyManager's bookkeeping helpers.
pub trait PtyHost: Send + Sync {
    fn connect(
        &self,
        installation: &InstallationId,
    ) -> impl Future<Output = Result<Connection, HostError>> + Send;
    fn reconcile(
        &self,
        controller: &Controller,
    ) -> impl Future<Output = Result<Vec<HostedSession>, HostError>> + Send;
    fn set_terminal_color_profile(
        &self,
        controller: &Controller,
        operation: OperationId,
        profile: TerminalColorProfile,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
    fn spawn(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: SpawnRequest,
    ) -> impl Future<Output = Result<PtyIdentity, HostError>> + Send;
    fn terminate(
        &self,
        controller: &Controller,
        operation: OperationId,
        pty: &PtyIdentity,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
    fn attach_recover(
        &self,
        controller: &Controller,
        pty: &PtyIdentity,
        after: Option<OutputPosition>,
    ) -> impl Future<Output = Result<HostAttachment, HostError>> + Send;
    fn io(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: IoRequest,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
    fn replacement(
        &self,
        controller: &Controller,
        operation: OperationId,
        phase: ReplacementPhase,
    ) -> impl Future<Output = Result<(), HostError>> + Send;
}

/// Shares one control ledger with all handles to the existing owner. It creates no
/// additional PTY owner, background process, socket, or durable restart state.
#[derive(Clone)]
pub struct InProcessHost<B> {
    backend: B,
    installation: InstallationId,
    state: Arc<Mutex<HostState>>,
}

impl<B> InProcessHost<B> {
    fn validate(&self, state: &HostState, controller: &Controller) -> Result<(), HostError> {
        if controller.installation != self.installation {
            return Err(HostError::ForeignInstallation);
        }
        state.validate(controller)
    }

    pub fn new(backend: B, installation: InstallationId, state: Arc<Mutex<HostState>>) -> Self {
        Self {
            backend,
            installation,
            state,
        }
    }
}

impl<B: HostBackend> PtyHost for InProcessHost<B> {
    async fn set_terminal_color_profile(
        &self,
        controller: &Controller,
        operation: OperationId,
        profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        profile.validate()?;
        let mut state = Arc::clone(&self.state).lock_owned().await;
        self.validate(&state, controller)?;
        let mutation = Mutation::SetTerminalColorProfile(profile);
        if state.retry(&operation, &mutation)?.is_some() {
            return Ok(());
        }
        state.begin(
            operation.clone(),
            mutation,
            std::mem::size_of::<TerminalColorProfile>(),
        )?;
        let backend = self.backend.clone();
        tokio::spawn(async move {
            let result = backend.set_terminal_color_profile(profile).await;
            state.finish(&operation, result.clone().map(|()| Receipt::Done));
            result
        })
        .await
        .map_err(|_| HostError::OutcomeUnknown)?
    }

    async fn attach_recover(
        &self,
        controller: &Controller,
        pty: &PtyIdentity,
        after: Option<OutputPosition>,
    ) -> Result<HostAttachment, HostError> {
        self.attach_session(controller, pty, after).await
    }

    async fn io(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: IoRequest,
    ) -> Result<(), HostError> {
        self.ordered_io(controller, operation, request).await
    }

    async fn replacement(
        &self,
        controller: &Controller,
        _operation: OperationId,
        _phase: ReplacementPhase,
    ) -> Result<(), HostError> {
        let state = self.state.lock().await;
        self.validate(&state, controller)?;
        Err(HostError::UnsupportedReplacement)
    }

    async fn connect(&self, installation: &InstallationId) -> Result<Connection, HostError> {
        if installation != &self.installation {
            return Err(HostError::ForeignInstallation);
        }
        let mut state = self.state.lock().await;
        state.check_installation(installation)?;
        let inventory = state.observe(installation, self.backend.inventory().await?);
        let controller = state.connect(installation.clone())?;
        Ok(Connection {
            controller,
            inventory,
            supports_replacement: false,
        })
    }

    async fn reconcile(&self, controller: &Controller) -> Result<Vec<HostedSession>, HostError> {
        let mut state = self.state.lock().await;
        self.validate(&state, controller)?;
        Ok(state.observe(&controller.installation, self.backend.inventory().await?))
    }

    async fn spawn(
        &self,
        controller: &Controller,
        operation: OperationId,
        request: SpawnRequest,
    ) -> Result<PtyIdentity, HostError> {
        let mut state = Arc::clone(&self.state).lock_owned().await;
        self.validate(&state, controller)?;
        let bytes = request.validate()?;
        let mutation = Mutation::Spawn(request.clone());
        if let Some(Receipt::Spawn(pty)) = state.retry(&operation, &mutation)? {
            return Ok(pty);
        }
        state.admit_spawn()?;
        state.begin(operation.clone(), mutation, bytes)?;
        let backend = self.backend.clone();
        let installation = controller.installation.clone();
        // The worker retains the mutation gate and owner through caller cancellation.
        // Reconnection waits for its result rather than abandoning a half-owned child.
        tokio::spawn(async move {
            let result = backend.spawn_prepared(&request).await.map(|instance| {
                let pty = state.identity(&installation, instance);
                let session_key = request.owner.session_key();
                for previous in state.sessions.values_mut() {
                    if previous.session_key == session_key {
                        previous.state = HostedSessionState::Exited;
                    }
                }
                state.sessions.insert(
                    instance,
                    HostedSession {
                        pty: pty.clone(),
                        session_key,
                        state: HostedSessionState::Live,
                        next_io_sequence: Some(1),
                    },
                );
                state.retain_exit_history();
                pty
            });
            state.finish(&operation, result.clone().map(Receipt::Spawn));
            result
        })
        .await
        .map_err(|_| HostError::OutcomeUnknown)?
    }

    async fn terminate(
        &self,
        controller: &Controller,
        operation: OperationId,
        pty: &PtyIdentity,
    ) -> Result<(), HostError> {
        let mut state = Arc::clone(&self.state).lock_owned().await;
        self.validate(&state, controller)?;
        let mutation = Mutation::Terminate(pty.clone());
        if state.retry(&operation, &mutation)?.is_some() {
            return Ok(());
        }
        let session = state.session(pty)?.clone();
        state.begin(operation.clone(), mutation, 512)?;
        let backend = self.backend.clone();
        tokio::spawn(async move {
            let result = backend.terminate_exact(&session).await;
            if result.is_ok() {
                if let Some(current) = state.sessions.get_mut(&session.pty.instance) {
                    current.state = HostedSessionState::Exited;
                }
                state.retain_exit_history();
            }
            state.finish(&operation, result.clone().map(|()| Receipt::Done));
            result
        })
        .await
        .map_err(|_| HostError::OutcomeUnknown)?
    }
}

mod presentation;
pub use presentation::*;
#[cfg(feature = "test-contracts")]
pub mod contracts;
