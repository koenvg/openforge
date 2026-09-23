//! Authenticated app replacement. This crate does not own sessions or authorize interruption.
mod authorization;
mod bundle;
mod files;
mod handoff;
mod handoff_input;
mod host_exit;
mod journal;
mod launch;
mod process_identity;
mod runtime_update;
mod sidecar_startup;
pub use handoff::run_helper;
pub use journal::Phase;
pub use sidecar_startup::{authorize_sidecar_startup, SidecarAdmission, SIDECAR_STARTUP_ARGUMENT};

use std::{
    fs::File,
    path::{Path, PathBuf},
};

/// Holds kernel-managed installation ownership until drop or process exit.
pub struct InstallTransaction {
    _lock: File,
    _destination_lock: File,
    root: PathBuf,
    installation: String,
    destination: PathBuf,
}

impl InstallTransaction {
    /// # Errors
    /// Rejects unsafe storage or another live installer. No process is signalled.
    pub fn open(root: &Path, installation: &str, destination: &Path) -> Result<Self, String> {
        if installation.is_empty()
            || installation.len() > 128
            || !installation
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || !root.is_absolute()
            || !destination.is_absolute()
        {
            return Err("invalid update installation identity".into());
        }
        let parent = destination
            .parent()
            .ok_or("missing installation parent")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let name = destination
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("invalid installation name")?;
        let normalized_destination = parent.join(name);
        let normalized_root = root
            .parent()
            .ok_or("missing recovery parent")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(root.file_name().ok_or("invalid recovery directory")?);
        if normalized_root.starts_with(&normalized_destination) {
            return Err("recovery storage must be outside the installed bundle".into());
        }
        let destination_lock =
            files::exclusive_lock(&parent.join(format!(".{name}.openforge-update.lock")))?;
        files::private_directory(root)?;
        let lock = files::exclusive_lock(&root.join("owner.lock"))?;
        files::bind_destination(&destination_lock, root, installation)?;
        files::sync_directory(&parent)?;
        journal::initialize(root)?;
        Ok(Self {
            _lock: lock,
            _destination_lock: destination_lock,
            root: normalized_root,
            installation: installation.into(),
            destination: normalized_destination,
        })
    }

    /// Authenticate and record the exact target before the host detaches.
    /// # Errors
    /// Refuses a conflicting/replayed operation, changed artifacts or foreign authority.
    pub fn prepare(
        &mut self,
        authorization_root: &Path,
        staging: &Path,
        operation: &str,
    ) -> Result<(), String> {
        authorization::identity(operation)?;
        if self
            .record()?
            .is_some_and(|r| !matches!(r.phase, Phase::RolledBack | Phase::Committed))
        {
            return Err("an update operation is already pending".into());
        }
        files::check_private_directory(authorization_root)?;
        files::check_private_directory(staging)?;
        let authorization_root = authorization_root
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let staging = staging.canonicalize().map_err(|e| e.to_string())?;
        if staging.starts_with(&self.destination)
            || authorization_root.starts_with(&self.destination)
        {
            return Err("update authority and staging must be outside the installed bundle".into());
        }
        let authority = authorization::read(
            &authorization_root,
            operation,
            &self.installation,
            &self.destination,
            &staging,
        )?;
        if self.root.starts_with(&authority.bundle_path) {
            return Err("recovery storage must be outside the staged bundle".into());
        }
        if bundle::measure(&authority.bundle_path)? != authority.manifest_sha256 {
            return Err("authorized bundle changed".into());
        }
        let previous_hash = authority.installed_digest(&self.destination)?;
        use std::os::unix::fs::MetadataExt;
        let device = std::fs::metadata(&self.root)
            .map_err(|e| e.to_string())?
            .dev();
        for path in [&self.destination, &authority.bundle_path] {
            if std::fs::metadata(path).map_err(|e| e.to_string())?.dev() != device {
                return Err(
                    "replacement requires staging and recovery on the installation filesystem"
                        .into(),
                );
            }
        }
        // Durable tombstones prevent reusing an old authorization after rollback.
        files::write_new(&self.root.join(format!("used-{operation}")), b"used")?;
        journal::write(
            &self.root,
            &journal::Record {
                version: 1,
                installation: self.installation.clone(),
                destination: self.destination.clone(),
                operation: operation.into(),
                authorization: authorization_root,
                staging,
                target_hash: authority.manifest_sha256,
                previous_hash,
                phase: Phase::Prepared,
                runtime: None,
                launched: None,
                sidecar: None,
            },
        )
    }

    fn record_runtime(
        &mut self,
        operation: &str,
        runtime: crate::runtime_update::RuntimePlan,
    ) -> Result<(), String> {
        let mut record = self.require(operation)?;
        if record.phase != Phase::Prepared {
            return Err("runtime preflight requires a prepared app transaction".into());
        }
        record.runtime = Some(runtime);
        journal::write(&self.root, &record)
    }

    /// # Errors
    /// Requires the current operation and reauthenticates bytes immediately before replacement.
    /// On interruption, the durable record remains available for recovery.
    pub fn replace(&mut self, operation: &str) -> Result<(), String> {
        let mut record = self.require(operation)?;
        if record.phase != Phase::Prepared {
            return Err("stale update replacement".into());
        }
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&authority.bundle_path)? != record.target_hash
        {
            return Err("authorized bundle changed".into());
        }
        if authority.installed_digest(&self.destination)? != record.previous_hash {
            return Err("installed bundle changed".into());
        }
        let backup = self.root.join(format!("previous-{operation}.app"));
        if backup.try_exists().map_err(|e| e.to_string())? {
            return Err("recovery destination already exists".into());
        }
        record.phase = Phase::Replacing;
        journal::write(&self.root, &record)?;
        // Hashing may take time. Reauthenticate the exact grant after those reads
        // and the durable intent write, immediately before touching the installation.
        let current_authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        if current_authority != authority {
            return Err("update authorization changed before replacement".into());
        }
        std::fs::rename(&self.destination, &backup).map_err(|e| e.to_string())?;
        files::sync_directory(&self.root)?;
        files::sync_directory(
            self.destination
                .parent()
                .ok_or("missing installation parent")?,
        )?;
        std::fs::rename(&authority.bundle_path, &self.destination).map_err(|e| e.to_string())?;
        files::sync_directory(&record.staging)?;
        files::sync_directory(
            self.destination
                .parent()
                .ok_or("missing installation parent")?,
        )?;
        if bundle::measure(&self.destination)? != record.target_hash {
            return Err("replaced bundle changed".into());
        }
        record.phase = Phase::Installed;
        journal::write(&self.root, &record)
    }

    /// Persist the rollback fence before spawning any target app/domain process.
    /// # Errors
    /// Refuses stale operations, changed authorization and altered installed bytes.
    pub fn begin_launch(&mut self, operation: &str) -> Result<(), String> {
        let mut record = self.require(operation)?;
        if record.phase != Phase::Installed {
            return Err("update is not ready to launch".into());
        }
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("authorized installed bundle changed".into());
        }
        record.phase = Phase::LaunchStarted;
        journal::write(&self.root, &record)
    }

    /// Record the authenticated host's completion after runtime and workspace readiness.
    /// Retained bundles stay pinned; commit never authorizes database rollback or cleanup.
    /// # Errors
    /// Refuses pre-launch/stale operations or changed authorization and installed bytes.
    pub fn commit(&mut self, operation: &str) -> Result<(), String> {
        self.commit_with_controller(operation, None)
    }

    /// Commit a live-runtime update only after the replacement Sidecar has reconciled.
    /// # Errors
    /// Refuses missing/stale controllers, a different daemon lifetime or PID, and
    /// activation receipts that do not identify the authorized prepared runtime.
    pub fn commit_with_controller(
        &mut self,
        operation: &str,
        controller: Option<openforge_session_protocol::Controller>,
    ) -> Result<(), String> {
        let mut record = self.require(operation)?;
        if !matches!(record.phase, Phase::LaunchStarted | Phase::Committed) {
            return Err("update has not launched".into());
        }
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("authorized installed bundle changed".into());
        }
        if record.phase == Phase::LaunchStarted {
            if let Some(runtime) = &record.runtime {
                let root = &authority
                    .launch
                    .as_ref()
                    .ok_or("missing runtime root")?
                    .daemon_root;
                runtime.verify_ready(root, operation, controller)?;
            }
        }
        record.phase = Phase::Committed;
        journal::write(&self.root, &record)
    }

    /// Restore only before any target domain process could have migrated the database.
    /// # Errors
    /// Refuses stale operations, corrupt recovery artifacts and post-launch rollback.
    pub fn recover(&mut self, operation: &str) -> Result<Phase, String> {
        let mut record = self.require(operation)?;
        if matches!(record.phase, Phase::LaunchStarted | Phase::Committed) {
            return Err(
                "target launch may have migrated data; retain the new app for recovery".into(),
            );
        }
        if record.phase == Phase::RolledBack {
            return Ok(record.phase);
        }
        let backup = self.root.join(format!("previous-{operation}.app"));
        if backup.try_exists().map_err(|e| e.to_string())? {
            if bundle::measure_previous(&backup)? != record.previous_hash {
                return Err("recovery bundle changed".into());
            }
            if self.destination.try_exists().map_err(|e| e.to_string())? {
                if bundle::measure(&self.destination)? != record.target_hash {
                    return Err("replacement destination changed".into());
                }
                let failed = self.root.join(format!("failed-{operation}.app"));
                if failed.try_exists().map_err(|e| e.to_string())? {
                    return Err("failed target destination already exists".into());
                }
                std::fs::rename(&self.destination, failed).map_err(|e| e.to_string())?;
                files::sync_directory(&self.root)?;
                files::sync_directory(
                    self.destination
                        .parent()
                        .ok_or("missing installation parent")?,
                )?;
            }
            std::fs::rename(&backup, &self.destination).map_err(|e| e.to_string())?;
            files::sync_directory(&self.root)?;
            files::sync_directory(
                self.destination
                    .parent()
                    .ok_or("missing installation parent")?,
            )?;
        }
        if bundle::measure_previous(&self.destination)? != record.previous_hash {
            return Err("original installation cannot be recovered".into());
        }
        record.phase = Phase::RolledBack;
        journal::write(&self.root, &record)?;
        Ok(record.phase)
    }

    fn record(&self) -> Result<Option<journal::Record>, String> {
        let record = journal::read(&self.root)?;
        if let Some(record) = &record {
            if record.version != 1
                || record.installation != self.installation
                || record.destination != self.destination
            {
                return Err("foreign update recovery record".into());
            }
            authorization::identity(&record.operation)?;
        }
        Ok(record)
    }

    fn require(&self, operation: &str) -> Result<journal::Record, String> {
        self.record()?
            .filter(|r| r.operation == operation)
            .ok_or_else(|| "stale update operation".into())
    }
}
