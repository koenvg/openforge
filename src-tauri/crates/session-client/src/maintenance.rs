//! Updater access without acquiring a controller or admitting session mutations.
use crate::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::{
    Capabilities, Command, Controller, Error, InstallationId, Inventory, OperationId,
    ReplacementPhase, ReplacementStatus, Response,
};
use std::path::Path;

/// Borrows an existing controller for update preflight. It cannot spawn, write,
/// resize, terminate, or allocate a second operation window for live sessions.
pub struct MaintenanceClient {
    client: Client,
}

impl MaintenanceClient {
    /// Observe a replacement before starting Sidecar, without Connect, inventory
    /// authority, process launch, or acquisition of a controller generation.
    /// # Errors
    /// Refuses foreign installations, unsafe sockets, unavailable owners and
    /// unknown or mismatched receipts. Observation never proves a missing operation.
    pub fn observe_replacement(
        root: &Path,
        installation: &InstallationId,
        operation: &OperationId,
    ) -> Result<(Capabilities, ReplacementStatus), Error> {
        let runtime = RuntimeDirectory::open_existing(root)?;
        runtime.check_socket()?;
        if &runtime.credentials().installation != installation {
            return Err(Error::ForeignInstallation);
        }
        let request =
            |command| crate::exchange(&runtime.socket_path(), runtime.credentials(), command);
        let capabilities = match request(Command::Capabilities)? {
            Response::Capabilities(value) => value,
            _ => return Err(Error::OutcomeUnknown),
        };
        let status = match request(Command::ReplacementStatus {
            operation: operation.clone(),
        })? {
            Response::Replacement(value) if &value.operation == operation => value,
            _ => return Err(Error::OutcomeUnknown),
        };
        Ok((capabilities, status))
    }

    /// Authenticates the supplied controller without sending Connect or launching a daemon.
    /// # Errors
    /// Refuses foreign installations, stale controllers and unsafe or unavailable runtimes.
    pub fn attach(root: &Path, controller: Controller) -> Result<Self, Error> {
        let runtime = RuntimeDirectory::open_existing(root)?;
        runtime.check_socket()?;
        let credentials = runtime.credentials().clone();
        if controller.installation != credentials.installation {
            return Err(Error::ForeignInstallation);
        }
        let client = Client {
            socket: runtime.socket_path(),
            credentials,
            controller,
            operation_window: Default::default(),
        };
        client.inventory()?;
        Ok(Self { client })
    }

    /// Runs compatibility preflight while the current Sidecar retains its controller.
    /// # Errors
    /// Refuses stale authority, unsupported images and unresolved maintenance outcomes.
    pub fn prepare(
        &self,
        operation: OperationId,
        executable: &Path,
    ) -> Result<ReplacementStatus, Error> {
        self.client.complete_replacement(
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: executable.into(),
            },
        )?;
        self.status(&operation)
    }

    /// Called after the owned Sidecar has detached and exited. Does not start another owner.
    /// # Errors
    /// Refuses stale authority, failed activation and unresolved maintenance outcomes.
    pub fn activate(&self, operation: OperationId) -> Result<ReplacementStatus, Error> {
        self.client
            .complete_replacement(operation.clone(), ReplacementPhase::Commit)?;
        self.status(&operation)
    }

    /// # Errors
    /// Refuses stale authority or a replacement that can no longer be aborted.
    pub fn abort(&self, operation: OperationId) -> Result<(), Error> {
        self.client
            .complete_replacement(operation, ReplacementPhase::Abort)
    }

    /// # Errors
    /// Rejects unknown receipts and unauthenticated or unavailable replies.
    pub fn status(&self, operation: &OperationId) -> Result<ReplacementStatus, Error> {
        let status = self.client.replacement_status(operation)?;
        if &status.operation != operation {
            return Err(Error::OutcomeUnknown);
        }
        Ok(status)
    }

    /// # Errors
    /// Refuses stale authority, unavailable owners and unauthenticated replies.
    pub fn inventory(&self) -> Result<Inventory, Error> {
        self.client.inventory()
    }

    /// # Errors
    /// Refuses stale authority and unavailable or incompatible capability responses.
    pub fn capabilities(&self) -> Result<Capabilities, Error> {
        self.client.inventory()?;
        self.client.capabilities()
    }
}
