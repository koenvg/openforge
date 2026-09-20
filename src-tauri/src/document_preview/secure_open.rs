//! Descriptor-relative traversal. No descendant path is reopened by absolute name.
use std::fs::File;
use std::path::Path;

#[derive(Debug)]
pub(super) struct RootGuard {
    directory: File,
    path: std::path::PathBuf,
}

impl RootGuard {
    pub(super) fn verify(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let pinned = self.directory.metadata().map_err(io_error)?;
            let current = std::fs::metadata(&self.path).map_err(|_| {
                "DOCUMENT_PREVIEW_CHANGED: workspace root is unavailable".to_string()
            })?;
            if current.is_dir() && (pinned.dev(), pinned.ino()) == (current.dev(), current.ino()) {
                return Ok(());
            }
        }
        Err("DOCUMENT_PREVIEW_CHANGED: workspace root changed during reading".into())
    }
}

pub(super) fn open(
    root: &Path,
    path: &str,
    operation: &super::Operation,
) -> Result<(File, RootGuard), String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains(['\\', ':', '\0'])
        || path.split('/').any(|part| part == "..")
    {
        return Err("DOCUMENT_PREVIEW_BAD_REQUEST: expected a relative document path".into());
    }
    open_relative(root, path, operation)
}

#[cfg(unix)]
fn open_relative(
    root: &Path,
    path: &str,
    operation: &super::Operation,
) -> Result<(File, RootGuard), String> {
    use rustix::fs::{open, openat, Mode, OFlags};
    let directory_flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
    // The root is host-selected and may itself be a symlink. Descendants may not.
    let directory = File::from(open(root, directory_flags, Mode::empty()).map_err(open_error)?);
    let mut directories = vec![directory.try_clone().map_err(io_error)?];
    let root_guard = RootGuard {
        directory,
        path: root.to_path_buf(),
    };
    let mut components = path.split('/').filter(|part| !part.is_empty()).peekable();
    while let Some(component) = components.next() {
        #[cfg(test)]
        operation.observe(super::ReadStage::BeforeComponent(directories.len() - 1));
        operation.checkpoint()?;
        let flags = if components.peek().is_some() {
            directory_flags | OFlags::NOFOLLOW
        } else {
            // NONBLOCK prevents a FIFO open from waiting for a writer. No content
            // is read until the opened descriptor has passed the regular-file check.
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK
        };
        let directory = directories
            .last()
            .ok_or_else(|| "DOCUMENT_PREVIEW_IO: missing root handle".to_string())?;
        let handle = openat(directory, component, flags, Mode::empty()).map_err(open_error)?;
        if components.peek().is_none() {
            let file = File::from(handle);
            if !file.metadata().map_err(io_error)?.is_file() {
                return Err(
                    "DOCUMENT_PREVIEW_FORBIDDEN: only regular documents are allowed".into(),
                );
            }
            return Ok((file, root_guard));
        }
        directories.push(File::from(handle));
    }
    Err("DOCUMENT_PREVIEW_BAD_REQUEST: expected a document path".into())
}

#[cfg(not(unix))]
fn open_relative(
    _root: &Path,
    _path: &str,
    _operation: &super::Operation,
) -> Result<(File, RootGuard), String> {
    Err("DOCUMENT_PREVIEW_UNAVAILABLE_HOST: secure document opening is unavailable".into())
}

#[cfg(unix)]
fn open_error(error: rustix::io::Errno) -> String {
    use rustix::io::Errno;
    match error {
        Errno::LOOP | Errno::NOTDIR | Errno::ACCESS | Errno::PERM => {
            "DOCUMENT_PREVIEW_FORBIDDEN: document path is not allowed".into()
        }
        _ => io_error(error.into()),
    }
}

pub(super) fn io_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "DOCUMENT_PREVIEW_NOT_FOUND: document is unavailable",
        std::io::ErrorKind::PermissionDenied => {
            "DOCUMENT_PREVIEW_FORBIDDEN: document access denied"
        }
        _ => "DOCUMENT_PREVIEW_IO: unable to read document",
    }
    .into()
}
