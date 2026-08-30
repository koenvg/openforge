use super::super::callbacks::{
    optional_param_string, required_param_string, required_param_string_allow_empty,
};
use super::super::PluginHost;
use super::{filesystem_plugin_id, read_text_file_under_root};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

impl PluginHost {
    pub(in crate::plugin_host) async fn read_plugin_user_data_dir_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = optional_param_string(params, "path")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        serde_json::to_value(
            crate::project_fs::read_dir(&root, path.as_deref())
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize plugin user data entries: {error}"))
    }

    pub(in crate::plugin_host) async fn read_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        read_text_file_under_root(&root, &path)
            .await
            .map(Value::String)
    }

    pub(in crate::plugin_host) async fn write_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let content = required_param_string_allow_empty(params, "content")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        write_text_file_atomically_under_root(&root, &path, &content).await?;
        Ok(Value::Null)
    }

    pub(in crate::plugin_host) async fn append_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let content = required_param_string_allow_empty(params, "content")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        let size_bytes = append_text_file_under_root(&root, &path, &content).await?;
        Ok(json!({ "sizeBytes": size_bytes }))
    }

    async fn plugin_user_data_root_for_host(&self, params: &Value) -> Result<PathBuf, String> {
        let plugin_id = filesystem_plugin_id(params)?;
        let root = self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve plugin user data directory: {error}"))?
            .join("plugin-data")
            .join(plugin_id);
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(|error| format!("failed to create plugin user data directory: {error}"))?;
        Ok(root)
    }
}

async fn user_data_write_target(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target =
        crate::project_fs::resolve_write_path(root, path).map_err(|error| error.to_string())?;
    let parent = target
        .parent()
        .ok_or_else(|| "user-data file path must include a parent directory".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("failed to create user-data parent directory: {error}"))?;
    crate::project_fs::resolve_write_path(root, path).map_err(|error| error.to_string())
}

async fn write_text_file_atomically_under_root(
    root: &Path,
    path: &str,
    content: &str,
) -> Result<(), String> {
    ensure_durable_user_data_supported()?;
    let target = user_data_write_target(root, path).await?;
    let parent = target
        .parent()
        .ok_or_else(|| "user-data file path must include a parent directory".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "user-data file path must have a UTF-8 file name".to_string())?;
    let temporary = target.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(|error| format!("failed to create temporary user-data file: {error}"))?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|error| format!("failed to write temporary user-data file: {error}"))?;
        file.sync_all()
            .await
            .map_err(|error| format!("failed to sync temporary user-data file: {error}"))?;
        drop(file);
        crate::project_fs::resolve_write_path(root, path).map_err(|error| error.to_string())?;
        tokio::fs::rename(&temporary, &target)
            .await
            .map_err(|error| format!("failed to atomically replace user-data file: {error}"))?;
        sync_parent_directory(parent).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

async fn append_text_file_under_root(
    root: &Path,
    path: &str,
    content: &str,
) -> Result<u64, String> {
    ensure_durable_user_data_supported()?;
    let target = user_data_write_target(root, path).await?;
    let parent = target
        .parent()
        .ok_or_else(|| "user-data file path must include a parent directory".to_string())?;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .await
        .map_err(|error| format!("failed to open user-data file for append: {error}"))?;
    file.write_all(content.as_bytes())
        .await
        .map_err(|error| format!("failed to append user-data file: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("failed to sync appended user-data file: {error}"))?;
    let size_bytes = file
        .metadata()
        .await
        .map_err(|error| format!("failed to inspect appended user-data file: {error}"))?
        .len();
    drop(file);
    sync_parent_directory(parent).await?;
    Ok(size_bytes)
}

#[cfg(unix)]
fn ensure_durable_user_data_supported() -> Result<(), String> {
    Ok(())
}

#[cfg(not(unix))]
fn ensure_durable_user_data_supported() -> Result<(), String> {
    Err("durable user-data writes are unavailable on this platform".to_string())
}

#[cfg(unix)]
async fn sync_parent_directory(parent: &Path) -> Result<(), String> {
    let directory = tokio::fs::File::open(parent)
        .await
        .map_err(|error| format!("failed to open user-data parent directory: {error}"))?;
    directory
        .sync_all()
        .await
        .map_err(|error| format!("failed to sync user-data parent directory: {error}"))
}

#[cfg(not(unix))]
async fn sync_parent_directory(_parent: &Path) -> Result<(), String> {
    Err("durable user-data parent sync is unavailable on this platform".to_string())
}
