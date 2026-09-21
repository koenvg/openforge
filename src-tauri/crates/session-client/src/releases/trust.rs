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
