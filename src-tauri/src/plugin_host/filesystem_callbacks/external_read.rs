use super::super::callbacks::{
    optional_param_string, optional_param_u64, optional_param_usize, required_param_string,
};
use super::super::PluginHost;
use super::{filesystem_plugin_id, read_text_file_under_root};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const DEFAULT_EXTERNAL_TEXT_CHUNK_BYTES: usize = 64 * 1024;
const MIN_EXTERNAL_TEXT_CHUNK_BYTES: usize = 1;
const MAX_EXTERNAL_TEXT_CHUNK_BYTES: usize = 1024 * 1024;

impl PluginHost {
    pub(in crate::plugin_host) async fn read_external_dir_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = optional_param_string(params, "path")?;
        let root = self.external_read_root_for_host(params)?;
        serde_json::to_value(
            crate::project_fs::read_dir(&root, path.as_deref())
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize external directory entries: {error}"))
    }

    pub(in crate::plugin_host) async fn read_external_text_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let path = required_param_string(params, "path")?;
        let root = self.external_read_root_for_host(params)?;
        read_text_file_under_root(&root, &path)
            .await
            .map(Value::String)
    }

    pub(in crate::plugin_host) async fn stat_external_file_for_host(
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

    pub(in crate::plugin_host) async fn read_external_text_file_chunk_for_host(
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

    fn external_read_root_for_host(&self, params: &Value) -> Result<PathBuf, String> {
        filesystem_plugin_id(params)?;
        let root = PathBuf::from(required_param_string(params, "root")?);
        if !root.is_absolute() {
            return Err("external filesystem root must be absolute".to_string());
        }
        Ok(root)
    }
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
