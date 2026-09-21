use crate::Client;
use openforge_session_protocol::*;

impl Client {
    /// Retries must retain the operation ID, including after reconnect.
    /// # Errors
    /// Returns protocol admission, fencing and process creation errors.
    pub fn spawn(&self, operation: &str, command: &ShellCommand) -> Result<Session, Error> {
        match self.request(Command::Spawn {
            controller: self.controller.clone(),
            operation: OperationId::parse(operation).map_err(|_| Error::InvalidRequest)?,
            command: command.clone(),
        })? {
            Response::Spawned(session) => Ok(session),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// # Errors
    /// Reports unknown outcomes without automatically replaying input.
    pub fn write(
        &self,
        operation: &str,
        pty: &PtyIdentity,
        sequence: u64,
        bytes: &[u8],
    ) -> Result<(), Error> {
        self.io(operation, pty, sequence, IoAction::Write(bytes.to_vec()))
    }

    /// # Errors
    /// Rejects stale identities, invalid geometry and out-of-order I/O.
    pub fn resize(
        &self,
        operation: &str,
        pty: &PtyIdentity,
        sequence: u64,
        columns: u16,
        rows: u16,
    ) -> Result<(), Error> {
        self.io(operation, pty, sequence, IoAction::Resize { columns, rows })
    }

    fn io(
        &self,
        operation: &str,
        pty: &PtyIdentity,
        sequence: u64,
        action: IoAction,
    ) -> Result<(), Error> {
        self.done(Command::Io {
            controller: self.controller.clone(),
            operation: OperationId::parse(operation).map_err(|_| Error::InvalidRequest)?,
            pty: pty.clone(),
            sequence,
            action,
        })
    }

    /// # Errors
    /// Refuses foreign/stale PTYs and reports verified process cleanup failures.
    pub fn terminate(&self, operation: &str, pty: &PtyIdentity) -> Result<(), Error> {
        self.done(Command::Terminate {
            controller: self.controller.clone(),
            operation: OperationId::parse(operation).map_err(|_| Error::InvalidRequest)?,
            pty: pty.clone(),
        })
    }

    fn done(&self, command: Command) -> Result<(), Error> {
        match self.request(command)? {
            Response::Done => Ok(()),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// Returns authority state and an event cursor captured before the snapshot.
    /// Discard output at or below the snapshot watermark when joining later events.
    /// # Errors
    /// Refuses unavailable recovery rather than substituting a raw suffix.
    pub fn recover(&self, pty: &PtyIdentity) -> Result<Recovery, Error> {
        match self.request(Command::Recover {
            controller: self.controller.clone(),
            pty: pty.clone(),
        })? {
            Response::Recovery(snapshot) => Ok(snapshot),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// # Errors
    /// Rejects future cursors and stale controllers. A retained-history gap is explicit.
    pub fn events(&self, after: u64) -> Result<EventBatch, Error> {
        match self.request(Command::Events {
            controller: self.controller.clone(),
            after,
        })? {
            Response::Events(batch) => Ok(batch),
            _ => Err(Error::InvalidRequest),
        }
    }
}
