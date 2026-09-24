//! Durable restart and Quit policy, separate from connection and event transport.
//!
//! Callers hold the transport's connection lock for every method. The operation
//! mutex protects storage only; it does not replace command admission or controller
//! fencing under that connection lock.
use super::super::daemon_restart::{Intent, Operation, Phase, ReconnectContext};
use openforge_session_client::Client;
use openforge_session_protocol::Error;
use std::path::Path;
use std::sync::Mutex;

#[derive(Default)]
struct State {
    operation: Option<Operation>,
    initialized: bool,
}

#[derive(Default)]
pub(super) struct Restart {
    state: Mutex<State>,
}

impl Restart {
    pub(super) fn reconnect(&self, root: &Path, client: &Client) -> Result<(), Error> {
        let mut state = self.state.lock().map_err(|_| Error::OutcomeUnknown)?;
        let context = if state.initialized {
            ReconnectContext::ConnectionRetry
        } else {
            ReconnectContext::Startup
        };
        state.operation = Operation::reconnect(root, client, context)?;
        state.initialized = true;
        Ok(())
    }

    pub(super) fn blocks_mutations(&self) -> Result<bool, Error> {
        Ok(self
            .state
            .lock()
            .map_err(|_| Error::OutcomeUnknown)?
            .operation
            .as_ref()
            .is_some_and(Operation::blocks_mutations))
    }

    pub(super) fn prepare(
        &self,
        root: &Path,
        client: &Client,
        operation_id: String,
        intent: Intent,
    ) -> Result<(), Error> {
        client.inventory()?;
        let mut state = self.state.lock().map_err(|_| Error::OutcomeUnknown)?;
        let operation = &mut state.operation;
        if operation.as_ref().is_some_and(Operation::blocks_mutations) {
            return Err(Error::OperationConflict);
        }
        let prepared = Operation::new(operation_id, client.controller().clone(), intent)?;
        *operation = Some(prepared.clone());
        prepared.persist(root)?;
        // Scoped sessions are explicitly not resumable. Their verified daemon
        // process groups must stop before the preservation handoff.
        for session in client.inventory()?.sessions {
            if openforge_session_host::scoped_agent_digest(&session.session_key).is_some()
                && session.exit_code.is_none()
            {
                client.terminate_ordered(&session.pty)?;
            }
        }
        Ok(())
    }

    pub(super) fn transition(
        &self,
        root: &Path,
        client: &Client,
        operation_id: String,
        from: Phase,
        to: Phase,
    ) -> Result<(), Error> {
        client.inventory()?;
        let mut state = self.state.lock().map_err(|_| Error::OutcomeUnknown)?;
        let operation = state.operation.as_mut().ok_or(Error::OperationConflict)?;
        if operation.operation_id == operation_id && operation.phase == to {
            return Ok(());
        }
        if operation.operation_id != operation_id
            || operation.phase != from
            || operation.controller != *client.controller()
        {
            return Err(Error::OperationConflict);
        }
        // Retain the safe intent even if the fsync acknowledgement is lost.
        operation.phase = to;
        operation.persist(root)?;
        if to == Phase::Detached {
            client.register_sidecar(None)?;
        }
        Ok(())
    }

    pub(super) fn shutdown(&self, root: &Path, client: &Client) -> Result<(), Error> {
        let mut state = self.state.lock().map_err(|_| Error::OutcomeUnknown)?;
        let slot = &mut state.operation;
        if slot.as_ref().is_some_and(Operation::preserves_sessions) {
            return Ok(());
        }
        let inventory = client.inventory()?;
        let operation = Operation::new(
            uuid::Uuid::new_v4().to_string(),
            client.controller().clone(),
            Intent::Quit,
        )?;
        *slot = Some(operation.clone());
        operation.persist(root)?;
        for session in inventory.sessions {
            if session.exit_code.is_none() {
                client.terminate_ordered(&session.pty)?;
            }
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            match client.shutdown_empty() {
                Ok(()) => break,
                Err(Error::InvalidRequest) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(20))
                }
                Err(error) => return Err(error),
            }
        }
        let mut completed = operation;
        completed.phase = Phase::Committed;
        completed.persist(root)?;
        Ok(())
    }
}
