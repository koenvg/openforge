//! Typed maintenance operations. Lost replies are resolved by status, never blind replay.
use crate::Client;
use openforge_session_protocol::{
    Capabilities, Command, Error, OperationId, ReplacementPhase, ReplacementState,
    ReplacementStatus, Response,
};
use std::time::{Duration, Instant};

impl Client {
    /// Returns the running daemon's executable identity and replacement support.
    /// # Errors
    /// Rejects unavailable or incompatible capability responses.
    pub fn capabilities(&self) -> Result<Capabilities, Error> {
        match self.request(Command::Capabilities)? {
            Response::Capabilities(value) => Ok(value),
            _ => Err(Error::OutcomeUnknown),
        }
    }
    /// Submits one maintenance phase and returns its acknowledged state, not completion.
    /// # Errors
    /// Preserves stale-controller, identity-conflict, capacity and transport failures.
    pub fn replacement_phase(
        &self,
        operation: OperationId,
        phase: ReplacementPhase,
    ) -> Result<ReplacementStatus, Error> {
        match self.request(Command::Replacement {
            controller: self.controller.clone(),
            operation,
            phase,
        })? {
            Response::Replacement(value) => Ok(value),
            _ => Err(Error::OutcomeUnknown),
        }
    }
    /// Looks up an operation without requiring the pre-replacement controller generation.
    /// # Errors
    /// An unknown receipt does not imply that an earlier request was never accepted.
    pub fn replacement_status(&self, operation: &OperationId) -> Result<ReplacementStatus, Error> {
        match self.request(Command::ReplacementStatus {
            operation: operation.clone(),
        })? {
            Response::Replacement(value) => Ok(value),
            _ => Err(Error::OutcomeUnknown),
        }
    }
    pub(crate) fn complete_replacement(
        &self,
        operation: OperationId,
        phase: ReplacementPhase,
    ) -> Result<(), Error> {
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut response = self.replacement_phase(operation.clone(), phase.clone());
        loop {
            match response {
                Ok(status) => {
                    if status.operation != operation {
                        return Err(Error::OutcomeUnknown);
                    }
                    match (&phase, &status.state) {
                        (ReplacementPhase::Prepare { .. }, ReplacementState::Prepared)
                        | (ReplacementPhase::Commit, ReplacementState::Activated)
                        | (ReplacementPhase::Abort, ReplacementState::Aborted) => return Ok(()),
                        (_, ReplacementState::Failed { stage }) => {
                            return Err(Error::Host(format!(
                                "replacement failed during {stage:?}; activation was unsuccessful"
                            )))
                        }
                        (_, ReplacementState::Aborted | ReplacementState::Activated) => {
                            return Err(Error::OperationConflict)
                        }
                        _ => {}
                    }
                }
                Err(Error::Transport(_) | Error::OutcomeUnknown) => {}
                Err(error) => return Err(error),
            }
            if Instant::now() >= deadline {
                return Err(Error::OutcomeUnknown);
            }
            std::thread::sleep(Duration::from_millis(25));
            response = self.replacement_status(&operation);
        }
    }
}
