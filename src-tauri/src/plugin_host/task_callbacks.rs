use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use crate::app_events::publish_app_event;
use serde_json::{json, Value};

const MAX_START_PROMPT_CONTRIBUTION_LENGTH: usize = 16_000;

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

    pub(super) fn get_task_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let task = db
            .get_task(&task_id)
            .map_err(|error| format!("failed to get task: {error}"))?
            .ok_or_else(|| format!("task not found: {task_id}"))?;
        serde_json::to_value(task).map_err(|error| format!("failed to serialize task: {error}"))
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

    pub(super) fn update_task_summary_for_host(&self, params: &Value) -> Result<Value, String> {
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
        let project_id = required_param_string(params, "projectId")?;
        let id = required_param_string(params, "id")?;
        if id.trim().is_empty() {
            return Err("plugin host callback missing non-empty string param: id".to_string());
        }
        let content = required_param_text(params, "content")?;
        if content.chars().count() > MAX_START_PROMPT_CONTRIBUTION_LENGTH {
            return Err(format!(
                "start prompt contribution content exceeds {MAX_START_PROMPT_CONTRIBUTION_LENGTH} characters"
            ));
        }
        let enabled = params
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let order = params.get("order").and_then(Value::as_i64).unwrap_or(0);
        let contribution = crate::agent_lifecycle::StartPromptContribution {
            id: id.trim().to_string(),
            enabled,
            content,
            order,
        };

        let contributions = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            let mut contributions = db
                .get_project_config(
                    &project_id,
                    crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
                )
                .map_err(|error| format!("failed to get start prompt contributions: {error}"))?
                .and_then(|value| {
                    serde_json::from_str::<Vec<crate::agent_lifecycle::StartPromptContribution>>(
                        &value,
                    )
                    .ok()
                })
                .unwrap_or_default();
            contributions.retain(|existing| existing.id != contribution.id);
            contributions.push(contribution);
            contributions.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
            let serialized = serde_json::to_string(&contributions).map_err(|error| {
                format!("failed to serialize start prompt contributions: {error}")
            })?;
            db.set_project_config(
                &project_id,
                crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
                &serialized,
            )
            .map_err(|error| format!("failed to set start prompt contributions: {error}"))?;
            contributions
        };
        serde_json::to_value(contributions)
            .map_err(|error| format!("failed to serialize start prompt contributions: {error}"))
    }

    pub(super) async fn start_task_implementation_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
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
