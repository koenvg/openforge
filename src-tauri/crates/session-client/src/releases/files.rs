use crate::runtime::io_error;
use openforge_session_protocol::Error;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::Path,
};

fn uid() -> u32 {
    // SAFETY: geteuid has no arguments or preconditions.
    unsafe { libc::geteuid() }
}

pub(super) fn check_directory(path: &Path, private: bool) -> Result<(), Error> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if !metadata.is_dir()
        || metadata.mode() & 0o022 != 0
        || (private && (metadata.uid() != uid() || metadata.mode() & 0o777 != 0o700))
    {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub(super) fn private_directory(path: &Path) -> Result<(), Error> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(io_error(e)),
    }
    check_directory(path, true)
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn read(
    root: &Path,
    relative: &str,
    limit: u64,
    private: bool,
) -> Result<Vec<u8>, Error> {
    check_directory(root, private)?;
    let path = root.join(relative);
    let mut parent = root.to_path_buf();
    if let Some(parents) = Path::new(relative).parent() {
        for component in parents.components() {
            parent.push(component);
            check_directory(&parent, private)?;
        }
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.mode() & 0o022 != 0
        || (private && (metadata.uid() != uid() || metadata.mode() & 0o277 != 0))
    {
        return Err(Error::Unauthorized);
    }
    if metadata.len() > limit {
        return Err(Error::Capacity);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(Error::Capacity);
    }
    Ok(bytes)
}

pub(super) fn write_new(root: &Path, relative: &str, bytes: &[u8], mode: u32) -> Result<(), Error> {
    let mut parent = root.to_path_buf();
    if let Some(parents) = Path::new(relative).parent() {
        for component in parents.components() {
            parent.push(component);
            private_directory(&parent)?;
        }
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .custom_flags(libc::O_NOFOLLOW)
        .open(root.join(relative))
        .map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    sync_directory(&parent)
}

pub(super) fn sync_directory(path: &Path) -> Result<(), Error> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)
}

pub(super) fn lock_file(path: &Path) -> Result<File, Error> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(io_error)?;
    let m = file.metadata().map_err(io_error)?;
    if !m.is_file() || m.uid() != uid() || m.nlink() != 1 || m.mode() & 0o777 != 0o600 {
        return Err(Error::Unauthorized);
    }
    Ok(file)
}

pub(super) fn lock(path: &Path) -> Result<File, Error> {
    let file = lock_file(path)?;
    file.lock().map_err(io_error)?;
    Ok(file)
}
