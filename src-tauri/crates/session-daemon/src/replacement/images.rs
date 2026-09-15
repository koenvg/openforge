use super::{probe, version};
use openforge_session_protocol::Error;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

const MAX_IMAGE_BYTES: u64 = 128 * 1024 * 1024;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Image {
    pub path: PathBuf,
    pub version: String,
    pub sha256: String,
}
struct Temporary(Option<PathBuf>);
impl Drop for Temporary {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(super) fn directory(runtime: &Path) -> Result<PathBuf, Error> {
    let directory = runtime.join("images");
    match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(Error::Unauthorized),
    }
    let metadata = std::fs::symlink_metadata(&directory).map_err(|_| Error::Unauthorized)?;
    // SAFETY: geteuid only reads the current process identity.
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(Error::Unauthorized);
    }
    Ok(directory)
}
pub(super) fn clean(directory: &Path, keep: &[&Path]) -> Result<(), Error> {
    let entries = std::fs::read_dir(directory)
        .map_err(|_| Error::Unauthorized)?
        .take(4)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Error::Unauthorized)?;
    if entries.len() > 2 {
        return Err(Error::Capacity);
    }
    for entry in entries {
        let path = entry.path();
        if keep.contains(&path.as_path()) {
            continue;
        }
        let name = entry.file_name();
        let managed = name
            .to_str()
            .and_then(|name| name.strip_prefix("image-"))
            .and_then(|name| name.strip_suffix(".bin"))
            .is_some_and(|name| uuid::Uuid::parse_str(name).is_ok());
        if !managed {
            return Err(Error::Unauthorized);
        }
        std::fs::remove_file(path).map_err(|_| Error::Unauthorized)?;
    }
    Ok(())
}
pub(super) fn bootstrap(runtime: &Path) -> Result<Image, Error> {
    let directory = directory(runtime)?;
    clean(&directory, &[])?;
    let image = copy(
        &directory,
        &std::env::current_exe().map_err(|_| Error::UnsupportedReplacement)?,
    )?;
    if image.version != version::current()? {
        eprintln!("image preflight retained source code identity mismatch");
        return Err(Error::UnsupportedReplacement);
    }
    Ok(image)
}
pub(super) fn prepare(directory: &Path, current: &Image, requested: &Path) -> Result<Image, Error> {
    verify(current, None)?;
    clean(directory, &[&current.path])?;
    copy(directory, requested)
}
fn copy(directory: &Path, source: &Path) -> Result<Image, Error> {
    let mut source = open(source)?;
    let path = directory.join(format!("image-{}.bin", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)
        .map_err(|_| Error::UnsupportedReplacement)?;
    let mut temporary = Temporary(Some(path.clone()));
    let copied = std::io::copy(&mut source.by_ref().take(MAX_IMAGE_BYTES + 1), &mut file)
        .map_err(|_| Error::UnsupportedReplacement)?;
    if copied > MAX_IMAGE_BYTES {
        return Err(Error::Capacity);
    }
    file.set_permissions(std::fs::Permissions::from_mode(0o500))
        .map_err(|_| Error::UnsupportedReplacement)?;
    file.sync_all().map_err(|_| Error::UnsupportedReplacement)?;
    drop(file);
    File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| Error::UnsupportedReplacement)?;
    let sha256 = digest(&path)?;
    let contract = probe::run(&path, None)?;
    if contract.sha256 != sha256 {
        eprintln!("image preflight copied byte identity mismatch");
        return Err(Error::UnsupportedReplacement);
    }
    temporary.0.take();
    Ok(Image {
        path,
        version: contract.image_version,
        sha256,
    })
}
pub(super) fn verify(image: &Image, state: Option<&[u8]>) -> Result<(), Error> {
    if digest(&image.path)? != image.sha256 {
        return Err(Error::UnsupportedReplacement);
    }
    let contract = probe::run(&image.path, state)?;
    if contract.image_version != image.version || contract.sha256 != image.sha256 {
        return Err(Error::UnsupportedReplacement);
    }
    Ok(())
}
pub(super) fn digest(path: &Path) -> Result<String, Error> {
    let mut file = open(path)?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| Error::UnsupportedReplacement)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_IMAGE_BYTES {
            return Err(Error::Capacity);
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn open(path: &Path) -> Result<File, Error> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| Error::UnsupportedReplacement)?;
    let metadata = file.metadata().map_err(|_| Error::UnsupportedReplacement)?;
    if !metadata.is_file() || metadata.mode() & 0o111 == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err(Error::UnsupportedReplacement);
    }
    let mut header = [0; 32];
    file.read_exact(&mut header)
        .map_err(|_| Error::UnsupportedReplacement)?;
    if header[..4] != [0xcf, 0xfa, 0xed, 0xfe]
        || header[4..8] != [0x0c, 0, 0, 1]
        || header[12..16] != [2, 0, 0, 0]
    {
        return Err(Error::UnsupportedReplacement);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| Error::UnsupportedReplacement)?;
    Ok(file)
}
