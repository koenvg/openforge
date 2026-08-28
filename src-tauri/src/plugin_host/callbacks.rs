use super::PluginHost;
use serde_json::Value;

impl PluginHost {
    pub(super) async fn handle_host_callback(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<Value, String> {
        match method {
            "openforge.commands.invokeGlobal" => self.invoke_global_command_for_host(params).await,
            "openforge.commands.listCatalog" => self.list_command_catalog_for_host(params).await,
            "openforge.storage.get" => self.get_plugin_storage_for_host(params),
            "openforge.storage.set" => self.set_plugin_storage_for_host(params),
            "openforge.storage.delete" => self.delete_plugin_storage_for_host(params),
            "openforge.tasks.list" => self.list_tasks_for_host(params),
            "openforge.tasks.get" => self.get_task_for_host(params),
            "openforge.tasks.create" => self.create_task_for_host(params),
            "openforge.tasks.compose" => self.compose_task_for_host(params).await,
            "openforge.tasks.updateStatus" => self.update_task_status_for_host(params).await,
            "openforge.tasks.listStartPromptContributions" => {
                self.list_start_prompt_contributions_for_host(params)
            }
            "openforge.tasks.configureStartPromptContribution" => {
                self.configure_start_prompt_contribution_for_host(params)
            }
            "openforge.tasks.startImplementation" => {
                self.start_task_implementation_for_host(params).await
            }
            "openforge.tasks.sendFollowUp" => self.send_task_follow_up_for_host(params).await,
            "openforge.tasks.getWorkspace" => self.get_task_workspace_for_host(params),
            "openforge.tasks.getLatestSession" => self.get_latest_session_for_host(params),
            "openforge.tasks.listSessions" => self.list_task_sessions_for_host(params),
            "openforge.projects.list" => self.list_projects_for_host(),
            "openforge.projects.get" => self.get_project_for_host(params),
            "openforge.fs.readDir" => self.read_project_dir_for_host(params).await,
            "openforge.fs.readFile" => self.read_project_file_for_host(params).await,
            "openforge.fs.searchFiles" => self.search_project_files_for_host(params),
            "openforge.fs.writeFile" => self.write_project_file_for_host(params).await,
            "openforge.fs.userData.readDir" => {
                self.read_plugin_user_data_dir_for_host(params).await
            }
            "openforge.fs.userData.readTextFile" => {
                self.read_plugin_user_data_text_file_for_host(params).await
            }
            "openforge.fs.userData.writeTextFile" => {
                self.write_plugin_user_data_text_file_for_host(params).await
            }
            "openforge.fs.userData.appendTextFile" => {
                self.append_plugin_user_data_text_file_for_host(params)
                    .await
            }
            "openforge.fs.external.readDir" => self.read_external_dir_for_host(params).await,
            "openforge.fs.external.readTextFile" => {
                self.read_external_text_file_for_host(params).await
            }
            "openforge.fs.external.stat" => self.stat_external_file_for_host(params).await,
            "openforge.fs.external.readTextFileChunk" => {
                self.read_external_text_file_chunk_for_host(params).await
            }
            "openforge.shell.spawn" => self.spawn_shell_for_host(params).await,
            "openforge.shell.write" => self.write_shell_for_host(params).await,
            "openforge.shell.resize" => self.resize_shell_for_host(params).await,
            "openforge.shell.kill" => self.kill_shell_for_host(params).await,
            "openforge.shell.getBuffer" => self.get_shell_buffer_for_host(params).await,
            "openforge.notifications.notify" => {
                self.emit_host_app_event("openforge.notification", params)
            }
            "openforge.attention.listProjects" => self.list_project_attention_for_host(),
            "openforge.system.openUrl" => self.emit_host_app_event("openforge.open-url", params),
            "openforge.system.writeClipboardText" => {
                self.emit_host_app_event("openforge.write-clipboard-text", params)
            }
            "openforge.config.get" => self.get_config_for_host(params).await,
            "openforge.config.set" => self.set_config_for_host(params).await,
            "openforge.projectConfig.get" => self.get_project_config_for_host(params),
            "openforge.projectConfig.set" => self.set_project_config_for_host(params),
            _ => Err(format!("unsupported plugin host callback method: {method}")),
        }
    }
}

pub(super) fn required_param_string(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("plugin host callback missing string param: {key}"))
}

pub(super) fn required_param_string_allow_empty(
    params: &Value,
    key: &str,
) -> Result<String, String> {
    match params.get(key) {
        None => Err(format!("plugin host callback missing string param: {key}")),
        Some(Value::String(value)) => Ok(value.clone()),
        Some(_) => Err(format!(
            "plugin host callback param must be a string: {key}"
        )),
    }
}

pub(super) fn optional_param_string(params: &Value, key: &str) -> Result<Option<String>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value.clone())),
        Some(_) => Err(format!(
            "plugin host callback param must be a non-empty string or null: {key}"
        )),
    }
}

pub(super) fn optional_param_usize(params: &Value, key: &str) -> Result<Option<usize>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => {
            let value = number.as_u64().ok_or_else(|| {
                format!("plugin host callback param must be a positive integer: {key}")
            })?;
            usize::try_from(value)
                .map(Some)
                .map_err(|_| format!("plugin host callback integer param out of range: {key}"))
        }
        Some(_) => Err(format!(
            "plugin host callback param must be a positive integer or null: {key}"
        )),
    }
}

pub(super) fn optional_param_u64(params: &Value, key: &str) -> Result<Option<u64>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number.as_u64().map(Some).ok_or_else(|| {
            format!("plugin host callback param must be a non-negative integer: {key}")
        }),
        Some(_) => Err(format!(
            "plugin host callback param must be a non-negative integer or null: {key}"
        )),
    }
}
