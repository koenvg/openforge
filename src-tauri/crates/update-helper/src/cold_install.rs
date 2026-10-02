//! Cold publication is forward-only because ordinary startup can observe the new app.
use crate::{authorization, bundle, exchange, files, journal, InstallTransaction, Phase};
use std::path::Path;

/// Inspect the complete usable cold target without authorizing or executing it.
/// # Errors
/// Refuses missing components, unsafe permissions, escaping links and invalid entries.
pub fn cold_target_sha256(bundle: &Path) -> Result<String, String> {
    bundle::measure(bundle)
}
impl InstallTransaction {
    /// Publish or resume a separately approved cold build, without launching domain code.
    /// # Errors
    /// Refuses ordinary update authority, changed bytes, stale operations and live owners.
    pub fn install_cold(&mut self, operation: &str) -> Result<Phase, String> {
        let mut record = self.require(operation)?;
        let authority = authorization::read(
            &record.authorization,
            operation,
            &self.installation,
            &self.destination,
            &record.staging,
        )?;
        let approval = authority
            .cold_install
            .as_ref()
            .ok_or("cold installation was not approved")?;
        if authority.manifest_sha256 != record.target_hash
            || approval.installed_manifest_sha256 != record.previous_hash
        {
            return Err("cold-install authorization changed".into());
        }
        if record.phase == Phase::ColdCommitted {
            if bundle::measure(&self.destination)? != record.target_hash {
                return Err("cold-installed bundle changed".into());
            }
            return Ok(record.phase);
        }
        if !matches!(record.phase, Phase::Prepared | Phase::ColdReplacing)
            || record.runtime.is_some()
        {
            return Err("stale cold installation".into());
        }
        let runtime_root = approval.daemon_root.canonicalize().map_err(message)?;
        if runtime_root.starts_with(&self.destination) || runtime_root.starts_with(&record.staging)
        {
            return Err("cold runtime must be outside replaceable bundles".into());
        }
        let _runtime = crate::runtime_update::ColdRuntime::reserve(&approval.daemon_root)?;
        if _runtime.installation.as_str() != approval.daemon_installation {
            return Err("approved cold runtime identity changed".into());
        }
        let installed = bundle::cold_source_sha256(&self.destination)?;
        let target = if installed == record.target_hash {
            &self.destination
        } else {
            &authority.bundle_path
        };
        let installer = crate::cold_processes::VerifiedInstaller::matching_current(
            target,
            &approval.helper_sha256,
        )?;
        crate::cold_processes::assert_stopped(&self.destination, installer.as_ref())?;
        crate::cold_processes::assert_stopped(&approval.daemon_root, installer.as_ref())?;
        if record.staging.canonicalize().map_err(message)? != record.staging {
            return Err("cold staging directory changed".into());
        }
        let backup = self.root.join(format!("previous-{operation}.app"));
        if record.phase == Phase::Prepared {
            if installed != record.previous_hash
                || bundle::measure(&authority.bundle_path)? != record.target_hash
                || exists(&backup)?
            {
                return Err("approved cold-install bundle changed".into());
            }
            record.exchange_path = Some(authority.bundle_path.clone());
            record.phase = Phase::ColdReplacing;
            journal::write(&self.root, &record)?;
        }
        if record.exchange_path.as_ref() != Some(&authority.bundle_path) {
            return Err("cold exchange path changed".into());
        }
        if installed == record.previous_hash && record.previous_hash != record.target_hash {
            if exists(&backup)? || bundle::measure(&authority.bundle_path)? != record.target_hash {
                return Err("cold publication cannot be recovered".into());
            }
            #[cfg(feature = "test-fixtures")]
            crate::replacement::pause(&self.root, "cold-before-exchange")?;
            crate::cold_processes::assert_stopped(&self.destination, installer.as_ref())?;
            exchange::swap(&authority.bundle_path, &self.destination)?;
            #[cfg(feature = "test-fixtures")]
            crate::replacement::pause(&self.root, "cold-after-exchange")?;
        } else if installed != record.target_hash {
            return Err("cold-install destination changed".into());
        }
        if exists(&authority.bundle_path)? {
            if exists(&backup)?
                || authority.installed_digest(&authority.bundle_path)? != record.previous_hash
            {
                return Err("cold-install retained source changed".into());
            }
            std::fs::rename(&authority.bundle_path, &backup).map_err(message)?;
            files::sync_directory(&record.staging)?;
            files::sync_directory(&self.root)?;
            #[cfg(feature = "test-fixtures")]
            crate::replacement::pause(&self.root, "cold-after-archive")?;
        }
        if authority.installed_digest(&backup)? != record.previous_hash
            || bundle::measure(&self.destination)? != record.target_hash
        {
            return Err("cold-installed bundle or retained source changed".into());
        }
        crate::cold_processes::assert_stopped(&self.destination, installer.as_ref())?;
        crate::cold_processes::assert_stopped(&backup, installer.as_ref())?;
        crate::cold_processes::assert_stopped(&approval.daemon_root, installer.as_ref())?;
        record.phase = Phase::ColdCommitted;
        journal::write(&self.root, &record)?;
        Ok(record.phase)
    }
}
/// Block ordinary startup before a cold publication is durably complete.
/// # Errors
/// Refuses active owners, pending cold operations, foreign records and changed targets.
pub fn assert_cold_startup_allowed(destination: &Path) -> Result<(), String> {
    assert_startup(destination, None)
}

/// Bind ordinary cold startup to the approved profile and runtime roots.
/// # Errors
/// Refuses incomplete installation, changed roots, credentials or target bytes.
pub fn assert_cold_launch_roots(
    destination: &Path,
    profile: &Path,
    daemon_root: &Path,
) -> Result<(), String> {
    assert_startup(destination, Some((profile, daemon_root)))
}

fn assert_startup(destination: &Path, roots: Option<(&Path, &Path)>) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or("missing installation parent")?
        .canonicalize()
        .map_err(message)?;
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("invalid installation name")?;
    let destination = parent.join(name);
    let lock_path = parent.join(format!(".{name}.openforge-update.lock"));
    if !exists(&lock_path)? {
        return Ok(());
    }
    let _ownership = files::exclusive_lock(&lock_path)?;
    let bytes = files::read_private(&lock_path, 16 * 1024)?;
    if bytes.is_empty() {
        return Ok(());
    }
    let (root, installation): (std::path::PathBuf, String) =
        serde_json::from_slice(&bytes).map_err(message)?;
    if root.canonicalize().map_err(message)? != root {
        return Err("installation recovery root changed".into());
    }
    files::check_private_directory(&root)?;
    let Some(record) = journal::read(&root)? else {
        return Ok(());
    };
    if record.destination != destination
        || record.installation != installation
        || record.version != 1
    {
        return Err("foreign cold-install recovery record".into());
    }
    if record.phase == Phase::ColdReplacing {
        return Err("cold installation needs forward recovery before startup".into());
    }
    let authority = authorization::read(
        &record.authorization,
        &record.operation,
        &installation,
        &destination,
        &record.staging,
    )?;
    if let Some(approval) = &authority.cold_install {
        if let Some((profile, daemon_root)) = roots {
            if profile.canonicalize().map_err(message)? != approval.electron_user_data
                || daemon_root.canonicalize().map_err(message)? != approval.daemon_root
            {
                return Err("cold launch data roots do not match approval".into());
            }
        }
        let runtime = openforge_session_client::runtime::RuntimeDirectory::open_existing(
            &approval.daemon_root,
        )
        .map_err(message)?;
        if runtime.credentials().installation.as_str() != approval.daemon_installation {
            return Err("approved cold runtime identity changed".into());
        }
        if record.phase != Phase::ColdCommitted {
            return Err("cold installation has not completed".into());
        }
        if authority.manifest_sha256 != record.target_hash
            || bundle::measure(&destination)? != record.target_hash
        {
            return Err("cold-installed bundle changed".into());
        }
    }
    Ok(())
}

fn exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(message(error)),
    }
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
