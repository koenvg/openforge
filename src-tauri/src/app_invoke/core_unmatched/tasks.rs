use super::*;

fn task_read_error(error: db::TaskReadError) -> (StatusCode, String) {
    match error {
        db::TaskReadError::ProjectNotFound(_) => (StatusCode::NOT_FOUND, error.to_string()),
        db::TaskReadError::SearchTooLong { .. }
        | db::TaskReadError::TooManyLabels { .. }
        | db::TaskReadError::LabelNameTooLong { .. }
        | db::TaskReadError::InvalidCursor => (StatusCode::BAD_REQUEST, error.to_string()),
        db::TaskReadError::Database(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read Tasks: {error}"),
        ),
    }
}

pub(super) fn handle(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "get_task_config" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = {
                let db = crate::db::acquire_db(&state.db);
                db.get_task_config(&task_id, &key).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get task config: {e}"),
                    )
                })?
            };
            json_value(value)
        }
        "set_task_config" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            let db = crate::db::acquire_db(&state.db);
            db.set_task_config(&task_id, &key, &value).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to set task config: {e}"),
                )
            })?;
            Ok(serde_json::Value::Null)
        }
        "create_task" => create_task(state, request),
        "update_task" => {
            let id = payload_string(&request.payload, "id")?;
            let initial_prompt = payload_string(&request.payload, "initialPrompt")?;
            let _claim = state
                .task_claims
                .try_claim(&id, TaskOperation::UpdateInitialPrompt)
                .ok_or_else(|| {
                    (
                        StatusCode::CONFLICT,
                        format!("task {id} is starting; create a replacement task instead"),
                    )
                })?;
            let project_id = {
                let db = crate::db::acquire_db(&state.db);
                db.update_task_initial_prompt(&id, &initial_prompt)
                    .map_err(|error| match error {
                        db::TaskInitialPromptUpdateError::NotFound(_) => {
                            (StatusCode::NOT_FOUND, error.to_string())
                        }
                        db::TaskInitialPromptUpdateError::AlreadyStarted(_) => {
                            (StatusCode::CONFLICT, error.to_string())
                        }
                        db::TaskInitialPromptUpdateError::Database(_) => (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to update task initial prompt: {error}"),
                        ),
                    })?;
                db.get_task(&id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to reload task after initial prompt update: {error}"),
                        )
                    })?
                    .and_then(|task| task.project_id)
            };
            publish_task_changed(state, &id, project_id.as_deref());
            Ok(serde_json::Value::Null)
        }
        "update_task_title" => {
            let id = payload_string(&request.payload, "id")?;
            let title = payload_string(&request.payload, "title")?;
            let project_id = {
                let db = crate::db::acquire_db(&state.db);
                db.update_task_title(&id, &title).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update task title: {e}"),
                    )
                })?;
                db.get_task(&id)
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to reload task after title update: {error}"),
                        )
                    })?
                    .and_then(|task| task.project_id)
            };
            publish_task_changed(state, &id, project_id.as_deref());
            Ok(serde_json::Value::Null)
        }
        "update_task_source_ticket_url" => {
            let id = payload_string(&request.payload, "id")?;
            let source_ticket_url = payload_optional_string(&request.payload, "sourceTicketUrl")?;
            let db = crate::db::acquire_db(&state.db);
            db.update_task_source_ticket_url(&id, source_ticket_url.as_deref())
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update task source ticket url: {e}"),
                    )
                })?;
            Ok(serde_json::Value::Null)
        }
        "tasks_active" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let result = {
                let db = crate::db::acquire_db(&state.db);
                db.tasks().active(&project_id).map_err(task_read_error)?
            };
            json_value(result)
        }
        "tasks_completed" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let query = request
                .payload
                .get("query")
                .cloned()
                .map(serde_json::from_value::<db::CompletedTaskQuery>)
                .transpose()
                .map_err(|error| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Invalid Completed Task query: {error}"),
                    )
                })?
                .unwrap_or_default();
            let result = {
                let db = crate::db::acquire_db(&state.db);
                db.tasks()
                    .completed(&project_id, query)
                    .map_err(task_read_error)?
            };
            json_value(result)
        }
        "tasks_detail" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let task_id = payload_string(&request.payload, "taskId")?;
            let result = {
                let db = crate::db::acquire_db(&state.db);
                db.tasks()
                    .detail(&project_id, &task_id)
                    .map_err(task_read_error)?
            };
            json_value(result)
        }
        "get_tasks" => {
            let tasks = {
                let db = crate::db::acquire_db(&state.db);
                db.get_all_tasks().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get tasks: {e}"),
                    )
                })?
            };
            json_value(tasks)
        }
        "get_project_attention" => {
            let attention = {
                let db = crate::db::acquire_db(&state.db);
                db.get_project_attention_summaries().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get project attention: {e}"),
                    )
                })?
            };
            json_value(attention)
        }
        "get_task_attention" => {
            let attention = {
                let db = crate::db::acquire_db(&state.db);
                db.get_task_attention_rows().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get task attention: {e}"),
                    )
                })?
            };
            json_value(attention)
        }
        "get_task_lanes" => {
            let lanes = {
                let db = crate::db::acquire_db(&state.db);
                db.get_task_lane_rows().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get task lanes: {e}"),
                    )
                })?
            };
            json_value(lanes)
        }
        "get_task_detail" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let task = {
                let db = crate::db::acquire_db(&state.db);
                db.get_task(&task_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get task: {e}"),
                        )
                    })?
                    .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task {task_id} not found")))?
            };
            json_value(task)
        }
        "get_tasks_for_project" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            // Default excludes done so the app board's active-only view is
            // unchanged; plugins opt in with includeDone to see done tasks too.
            let include_done =
                payload_optional_bool(&request.payload, "includeDone")?.unwrap_or(false);
            let tasks = {
                let db = crate::db::acquire_db(&state.db);
                if include_done {
                    db.get_tasks_for_project(&project_id)
                } else {
                    db.get_tasks_for_project_excluding_state(&project_id, "done")
                }
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get tasks for project: {e}"),
                    )
                })?
            };
            json_value(tasks)
        }
        "get_task_workspace" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let workspace = {
                let db = crate::db::acquire_db(&state.db);
                crate::provider_runtime::get_task_workspace(&db, &task_id)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
            };
            json_value(workspace)
        }
        _ => unreachable!("task handler only receives task commands"),
    }
}

fn create_task(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    let initial_prompt = payload_string(&request.payload, "initialPrompt")?;
    let status = payload_string(&request.payload, "status")?;
    let project_id = payload_optional_string(&request.payload, "projectId")?;
    let permission_mode = payload_optional_string(&request.payload, "permissionMode")?;
    let depends_on = payload_optional_string_vec(&request.payload, "dependsOn")?;
    let label_names = payload_optional_string_vec(&request.payload, "labelNames")?;
    let worktree_source = payload_optional_string(&request.payload, "worktreeSource")?;
    let worktree_branch = payload_optional_string(&request.payload, "worktreeBranch")?;
    let title = payload_optional_string(&request.payload, "title")?;
    let source_ticket_url = payload_optional_string(&request.payload, "sourceTicketUrl")?;
    // A missing Task-level hierarchy override means the runtime inherits the project/global value.
    let task_display_title_updates_enabled = request
        .payload
        .get("taskDisplayTitleUpdatesEnabled")
        .and_then(|value| value.as_bool());
    let ai_provider = payload_optional_string(&request.payload, "aiProvider")?;

    let task = {
        let db = crate::db::acquire_db(&state.db);
        let dependencies = depends_on.unwrap_or_default();
        let labels = label_names.unwrap_or_default();
        db.create_task_with_metadata(
            crate::db::NewTaskOptions {
                initial_prompt: &initial_prompt,
                status: &status,
                project_id: project_id.as_deref(),
                prompt: None,
                permission_mode: permission_mode.as_deref(),
                worktree_source: worktree_source.as_deref(),
                worktree_branch: worktree_branch.as_deref(),
                title: title.as_deref(),
                source_ticket_url: source_ticket_url.as_deref(),
                task_display_title_updates_enabled,
                ai_provider: ai_provider.as_deref(),
            },
            &dependencies,
            &labels,
        )
        .map_err(|error| match error {
            crate::db::TaskCreationError::ActiveTaskLimit { .. } => {
                (StatusCode::CONFLICT, error.to_string())
            }
            crate::db::TaskCreationError::Storage(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create task: {error}"),
            ),
            crate::db::TaskCreationError::Dependencies(_)
            | crate::db::TaskCreationError::Labels(_) => {
                (StatusCode::BAD_REQUEST, error.to_string())
            }
        })?
    };

    publish_task_changed(state, &task.id, task.project_id.as_deref());
    json_value(db::TaskDetail::from(&task))
}
