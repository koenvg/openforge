mod external_read;
mod project;
mod task;
mod user_data_durability;

use super::callbacks::required_param_string;
use crate::authorized_fs::AuthorizedFile;
use serde_json::Value;
use std::path::{Component, Path};
use tokio::io::AsyncReadExt;

async fn open_authorized_file_under_root(
    root: &Path,
    path: &str,
) -> Result<AuthorizedFile, String> {
    let root = root.to_path_buf();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        crate::authorized_fs::open_authorized_file(
            &root,
            &path,
            crate::authorized_fs::SymlinkPolicy::FollowWithinRoot,
        )
    })
    .await
    .map_err(|error| format!("failed to join authorized file open: {error}"))?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
async fn open_authorized_file_under_root_with_hook<F>(
    root: &Path,
    path: &str,
    before_open: F,
) -> Result<AuthorizedFile, String>
where
    F: FnOnce() + Send + 'static,
{
    let root = root.to_path_buf();
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        crate::authorized_fs::open_authorized_file_with_hook(
            &root,
            &path,
            crate::authorized_fs::SymlinkPolicy::FollowWithinRoot,
            before_open,
        )
    })
    .await
    .map_err(|error| format!("failed to join authorized file open: {error}"))?
    .map_err(|error| error.to_string())
}

async fn read_text_file_under_root(root: &Path, path: &str) -> Result<String, String> {
    let opened = open_authorized_file_under_root(root, path).await?;
    read_opened_text_file(opened).await
}

#[cfg(test)]
async fn read_text_file_under_root_with_hook<F>(
    root: &Path,
    path: &str,
    before_open: F,
) -> Result<String, String>
where
    F: FnOnce() + Send + 'static,
{
    let opened = open_authorized_file_under_root_with_hook(root, path, before_open).await?;
    read_opened_text_file(opened).await
}

async fn read_opened_text_file(opened: AuthorizedFile) -> Result<String, String> {
    let mut file = tokio::fs::File::from_std(opened.into_file());
    let mut content = String::new();
    file.read_to_string(&mut content)
        .await
        .map_err(|error| format!("failed to read UTF-8 text file: {error}"))?;
    Ok(content)
}

fn filesystem_plugin_id(params: &Value) -> Result<String, String> {
    let plugin_id = required_param_string(params, "pluginId")?;
    let path = Path::new(&plugin_id);
    if !matches!(path.components().next(), Some(Component::Normal(_)))
        || path.components().count() != 1
    {
        return Err("plugin filesystem callback has invalid pluginId".to_string());
    }
    Ok(plugin_id)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStrExt;

    #[tokio::test]
    async fn complete_text_read_cannot_be_redirected_by_component_replacement() {
        let root = tempfile::tempdir().expect("root");
        let outside = tempfile::tempdir().expect("outside");
        std::fs::create_dir(root.path().join("nested")).expect("nested directory");
        std::fs::write(root.path().join("nested/file.txt"), "inside").expect("inside fixture");
        std::fs::write(outside.path().join("file.txt"), "outside").expect("outside fixture");
        let root_path = root.path().to_path_buf();
        let outside_path = outside.path().to_path_buf();

        let result =
            read_text_file_under_root_with_hook(root.path(), "nested/file.txt", move || {
                std::fs::rename(root_path.join("nested"), root_path.join("original"))
                    .expect("move authorized component");
                std::os::unix::fs::symlink(&outside_path, root_path.join("nested"))
                    .expect("replace component with outside symlink");
            })
            .await;

        match result {
            Ok(content) => assert_eq!(content, "inside"),
            Err(error) => assert!(
                error.contains("Path traversal detected")
                    || error.contains("Failed to canonicalize path"),
                "unexpected authorization error: {error}"
            ),
        }
    }

    #[tokio::test]
    async fn complete_text_read_rejects_special_files_without_waiting_for_a_writer() {
        let root = tempfile::tempdir().expect("root");
        let fifo = root.path().join("events.jsonl");
        let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_bytes()).expect("FIFO path");
        // SAFETY: fifo_path is NUL-terminated and the mode is a valid permission mask.
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);

        let error = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            read_text_file_under_root(root.path(), "events.jsonl"),
        )
        .await
        .expect("special-file rejection must not wait for a writer")
        .expect_err("special file must fail");

        assert!(error.contains("not a regular file"));
    }
}
