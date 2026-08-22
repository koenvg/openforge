use super::callbacks::{
    optional_param_string, optional_param_usize, required_param_string,
    required_param_string_allow_empty,
};
use super::PluginHost;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

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
        crate::project_fs::write_file(&root, &path, &content)
            .await
            .map_err(|error| error.to_string())?;
        Ok(Value::Null)
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
