//! Upgrade negotiation at attachment, never a kill-and-relaunch recovery path.
use crate::{
    releases::ReleaseStore,
    runtime::{io_error, RuntimeDirectory},
    Client,
};
use openforge_session_protocol::{Error, OperationId, ReplacementPhase, ReplacementState};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

impl Client {
    /// Enables bounded receipt retention, replacing a legacy daemon in place when supported.
    /// The returned controller is reconciled after replacement; old client clones stay fenced.
    ///
    /// # Errors
    /// Refuses incompatible images, unknown activation, and failed replacement without
    /// stopping sessions or starting another daemon. Only a definitive unsupported-command
    /// response authorizes attempting an upgrade.
    pub fn with_operation_retirement(self, executable: &Path) -> Result<Self, Error> {
        match self.enable_operation_retirement() {
            Ok(()) => return Ok(self),
            Err(Error::InvalidRequest | Error::Version) => {}
            Err(error) => return Err(error),
        }
        self.upgrade_for_retirement(executable).map_err(|error| {
            Error::Host(format!(
                "automatic terminal daemon upgrade failed; refusing to stop existing sessions: {error}"
            ))
        })
    }

    fn upgrade_for_retirement(self, executable: &Path) -> Result<Self, Error> {
        if !self.capabilities()?.supports_replacement {
            return Err(Error::UnsupportedReplacement);
        }
        let root = self
            .socket
            .parent()
            .and_then(Path::parent)
            .ok_or(Error::Unauthorized)?;
        let runtime = RuntimeDirectory::open_existing(root)?;
        if runtime.credentials().installation != self.credentials.installation {
            return Err(Error::ForeignInstallation);
        }
        // Keep all packaged assets pinned while the running owner verifies and adopts the image.
        let staged = match executable.parent() {
            Some(source)
                if source
                    .file_name()
                    .is_some_and(|name| name == "session-runtime") =>
            {
                let store = ReleaseStore::open(&runtime)?;
                let release = store.stage(source)?;
                store.retain(&release, &format!("session-{}", release.id()))?;
                Some(release)
            }
            _ => None,
        };
        let selected = staged.as_ref().map(|release| release.executable());
        let executable =
            std::fs::canonicalize(selected.as_deref().unwrap_or(executable)).map_err(io_error)?;
        let operation = upgrade_identity(&executable)?;
        let status = match self.replacement_status(&operation) {
            Ok(status) => Some(status.state),
            Err(Error::InvalidRequest) => None,
            Err(error) => return Err(error),
        };
        match status {
            Some(ReplacementState::Failed { .. } | ReplacementState::Aborted) => {
                return Err(Error::UnsupportedReplacement);
            }
            Some(ReplacementState::Activated) => {}
            Some(ReplacementState::Executing) => {
                self.complete_replacement(operation, ReplacementPhase::Commit)?;
            }
            None | Some(ReplacementState::Preparing | ReplacementState::Prepared) => {
                self.complete_replacement(
                    operation.clone(),
                    ReplacementPhase::Prepare { executable },
                )?;
                self.complete_replacement(operation, ReplacementPhase::Commit)?;
            }
        }
        // Connect, never launch: temporary unavailability is not permission to create an owner.
        let next = Self::connect(root)?;
        if next.controller.lifetime != self.controller.lifetime {
            return Err(Error::OutcomeUnknown);
        }
        next.inventory()?;
        next.enable_operation_retirement()?;
        Ok(next)
    }
}

fn upgrade_identity(path: &Path) -> Result<OperationId, Error> {
    let mut file = File::open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(Error::UnsupportedReplacement);
    }
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update([0]);
    let mut total = 0usize;
    let mut buffer = [0; 8192];
    loop {
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        total += count;
        if total > 128 * 1024 * 1024 {
            return Err(Error::Capacity);
        }
        hash.update(&buffer[..count]);
    }
    OperationId::parse(format!("retirement-{:x}", hash.finalize()))
        .map_err(|_| Error::InvalidRequest)
}
