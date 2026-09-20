//! Descriptor-relative file authorization shared by previews and bounded document reads.
//! The returned file handle owns the checked object, so later path replacement cannot redirect I/O.
use std::fs::{File, Metadata};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthorizedOpenErrorKind {
    BadRequest,
    Forbidden,
    Internal,
}

#[derive(Debug)]
pub(crate) struct AuthorizedOpenError {
    kind: AuthorizedOpenErrorKind,
    message: String,
}

impl AuthorizedOpenError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            kind: AuthorizedOpenErrorKind::BadRequest,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            kind: AuthorizedOpenErrorKind::Forbidden,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: AuthorizedOpenErrorKind::Internal,
            message: message.into(),
        }
    }

    pub(crate) const fn kind(&self) -> AuthorizedOpenErrorKind {
        self.kind
    }

    pub(crate) fn message(self) -> String {
        self.message
    }
}

impl std::fmt::Display for AuthorizedOpenError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AuthorizedOpenError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SymlinkPolicy {
    FollowWithinRoot,
    #[allow(
        dead_code,
        reason = "reserved for the stricter secure PDF reader approved in KVG-3923"
    )]
    Deny,
}

#[derive(Debug)]
pub(crate) struct AuthorizedFile {
    file: File,
    metadata: Metadata,
    resolved_path: PathBuf,
}

impl AuthorizedFile {
    pub(crate) fn metadata(&self) -> &Metadata {
        &self.metadata
    }

    pub(crate) fn resolved_path(&self) -> &Path {
        &self.resolved_path
    }

    pub(crate) fn into_file(self) -> File {
        self.file
    }
}

pub(crate) fn open_authorized_file(
    root: &Path,
    relative_path: &str,
    symlink_policy: SymlinkPolicy,
) -> Result<AuthorizedFile, AuthorizedOpenError> {
    open_authorized_file_impl(root, relative_path, symlink_policy, || {})
}

fn open_authorized_file_impl(
    root: &Path,
    relative_path: &str,
    symlink_policy: SymlinkPolicy,
    before_open: impl FnOnce(),
) -> Result<AuthorizedFile, AuthorizedOpenError> {
    let canonical_root = std::fs::canonicalize(root).map_err(|error| {
        AuthorizedOpenError::bad_request(format!("Failed to canonicalize project root: {error}"))
    })?;
    let root = open_root_directory(&canonical_root)?;
    let root_metadata = root.metadata().map_err(|error| {
        AuthorizedOpenError::internal(format!("Failed to inspect project root: {error}"))
    })?;
    if !root_metadata.is_dir() {
        return Err(AuthorizedOpenError::bad_request(
            "Project root is not a directory",
        ));
    }

    let requested_path = Path::new(relative_path);
    if relative_path.contains('\0') || requested_path.is_absolute() {
        return Err(AuthorizedOpenError::bad_request(
            "file path must be relative",
        ));
    }

    let resolved_path = match symlink_policy {
        SymlinkPolicy::FollowWithinRoot => {
            let canonical_path = std::fs::canonicalize(canonical_root.join(requested_path))
                .map_err(|error| {
                    AuthorizedOpenError::bad_request(format!(
                        "Failed to canonicalize path: {error}"
                    ))
                })?;
            canonical_path
                .strip_prefix(&canonical_root)
                .map(Path::to_path_buf)
                .map_err(|_| {
                    AuthorizedOpenError::forbidden("Path traversal detected: access denied")
                })?
        }
        SymlinkPolicy::Deny => normalize_strict_relative_path(requested_path)?,
    };

    if resolved_path.as_os_str().is_empty() {
        return Err(AuthorizedOpenError::bad_request(
            "Path is a directory, not a file",
        ));
    }

    before_open();
    let file = open_relative_regular_file(root, &resolved_path)?;
    let metadata = file.metadata().map_err(|error| {
        AuthorizedOpenError::internal(format!("Failed to read file metadata: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(AuthorizedOpenError::bad_request(
            "Path is not a regular file",
        ));
    }

    Ok(AuthorizedFile {
        file,
        metadata,
        resolved_path,
    })
}

fn normalize_strict_relative_path(path: &Path) -> Result<PathBuf, AuthorizedOpenError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(component) => normalized.push(component),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AuthorizedOpenError::forbidden(
                    "Path traversal detected: access denied",
                ));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(AuthorizedOpenError::bad_request(
                    "file path must be relative",
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(AuthorizedOpenError::bad_request(
            "file path must be relative",
        ));
    }
    Ok(normalized)
}

#[cfg(unix)]
fn open_root_directory(path: &Path) -> Result<File, AuthorizedOpenError> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = std::fs::OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    options.open(path).map_err(|error| {
        AuthorizedOpenError::internal(format!("Failed to open project root: {error}"))
    })
}

#[cfg(not(unix))]
fn open_root_directory(_path: &Path) -> Result<File, AuthorizedOpenError> {
    Err(AuthorizedOpenError::internal(
        "Secure descriptor-relative file opening is unavailable on this platform",
    ))
}

#[cfg(unix)]
fn open_relative_regular_file(
    mut directory: File,
    path: &Path,
) -> Result<File, AuthorizedOpenError> {
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(component) => Some(component.to_owned()),
            Component::CurDir => None,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => None,
        })
        .collect::<Vec<_>>();
    let Some((file_name, directories)) = components.split_last() else {
        return Err(AuthorizedOpenError::bad_request(
            "file path must be relative",
        ));
    };

    for component in directories {
        directory = openat_component(&directory, component, true)?;
    }
    openat_component(&directory, file_name, false)
}

#[cfg(unix)]
fn openat_component(
    directory: &File,
    component: &std::ffi::OsStr,
    require_directory: bool,
) -> Result<File, AuthorizedOpenError> {
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    let component = std::ffi::CString::new(component.as_bytes())
        .map_err(|_| AuthorizedOpenError::bad_request("file path contains NUL"))?;
    let mut flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK;
    if require_directory {
        flags |= libc::O_DIRECTORY;
    }
    // SAFETY: directory is a live descriptor, component is NUL-terminated, and openat
    // returns a new owned descriptor on success. No mode argument is needed without O_CREAT.
    let descriptor = unsafe { libc::openat(directory.as_raw_fd(), component.as_ptr(), flags) };
    if descriptor < 0 {
        return Err(map_open_error(std::io::Error::last_os_error()));
    }
    // SAFETY: openat returned a fresh descriptor whose ownership transfers to File.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(not(unix))]
fn open_relative_regular_file(_directory: File, _path: &Path) -> Result<File, AuthorizedOpenError> {
    Err(AuthorizedOpenError::internal(
        "Secure descriptor-relative file opening is unavailable on this platform",
    ))
}

fn map_open_error(error: std::io::Error) -> AuthorizedOpenError {
    match error.raw_os_error() {
        #[cfg(unix)]
        Some(libc::ELOOP | libc::ENOTDIR) => {
            AuthorizedOpenError::forbidden("Path traversal detected: access denied")
        }
        #[cfg(unix)]
        Some(libc::ENOENT) => {
            AuthorizedOpenError::bad_request(format!("Failed to canonicalize path: {error}"))
        }
        #[cfg(unix)]
        Some(code) if code == libc::EOPNOTSUPP || code == libc::ENXIO || code == libc::ENODEV => {
            AuthorizedOpenError::bad_request("Path is not a regular file")
        }
        _ => AuthorizedOpenError::internal(format!("Failed to open authorized file: {error}")),
    }
}

#[cfg(test)]
fn open_authorized_file_with_hook(
    root: &Path,
    relative_path: &str,
    symlink_policy: SymlinkPolicy,
    before_open: impl FnOnce(),
) -> Result<AuthorizedFile, AuthorizedOpenError> {
    open_authorized_file_impl(root, relative_path, symlink_policy, before_open)
}

#[cfg(test)]
mod tests;
