use super::callbacks::{optional_param_string, optional_param_usize, required_param_string};
use super::PluginHost;
use serde_json::Value;
use std::path::PathBuf;

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
        let content = required_param_string(params, "content")?;
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

    fn pty_manager_for_host(&self) -> Result<crate::pty_manager::PtyManager, String> {
        self.app_handle
            .try_state::<crate::pty_manager::PtyManager>()
            .map(|state| state.inner().clone())
            .ok_or_else(|| "PTY manager is not available".to_string())
    }

    pub(super) async fn spawn_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let cwd = required_param_string(params, "cwd")?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        let terminal_index = Some(u32::from(required_param_u16(params, "terminalIndex")?));
        let terminal_image_protocol =
            match optional_param_string(params, "terminalImageProtocol")?.as_deref() {
                None => None,
                Some("iterm2") => Some(crate::pty_manager::TerminalImageProtocol::Iterm2),
                Some(value) => return Err(format!("unsupported terminal image protocol: {value}")),
            };
        let pty_manager = self.pty_manager_for_host()?;
        serde_json::to_value(
            pty_manager
                .spawn_shell_pty(
                    crate::pty_manager::PtySpawnContext {
                        task_id: &task_id,
                        cwd: std::path::Path::new(&cwd),
                        cols,
                        rows,
                        app_handle: Some(self.app_handle.clone()),
                        app_event_tx: self.app_event_tx.clone(),
                    },
                    terminal_index,
                    terminal_image_protocol,
                )
                .await
                .map_err(|error| format!("failed to spawn shell PTY: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize shell PTY id: {error}"))
    }

    pub(super) async fn write_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        let data = params
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| "plugin host callback missing string param: data".to_string())?;
        self.pty_manager_for_host()?
            .write_pty(&task_id, data.as_bytes())
            .await
            .map_err(|error| format!("failed to write to PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn resize_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        self.pty_manager_for_host()?
            .resize_pty(&task_id, cols, rows)
            .await
            .map_err(|error| format!("failed to resize PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn kill_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        self.pty_manager_for_host()?
            .kill_pty(&task_id)
            .await
            .map_err(|error| format!("failed to kill PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn get_shell_buffer_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        serde_json::to_value(self.pty_manager_for_host()?.get_pty_buffer(&task_id).await)
            .map_err(|error| format!("failed to serialize PTY buffer: {error}"))
    }
}

fn required_shell_session_key(params: &Value) -> Result<String, String> {
    let task_id = required_param_string(params, "taskId")?;
    let terminal_index = required_param_u16(params, "terminalIndex")?;
    Ok(format!("{task_id}-shell-{terminal_index}"))
}

fn required_param_u16(params: &Value, key: &str) -> Result<u16, String> {
    let value = params
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("plugin host callback missing integer param: {key}"))?;
    u16::try_from(value)
        .map_err(|_| format!("plugin host callback integer param out of range: {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shell_session_key_uses_task_id_and_terminal_index() {
        let params = json!({ "taskId": "project-P-1", "terminalIndex": 2 });

        assert_eq!(
            required_shell_session_key(&params).expect("valid shell request"),
            "project-P-1-shell-2"
        );
    }

    #[test]
    fn shell_session_key_rejects_missing_terminal_index() {
        let params = json!({ "taskId": "project-P-1" });

        assert_eq!(
            required_shell_session_key(&params).expect_err("terminalIndex should be required"),
            "plugin host callback missing integer param: terminalIndex"
        );
    }
}
