use super::*;

fn load_task_relationship_references(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<db::TaskRelationshipReferenceRow>, String> {
    let database = crate::db::acquire_db(&state.db);
    database
        .get_task_relationship_references_for_project(project_id)
        .map_err(|error| format!("Failed to get task relationship references: {error}"))
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
        "list_task_usage_candidates" => {
            let max_page_size = crate::db::MAX_TASK_USAGE_CANDIDATE_PAGE_SIZE;

            let provider = payload_string(&request.payload, "provider")?;
            let period_start = payload_i64(&request.payload, "periodStart")?;
            if period_start < 0 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "payload.periodStart must be a non-negative integer".to_string(),
                ));
            }
            let task_id = payload_optional_string(&request.payload, "taskId")?;
            let cursor = payload_optional_string(&request.payload, "cursor")?;
            let page_size =
                payload_optional_usize(&request.payload, "pageSize")?.ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "payload.pageSize is required".to_string(),
                    )
                })?;
            if !(1..=max_page_size).contains(&page_size) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("payload.pageSize must be between 1 and {max_page_size}"),
                ));
            }
            let page = {
                let db = crate::db::acquire_db(&state.db);
                db.list_task_usage_candidates(
                    &provider,
                    period_start,
                    task_id.as_deref(),
                    cursor.as_deref(),
                    page_size,
                )
                .map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to list Task usage candidates: {error}"),
                    )
                })?
            };
            json_value(page)
        }
        "get_task_relationship_references" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let references = load_task_relationship_references(state, &project_id)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
            json_value(references)
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
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
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
            })
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create task: {e}"),
                )
            })?;
        if let Some(depends_on) = depends_on {
            if !depends_on.is_empty() {
                if let Err(e) = db.set_task_dependencies(&task.id, &depends_on) {
                    let _ = db.hard_delete_task(&task.id);
                    return Err((
                        StatusCode::BAD_REQUEST,
                        format!("Failed to set task dependencies: {e}"),
                    ));
                }
            }
        }
        if let Some(label_names) = label_names {
            if !label_names.is_empty() {
                if let Err(e) = db.set_task_labels(&task.id, &label_names) {
                    let _ = db.hard_delete_task(&task.id);
                    return Err((
                        StatusCode::BAD_REQUEST,
                        format!("Failed to set task labels: {e}"),
                    ));
                }
            }
        }
        db.get_task(&task.id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to reload task: {e}"),
                )
            })?
            .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task {} not found", task.id)))?
    };

    publish_task_changed(state, &task.id, task.project_id.as_deref());
    json_value(task)
}
