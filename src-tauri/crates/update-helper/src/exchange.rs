//! Kernel-supported exchange. Never fall back to removing the installed app first.
use crate::files;
use std::path::Path;

pub(crate) fn swap(left: &Path, right: &Path) -> Result<(), String> {
    exchange_entries(left, right)?;
    files::sync_directory(left.parent().ok_or("missing exchange parent")?)?;
    files::sync_directory(right.parent().ok_or("missing exchange parent")?)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn exchange_entries(left: &Path, right: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let left = CString::new(left.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let right = CString::new(right.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    // SAFETY: both C strings are valid for the call; RENAME_SWAP exchanges both entries atomically.
    let result = unsafe { libc::renamex_np(left.as_ptr(), right.as_ptr(), libc::RENAME_SWAP) };
    #[cfg(target_os = "linux")]
    // SAFETY: both absolute C paths are valid; RENAME_EXCHANGE never removes one entry first.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            left.as_ptr(),
            libc::AT_FDCWD,
            right.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    if result != 0 {
        return Err(format!(
            "atomic app exchange failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn exchange_entries(_left: &Path, _right: &Path) -> Result<(), String> {
    Err("atomic app exchange is unsupported on this platform".into())
}

/// Test the actual installation filesystem before the source is asked to detach.
pub(crate) fn probe(root: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    let temporary = root.join(format!(".exchange-{}", uuid::Uuid::new_v4()));
    // A collision is an error. Cleanup may remove only the directory we created.
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&temporary)
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        let left = temporary.join("left");
        let right = temporary.join("right");
        files::private_directory(&left)?;
        files::private_directory(&right)?;
        files::write_new(&left.join("marker"), b"left")?;
        files::write_new(&right.join("marker"), b"right")?;
        swap(&left, &right)?;
        if files::read_private(&left.join("marker"), 5)? != b"right"
            || files::read_private(&right.join("marker"), 5)? != b"left"
        {
            return Err("filesystem did not exchange app entries".into());
        }
        Ok(())
    })();
    let cleanup = std::fs::remove_dir_all(&temporary).map_err(|e| e.to_string());
    let synced = files::sync_directory(root);
    result?;
    cleanup?;
    synced
}
