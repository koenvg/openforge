use super::contract::CompanionErrorCode;
use std::sync::atomic::{AtomicBool, Ordering};

/// Trust-lifecycle signals consumed by the canonical Companion SSE route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CompanionStreamTermination {
    DeviceRevoked { device_id: String },
    AllDevicesRevoked,
    GatewayClosing,
}

impl CompanionStreamTermination {
    pub(crate) fn terminates(&self, device_id: &str) -> bool {
        match self {
            Self::DeviceRevoked { device_id: revoked } => revoked == device_id,
            Self::AllDevicesRevoked | Self::GatewayClosing => true,
        }
    }
}

/// Authenticated stream principal plus a race-safe trust termination subscription.
pub(crate) struct CompanionStreamAuthorization {
    device_id: String,
    terminations: tokio::sync::broadcast::Receiver<CompanionStreamTermination>,
}

impl CompanionStreamAuthorization {
    pub(super) fn new(
        device_id: String,
        terminations: tokio::sync::broadcast::Receiver<CompanionStreamTermination>,
    ) -> Self {
        Self {
            device_id,
            terminations,
        }
    }

    pub(crate) fn device_id(&self) -> &str {
        &self.device_id
    }

    pub(crate) async fn wait_for_termination(&mut self) -> CompanionStreamTermination {
        loop {
            match self.terminations.recv().await {
                Ok(termination) if termination.terminates(self.device_id()) => return termination,
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Missing any trust event is unsafe. Force the stream closed so the
                    // client reconnects and authenticates against current device state.
                    return CompanionStreamTermination::AllDevicesRevoked;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return CompanionStreamTermination::GatewayClosing;
                }
            }
        }
    }
}

pub(super) struct CompanionStreamTerminator {
    termination_tx: tokio::sync::broadcast::Sender<CompanionStreamTermination>,
    gateway_accepting_streams: AtomicBool,
}

impl CompanionStreamTerminator {
    pub(super) fn new() -> Self {
        let (termination_tx, _) = tokio::sync::broadcast::channel(64);
        Self {
            termination_tx,
            gateway_accepting_streams: AtomicBool::new(false),
        }
    }

    pub(super) fn begin_authorization(
        &self,
    ) -> Result<tokio::sync::broadcast::Receiver<CompanionStreamTermination>, CompanionErrorCode>
    {
        // Subscribe first, then authorize. A revocation racing authorization is
        // therefore either observed by the authorization read or queued for the stream.
        let terminations = self.subscribe();
        self.ensure_accepting()?;
        Ok(terminations)
    }

    pub(super) fn ensure_accepting(&self) -> Result<(), CompanionErrorCode> {
        if self.gateway_accepting_streams.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(CompanionErrorCode::TemporarilyUnavailable)
        }
    }

    pub(super) fn subscribe(&self) -> tokio::sync::broadcast::Receiver<CompanionStreamTermination> {
        self.termination_tx.subscribe()
    }

    pub(super) fn device_revoked(&self, device_id: &str) {
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::DeviceRevoked {
                device_id: device_id.to_string(),
            });
    }

    pub(super) fn all_devices_revoked(&self) {
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::AllDevicesRevoked);
    }

    pub(super) fn gateway_closing(&self) {
        self.mark_gateway_not_accepting();
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::GatewayClosing);
    }

    pub(super) fn mark_gateway_not_accepting(&self) {
        self.gateway_accepting_streams
            .store(false, Ordering::SeqCst);
    }

    pub(super) fn gateway_running(&self) {
        self.gateway_accepting_streams.store(true, Ordering::SeqCst);
    }
}
