//! Authenticated app replacement. This crate does not own sessions or authorize interruption.
mod authorization;
mod bundle;
mod cold_command;
mod cold_install;
mod cold_processes;
mod exchange;
mod files;
mod handoff;
mod handoff_input;
mod host_exit;
mod journal;
mod launch;
mod launch_gate;
mod native_image;
mod process_identity;
mod readiness;
mod replacement;
mod runtime_update;
mod sidecar_startup;
mod startup;
pub use bundle::cold_source_sha256;
pub use cold_command::{run_cold_install, run_cold_recovery, run_cold_startup};
pub use cold_install::assert_cold_launch_roots;
pub use cold_install::assert_cold_startup_allowed;
pub use cold_install::cold_target_sha256;
pub use cold_processes::assert_cold_source_stopped;
pub use handoff::run_helper;
pub use host_exit::{exit_with_host, parent_exit_guard_armed};
pub use journal::Phase;
pub use launch_gate::{run_app_bootstrap, APP_BOOTSTRAP_ARGUMENT};
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

/// Temporary exclusion, without assigning an unapproved recovery identity.
/// Dropping this reservation leaves the permanent lock inode unbound.
pub struct InstallReservation {
    transaction: InstallTransaction,
}

impl InstallReservation {
    /// Assign the approved installation identity while retaining both locks.
    /// # Errors
    /// Refuses foreign bindings and unsafe ownership records.
    pub fn bind(self) -> Result<InstallTransaction, String> {
        let transaction = self.transaction;
        files::bind_destination(
            &transaction._destination_lock,
            &transaction.root,
            &transaction.installation,
        )?;
        files::sync_directory(
            transaction
                .destination
                .parent()
                .ok_or("missing installation parent")?,
        )?;
        Ok(transaction)
    }

    fn record(&self) -> Result<Option<journal::Record>, String> {
        self.transaction.record()
    }
}
impl InstallTransaction {
    /// # Errors
    /// Rejects unsafe storage or another live installer. No process is signalled.
    pub fn open(root: &Path, installation: &str, destination: &Path) -> Result<Self, String> {
        Self::reserve(root, installation, destination)?.bind()
    }

    /// Reserve the destination and recovery storage without committing an identity.
    /// # Errors
    /// Refuses conflicting owners, unsafe storage and an existing foreign binding.
    pub fn reserve(
        root: &Path,
        installation: &str,
        destination: &Path,
    ) -> Result<InstallReservation, String> {
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
        files::check_destination(&destination_lock, root, installation)?;
        files::sync_directory(&parent)?;
        journal::initialize(root)?;
        Ok(InstallReservation {
            transaction: Self {
                _lock: lock,
                _destination_lock: destination_lock,
                root: normalized_root,
                installation: installation.into(),
                destination: normalized_destination,
            },
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
        if self.record()?.is_some_and(|r| {
            !matches!(
                r.phase,
                Phase::RolledBack | Phase::Committed | Phase::ColdCommitted
            )
        }) {
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
        exchange::probe(&self.root)?;
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
                cold_installation: None,
                launch_attempt: 0,
                launch_gate: None,
                exchange_path: None,
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
        if !matches!(
            record.phase,
            Phase::LaunchStarted | Phase::RelaunchStarted | Phase::Committed
        ) {
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
        if record.phase.awaiting_commit() {
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
