//! Installation-owned, content-addressed daemon releases. Integrity is not publisher trust.
mod files;
mod retention;

use crate::runtime::{io_error, RuntimeDirectory};
use files::{digest, private_directory, read, write_new};
use openforge_session_protocol::{Error, VERSION};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
};

const MANIFEST: &str = "manifest.json";
const DAEMON: &str = "openforge-session-daemon";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Artifact {
    path: String,
    sha256: String,
    executable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: u32,
    architecture: String,
    protocol: u32,
    state_format: u32,
    files: Vec<Artifact>,
}

impl Manifest {
    fn parse(bytes: &[u8]) -> Result<Self, Error> {
        let manifest: Self = serde_json::from_slice(bytes).map_err(|_| Error::InvalidRequest)?;
        if manifest.format != 1
            || manifest.protocol != VERSION
            || manifest.state_format != 1
            || manifest.architecture != std::env::consts::ARCH
        {
            return Err(Error::UnsupportedReplacement);
        }
        if manifest.files.is_empty() || manifest.files.len() > 128 {
            return Err(Error::Capacity);
        }
        let mut names = BTreeSet::new();
        for artifact in &manifest.files {
            let path = Path::new(&artifact.path);
            if artifact.path.len() > 256
                || artifact.path.is_empty()
                || artifact.path == MANIFEST
                || artifact.path.contains('\\')
                || path
                    .components()
                    .any(|part| !matches!(part, Component::Normal(_)))
                || !names.insert(&artifact.path)
                || artifact.sha256.len() != 64
                || !artifact.sha256.bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err(Error::InvalidRequest);
            }
        }
        if !manifest
            .files
            .iter()
            .any(|a| a.path == DAEMON && a.executable)
        {
            return Err(Error::InvalidRequest);
        }
        Ok(manifest)
    }
}

#[derive(Debug)]
pub struct StagedRelease {
    directory: PathBuf,
    id: String,
    _lease: std::fs::File,
}

impl StagedRelease {
    fn open(directory: PathBuf, id: String) -> Result<Self, Error> {
        let lease = files::lock_file(&directory.join("lease.lock"))?;
        lease.lock_shared().map_err(io_error)?;
        Ok(Self {
            directory,
            id,
            _lease: lease,
        })
    }
    pub fn executable(&self) -> PathBuf {
        self.directory.join(DAEMON)
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn id(&self) -> &str {
        &self.id
    }
}

/// All writers and cleanup share the installation's release lock.
pub struct ReleaseStore {
    directory: PathBuf,
    installation: String,
}

impl ReleaseStore {
    /// # Errors
    /// Refuses unsafe roots rather than adopting another user's artifacts.
    pub fn open(runtime: &RuntimeDirectory) -> Result<Self, Error> {
        let _setup = files::lock(&runtime.path().join("setup.lock"))?;
        let directory = runtime.path().join("releases");
        private_directory(&directory)?;
        let installation = runtime.credentials().installation.as_str().to_owned();
        let owner = directory.join("owner");
        if !owner.try_exists().map_err(io_error)? {
            if fs::read_dir(&directory).map_err(io_error)?.next().is_some() {
                return Err(Error::Unauthorized);
            }
            write_new(&directory, "owner", installation.as_bytes(), 0o400)?;
        }
        if read(&directory, "owner", 128, true)? != installation.as_bytes() {
            return Err(Error::ForeignInstallation);
        }
        Ok(Self {
            directory,
            installation,
        })
    }

    /// Copies and verifies an entire release before atomically publishing it.
    /// No executable is run here. This verifies bytes, not production publisher trust.
    /// # Errors
    /// Refuses incompatible manifests, symlinks, altered artifacts and unsafe destinations.
    pub fn stage(&self, source: &Path) -> Result<StagedRelease, Error> {
        if read(&self.directory, "owner", 128, true)? != self.installation.as_bytes() {
            return Err(Error::ForeignInstallation);
        }
        let _lock = files::lock(&self.directory.join("store.lock"))?;
        let bytes = read(source, MANIFEST, 64 * 1024, false)?;
        let manifest = Manifest::parse(&bytes)?;
        let id = digest(&bytes);
        let directory = self.directory.join(&id);
        if directory.try_exists().map_err(io_error)? {
            self.verify(&directory, &manifest, &bytes)?;
            return StagedRelease::open(directory, id);
        }
        let temporary = self
            .directory
            .join(format!("staging-{}", uuid::Uuid::new_v4()));
        private_directory(&temporary)?;
        let result = (|| {
            let mut total = 0;
            for artifact in &manifest.files {
                let contents = read(source, &artifact.path, 128 * 1024 * 1024, false)?;
                total += contents.len();
                if total > 256 * 1024 * 1024 {
                    return Err(Error::Capacity);
                }
                if digest(&contents) != artifact.sha256 {
                    return Err(Error::UnsupportedReplacement);
                }
                write_new(
                    &temporary,
                    &artifact.path,
                    &contents,
                    if artifact.executable { 0o500 } else { 0o400 },
                )?;
            }
            write_new(&temporary, MANIFEST, &bytes, 0o400)?;
            files::sync_directory(&temporary)?;
            fs::rename(&temporary, &directory).map_err(io_error)?;
            files::sync_directory(&self.directory)?;
            StagedRelease::open(directory, id)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }

    fn verify(&self, directory: &Path, manifest: &Manifest, bytes: &[u8]) -> Result<(), Error> {
        files::check_directory(directory, true)?;
        let mut expected: BTreeSet<PathBuf> = manifest
            .files
            .iter()
            .map(|a| PathBuf::from(&a.path))
            .collect();
        expected.insert(MANIFEST.into());
        expected.insert("lease.lock".into());
        let mut pending = vec![PathBuf::new()];
        while let Some(relative) = pending.pop() {
            for entry in fs::read_dir(directory.join(&relative)).map_err(io_error)? {
                let entry = entry.map_err(io_error)?;
                let path = relative.join(entry.file_name());
                let kind = entry.file_type().map_err(io_error)?;
                if kind.is_dir() && expected.iter().any(|file| file.starts_with(&path)) {
                    files::check_directory(&directory.join(&path), true)?;
                    pending.push(path);
                } else if !kind.is_file() || !expected.contains(&path) {
                    return Err(Error::Unauthorized);
                }
            }
        }
        if read(directory, MANIFEST, 64 * 1024, true)? != bytes {
            return Err(Error::Unauthorized);
        }
        for artifact in &manifest.files {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::symlink_metadata(directory.join(&artifact.path))
                .map_err(io_error)?
                .permissions()
                .mode()
                & 0o777;
            if mode != if artifact.executable { 0o500 } else { 0o400 } {
                return Err(Error::Unauthorized);
            }
            let contents = read(directory, &artifact.path, 128 * 1024 * 1024, true)?;
            if digest(&contents) != artifact.sha256 {
                return Err(Error::UnsupportedReplacement);
            }
        }
        Ok(())
    }
}
