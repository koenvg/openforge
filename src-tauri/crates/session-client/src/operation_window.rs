//! Blocking, controller-scoped mutation stream shared by all client clones.
use crate::Client;
use openforge_session_host::OperationWindow;
use openforge_session_protocol::*;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub(crate) type SharedWindow = Arc<Mutex<Option<ManagedWindow>>>;

pub(crate) struct ManagedWindow {
    window: OperationWindow,
    completed_through: u64,
    uncertain: bool,
    flush_scheduled: bool,
}

impl Client {
    /// Opts this controller into bounded retry retention after ownership reconciliation.
    ///
    /// # Errors
    /// Refuses incompatible daemons and stale controllers without falling back to legacy I/O.
    pub fn enable_operation_retirement(&self) -> Result<(), Error> {
        let mut managed = self
            .operation_window
            .lock()
            .map_err(|_| Error::OutcomeUnknown)?;
        if managed.is_some() {
            return Ok(());
        }
        self.inventory()?;
        let Response::OperationWindow(window) = self.request(Command::OpenOperationStream {
            controller: self.controller.clone(),
        })?
        else {
            return Err(Error::Version);
        };
        // An existing unacknowledged suffix belongs to an earlier client, not to this one.
        let uncertain = window.admitted_through != window.retired_through;
        *managed = Some(ManagedWindow {
            completed_through: window.retired_through,
            window,
            uncertain,
            flush_scheduled: false,
        });
        Ok(())
    }

    /// Flushes only results this client has received definitively.
    ///
    /// # Errors
    /// Preserves pending acknowledgement state on transport or controller errors.
    pub fn flush_operation_receipts(&self) -> Result<(), Error> {
        let mut guard = self
            .operation_window
            .lock()
            .map_err(|_| Error::OutcomeUnknown)?;
        if let Some(managed) = guard.as_mut() {
            self.flush_window(managed)?;
        }
        Ok(())
    }

    fn flush_window(&self, managed: &mut ManagedWindow) -> Result<(), Error> {
        if managed.completed_through <= managed.window.retired_through {
            return Ok(());
        }
        match self.request(Command::AcknowledgeOperations {
            controller: self.controller.clone(),
            stream: managed.window.stream,
            through: managed.completed_through,
        })? {
            Response::Done => {
                managed.window.retired_through = managed.completed_through;
                Ok(())
            }
            _ => Err(Error::InvalidRequest),
        }
    }

    fn ordered_mutation(
        &self,
        make: impl FnOnce(OperationId) -> Command,
    ) -> Result<Response, Error> {
        let mut guard = self
            .operation_window
            .lock()
            .map_err(|_| Error::OutcomeUnknown)?;
        let managed = guard.as_mut().ok_or(Error::Version)?;
        if managed.uncertain {
            return Err(Error::OutcomeUnknown);
        }
        // Admission is serialized so rejected requests never leave an ordinal hole.
        // Retire in batches, well below both the default count and byte budgets.
        if managed.completed_through - managed.window.retired_through >= 16 {
            self.flush_window(managed)?;
        }
        let ordinal = managed
            .window
            .admitted_through
            .checked_add(1)
            .ok_or(Error::Capacity)?;
        let operation = OperationId::ordered(managed.window.stream, ordinal)
            .map_err(|_| Error::InvalidRequest)?;
        let command = make(operation);
        let expects_spawn = matches!(&command, Command::Spawn { .. });
        let result = self.request(command).and_then(|response| {
            if matches!(
                (&response, expects_spawn),
                (Response::Spawned(_), true) | (Response::Done, false)
            ) {
                Ok(response)
            } else {
                Err(Error::OutcomeUnknown)
            }
        });
        match &result {
            Ok(_) => {
                managed.window.admitted_through = ordinal;
                managed.completed_through = ordinal;
            }
            Err(Error::OutcomeUnknown | Error::Transport(_)) => managed.uncertain = true,
            Err(_) => {
                // Definitive refusals may occur before admission or be recorded backend errors.
                // Inspect the authoritative boundary; never assume either from the error text.
                match self
                    .inventory()
                    .ok()
                    .and_then(|inventory| inventory.capacity.operation_window)
                {
                    Some(window)
                        if window.stream == managed.window.stream
                            && window.admitted_through == ordinal =>
                    {
                        managed.window.admitted_through = ordinal;
                        managed.completed_through = ordinal;
                    }
                    Some(window) if window == managed.window => {}
                    _ => managed.uncertain = true,
                }
            }
        }
        if managed.completed_through > managed.window.retired_through && !managed.flush_scheduled {
            managed.flush_scheduled = true;
            let client = self.clone();
            // One short-lived worker per burst, not one worker per keystroke. A failed flush
            // stays pending and is retried by later traffic or an explicit flush.
            if std::thread::Builder::new()
                .name("session-receipt-flush".into())
                .spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    let Ok(mut guard) = client.operation_window.lock() else {
                        return;
                    };
                    if let Some(managed) = guard.as_mut() {
                        let _ = client.flush_window(managed);
                        managed.flush_scheduled = false;
                    }
                })
                .is_err()
            {
                managed.flush_scheduled = false;
            }
        }
        result
    }

    /// Starts a terminal using a client-owned operation identity.
    /// # Errors
    /// Returns admission errors or an explicit unknown outcome, never automatically replaying.
    pub fn spawn_ordered(&self, command: &ShellCommand) -> Result<Session, Error> {
        match self.ordered_mutation(|operation| Command::Spawn {
            controller: self.controller.clone(),
            operation,
            command: command.clone(),
        })? {
            Response::Spawned(session) => Ok(session),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// Writes once in PTY sequence order.
    /// # Errors
    /// Returns refusals or unknown outcomes without replaying input.
    pub fn write_ordered(
        &self,
        pty: &PtyIdentity,
        sequence: u64,
        bytes: &[u8],
    ) -> Result<(), Error> {
        self.io_ordered(pty, sequence, IoAction::Write(bytes.to_vec()))
    }

    /// Resizes once in PTY sequence order.
    /// # Errors
    /// Returns stale-identity, ordering, geometry, and transport errors.
    pub fn resize_ordered(
        &self,
        pty: &PtyIdentity,
        sequence: u64,
        columns: u16,
        rows: u16,
    ) -> Result<(), Error> {
        self.io_ordered(pty, sequence, IoAction::Resize { columns, rows })
    }

    fn io_ordered(&self, pty: &PtyIdentity, sequence: u64, action: IoAction) -> Result<(), Error> {
        match self.ordered_mutation(|operation| Command::Io {
            controller: self.controller.clone(),
            operation,
            pty: pty.clone(),
            sequence,
            action,
        })? {
            Response::Done => Ok(()),
            _ => Err(Error::InvalidRequest),
        }
    }

    /// Terminates only the exact PTY identity.
    /// # Errors
    /// Returns controller, identity, cleanup, or transport errors.
    pub fn terminate_ordered(&self, pty: &PtyIdentity) -> Result<(), Error> {
        match self.ordered_mutation(|operation| Command::Terminate {
            controller: self.controller.clone(),
            operation,
            pty: pty.clone(),
        })? {
            Response::Done => Ok(()),
            _ => Err(Error::InvalidRequest),
        }
    }
}
