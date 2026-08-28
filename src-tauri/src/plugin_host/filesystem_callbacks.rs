use super::callbacks::{
    optional_param_string, optional_param_u64, optional_param_usize, required_param_string,
    required_param_string_allow_empty,
};
use super::PluginHost;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

const DEFAULT_EXTERNAL_TEXT_CHUNK_BYTES: usize = 64 * 1024;
const MIN_EXTERNAL_TEXT_CHUNK_BYTES: usize = 1;
const MAX_EXTERNAL_TEXT_CHUNK_BYTES: usize = 1024 * 1024;

impl PluginHost {
    pub(super) async fn read_project_dir_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let path = optional_param_string(params, "path")?;
        let project_root = self.project_root_for_host(&project_id)?;
        serde_json::to_value(
            crate::project_fs::read_dir(&project_root, path.as_deref())
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize directory entries: {error}"))
    }

    pub(super) async fn read_project_file_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let path = required_param_string(params, "path")?;
        let project_root = self.project_root_for_host(&project_id)?;
        let full_path = crate::project_fs::resolve_existing_path(&project_root, Some(&path))
            .map_err(|error| error.to_string())?;
        serde_json::to_value(
            crate::project_fs::read_file_preview(&full_path)
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize file content: {error}"))
    }

    pub(super) fn search_project_files_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let query = required_param_string(params, "query")?;
        let limit = optional_param_usize(params, "limit")?.unwrap_or(50);
        let project_root = self.project_root_for_host(&project_id)?;
        serde_json::to_value(crate::project_fs::search_files(
            &project_root,
            &query,
            limit,
        ))
        .map_err(|error| format!("failed to serialize file search results: {error}"))
    }

    pub(super) async fn write_project_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let path = required_param_string(params, "path")?;
        let content = required_param_string_allow_empty(params, "content")?;
        let project_root = self.project_root_for_host(&project_id)?;
        crate::project_fs::write_file(&project_root, &path, &content)
            .await
            .map_err(|error| error.to_string())?;
        Ok(Value::Null)
    }

    pub(super) async fn read_plugin_user_data_dir_for_host(
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

    pub(super) async fn read_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        read_text_file_under_root(&root, &path)
            .await
            .map(Value::String)
    }

    pub(super) async fn write_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let content = required_param_string_allow_empty(params, "content")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        write_text_file_atomically_under_root(&root, &path, &content).await?;
        Ok(Value::Null)
    }

    pub(super) async fn append_plugin_user_data_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let content = required_param_string_allow_empty(params, "content")?;
        let root = self.plugin_user_data_root_for_host(params).await?;
        let size_bytes = append_text_file_under_root(&root, &path, &content).await?;
        Ok(json!({ "sizeBytes": size_bytes }))
    }

    pub(super) async fn read_external_dir_for_host(&self, params: &Value) -> Result<Value, String> {
        let path = optional_param_string(params, "path")?;
        let root = self.external_read_root_for_host(params)?;
        serde_json::to_value(
            crate::project_fs::read_dir(&root, path.as_deref())
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize external directory entries: {error}"))
    }

    pub(super) async fn read_external_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let root = self.external_read_root_for_host(params)?;
        read_text_file_under_root(&root, &path)
            .await
            .map(Value::String)
    }

    pub(super) async fn stat_external_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let root = self.external_read_root_for_host(params)?;
        let full_path = crate::project_fs::resolve_existing_path(&root, Some(&path))
            .map_err(|error| error.to_string())?;
        let metadata = tokio::fs::metadata(&full_path)
            .await
            .map_err(|error| format!("failed to inspect external file: {error}"))?;
        if !metadata.is_file() {
            return Err("external filesystem path is not a file".to_string());
        }
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|time| crate::unix_timestamp::milliseconds(time).ok());
        Ok(json!({
            "identity": external_file_identity(&metadata)?,
            "sizeBytes": metadata.len(),
            "modifiedAtMs": modified_at_ms,
        }))
    }

    pub(super) async fn read_external_text_file_chunk_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let expected_identity = optional_param_string(params, "expectedIdentity")?;
        let offset = optional_param_u64(params, "offset")?.unwrap_or(0);
        let max_bytes =
            optional_param_usize(params, "maxBytes")?.unwrap_or(DEFAULT_EXTERNAL_TEXT_CHUNK_BYTES);
        if !(MIN_EXTERNAL_TEXT_CHUNK_BYTES..=MAX_EXTERNAL_TEXT_CHUNK_BYTES).contains(&max_bytes) {
            return Err(format!(
                "external text chunk maxBytes must be between {MIN_EXTERNAL_TEXT_CHUNK_BYTES} and {MAX_EXTERNAL_TEXT_CHUNK_BYTES}"
            ));
        }
        let root = self.external_read_root_for_host(params)?;
        let (content, next_offset, eof) = read_text_file_chunk_under_root(
            &root,
            &path,
            expected_identity.as_deref(),
            offset,
            max_bytes,
        )
        .await?;
        Ok(json!({
            "content": content,
            "nextOffset": next_offset,
            "eof": eof,
        }))
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

    fn external_read_root_for_host(&self, params: &Value) -> Result<PathBuf, String> {
        filesystem_plugin_id(params)?;
        let root = PathBuf::from(required_param_string(params, "root")?);
        if !root.is_absolute() {
            return Err("external filesystem root must be absolute".to_string());
        }
        Ok(root)
    }

    fn project_root_for_host(&self, project_id: &str) -> Result<PathBuf, String> {
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let project = db
            .get_project(project_id)
            .map_err(|error| format!("failed to get project root: {error}"))?
            .ok_or_else(|| format!("Project not found: {project_id}"))?;
        Ok(PathBuf::from(project.path))
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

async fn read_text_file_under_root(root: &Path, path: &str) -> Result<String, String> {
    let full_path = crate::project_fs::resolve_existing_path(root, Some(path))
        .map_err(|error| error.to_string())?;
    tokio::fs::read_to_string(full_path)
        .await
        .map_err(|error| format!("failed to read UTF-8 text file: {error}"))
}

async fn read_text_file_chunk_under_root(
    root: &Path,
    path: &str,
    expected_identity: Option<&str>,
    offset: u64,
    max_bytes: usize,
) -> Result<(String, u64, bool), String> {
    let full_path = crate::project_fs::resolve_existing_path(root, Some(path))
        .map_err(|error| error.to_string())?;
    let mut file = tokio::fs::File::open(full_path)
        .await
        .map_err(|error| format!("failed to open UTF-8 text file: {error}"))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|error| format!("failed to inspect UTF-8 text file: {error}"))?;
    let identity = external_file_identity(&metadata)?;
    if let Some(expected_identity) = expected_identity {
        if expected_identity != identity {
            return Err(format!(
                "external file identity changed: expected {expected_identity}, received {identity}"
            ));
        }
    }
    let file_len = metadata.len();
    if offset >= file_len {
        return Ok((String::new(), offset, true));
    }

    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|error| format!("failed to seek UTF-8 text file: {error}"))?;
    let mut bytes = Vec::with_capacity(max_bytes);
    (&mut file)
        .take(max_bytes as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("failed to read UTF-8 text file chunk: {error}"))?;
    let read_was_empty = bytes.is_empty();
    let reached_eof = offset.saturating_add(bytes.len() as u64) >= file_len;
    let valid_len = match std::str::from_utf8(&bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() && !reached_eof => error.valid_up_to(),
        Err(error) => {
            return Err(format!(
                "failed to read UTF-8 text file: invalid UTF-8 at byte {}",
                offset.saturating_add(error.valid_up_to() as u64)
            ));
        }
    };
    if valid_len == 0 && !bytes.is_empty() {
        return Err("failed to read UTF-8 text file: chunk made no progress".to_string());
    }
    bytes.truncate(valid_len);
    let content = String::from_utf8(bytes)
        .map_err(|error| format!("failed to read UTF-8 text file: {error}"))?;
    let next_offset = offset.saturating_add(valid_len as u64);
    Ok((
        content,
        next_offset,
        read_was_empty || next_offset >= file_len,
    ))
}

#[cfg(unix)]
fn external_file_identity(metadata: &std::fs::Metadata) -> Result<String, String> {
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn external_file_identity(_metadata: &std::fs::Metadata) -> Result<String, String> {
    Err("stable external file identity is unavailable on this platform".to_string())
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
