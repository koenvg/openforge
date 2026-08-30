mod external_read;
mod project;
mod user_data_durability;

use super::callbacks::required_param_string;
use serde_json::Value;
use std::path::{Component, Path};

async fn read_text_file_under_root(root: &Path, path: &str) -> Result<String, String> {
    let full_path = crate::project_fs::resolve_existing_path(root, Some(path))
        .map_err(|error| error.to_string())?;
    tokio::fs::read_to_string(full_path)
        .await
        .map_err(|error| format!("failed to read UTF-8 text file: {error}"))
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
