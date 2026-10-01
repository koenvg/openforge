use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::Path,
};

pub(crate) fn private_directory(path: &Path) -> Result<(), String> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => sync_directory(path.parent().ok_or("update directory has no parent")?)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    check_private_directory(path)
}

pub(crate) fn check_private_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    // SAFETY: geteuid has no arguments or memory preconditions.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o7777 != 0o700 {
        return Err("unsafe update transaction directory".into());
    }
    Ok(())
}

pub(crate) fn exclusive_lock(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    // SAFETY: geteuid has no arguments or memory preconditions.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_file()
        || metadata.uid() != uid
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err("unsafe update ownership lock".into());
    }
    file.try_lock()
        .map_err(|_| "another updater owns this installation".to_string())?;
    // The inode is permanent. Never unlink a lock, including after a crash.
    Ok(file)
}

pub(crate) fn read_private(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    // SAFETY: geteuid has no arguments or memory preconditions.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_file()
        || metadata.uid() != uid
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o600
        || metadata.len() > limit
    {
        return Err("unsafe update private file".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("update file exceeds limit".into());
    }
    Ok(bytes)
}

pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string())?;
    sync_directory(path.parent().ok_or("update file has no parent")?)
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    write_new(&temporary, bytes)?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    sync_directory(path.parent().ok_or("update file has no parent")?)
}

pub(crate) fn bind_destination(
    mut lock: &File,
    root: &Path,
    installation: &str,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let expected = serde_json::to_vec(&(
        root.canonicalize().map_err(|e| e.to_string())?,
        installation,
    ))
    .map_err(|e| e.to_string())?;
    let size = lock.metadata().map_err(|e| e.to_string())?.len();
    if size == 0 {
        lock.write_all(&expected)
            .and_then(|()| lock.sync_all())
            .map_err(|e| e.to_string())?;
    } else {
        if size > 16 * 1024 {
            return Err("invalid destination ownership record".into());
        }
        let mut current = Vec::new();
        lock.take(16 * 1024 + 1)
            .read_to_end(&mut current)
            .map_err(|e| e.to_string())?;
        if current != expected {
            return Err(
                "destination belongs to another update recovery root or installation".into(),
            );
        }
    }
    Ok(())
}
