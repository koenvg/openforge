//! Publishing and recovering the complete installation without a missing app path.
use crate::{authorization, bundle, exchange, files, journal, InstallTransaction, Phase};
use std::path::Path;

impl InstallTransaction {
    /// Reauthenticate the complete target, then exchange it with the installed app.
    /// # Errors
    /// Refuses stale phases, changed authority or bytes, and unsupported atomic exchange.
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
        if entry_exists(&backup)? {
            return Err("recovery destination already exists".into());
        }
        // After exchange this path contains the source until it is archived. Persist
        // it before publishing so helper death cannot lose the source's location.
        record.exchange_path = Some(authority.bundle_path.clone());
        record.phase = Phase::Replacing;
        journal::write(&self.root, &record)?;
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
        exchange::swap(&authority.bundle_path, &self.destination)?;
        #[cfg(feature = "test-fixtures")]
        pause(&self.root, "replace-first-move")?;
        rename_retained(&authority.bundle_path, &backup)?;
        if bundle::measure(&self.destination)? != record.target_hash {
            return Err("replaced bundle changed".into());
        }
        record.phase = Phase::Installed;
        journal::write(&self.root, &record)
    }

    /// Restore only before a target domain process could have migrated data.
    /// # Errors
    /// Refuses stale operations, corrupt recovery artifacts and post-launch rollback.
    pub fn recover(&mut self, operation: &str) -> Result<Phase, String> {
        let mut record = self.require(operation)?;
        if record.phase.may_own_domain() {
            return Err(
                "target launch may have migrated data; retain the new app for recovery".into(),
            );
        }
        let installed = if entry_exists(&self.destination)? {
            Some(bundle::measure_previous(&self.destination)?)
        } else {
            None
        };
        if record.phase == Phase::RolledBack {
            if installed.as_ref() != Some(&record.previous_hash) {
                return Err("recovered installation changed".into());
            }
            return Ok(record.phase);
        }
        let backup = self.root.join(format!("previous-{operation}.app"));
        if let Some(path) = &record.exchange_path {
            if !path.starts_with(&record.staging) || path == &record.staging {
                return Err("invalid app exchange path".into());
            }
            if entry_exists(path)? {
                if record.staging.canonicalize().map_err(|e| e.to_string())? != record.staging
                    || path.canonicalize().map_err(|e| e.to_string())? != *path
                {
                    return Err("app exchange staging changed".into());
                }
                files::check_private_directory(&record.staging)?;
            }
        }
        let source_installed = installed.as_ref() == Some(&record.previous_hash);
        let previous = if source_installed {
            self.destination.as_path()
        } else {
            if installed
                .as_ref()
                .is_some_and(|hash| hash != &record.target_hash)
            {
                return Err("replacement destination changed".into());
            }
            let previous = if entry_exists(&backup)? {
                backup.as_path()
            } else {
                record
                    .exchange_path
                    .as_deref()
                    .ok_or("original installation cannot be recovered")?
            };
            if bundle::measure_previous(previous)? != record.previous_hash {
                return Err("recovery bundle changed".into());
            }
            previous
        };
        if let Some(runtime) = &record.runtime {
            let authority = authorization::read(
                &record.authorization,
                operation,
                &self.installation,
                &self.destination,
                &record.staging,
            )?;
            let launch = authority.launch.as_ref().ok_or("missing runtime root")?;
            launch.validate(&self.destination, &authority.bundle_path)?;
            runtime.verify_source(&launch.daemon_root, operation, previous)?;
        }
        if source_installed {
            // A rollback may have exchanged the apps but died before archiving the
            // rejected target or recording its acknowledgement. Do not swap again.
            if entry_exists(&backup)? {
                self.archive_rejected(&backup, &record)?;
            } else if let Some(path) = &record.exchange_path {
                if entry_exists(path)? {
                    self.archive_rejected(path, &record)?;
                }
            }
        } else {
            if installed.is_some() {
                if entry_exists(&self.root.join(format!("failed-{operation}.app")))? {
                    return Err("failed target destination already exists".into());
                }
                exchange::swap(previous, &self.destination)?;
                #[cfg(feature = "test-fixtures")]
                pause(&self.root, "rollback-first-move")?;
                self.archive_rejected(previous, &record)?;
            } else {
                // Compatibility with an interrupted older, non-exchanging helper.
                rename_retained(previous, &self.destination)?;
            }
        }
        if bundle::measure_previous(&self.destination)? != record.previous_hash {
            return Err("original installation cannot be recovered".into());
        }
        record.phase = Phase::RolledBack;
        journal::write(&self.root, &record)?;
        Ok(record.phase)
    }

    fn archive_rejected(&self, path: &Path, record: &journal::Record) -> Result<(), String> {
        if bundle::measure(path)? != record.target_hash {
            return Err("rejected target bundle changed".into());
        }
        let failed = self.root.join(format!("failed-{}.app", record.operation));
        if entry_exists(&failed)? {
            return Err("failed target destination already exists".into());
        }
        rename_retained(path, &failed)
    }
}

fn entry_exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn rename_retained(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| e.to_string())?;
    files::sync_directory(source.parent().ok_or("missing retained app parent")?)?;
    files::sync_directory(destination.parent().ok_or("missing retained app parent")?)
}

#[cfg(feature = "test-fixtures")]
pub(crate) fn pause(root: &Path, boundary: &str) -> Result<(), String> {
    if !root.join(format!("pause-{boundary}")).exists() {
        return Ok(());
    }
    std::fs::write(root.join(format!("{boundary}-paused")), b"ready")
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !root.join(format!("resume-{boundary}")).exists() {
        if std::time::Instant::now() >= deadline {
            return Err(format!("fixture {boundary} pause expired"));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}
