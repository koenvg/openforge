#[cfg(test)]
use super::stream_termination::CompanionStreamTermination;
use super::{
    contract::CompanionErrorCode,
    devices::{
        CompanionDeviceAuthentication, CompanionDeviceRecord, CompanionDeviceRemoval,
        CompanionDeviceRevocationBatch, CompanionDeviceStore, CompanionPairedDevice,
    },
    stream_termination::{CompanionStreamAuthorization, CompanionStreamTerminator},
};
use axum::http::HeaderMap;
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionAuthenticatedDevice {
    pub(crate) device_id: String,
}

/// Owns paired-device persistence, credential authentication, and trust invalidation.
pub(super) struct CompanionTrustPolicy {
    devices: Arc<dyn CompanionDeviceStore>,
    stream_terminator: CompanionStreamTerminator,
}

impl CompanionTrustPolicy {
    pub(super) fn new(devices: Arc<dyn CompanionDeviceStore>) -> Self {
        Self {
            devices,
            stream_terminator: CompanionStreamTerminator::new(),
        }
    }

    pub(super) fn pair_device(
        &self,
        device_name: String,
        platform: String,
        credential: &str,
    ) -> Result<String, String> {
        let device_id = uuid::Uuid::new_v4().to_string();
        self.devices.save(&CompanionDeviceRecord {
            device_id: device_id.clone(),
            device_name,
            platform,
            credential_verifier: credential_verifier(credential),
            paired_at: chrono::Utc::now().timestamp(),
            last_seen_at: None,
            revoked_at: None,
        })?;
        Ok(device_id)
    }

    pub(super) fn devices(&self) -> Result<Vec<CompanionPairedDevice>, String> {
        self.devices
            .list()
            .map(|records| records.iter().map(CompanionPairedDevice::from).collect())
    }

    pub(super) fn revoke(&self, device_id: &str) -> Result<(), String> {
        if !self
            .devices
            .revoke(device_id, chrono::Utc::now().timestamp())?
        {
            return Err("Companion device was not found".to_string());
        }
        self.stream_terminator.device_revoked(device_id);
        Ok(())
    }

    pub(super) fn remove_revoked(&self, device_id: &str) -> Result<(), String> {
        match self.devices.remove_revoked(device_id)? {
            CompanionDeviceRemoval::Removed => Ok(()),
            CompanionDeviceRemoval::Active => {
                Err("Only revoked Companion devices can be removed".to_string())
            }
            CompanionDeviceRemoval::Missing => Err("Companion device was not found".to_string()),
        }
    }

    pub(super) fn revoke_all(&self) -> Result<CompanionDeviceRevocationBatch, String> {
        self.devices.revoke_all(chrono::Utc::now().timestamp())
    }

    pub(super) fn notify_all_devices_revoked(&self) {
        self.stream_terminator.all_devices_revoked();
    }

    pub(super) fn rollback_revoke_all(
        &self,
        batch: &CompanionDeviceRevocationBatch,
    ) -> Result<(), String> {
        self.devices.rollback_revoke_all(batch)
    }

    #[cfg(test)]
    pub(super) fn subscribe_stream_terminations(
        &self,
    ) -> tokio::sync::broadcast::Receiver<CompanionStreamTermination> {
        self.stream_terminator.subscribe()
    }

    pub(super) fn notify_gateway_closing(&self) {
        self.stream_terminator.gateway_closing();
    }

    pub(super) fn mark_gateway_not_accepting_streams(&self) {
        self.stream_terminator.mark_gateway_not_accepting();
    }

    pub(super) fn notify_gateway_running(&self) {
        self.stream_terminator.gateway_running();
    }

    pub(super) fn authorize_device(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        let credential = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| !value.is_empty())
            .ok_or(CompanionErrorCode::Unauthenticated)?;
        let supplied_verifier = credential_verifier(credential);
        match self
            .devices
            .authenticate(&supplied_verifier, chrono::Utc::now().timestamp())
            .map_err(|_| CompanionErrorCode::TemporarilyUnavailable)?
        {
            CompanionDeviceAuthentication::Active { device_id } => {
                Ok(CompanionAuthenticatedDevice { device_id })
            }
            CompanionDeviceAuthentication::Revoked => Err(CompanionErrorCode::Revoked),
            CompanionDeviceAuthentication::Missing => Err(CompanionErrorCode::Unauthenticated),
        }
    }

    pub(super) fn authorize_stream(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionStreamAuthorization, CompanionErrorCode> {
        let terminations = self.stream_terminator.begin_authorization()?;
        let principal = self.authorize_device(headers)?;
        self.stream_terminator.ensure_accepting()?;
        Ok(CompanionStreamAuthorization::new(
            principal.device_id,
            terminations,
        ))
    }
}

pub(super) fn credential_verifier(secret: &str) -> [u8; 32] {
    Sha256::digest(secret.as_bytes()).into()
}
