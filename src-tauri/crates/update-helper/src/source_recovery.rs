//! Preparation-loss recovery never creates a Sidecar or acquires a controller.
use crate::{authorization, bundle, InstallTransaction, Phase};

impl InstallTransaction {
    pub(crate) fn recover_preparation(
        &mut self,
        operation: &str,
        parent: u32,
        current: Option<crate::source_attestation::Authority>,
        challenge: &str,
    ) -> Result<bool, String> {
        let record = self.require(operation)?;
        if record.phase != Phase::Prepared {
            return Ok(false);
        }
        let source = record
            .source
            .as_ref()
            .ok_or("original source authority is unknown in this journal")?;
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        source.verify_binding(&record, &self.root)?;
        if authority.launch.as_ref() != Some(&source.proof.birth.roots)
            || bundle::measure_daemon_source(&self.destination)? != record.previous_hash
        {
            return Err("original source recovery roots or bytes changed".into());
        }
        if let Some(current) = current {
            let mut binding = source.proof.binding.clone();
            binding.challenge = challenge.into();
            let observed = current.authenticate(&binding, &authority, parent)?;
            if observed.proof.birth != source.proof.birth {
                return Err("original source startup lifetime changed".into());
            }
        } else {
            source.verify_exits()?;
            crate::native_image::verify(
                parent,
                &self.destination.join("Contents/MacOS/Open Forge"),
            )?;
        }
        if let Some(runtime) = &record.runtime {
            runtime.cancel_preparation(
                &source.proof.birth.roots.daemon_root,
                operation,
                &self.destination,
            )?;
        }
        // A live source or two independently witnessed exits authorize cancellation.
        // Missing or reused identity cannot enter this branch.
        self.recover(operation)?;
        Ok(true)
    }
}
