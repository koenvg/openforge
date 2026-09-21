use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub(crate) fn install_provider_file(path: &Path, contents: &[u8]) -> io::Result<PathBuf> {
    install_provider_file_with(path, |staged| staged.write_all(contents))
}

fn install_provider_file_with<F>(path: &Path, write_staged: F) -> io::Result<PathBuf>
where
    F: FnOnce(&mut File) -> io::Result<()>,
{
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "provider file path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;
    validate_provider_file(path)?;

    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    write_staged(staged.as_file_mut())?;
    staged.as_file_mut().flush()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        staged
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o644))?;
    }

    staged.as_file().sync_all()?;
    validate_provider_file(path)?;
    staged.persist(path).map_err(|error| error.error)?;
    Ok(path.to_path_buf())
}
pub(crate) fn validate_provider_file(path: &Path) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "provider file path has no parent directory",
        )
    })?;
    validate_directory(parent)?;
    validate_destination(path)
}

fn validate_directory(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Err(permission_denied(
            path,
            "provider install directory is not a real directory",
        ));
    }
    validate_owner(path, &metadata)
}

fn validate_destination(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    if !metadata.is_file() {
        return Err(permission_denied(
            path,
            "provider destination is not a regular file",
        ));
    }
    validate_owner(path, &metadata)
}

#[cfg(unix)]
fn validate_owner(path: &Path, metadata: &fs::Metadata) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;

    // SAFETY: geteuid has no pointer arguments and only reads the process identity.
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(permission_denied(
            path,
            "provider path is not owned by the current user",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_owner(_path: &Path, _metadata: &fs::Metadata) -> io::Result<()> {
    Ok(())
}

fn permission_denied(path: &Path, reason: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("{reason}: {}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Write};
    use std::sync::{Arc, Barrier};

    #[test]
    fn concurrent_installations_publish_one_complete_file() {
        let root = tempfile::tempdir().expect("create provider install fixture");
        let destination = root.path().join("provider/openforge.ts");
        let payloads: Vec<_> = (0..8).map(|index| vec![b'a' + index; 256 * 1024]).collect();
        let barrier = Arc::new(Barrier::new(payloads.len()));

        std::thread::scope(|scope| {
            for payload in &payloads {
                let barrier = Arc::clone(&barrier);
                let destination = destination.clone();
                scope.spawn(move || {
                    barrier.wait();
                    install_provider_file(&destination, payload)
                        .expect("concurrent provider install should succeed");
                });
            }
        });

        let installed = std::fs::read(&destination).expect("read installed provider file");
        assert!(payloads.contains(&installed));
    }

    #[test]
    fn failed_staged_write_preserves_existing_file() {
        let root = tempfile::tempdir().expect("create provider install fixture");
        let destination = root.path().join("provider/openforge.ts");
        std::fs::create_dir_all(destination.parent().expect("destination parent"))
            .expect("create destination parent");
        std::fs::write(&destination, b"previous complete file")
            .expect("write existing provider file");

        let result = install_provider_file_with(&destination, |staged| {
            staged.write_all(b"partial replacement")?;
            Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "injected staging failure",
            ))
        });

        assert!(result.is_err());
        assert_eq!(
            std::fs::read(&destination).expect("read preserved provider file"),
            b"previous complete file"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_destination_is_rejected_without_changing_its_target() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().expect("create provider install fixture");
        let install_dir = root.path().join("provider");
        std::fs::create_dir(&install_dir).expect("create provider directory");
        let user_file = root.path().join("user-owned.ts");
        std::fs::write(&user_file, b"user contents").expect("write user file");
        let destination = install_dir.join("openforge.ts");
        symlink(&user_file, &destination).expect("create destination symlink");

        let error = install_provider_file(&destination, b"managed contents")
            .expect_err("symlink destination must be rejected");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(
            std::fs::read(&user_file).expect("read user file"),
            b"user contents"
        );
        assert!(std::fs::symlink_metadata(&destination)
            .expect("inspect destination")
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_install_directory_is_rejected_without_writing_through_it() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().expect("create provider install fixture");
        let user_directory = root.path().join("user-directory");
        std::fs::create_dir(&user_directory).expect("create user directory");
        let install_dir = root.path().join("provider");
        symlink(&user_directory, &install_dir).expect("create install directory symlink");
        let destination = install_dir.join("openforge.ts");

        let error = install_provider_file(&destination, b"managed contents")
            .expect_err("symlink install directory must be rejected");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!user_directory.join("openforge.ts").exists());
    }
}
