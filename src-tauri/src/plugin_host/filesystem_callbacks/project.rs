use super::super::callbacks::{
    optional_param_string, optional_param_usize, required_param_string,
    required_param_string_allow_empty,
};
use super::super::PluginHost;
use serde_json::Value;
use std::path::PathBuf;

impl PluginHost {
    pub(in crate::plugin_host) async fn read_project_dir_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
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

    pub(in crate::plugin_host) async fn read_project_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
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

    pub(in crate::plugin_host) fn search_project_files_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
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

    pub(in crate::plugin_host) async fn write_project_file_for_host(
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
