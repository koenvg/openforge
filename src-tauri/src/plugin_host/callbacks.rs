use super::PluginHost;
use crate::app_events::publish_app_event;
use serde_json::Value;
use std::sync::{Arc, Mutex};

const GITHUB_SYNC_PLUGIN_ID: &str = "com.openforge.github-sync";

fn openforge_global_command_to_app_invoke(qualified_id: &str) -> Result<&'static str, String> {
    let command = qualified_id
        .strip_prefix("openforge.")
        .ok_or_else(|| format!("unsupported plugin host global command id: {qualified_id}"))?;

    match command {
        "forceGithubSync" => Ok("force_github_sync"),
        "getPullRequests" => Ok("get_pull_requests"),
        "refreshTaskGithubStatus" => Ok("refresh_task_github_status"),
        "linkPullRequest" => Ok("link_pull_request"),
        "getPrComments" => Ok("get_pr_comments"),
        "markCommentAddressed" => Ok("mark_comment_addressed"),
        "mergeTaskPullRequest" => Ok("merge_task_pull_request"),
        "enqueueTaskPullRequest" => Ok("enqueue_task_pull_request"),
        "fetchReviewPrs" => Ok("fetch_review_prs"),
        "getReviewPrs" => Ok("get_review_prs"),
        "fetchAuthoredPrs" => Ok("fetch_authored_prs"),
        "getAuthoredPrs" => Ok("get_authored_prs"),
        "markReviewPrViewed" => Ok("mark_review_pr_viewed"),
        "markReviewPrUnviewed" => Ok("mark_review_pr_unviewed"),
        "getPrFileDiffs" => Ok("get_pr_file_diffs"),
        "getFileContent" => Ok("get_file_content"),
        "getFileContentBase64" => Ok("get_file_content_base64"),
        "getFileAtRef" => Ok("get_file_at_ref"),
        "getFileAtRefBase64" => Ok("get_file_at_ref_base64"),
        "getReviewComments" => Ok("get_review_comments"),
        "getPrOverviewComments" => Ok("get_pr_overview_comments"),
        "submitPrReview" => Ok("submit_pr_review"),
        "getAgentReviewComments" => Ok("get_agent_review_comments"),
        "updateAgentReviewCommentStatus" => Ok("update_agent_review_comment_status"),
        "agentGenerate" => Ok("agent_generate"),
        "abortAgentGenerate" => Ok("abort_agent_generate"),
        _ => Err(format!(
            "unsupported plugin host global command id: {qualified_id}"
        )),
    }
}

fn is_files_review_app_command(command: &str) -> bool {
    matches!(
        command,
        "get_agent_review_comments" | "update_agent_review_comment_status"
    )
}

fn is_agent_generate_app_command(command: &str) -> bool {
    matches!(command, "agent_generate" | "abort_agent_generate")
}

/// Whether `plugin_id` may invoke the given resolved app command.
///
/// Only built-in plugins reach app commands, and each owns its own namespace.
/// Everything else — including every externally installed plugin — is denied.
fn plugin_may_invoke_command(plugin_id: &str, command: &str) -> bool {
    let _ = command;
    matches!(plugin_id, GITHUB_SYNC_PLUGIN_ID)
}

fn required_shell_session_key(params: &Value) -> Result<String, String> {
    let task_id = required_param_string(params, "taskId")?;
    let terminal_index = required_param_u16(params, "terminalIndex")?;
    Ok(format!("{task_id}-shell-{terminal_index}"))
}

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
            "openforge.projects.list" => self.list_projects_for_host(),
            "openforge.projects.get" => self.get_project_for_host(params),
            "openforge.fs.readDir" => self.read_project_dir_for_host(params).await,
            "openforge.fs.readFile" => self.read_project_file_for_host(params).await,
            "openforge.fs.searchFiles" => self.search_project_files_for_host(params),
            "openforge.fs.writeFile" => self.write_project_file_for_host(params).await,
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
            "openforge.config.get" => self.get_config_for_host(params).await,
            "openforge.config.set" => self.set_config_for_host(params).await,
            "openforge.projectConfig.get" => self.get_project_config_for_host(params),
            "openforge.projectConfig.set" => self.set_project_config_for_host(params),
            _ => Err(format!("unsupported plugin host callback method: {method}")),
        }
    }

    async fn list_command_catalog_for_host(&self, params: &Value) -> Result<Value, String> {
        let Some(project_id) = optional_param_string(params, "projectId")? else {
            return Ok(Value::Array(Vec::new()));
        };
        let state = self.app_state_for_host_callback()?;
        let request = crate::http_server::AppInvokeRequest {
            command: "list_opencode_commands".to_string(),
            payload: serde_json::json!({ "projectId": project_id }),
        };
        crate::app_invoke::handle_runtime_command(&state, &request)
            .await
            .map_err(|(status, message)| {
                format!("plugin host command catalog callback failed ({status}): {message}")
            })?
            .ok_or_else(|| "plugin host command catalog callback returned no value".to_string())
    }

    async fn invoke_global_command_for_host(&self, params: &Value) -> Result<Value, String> {
        let qualified_id = required_param_string(params, "qualifiedId")?;
        let caller_plugin_id = required_param_string(params, "callerPluginId")?;
        let command = openforge_global_command_to_app_invoke(&qualified_id)?;
        if !plugin_may_invoke_command(&caller_plugin_id, command) {
            return Err(format!(
                "plugin {caller_plugin_id} is not authorized to invoke private host command {qualified_id}"
            ));
        }
        let payload = params.get("payload").cloned().unwrap_or(Value::Null);
        let request = crate::http_server::AppInvokeRequest {
            command: command.to_string(),
            payload,
        };
        let state = self.app_state_for_host_callback()?;
        let result = if is_agent_generate_app_command(command) {
            crate::app_invoke::handle_agent_generate_command(&state, &request).await
        } else if is_files_review_app_command(command) {
            crate::app_invoke::handle_files_review_command(&state, &request).await
        } else {
            crate::app_invoke::handle_github_review_command(&state, &request).await
        };

        result
            .map_err(|(status, message)| {
                format!("plugin host command callback {command} failed ({status}): {message}")
            })?
            .ok_or_else(|| format!("plugin host command callback returned no value: {command}"))
    }

    fn get_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        let raw = db
            .get_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key)
            .map_err(|error| format!("failed to get plugin storage: {error}"))?;
        Ok(raw
            .map(|value| serde_json::from_str(&value).unwrap_or(Value::String(value)))
            .unwrap_or(Value::Null))
    }

    fn set_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        let value = params.get("value").cloned().unwrap_or(Value::Null);
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;
        let serialized = serde_json::to_string(&value)
            .map_err(|error| format!("failed to serialize plugin storage value: {error}"))?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.set_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key, &serialized)
            .map_err(|error| format!("failed to set plugin storage: {error}"))?;
        Ok(Value::Null)
    }

    fn delete_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.delete_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key)
            .map_err(|error| format!("failed to delete plugin storage: {error}"))?;
        Ok(Value::Null)
    }

    fn list_projects_for_host(&self) -> Result<Value, String> {
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_all_projects()
                .map_err(|error| format!("failed to list projects: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize projects: {error}"))
    }

    fn get_project_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project(&project_id)
                .map_err(|error| format!("failed to get project: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project: {error}"))
    }

    fn pty_manager_for_host(&self) -> Result<crate::pty_manager::PtyManager, String> {
        self.app_handle
            .try_state::<crate::pty_manager::PtyManager>()
            .map(|state| state.inner().clone())
            .ok_or_else(|| "PTY manager is not available".to_string())
    }

    async fn spawn_shell_for_host(&self, params: &Value) -> Result<Value, String> {
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

    async fn write_shell_for_host(&self, params: &Value) -> Result<Value, String> {
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

    async fn resize_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        self.pty_manager_for_host()?
            .resize_pty(&task_id, cols, rows)
            .await
            .map_err(|error| format!("failed to resize PTY: {error}"))?;
        Ok(Value::Null)
    }

    async fn kill_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        self.pty_manager_for_host()?
            .kill_pty(&task_id)
            .await
            .map_err(|error| format!("failed to kill PTY: {error}"))?;
        Ok(Value::Null)
    }

    async fn get_shell_buffer_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        serde_json::to_value(self.pty_manager_for_host()?.get_pty_buffer(&task_id).await)
            .map_err(|error| format!("failed to serialize PTY buffer: {error}"))
    }

    fn list_project_attention_for_host(&self) -> Result<Value, String> {
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project_attention_summaries()
                .map_err(|error| format!("failed to get project attention: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project attention: {error}"))
    }

    async fn get_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let value = if crate::secure_store::is_secret(&key) {
            crate::secure_config::get(db_state.inner(), &key)
                .await
                .map_err(|error| format!("failed to get secret config: {error}"))?
        } else {
            let db = crate::db::acquire_db(db_state.inner().as_ref());
            db.get_config(&key)
                .map_err(|error| format!("failed to get config: {error}"))?
        };
        serde_json::to_value(value).map_err(|error| format!("failed to serialize config: {error}"))
    }

    async fn set_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let value = host_config_value(params);
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        if crate::secure_store::is_secret(&key) {
            crate::secure_config::set(db_state.inner(), &key, &value)
                .await
                .map_err(|error| format!("failed to set secret config: {error}"))?;
        } else {
            let db = crate::db::acquire_db(db_state.inner().as_ref());
            db.set_config(&key, &value)
                .map_err(|error| format!("failed to set config: {error}"))?;
        }
        Ok(Value::Null)
    }

    fn get_project_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let key = required_param_string(params, "key")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project_config(&project_id, &key)
                .map_err(|error| format!("failed to get project config: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project config: {error}"))
    }

    fn set_project_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let key = required_param_string(params, "key")?;
        let value = host_config_value(params);
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.set_project_config(&project_id, &key, &value)
            .map_err(|error| format!("failed to set project config: {error}"))?;
        Ok(Value::Null)
    }

    fn emit_host_app_event(&self, event_name: &str, params: &Value) -> Result<Value, String> {
        let payload = params.clone();
        publish_app_event(&self.app_event_tx, event_name, &payload);
        self.app_handle.emit(event_name, payload)?;
        Ok(Value::Null)
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

pub(super) fn optional_param_string(params: &Value, key: &str) -> Result<Option<String>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value.clone())),
        Some(_) => Err(format!(
            "plugin host callback param must be a non-empty string or null: {key}"
        )),
    }
}

fn required_param_u16(params: &Value, key: &str) -> Result<u16, String> {
    let value = params
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("plugin host callback missing integer param: {key}"))?;
    u16::try_from(value)
        .map_err(|_| format!("plugin host callback integer param out of range: {key}"))
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

fn host_config_value(params: &Value) -> String {
    match params.get("value") {
        Some(Value::String(value)) => value.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    }
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

    #[test]
    fn authorization_gate_admits_only_built_in_plugins() {
        // github-sync keeps access to its commands.
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "fetch_review_prs"
        ));
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "get_agent_review_comments"
        ));

        // Every other plugin, external ones included, is denied everything.
        assert!(!plugin_may_invoke_command(
            "com.openforge.issues",
            "fetch_review_prs"
        ));
        assert!(!plugin_may_invoke_command(
            "com.example.evil",
            "fetch_review_prs"
        ));
    }
}
