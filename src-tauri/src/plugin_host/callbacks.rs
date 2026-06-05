use super::PluginHost;
use crate::app_events::publish_app_event;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

impl PluginHost {
    pub(super) async fn handle_host_callback(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<Value, String> {
        match method {
            "openforge.storage.get" => self.get_plugin_storage_for_host(params),
            "openforge.storage.set" => self.set_plugin_storage_for_host(params),
            "openforge.storage.delete" => self.delete_plugin_storage_for_host(params),
            "openforge.tasks.list" => self.list_tasks_for_host(params),
            "openforge.tasks.get" => self.get_task_for_host(params),
            "openforge.tasks.create" => self.create_task_for_host(params),
            "openforge.tasks.updateSummary" => self.update_task_summary_for_host(params),
            "openforge.tasks.updateStatus" => self.update_task_status_for_host(params).await,
            "openforge.tasks.startImplementation" => {
                self.start_task_implementation_for_host(params).await
            }
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
            "openforge.config.get" => self.get_config_for_host(params),
            "openforge.config.set" => self.set_config_for_host(params),
            "openforge.projectConfig.get" => self.get_project_config_for_host(params),
            "openforge.projectConfig.set" => self.set_project_config_for_host(params),
            _ => Err(format!("unsupported plugin host callback method: {method}")),
        }
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

    fn database_state_for_host(&self) -> Result<Arc<Mutex<crate::db::Database>>, String> {
        self.app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .map(|state| Arc::clone(state.inner()))
            .ok_or_else(|| "plugin host database state is not available".to_string())
    }

    fn app_state_for_task_callback(&self) -> Result<crate::http_server::AppState, String> {
        let db = self.database_state_for_host()?;
        let pty_manager = self
            .app_handle
            .try_state::<crate::pty_manager::PtyManager>()
            .map(|state| state.inner().clone());
        let github_client = self
            .app_handle
            .try_state::<crate::github_client::GitHubClient>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(crate::github_client::GitHubClient::new);

        Ok(crate::http_server::AppState {
            app: Some(self.app_handle.clone()),
            db,
            backend_token: None,
            pty_manager,
            github_client,
            plugin_host: Some(self.clone()),
            app_event_tx: self.app_event_tx.clone(),
            app_event_bus: None,
            whisper: None,
            sidecar_readiness: crate::http_server::SidecarReadinessState::default(),
            start_implementation_claims: self.start_implementation_claims.clone(),
        })
    }

    fn publish_task_changed_for_host(
        &self,
        action: &str,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<(), String> {
        let mut payload = json!({
            "action": action,
            "task_id": task_id,
        });
        if let Some(project_id) = project_id {
            payload["project_id"] = json!(project_id);
        }

        publish_app_event(&self.app_event_tx, "task-changed", &payload);
        self.app_handle.emit("task-changed", payload)
    }

    async fn invoke_app_task_command_for_host(
        &self,
        command: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let state = self.app_state_for_task_callback()?;
        let request = crate::http_server::AppInvokeRequest {
            command: command.to_string(),
            payload,
        };
        let result = match command {
            "update_task_status" => {
                crate::app_invoke::handle_core_task_project_command(&state, &request).await
            }
            "start_implementation" => {
                crate::app_invoke::handle_start_implementation_command(&state, &request).await
            }
            _ => {
                return Err(format!(
                    "unsupported plugin host app task command: {command}"
                ))
            }
        };

        result
            .map_err(|(status, message)| {
                format!("plugin host task callback {command} failed ({status}): {message}")
            })?
            .ok_or_else(|| format!("plugin host app task command returned no value: {command}"))
    }

    fn list_tasks_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = optional_param_string(params, "projectId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let tasks = if let Some(project_id) = project_id {
            db.get_tasks_for_project(&project_id)
                .map_err(|error| format!("failed to list project tasks: {error}"))?
        } else {
            db.get_all_tasks()
                .map_err(|error| format!("failed to list tasks: {error}"))?
        };
        serde_json::to_value(tasks).map_err(|error| format!("failed to serialize tasks: {error}"))
    }

    fn get_task_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let task = db
            .get_task(&task_id)
            .map_err(|error| format!("failed to get task: {error}"))?
            .ok_or_else(|| format!("task not found: {task_id}"))?;
        serde_json::to_value(task).map_err(|error| format!("failed to serialize task: {error}"))
    }

    fn create_task_for_host(&self, params: &Value) -> Result<Value, String> {
        let initial_prompt = required_param_text(params, "initialPrompt")?;
        let project_id = required_param_string(params, "projectId")?;
        let depends_on = optional_param_string_vec(params, "dependsOn")?;
        let label_names = optional_param_string_vec(params, "labelNames")?;
        let task = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            let created = db
                .create_task(&initial_prompt, "backlog", Some(&project_id), None, None)
                .map_err(|error| format!("failed to create task: {error}"))?;

            if let Some(depends_on) = depends_on {
                if !depends_on.is_empty() {
                    if let Err(error) = db.set_task_dependencies(&created.id, &depends_on) {
                        let _ = db.delete_task(&created.id);
                        return Err(format!("failed to set task dependencies: {error}"));
                    }
                }
            }

            if let Some(label_names) = label_names {
                if !label_names.is_empty() {
                    if let Err(error) = db.set_task_labels(&created.id, &label_names) {
                        let _ = db.delete_task(&created.id);
                        return Err(format!("failed to set task labels: {error}"));
                    }
                }
            }

            db.get_task(&created.id)
                .map_err(|error| format!("failed to reload task: {error}"))?
                .ok_or_else(|| format!("task not found after create: {}", created.id))?
        };

        self.publish_task_changed_for_host("created", &task.id, task.project_id.as_deref())?;
        serde_json::to_value(task).map_err(|error| format!("failed to serialize task: {error}"))
    }

    fn update_task_summary_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let summary = required_param_text(params, "summary")?;
        {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            db.update_task_summary(&task_id, &summary)
                .map_err(|error| format!("failed to update task summary: {error}"))?;
        }
        self.publish_task_changed_for_host("updated", &task_id, None)?;
        Ok(Value::Null)
    }

    async fn update_task_status_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let status = required_param_string(params, "status")?;
        self.invoke_app_task_command_for_host(
            "update_task_status",
            json!({ "id": task_id, "status": status }),
        )
        .await
    }

    async fn start_task_implementation_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let repo_path = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            let task = db
                .get_task(&task_id)
                .map_err(|error| format!("failed to get task: {error}"))?
                .ok_or_else(|| format!("task not found: {task_id}"))?;
            let project_id = task.project_id.ok_or_else(|| {
                format!("cannot start task {task_id}: task is not associated with a project")
            })?;
            let project = db
                .get_project(&project_id)
                .map_err(|error| format!("failed to get project: {error}"))?
                .ok_or_else(|| {
                    format!("cannot start task {task_id}: project {project_id} not found")
                })?;
            project.path
        };

        self.invoke_app_task_command_for_host(
            "start_implementation",
            json!({ "taskId": task_id, "repoPath": repo_path }),
        )
        .await
    }

    fn get_task_workspace_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let workspace = crate::provider_runtime::get_task_workspace(&db, &task_id)
            .map_err(|error| format!("failed to get task workspace: {error}"))?;
        serde_json::to_value(workspace)
            .map_err(|error| format!("failed to serialize task workspace: {error}"))
    }

    fn get_latest_session_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .map_err(|error| format!("failed to get latest session: {error}"))?;
        serde_json::to_value(session)
            .map_err(|error| format!("failed to serialize latest session: {error}"))
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
        let pty_manager = self.pty_manager_for_host()?;
        serde_json::to_value(
            pty_manager
                .spawn_shell_pty(
                    &task_id,
                    std::path::Path::new(&cwd),
                    cols,
                    rows,
                    terminal_index,
                    Some(self.app_handle.clone()),
                    self.app_event_tx.clone(),
                )
                .await
                .map_err(|error| format!("failed to spawn shell PTY: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize shell PTY id: {error}"))
    }

    async fn write_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
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
        let task_id = required_param_string(params, "taskId")?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        self.pty_manager_for_host()?
            .resize_pty(&task_id, cols, rows)
            .await
            .map_err(|error| format!("failed to resize PTY: {error}"))?;
        Ok(Value::Null)
    }

    async fn kill_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        self.pty_manager_for_host()?
            .kill_pty(&task_id)
            .await
            .map_err(|error| format!("failed to kill PTY: {error}"))?;
        Ok(Value::Null)
    }

    async fn get_shell_buffer_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
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

    fn get_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        let value = if crate::secure_store::is_secret(&key) {
            crate::secure_store::get_secret(&key)
                .map_err(|error| format!("failed to get secret config: {error}"))?
                .or_else(|| db.get_config(&key).ok().flatten())
        } else {
            db.get_config(&key)
                .map_err(|error| format!("failed to get config: {error}"))?
        };
        serde_json::to_value(value).map_err(|error| format!("failed to serialize config: {error}"))
    }

    fn set_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let value = host_config_value(params);
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        if crate::secure_store::is_secret(&key) {
            crate::secure_store::set_secret(&key, &value)
                .map_err(|error| format!("failed to set secret config: {error}"))?;
            db.set_config(&key, "")
                .map_err(|error| format!("failed to clear persisted secret config: {error}"))?;
        } else {
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

fn required_param_text(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
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

fn optional_param_string_vec(params: &Value, key: &str) -> Result<Option<Vec<String>>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(values)) => values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                    format!(
                        "plugin host callback param must be an array of strings: {key}[{index}]"
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(format!(
            "plugin host callback param must be an array of strings or null: {key}"
        )),
    }
}

pub(super) fn required_param_u16(params: &Value, key: &str) -> Result<u16, String> {
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
