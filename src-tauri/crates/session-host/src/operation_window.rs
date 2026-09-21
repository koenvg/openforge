//! Acknowledged retry history. The boundary rejects expired requests without tombstones.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationWindow {
    pub stream: u64,
    pub retired_through: u64,
    pub admitted_through: u64,
}

impl OperationId {
    /// Creates an identity bound to a negotiated stream and ordinal.
    ///
    /// # Errors
    /// Zero is reserved for both stream and ordinal.
    pub fn ordered(stream: u64, ordinal: u64) -> Result<Self, IdentityError> {
        ControllerGeneration::new(stream)?;
        ControllerGeneration::new(ordinal)?;
        Self::parse(format!("ordered.{stream}.{ordinal}"))
    }

    pub(crate) fn position(&self) -> Option<(u64, u64)> {
        let mut parts = self.as_str().strip_prefix("ordered.")?.split('.');
        let stream = parts.next()?.parse().ok()?;
        let ordinal = parts.next()?.parse().ok()?;
        let canonical = Self::ordered(stream, ordinal).ok()?;
        (parts.next().is_none() && &canonical == self).then_some((stream, ordinal))
    }
}

impl<B: HostBackend> InProcessHost<B> {
    /// Fences prior operation streams after the caller has reconciled ownership.
    /// Repeating this in the same controller generation is idempotent.
    ///
    /// # Errors
    /// Rejects stale or foreign controllers. This never replays unknown mutations.
    pub async fn open_operation_stream(
        &self,
        controller: &Controller,
    ) -> Result<OperationWindow, HostError> {
        let mut state = self.state.lock().await;
        self.validate(&state, controller)?;
        Ok(state.open_operation_stream(controller.generation.value()))
    }

    /// Retires a contiguous prefix of settled operations without consuming admission capacity.
    ///
    /// # Errors
    /// Rejects stale controllers, foreign streams, and acknowledgements of unresolved work.
    pub async fn acknowledge_operations(
        &self,
        controller: &Controller,
        stream: u64,
        through: u64,
    ) -> Result<(), HostError> {
        let mut state = self.state.lock().await;
        self.validate(&state, controller)?;
        state.acknowledge_operations(stream, through)
    }
}
