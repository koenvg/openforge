use super::{events::emit_task_changed, models::*};
use crate::{
    db,
    http_server::{AppState, TaskOperation},
};
use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
};

/// Resolve project_id from request parameters, failing if no project can be determined.
///
/// Priority: explicit project_id > worktree deduction.
/// If neither succeeds, returns an error message listing available projects
/// so the calling agent can retry with the correct project_id.
pub(in crate::http_server) fn resolve_project_id(
    db: &db::Database,
    explicit_project_id: Option<&str>,
    worktree: Option<&str>,
) -> Result<String, String> {
    if let Some(id) = explicit_project_id {
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }

    if let Some(wt) = worktree {
        if let Ok(Some(id)) = db.get_project_for_worktree(wt) {
            return Ok(id);
        }
    }

    let projects = db.get_all_projects().unwrap_or_default();
    let project_list = if projects.is_empty() {
        "  (none — create a project in Open Forge first)".to_string()
    } else {
        projects
            .iter()
            .map(|p| format!("  - {}: {} ({})", p.id, p.name, p.path))
            .collect::<Vec<_>>()
            .join("\n")
    };

    Err(format!(
        "Could not determine project for this task. project_id was not provided and could not be deduced from the worktree path.\n\nAvailable projects:\n{}\n\nPlease call create_task again with the correct project_id parameter.",
        project_list
    ))
}

/// Handle create_task requests from OpenCode sessions
///
/// Creates a new task in the database with "backlog" status and
/// emits a "task-changed" event to notify the frontend.
///
/// If project_id is not provided but worktree is, attempts to deduce
/// the project from the calling session's worktree.
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();

    let project_id = resolve_project_id(
        &db,
        request.project_id.as_deref(),
        request.worktree.as_deref(),
    )
    .map_err(|msg| (StatusCode::UNPROCESSABLE_ENTITY, msg))?;

    let task = db
        .create_task(
            &request.initial_prompt,
            "backlog",
            Some(&project_id),
            None,
            None,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create task: {}", e),
            )
        })?;

    if !request.depends_on.is_empty() {
        if let Err(e) = db.set_task_dependencies(&task.id, &request.depends_on) {
            let _ = db.hard_delete_task(&task.id);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to set task dependencies: {e}"),
            ));
        }
    }

    if !request.labels.is_empty() {
        if let Err(e) = db.set_task_labels(&task.id, &request.labels) {
            let _ = db.hard_delete_task(&task.id);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to set task labels: {e}"),
            ));
        }
    }

    drop(db);

    emit_task_changed(&state, "created", &task.id, task.project_id.as_deref());

    Ok(Json(CreateTaskResponse {
        task_id: task.id,
        project_id: task.project_id,
        status: "created".to_string(),
    }))
}

pub async fn start_task_handler(
    State(state): State<AppState>,
    Json(request): Json<StartTaskRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let response = crate::app_invoke::start_task(&state, &request.task_id).await?;

    Ok(Json(response))
}

pub async fn update_task_handler(
    State(state): State<AppState>,
    Json(request): Json<UpdateTaskRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let _claim = state
        .task_claims
        .try_claim(&request.task_id, TaskOperation::UpdateInitialPrompt)
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                format!(
                    "task {} is starting; create a replacement task instead",
                    request.task_id
                ),
            )
        })?;
    let db = state.db.lock().unwrap();
    db.update_task_initial_prompt(&request.task_id, &request.initial_prompt)
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
    drop(db);
    let project_id = state
        .db
        .lock()
        .unwrap()
        .get_task(&request.task_id)
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to reload task after update: {error}"),
            )
        })?
        .and_then(|task| task.project_id);
    emit_task_changed(&state, "updated", &request.task_id, project_id.as_deref());

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn delete_task_handler(
    State(state): State<AppState>,
    Json(request): Json<DeleteTaskRequest>,
) -> Result<Json<DeleteTaskResponse>, (StatusCode, String)> {
    let task_id = request.task_id;
    let service = crate::terminal_task_completion::TerminalTaskCompletionService::new(
        std::sync::Arc::clone(&state.db),
        crate::terminal_task_completion::PtyTerminalTaskRuntime::new(state.pty_manager.clone()),
        state.task_claims.clone(),
        state.app.clone(),
        state.app_event_bus.clone(),
        state.app_event_tx.clone(),
    );
    service
        .complete(crate::terminal_task_completion::TerminalTaskCompletionRequest::delete(&task_id))
        .await
        .map_err(crate::http_server::map_terminal_task_completion_error)?;

    Ok(Json(DeleteTaskResponse {
        task_id,
        status: "deleted".to_string(),
    }))
}

pub async fn hard_delete_task_handler(
    State(state): State<AppState>,
    Json(request): Json<DeleteTaskRequest>,
) -> Result<Json<DeleteTaskResponse>, (StatusCode, String)> {
    let _hard_delete_claim = state
        .task_claims
        .try_claim(&request.task_id, TaskOperation::HardDelete)
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                "Task has another lifecycle operation in progress".to_string(),
            )
        })?;
    let db = state.db.lock().unwrap();
    let task = db
        .get_task(&request.task_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get task before hard deletion: {e}"),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Task not found: {}", request.task_id),
            )
        })?;

    let project_id = task.project_id;

    db.hard_delete_task(&request.task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to hard-delete task: {e}"),
        )
    })?;
    drop(db);

    emit_task_changed(&state, "deleted", &request.task_id, project_id.as_deref());

    Ok(Json(DeleteTaskResponse {
        task_id: request.task_id,
        status: "deleted".to_string(),
    }))
}
pub async fn set_task_dependencies_handler(
    State(state): State<AppState>,
    Json(request): Json<SetTaskDependenciesRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    db.set_task_dependencies(&request.task_id, &request.depends_on)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to set task dependencies: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn add_task_dependency_handler(
    State(state): State<AppState>,
    Json(request): Json<AddTaskDependencyRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    db.add_task_dependency(&request.task_id, &request.depends_on)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to add task dependency: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn link_task_chain_handler(
    State(state): State<AppState>,
    Json(request): Json<LinkTaskChainRequest>,
) -> Result<Json<LinkTaskChainResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let links = db.link_task_chain(&request.chain).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to link task chain: {e}"),
        )
    })?;
    drop(db);

    for (task_id, _) in &links {
        emit_task_changed(&state, "updated", task_id, None);
    }

    Ok(Json(LinkTaskChainResponse {
        status: "updated".to_string(),
        links: links
            .into_iter()
            .map(|(task_id, depends_on)| TaskDependencyLink {
                task_id,
                depends_on,
            })
            .collect(),
    }))
}

pub async fn get_task_info_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<GetTaskInfoResponse>, StatusCode> {
    let db = state.db.lock().unwrap();

    match db
        .get_task(&id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        Some(task) => Ok(Json(GetTaskInfoResponse {
            id: task.id,
            initial_prompt: task.initial_prompt,
            prompt: task.prompt,
            status: task.status,
            depends_on: task.depends_on,
            labels: task.labels,
        })),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn list_task_labels_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskLabelsResponse>, StatusCode> {
    let db = state.db.lock().unwrap();

    match db
        .get_task(&id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        Some(task) => Ok(Json(TaskLabelsResponse {
            task_id: task.id,
            labels: task.labels,
        })),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn add_task_label_handler(
    State(state): State<AppState>,
    Json(request): Json<AddTaskLabelRequest>,
) -> Result<Json<AddTaskLabelResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let label = db
        .add_task_label(&request.task_id, &request.label)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to add task label: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(AddTaskLabelResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
        label,
    }))
}

pub async fn remove_task_label_handler(
    State(state): State<AppState>,
    Json(request): Json<RemoveTaskLabelRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    db.remove_task_label(&request.task_id, request.label_id)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to remove task label: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn get_projects_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::ProjectRow>>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let projects = db.get_all_projects().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get projects: {e}"),
        )
    })?;

    Ok(Json(projects))
}

pub async fn get_project_task_labels_handler(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<db::TaskLabelRow>>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let labels = db.get_project_task_labels(&project_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get project labels: {e}"),
        )
    })?;

    Ok(Json(labels))
}

pub async fn get_tasks_handler(
    State(state): State<AppState>,
    Query(query): Query<TasksQuery>,
) -> Result<Json<Vec<TaskListRow>>, (StatusCode, String)> {
    if let Some(task_state) = query.state.as_deref() {
        if !matches!(task_state, "backlog" | "doing" | "done") {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid state '{task_state}'. Expected one of: backlog, doing, done"),
            ));
        }
    }

    let compact = query.compact.unwrap_or(false);
    let exclude_done = query.exclude_done.unwrap_or(false) || !query.include_done.unwrap_or(true);
    let db = state.db.lock().unwrap();

    if compact {
        let tasks = match query.state.as_deref() {
            Some(task_state) => db
                .get_compact_tasks_for_project_by_state(&query.project_id, task_state)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get compact tasks by state: {e}"),
                    )
                })?,
            None if exclude_done => db
                .get_compact_tasks_for_project_excluding_state(&query.project_id, "done")
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get compact tasks excluding done: {e}"),
                    )
                })?,
            None => db
                .get_compact_tasks_for_project(&query.project_id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get compact tasks: {e}"),
                    )
                })?,
        };
        return Ok(Json(tasks.into_iter().map(TaskListRow::Compact).collect()));
    }

    let tasks = match query.state.as_deref() {
        Some(task_state) => db
            .get_tasks_for_project_by_state(&query.project_id, task_state)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get tasks by state: {e}"),
                )
            })?,
        None if exclude_done => db
            .get_tasks_for_project_excluding_state(&query.project_id, "done")
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get tasks excluding done: {e}"),
                )
            })?,
        None => db.get_tasks_for_project(&query.project_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get tasks: {e}"),
            )
        })?,
    };

    Ok(Json(tasks.into_iter().map(TaskListRow::Full).collect()))
}

pub async fn get_project_attention_handler(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<db::ProjectAttentionRow>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();

    let project = db
        .get_project(&project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project: {e}"),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Project not found: {project_id}"),
            )
        })?;

    let attention = db
        .get_project_attention_for_project(&project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project attention: {e}"),
            )
        })?
        .unwrap_or(db::ProjectAttentionRow {
            project_id: project.id,
            needs_input: 0,
            running_agents: 0,
            ci_failures: 0,
            unaddressed_comments: 0,
            completed_agents: 0,
        });

    Ok(Json(attention))
}
