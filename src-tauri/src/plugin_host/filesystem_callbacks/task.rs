use super::super::callbacks::{optional_param_string, optional_param_usize, required_param_string};
use super::super::PluginHost;
use serde_json::Value;
use std::path::PathBuf;

impl PluginHost {
    pub(in crate::plugin_host) async fn read_task_dir_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let path = optional_param_string(params, "path")?;
        let workspace_root = self.task_workspace_root_for_host(&task_id)?;
        serde_json::to_value(
            crate::project_fs::read_dir(&workspace_root, path.as_deref())
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize directory entries: {error}"))
    }

    pub(in crate::plugin_host) async fn read_task_file_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let path = required_param_string(params, "path")?;
        let workspace_root = self.task_workspace_root_for_host(&task_id)?;
        let full_path = crate::project_fs::resolve_existing_path(&workspace_root, Some(&path))
            .map_err(|error| error.to_string())?;
        serde_json::to_value(
            crate::project_fs::read_file_preview(&full_path)
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize file content: {error}"))
    }

    pub(in crate::plugin_host) fn search_task_files_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let query = required_param_string(params, "query")?;
        let limit = optional_param_usize(params, "limit")?.unwrap_or(50);
        let workspace_root = self.task_workspace_root_for_host(&task_id)?;
        serde_json::to_value(
            crate::project_fs::search_files_checked(&workspace_root, &query, limit)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("failed to serialize file search results: {error}"))
    }

    fn task_workspace_root_for_host(&self, task_id: &str) -> Result<PathBuf, String> {
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        crate::self_review_runtime::resolve_workspace_path(&db, task_id).map(PathBuf::from)
    }
}
