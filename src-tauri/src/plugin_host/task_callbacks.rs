use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use crate::app_events::publish_app_event;
use serde_json::{json, Value};

impl PluginHost {
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
        let state = self.app_state_for_host_callback()?;
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
            "send_agent_follow_up" => crate::app_invoke::handle_pty_command(&state, &request).await,
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

    pub(super) fn list_tasks_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = optional_param_string(params, "projectId")?;
        let include_done = optional_param_bool(params, "includeDone")?.unwrap_or(false);
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let tasks = if let Some(project_id) = project_id {
            if include_done {
                db.get_tasks_for_project(&project_id)
                    .map_err(|error| format!("failed to list project tasks: {error}"))?
            } else {
                db.get_tasks_for_project_excluding_state(&project_id, "done")
                    .map_err(|error| format!("failed to list project tasks: {error}"))?
            }
        } else {
            db.get_all_tasks()
                .map_err(|error| format!("failed to list tasks: {error}"))?
        };
        serde_json::to_value(tasks).map_err(|error| format!("failed to serialize tasks: {error}"))
    }

    pub(super) fn get_task_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let task = db
            .get_task(&task_id)
            .map_err(|error| format!("failed to get task: {error}"))?;
        match task {
            // A missing row is a closed/deleted Task, not a failure: return null so
            // the plugin API resolves to `null` rather than rejecting. A genuine DB
            // failure above still surfaces as an Err the caller can distinguish.
            None => Ok(Value::Null),
            Some(task) => serde_json::to_value(task)
                .map_err(|error| format!("failed to serialize task: {error}")),
        }
    }

    pub(super) fn create_task_for_host(&self, params: &Value) -> Result<Value, String> {
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
                        let _ = db.hard_delete_task(&created.id);
                        return Err(format!("failed to set task dependencies: {error}"));
                    }
                }
            }

            if let Some(label_names) = label_names {
                if !label_names.is_empty() {
                    if let Err(error) = db.set_task_labels(&created.id, &label_names) {
                        let _ = db.hard_delete_task(&created.id);
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

    pub(super) async fn compose_task_for_host(&self, params: &Value) -> Result<Value, String> {
        self.frontend_host_requests
            .compose_task(params.clone())
            .await
            .map_err(|error| format!("plugin host task compose callback failed: {error}"))
    }

    pub(super) async fn update_task_status_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let status = required_param_string(params, "status")?;
        self.invoke_app_task_command_for_host(
            "update_task_status",
            json!({ "id": task_id, "status": status }),
        )
        .await
    }

    pub(super) fn list_start_prompt_contributions_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let contributions = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            db.get_project_config(
                &project_id,
                crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            )
            .map_err(|error| format!("failed to get start prompt contributions: {error}"))?
            .and_then(|value| {
                serde_json::from_str::<Vec<crate::agent_lifecycle::StartPromptContribution>>(&value)
                    .ok()
            })
            .unwrap_or_default()
        };
        serde_json::to_value(contributions)
            .map_err(|error| format!("failed to serialize start prompt contributions: {error}"))
    }

    pub(super) fn configure_start_prompt_contribution_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let owner_plugin_id = required_param_string(params, "pluginId")?;
        let project_id = required_param_string(params, "projectId")?;
        let id = required_param_string(params, "id")?;
        let content = required_param_text(params, "content")?;
        let enabled = params
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let order =
            crate::task_start_prompt::parse_start_prompt_contribution_order(params.get("order"))?;
        let contribution = crate::agent_lifecycle::StartPromptContribution {
            owner_plugin_id: Some(owner_plugin_id),
            id: id.trim().to_string(),
            enabled,
            content,
            order,
        };

        let contributions = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            crate::task_start_prompt::upsert_start_prompt_contribution(
                &db,
                &project_id,
                contribution,
            )?
        };
        serde_json::to_value(contributions)
            .map_err(|error| format!("failed to serialize start prompt contributions: {error}"))
    }

    pub(super) async fn start_task_implementation_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        self.invoke_app_task_command_for_host(
            "start_implementation",
            json!({ "taskId": task_id, "repoPath": "" }),
        )
        .await
    }

    pub(super) async fn send_task_follow_up_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let message = required_param_text(params, "message")?;
        self.invoke_app_task_command_for_host(
            "send_agent_follow_up",
            json!({ "taskId": task_id, "message": message }),
        )
        .await
    }

    pub(super) fn get_task_workspace_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let workspace = crate::provider_runtime::get_task_workspace(&db, &task_id)
            .map_err(|error| format!("failed to get task workspace: {error}"))?;
        serde_json::to_value(workspace)
            .map_err(|error| format!("failed to serialize task workspace: {error}"))
    }

    pub(super) fn get_latest_session_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .map_err(|error| format!("failed to get latest session: {error}"))?;
        serde_json::to_value(session)
            .map_err(|error| format!("failed to serialize latest session: {error}"))
    }
}

fn required_param_text(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("plugin host callback missing string param: {key}"))
}

fn optional_param_bool(params: &Value, key: &str) -> Result<Option<bool>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(format!(
            "plugin host callback param must be a boolean or null: {key}"
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
