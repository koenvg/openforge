use super::{
    identity::{
        generate_host_identity, load_or_create_host_identity, CompanionHostIdentity,
        CompanionIdentityStore,
    },
    pairing::PairingCoordinator,
};
use std::sync::Arc;

#[derive(Clone)]
pub(super) struct CompanionIdentityLifecycle {
    store: Arc<dyn CompanionIdentityStore>,
    cancellation: crate::secure_store::SecretStoreCancellation,
}

impl CompanionIdentityLifecycle {
    pub(super) fn new(store: Arc<dyn CompanionIdentityStore>) -> Self {
        Self {
            store,
            cancellation: crate::secure_store::SecretStoreCancellation::default(),
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub(super) fn cancel_pending_operations(&self) {
        self.cancellation.cancel();
    }

    pub(super) async fn load_or_create(&self) -> Result<CompanionHostIdentity, String> {
        let store = Arc::clone(&self.store);
        let cancellation = self.cancellation.clone();
        tokio::task::spawn_blocking(move || {
            load_or_create_host_identity(store.as_ref(), &cancellation)
        })
        .await
        .map_err(|error| format!("Companion Gateway startup task failed: {error}"))?
    }

    pub(super) async fn reset(
        &self,
        pairing: &PairingCoordinator,
    ) -> Result<IdentityReset, IdentityResetError> {
        let identity = tokio::task::spawn_blocking(generate_host_identity)
            .await
            .map_err(|error| {
                IdentityResetError::Recoverable(format!(
                    "Companion identity generation task failed: {error}"
                ))
            })?
            .map_err(IdentityResetError::Recoverable)?;
        let revoked_devices = pairing
            .revoke_all()
            .map_err(IdentityResetError::Recoverable)?;

        let store = Arc::clone(&self.store);
        let identity_to_save = identity.clone();
        let cancellation = self.cancellation.clone();
        let save_result = match tokio::task::spawn_blocking(move || {
            store.save_with_cancellation(&identity_to_save, &cancellation)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => Err(crate::secure_store::SecretStoreWriteError::CommitUnknown(
                format!("Companion identity persistence task failed: {error}"),
            )),
        };
        if let Err(save_error) = save_result {
            if save_error.commit_unknown() {
                pairing.notify_all_devices_revoked();
                return Err(IdentityResetError::RequiresGatewayStop(format!(
                    "{save_error}; paired-device trust remains revoked because identity persistence may have committed"
                )));
            }
            if let Err(rollback_error) = pairing.rollback_revoke_all(&revoked_devices) {
                return Err(IdentityResetError::RequiresGatewayStop(format!(
                    "{save_error}; failed to restore paired-device trust: {rollback_error}"
                )));
            }
            return Err(IdentityResetError::Recoverable(save_error.to_string()));
        }

        pairing.notify_all_devices_revoked();
        Ok(IdentityReset {
            identity,
            revoked_device_count: revoked_devices.len(),
        })
    }
}

pub(super) struct IdentityReset {
    pub(super) identity: CompanionHostIdentity,
    pub(super) revoked_device_count: usize,
}

pub(super) enum IdentityResetError {
    Recoverable(String),
    RequiresGatewayStop(String),
}
