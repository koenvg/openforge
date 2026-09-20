use super::{files, Manifest, ReleaseStore, StagedRelease, MANIFEST};
use crate::runtime::{io_error, RuntimeDirectory};
use openforge_session_protocol::Error;
use std::{collections::BTreeSet, fs};

fn reference_name(key: &str) -> Result<String, Error> {
    if key.is_empty()
        || key.len() > 128
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(Error::InvalidRequest);
    }
    Ok(format!("ref-{key}"))
}

impl ReleaseStore {
    fn check_installation(&self, runtime: &RuntimeDirectory) -> Result<(), Error> {
        if runtime.path().join("releases") != self.directory
            || runtime.credentials().installation.as_str() != self.installation
            || files::read(&self.directory, "owner", 128, true)? != self.installation.as_bytes()
        {
            return Err(Error::ForeignInstallation);
        }
        Ok(())
    }

    /// Pins a release for a session, checkpoint or incomplete operation. Pins survive
    /// process exit. A key cannot be repointed to a different release.
    /// # Errors
    /// Refuses foreign releases and conflicting reference keys.
    pub fn retain(&self, release: &StagedRelease, key: &str) -> Result<(), Error> {
        if release.directory != self.directory.join(&release.id)
            || files::read(&self.directory, "owner", 128, true)? != self.installation.as_bytes()
        {
            return Err(Error::ForeignInstallation);
        }
        let name = reference_name(key)?;
        let _lock = files::lock(&self.directory.join("store.lock"))?;
        if self.directory.join(&name).try_exists().map_err(io_error)? {
            if files::read(&self.directory, &name, 64, true)? != release.id.as_bytes() {
                return Err(Error::InvalidRequest);
            }
            return Ok(());
        }
        files::write_new(&self.directory, &name, release.id.as_bytes(), 0o400)
    }

    /// Explicitly completes a reference only when no daemon can still use it.
    /// # Errors
    /// Refuses foreign installations and live daemon owners.
    pub fn release_reference(&self, runtime: &RuntimeDirectory, key: &str) -> Result<(), Error> {
        self.check_installation(runtime)?;
        let _owner = runtime.claim()?;
        let _lock = files::lock(&self.directory.join("store.lock"))?;
        let name = reference_name(key)?;
        files::read(&self.directory, &name, 64, true)?;
        fs::remove_file(self.directory.join(name)).map_err(io_error)?;
        files::sync_directory(&self.directory)
    }
    /// Checks installation, complete target/fallback integrity and supported formats
    /// without contacting or quiescing a daemon. Production publisher verification
    /// is not implemented, so even compatible artifacts are refused. There is no
    /// environment-variable or caller-supplied boolean bypass.
    /// # Errors
    /// Always refuses until a production trust verifier and transition proof exist.
    pub fn preflight(
        &self,
        runtime: &RuntimeDirectory,
        target: &StagedRelease,
        fallback: Option<&StagedRelease>,
    ) -> Result<(), Error> {
        self.check_installation(runtime)?;
        let _lock = files::lock(&self.directory.join("store.lock"))?;
        let fallback = fallback.ok_or(Error::UnsupportedReplacement)?;
        for release in [target, fallback] {
            if release.directory != self.directory.join(&release.id) {
                return Err(Error::ForeignInstallation);
            }
            let bytes = files::read(&release.directory, MANIFEST, 64 * 1024, true)?;
            if files::digest(&bytes) != release.id {
                return Err(Error::Unauthorized);
            }
            let manifest = Manifest::parse(&bytes)?;
            self.verify(&release.directory, &manifest, &bytes)?;
        }
        Err(Error::Host(
            "production release trust verification unavailable; replacement disabled".into(),
        ))
    }

    /// Removes only verified releases belonging to this installation. A live owner
    /// conservatively protects all versions, including its session and recovery assets.
    /// # Errors
    /// Refuses foreign roots and unknown or corrupt entries before deleting anything.
    pub fn cleanup(&self, runtime: &RuntimeDirectory) -> Result<Vec<String>, Error> {
        self.check_installation(runtime)?;
        let _owner = match runtime.claim() {
            Ok(owner) => owner,
            Err(Error::AlreadyRunning) => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let _lock = files::lock(&self.directory.join("store.lock"))?;
        let mut candidates = Vec::new();
        let mut references = BTreeSet::new();
        let mut leases = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| Error::Unauthorized)?;
            if matches!(name.as_str(), "owner" | "store.lock") {
                continue;
            }
            if let Some(key) = name.strip_prefix("ref-") {
                reference_name(key)?;
                let value = files::read(&self.directory, &name, 64, true)?;
                let value = String::from_utf8(value).map_err(|_| Error::Unauthorized)?;
                if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(Error::Unauthorized);
                }
                references.insert(value);
                continue;
            }
            if name.len() != 64 || !name.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(Error::Unauthorized);
            }
            let bytes = files::read(&entry.path(), MANIFEST, 64 * 1024, true)?;
            if files::digest(&bytes) != name {
                return Err(Error::Unauthorized);
            }
            let manifest = Manifest::parse(&bytes)?;
            self.verify(&entry.path(), &manifest, &bytes)?;
            let lease = files::lock_file(&entry.path().join("lease.lock"))?;
            match lease.try_lock() {
                Ok(()) => {
                    leases.push(lease);
                    candidates.push(name);
                }
                Err(std::fs::TryLockError::WouldBlock) => {}
                Err(std::fs::TryLockError::Error(error)) => return Err(io_error(error)),
            }
        }
        candidates.retain(|name| !references.contains(name));
        for name in &candidates {
            fs::remove_dir_all(self.directory.join(name)).map_err(io_error)?;
        }
        files::sync_directory(&self.directory)?;
        Ok(candidates)
    }
}
