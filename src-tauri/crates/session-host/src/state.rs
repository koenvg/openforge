#[path = "checkpoint.rs"]
mod checkpoint;
#[path = "operation_retention.rs"]
mod retention;
pub use checkpoint::MAX_HOST_CHECKPOINT_BYTES;
use serde::{Deserialize, Serialize};

use std::collections::HashMap;

use super::*;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum Mutation {
    Spawn(SpawnRequest),
    Terminate(PtyIdentity),
    Io(IoRequest),
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) enum Receipt {
    Spawn(PtyIdentity),
    Done,
}

struct RecordedOperation {
    request: Mutation,
    // Stored before calling the adapter. Cancellation never makes a retry execute twice.
    result: Result<Receipt, HostError>,
}

pub struct HostState {
    installation: Option<InstallationId>,
    lifetime: DaemonLifetimeId,
    generation: u64,
    pub(super) sessions: HashMap<PtyInstanceId, HostedSession>,
    pub(super) input_sequences: HashMap<PtyInstanceId, u64>,
    operations: HashMap<OperationId, RecordedOperation>,
    retained_bytes: usize,
    operation_window: Option<OperationWindow>,
    limits: HostLimits,
}

impl Default for HostState {
    fn default() -> Self {
        Self::new()
    }
}

impl HostState {
    pub fn new() -> Self {
        Self {
            installation: None,
            lifetime: DaemonLifetimeId::fresh(),
            generation: 0,
            sessions: HashMap::new(),
            input_sequences: HashMap::new(),
            operations: HashMap::new(),
            retained_bytes: 0,
            operation_window: None,
            limits: HostLimits::default(),
        }
    }

    pub fn with_limits(limits: HostLimits) -> Self {
        Self {
            limits,
            ..Self::new()
        }
    }
    pub fn lifetime(&self) -> &DaemonLifetimeId {
        &self.lifetime
    }
    /// Installation established by the first controller connection.
    pub fn installation(&self) -> Option<&InstallationId> {
        self.installation.as_ref()
    }
    /// Retained identities let a resource-owning adapter validate a combined checkpoint.
    pub fn retained_sessions(&self) -> impl ExactSizeIterator<Item = &HostedSession> {
        self.sessions.values()
    }
    pub fn capacity(&self) -> HostCapacity {
        HostCapacity {
            operation_window: self.operation_window,
            operations: self.operations.len(),
            retained_request_bytes: self.retained_bytes,
            limits: self.limits,
        }
    }
    pub(super) fn admit_spawn(&self) -> Result<(), HostError> {
        if self.sessions.len() >= self.limits.retained_sessions
            || self
                .sessions
                .values()
                .filter(|s| s.state != HostedSessionState::Exited)
                .count()
                >= self.limits.live_sessions
        {
            return Err(self.capacity_error(CapacityKind::Sessions));
        }
        Ok(())
    }

    pub(super) fn check_installation(
        &self,
        installation: &InstallationId,
    ) -> Result<(), HostError> {
        if self
            .installation
            .as_ref()
            .is_some_and(|current| current != installation)
        {
            return Err(HostError::ForeignInstallation);
        }
        Ok(())
    }

    pub(super) fn connect(
        &mut self,
        installation: InstallationId,
    ) -> Result<Controller, HostError> {
        self.check_installation(&installation)?;
        let generation = self.generation.checked_add(1).ok_or(HostError::Capacity)?;
        self.installation = Some(installation.clone());
        self.generation = generation;
        Ok(Controller {
            installation,
            lifetime: self.lifetime.clone(),
            generation: ControllerGeneration::new(generation)?,
        })
    }

    pub(super) fn validate(&self, controller: &Controller) -> Result<(), HostError> {
        if self.installation.as_ref() != Some(&controller.installation) {
            return Err(HostError::ForeignInstallation);
        }
        if controller.lifetime != self.lifetime || controller.generation.value() != self.generation
        {
            return Err(HostError::StaleController);
        }
        Ok(())
    }

    pub(super) fn identity(
        &self,
        installation: &InstallationId,
        instance: PtyInstanceId,
    ) -> PtyIdentity {
        PtyIdentity {
            installation: installation.clone(),
            lifetime: self.lifetime.clone(),
            instance,
        }
    }

    pub(super) fn session(&self, pty: &PtyIdentity) -> Result<&HostedSession, HostError> {
        self.sessions
            .get(&pty.instance)
            .filter(|session| &session.pty == pty)
            .ok_or(HostError::StalePty)
    }

    pub(super) fn observe(
        &mut self,
        installation: &InstallationId,
        inventory: Vec<BackendSession>,
    ) -> Vec<HostedSession> {
        for session in self.sessions.values_mut() {
            session.state = HostedSessionState::Exited;
        }
        for item in inventory {
            let session = HostedSession {
                pty: self.identity(installation, item.instance),
                session_key: item.session_key,
                state: item.state,
                next_io_sequence: self
                    .input_sequences
                    .get(&item.instance)
                    .copied()
                    .unwrap_or(0)
                    .checked_add(1),
            };
            self.sessions.insert(item.instance, session);
        }
        self.retain_exit_history();
        let mut inventory: Vec<_> = self.sessions.values().cloned().collect();
        inventory.sort_by_key(|session| session.pty.instance.value());
        inventory
    }

    pub(super) fn retain_exit_history(&mut self) {
        // Never truncate current ownership to make room for history. Legacy callers
        // can create sessions beyond this interface's admission limit.
        let mut exited: Vec<_> = self
            .sessions
            .values()
            .filter(|session| session.state == HostedSessionState::Exited)
            .map(|session| session.pty.instance)
            .collect();
        let excess = exited.len().saturating_sub(self.limits.exit_history);
        exited.sort_by_key(|instance| instance.value());
        for instance in exited.into_iter().take(excess) {
            self.sessions.remove(&instance);
        }
        // Operation receipts and input counters are separately bounded by admitted
        // operations. Keep them: expiry of exit history must not permit reexecution.
    }

    pub(super) fn retry(
        &self,
        operation: &OperationId,
        request: &Mutation,
    ) -> Result<Option<Receipt>, HostError> {
        self.validate_operation(operation)?;
        let Some(record) = self.operations.get(operation) else {
            return Ok(None);
        };
        if &record.request != request {
            return Err(HostError::OperationConflict);
        }
        record.result.clone().map(Some)
    }

    pub(super) fn begin(
        &mut self,
        operation: OperationId,
        request: Mutation,
        bytes: usize,
    ) -> Result<(), HostError> {
        let position = self.validate_operation(&operation)?;
        if let (Some(window), Some(ordinal)) = (self.operation_window, position) {
            if window.admitted_through.checked_add(1) != Some(ordinal) {
                return Err(HostError::OutOfOrder);
            }
        }
        // Ordinary traffic cannot consume the reserved allowance for scoped cleanup.
        let reserve = if matches!(request, Mutation::Terminate(_)) {
            self.limits.cleanup_reserve
        } else {
            0
        };
        if self.operations.len() >= self.limits.operations + reserve {
            return Err(self.capacity_error(CapacityKind::OperationReceipts));
        }
        if self.retained_bytes + bytes > self.limits.retained_request_bytes + reserve * 512 {
            return Err(self.capacity_error(CapacityKind::RequestBytes));
        }
        if let (Some(window), Some(ordinal)) = (&mut self.operation_window, position) {
            window.admitted_through = ordinal;
        }
        self.retained_bytes += bytes;
        self.operations.insert(
            operation,
            RecordedOperation {
                request,
                result: Err(HostError::OutcomeUnknown),
            },
        );
        Ok(())
    }

    pub(super) fn finish(&mut self, operation: &OperationId, result: Result<Receipt, HostError>) {
        if let Some(record) = self.operations.get_mut(operation) {
            record.result = result;
        }
    }
}
