use rcgen::generate_simple_self_signed;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const COMPANION_HOST_IDENTITY_SECRET: &str = "companion_host_identity";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionHostIdentity {
    pub(crate) host_id: String,
    pub(crate) certificate_pem: String,
    pub(crate) private_key_pem: String,
    pub(crate) certificate_fingerprint: String,
}

pub(crate) trait CompanionIdentityStore: Send + Sync {
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<CompanionHostIdentity>, String>;
    fn save(&self, identity: &CompanionHostIdentity) -> Result<(), String>;
    fn save_with_cancellation(
        &self,
        identity: &CompanionHostIdentity,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<(), crate::secure_store::SecretStoreWriteError> {
        if cancellation.is_cancelled() {
            return Err(crate::secure_store::SecretStoreWriteError::NotCommitted(
                "Companion identity persistence was cancelled".to_string(),
            ));
        }
        self.save(identity)
            .map_err(crate::secure_store::SecretStoreWriteError::NotCommitted)
    }
}

#[derive(Debug, Default)]
pub(crate) struct KeychainCompanionIdentityStore;

impl CompanionIdentityStore for KeychainCompanionIdentityStore {
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<CompanionHostIdentity>, String> {
        let Some(serialized) = crate::secure_store::get_secret_with_cancellation(
            COMPANION_HOST_IDENTITY_SECRET,
            cancellation,
        )?
        else {
            return Ok(None);
        };
        serde_json::from_str(&serialized)
            .map(Some)
            .map_err(|error| format!("failed to decode Companion host identity: {error}"))
    }

    fn save(&self, identity: &CompanionHostIdentity) -> Result<(), String> {
        let serialized = serde_json::to_string(identity)
            .map_err(|error| format!("failed to encode Companion host identity: {error}"))?;
        crate::secure_store::set_secret(COMPANION_HOST_IDENTITY_SECRET, &serialized)
            .map_err(|error| format!("failed to persist Companion host identity: {error}"))
    }

    fn save_with_cancellation(
        &self,
        identity: &CompanionHostIdentity,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<(), crate::secure_store::SecretStoreWriteError> {
        let serialized = serde_json::to_string(identity).map_err(|error| {
            crate::secure_store::SecretStoreWriteError::NotCommitted(format!(
                "failed to encode Companion host identity: {error}"
            ))
        })?;
        crate::secure_store::set_secret_with_cancellation(
            COMPANION_HOST_IDENTITY_SECRET,
            &serialized,
            cancellation,
        )
        .map_err(|error| match error {
            crate::secure_store::SecretStoreWriteError::NotCommitted(error) => {
                crate::secure_store::SecretStoreWriteError::NotCommitted(format!(
                    "failed to persist Companion host identity: {error}"
                ))
            }
            crate::secure_store::SecretStoreWriteError::CommitUnknown(error) => {
                crate::secure_store::SecretStoreWriteError::CommitUnknown(format!(
                    "Companion host identity persistence may have committed: {error}"
                ))
            }
        })
    }
}

fn certificate_fingerprint(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

pub(crate) fn generate_host_identity() -> Result<CompanionHostIdentity, String> {
    let host_id = uuid::Uuid::new_v4().to_string();
    let certified_key = generate_simple_self_signed(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "openforge-companion.local".to_string(),
    ])
    .map_err(|error| format!("failed to create Companion TLS certificate: {error}"))?;

    Ok(CompanionHostIdentity {
        host_id,
        certificate_pem: certified_key.cert.pem(),
        private_key_pem: certified_key.key_pair.serialize_pem(),
        certificate_fingerprint: certificate_fingerprint(certified_key.cert.der().as_ref()),
    })
}

pub(crate) fn load_or_create_host_identity(
    store: &dyn CompanionIdentityStore,
    cancellation: &crate::secure_store::SecretStoreCancellation,
) -> Result<CompanionHostIdentity, String> {
    if let Some(identity) = store.load(cancellation)? {
        return Ok(identity);
    }

    let identity = generate_host_identity()?;
    store
        .save_with_cancellation(&identity, cancellation)
        .map_err(|error| error.to_string())?;
    Ok(identity)
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct InMemoryIdentityStore {
    identity: std::sync::Mutex<Option<CompanionHostIdentity>>,
    saves: std::sync::atomic::AtomicUsize,
    fail_next_save: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
impl InMemoryIdentityStore {
    pub(crate) fn save_count(&self) -> usize {
        self.saves.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn fail_next_save(&self) {
        self.fail_next_save
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
impl CompanionIdentityStore for InMemoryIdentityStore {
    fn load(
        &self,
        _cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<CompanionHostIdentity>, String> {
        self.identity
            .lock()
            .map(|identity| identity.clone())
            .map_err(|_| "test identity store lock was poisoned".to_string())
    }

    fn save(&self, identity: &CompanionHostIdentity) -> Result<(), String> {
        if self
            .fail_next_save
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err("test identity save failed".to_string());
        }
        *self
            .identity
            .lock()
            .map_err(|_| "test identity store lock was poisoned".to_string())? =
            Some(identity.clone());
        self.saves.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
#[derive(Debug)]
pub(crate) struct DelayedIdentityStore {
    inner: InMemoryIdentityStore,
    delay: std::time::Duration,
}

#[cfg(test)]
impl DelayedIdentityStore {
    pub(crate) fn new(delay: std::time::Duration) -> Self {
        Self {
            inner: InMemoryIdentityStore::default(),
            delay,
        }
    }
}
#[cfg(test)]
impl CompanionIdentityStore for DelayedIdentityStore {
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<CompanionHostIdentity>, String> {
        let deadline = std::time::Instant::now() + self.delay;
        while std::time::Instant::now() < deadline {
            if cancellation.is_cancelled() {
                return Err("Companion identity read was cancelled".to_string());
            }
            std::thread::sleep(
                std::time::Duration::from_millis(10)
                    .min(deadline.saturating_duration_since(std::time::Instant::now())),
            );
        }
        self.inner.load(cancellation)
    }

    fn save(&self, identity: &CompanionHostIdentity) -> Result<(), String> {
        std::thread::sleep(self.delay);
        self.inner.save(identity)
    }
}
