//! Publisher keys are host configuration, never read from an artifact or the environment.
use super::{files, ReleaseStore, StagedRelease, MANIFEST};
use openforge_session_protocol::Error;
use ring::signature::{UnparsedPublicKey, ED25519};
use std::path::Path;

const SIGNING_CONTEXT: &[u8] = b"openforge-session-release-v1\0";

/// Publisher keys pinned by the installed host. This does not trust local source builds.
#[derive(Debug)]
pub struct PublisherTrust {
    keys: Vec<[u8; 32]>,
}

impl PublisherTrust {
    /// Uses the publisher keys embedded in the installed app and daemon client.
    /// Artifacts, IPC and environment variables cannot add trust anchors.
    /// # Errors
    /// Refuses malformed build-time publisher configuration.
    pub fn production() -> Result<Self, Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Configuration {
            version: u32,
            ed25519_public_keys: Vec<String>,
        }
        let configuration: Configuration = serde_json::from_str(include_str!(
            "../../../../../src/electron/updatePublisher.json"
        ))
        .map_err(|_| Error::Unauthorized)?;
        if configuration.version != 1 {
            return Err(Error::Unauthorized);
        }
        let keys = configuration
            .ed25519_public_keys
            .iter()
            .map(|hex| {
                if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return Err(Error::Unauthorized);
                }
                let mut key = [0; 32];
                for (index, byte) in key.iter_mut().enumerate() {
                    *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16)
                        .map_err(|_| Error::Unauthorized)?;
                }
                Ok(key)
            })
            .collect::<Result<Vec<_>, Error>>()?;
        Self::new(keys)
    }

    /// # Errors
    /// Refuses empty or excessively large publisher key sets.
    pub fn new(keys: Vec<[u8; 32]>) -> Result<Self, Error> {
        if keys.is_empty() || keys.len() > 16 {
            return Err(Error::Unauthorized);
        }
        Ok(Self { keys })
    }

    fn verify(&self, manifest: &[u8], signature: &[u8]) -> Result<(), Error> {
        let mut message = SIGNING_CONTEXT.to_vec();
        message.extend_from_slice(manifest);
        if self.keys.iter().any(|key| {
            UnparsedPublicKey::new(&ED25519, key)
                .verify(&message, signature)
                .is_ok()
        }) {
            Ok(())
        } else {
            Err(Error::Unauthorized)
        }
    }
}

impl ReleaseStore {
    /// Stages runtime bytes covered by a pinned publisher's Ed25519 signature.
    /// The signed message is `openforge-session-release-v1\0` followed by the exact
    /// manifest bytes, without JSON normalization. No source executable is run.
    ///
    /// This authenticates runtime artifacts only. It does not authorize app replacement,
    /// prove daemon transition compatibility, or persist an activation authorization.
    /// # Errors
    /// Refuses an untrusted signature and all integrity/ownership failures from staging.
    pub fn stage_published(
        &self,
        source: &Path,
        trust: &PublisherTrust,
        signature: &[u8],
    ) -> Result<StagedRelease, Error> {
        let bytes = files::read(source, MANIFEST, 64 * 1024, false)?;
        trust.verify(&bytes, signature)?;
        self.stage_manifest(source, &bytes)
    }
}
