use super::*;

pub(super) async fn handle_app_core_task_project_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "update_task_status" => {
            let id = payload_string(&request.payload, "id")?;
            let status_text = payload_string(&request.payload, "status")?;
            let status = db::BoardStatus::from_str(&status_text)
                .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            if !status.is_writable() {
                // 'done' is recognized for reading legacy rows but is not an
                // assignable status: writing it would hide the task from every
                // board surface with no reopen path or runtime cleanup.
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!(
                        "Cannot assign non-writable board status: {}",
                        status.as_str()
                    ),
                ));
            }
            let _status_claim = state
                .task_claims
                .try_claim(&id, TaskOperation::UpdateStatus)
                .ok_or_else(|| {
                    (
                        StatusCode::CONFLICT,
                        "Task has another lifecycle operation in progress".to_string(),
                    )
                })?;
            let project_id = {
                let db = crate::db::acquire_db(&state.db);
                let project_id = db
                    .get_task(&id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to read task before status update: {e}"),
                        )
                    })?
                    .and_then(|task| task.project_id);
                db.update_task_status(&id, status.as_str())
                    .map_err(|error| match error {
                        crate::db::TaskStatusUpdateError::ActiveTaskLimit { .. } => {
                            (StatusCode::CONFLICT, error.to_string())
                        }
                        crate::db::TaskStatusUpdateError::Storage(_) => (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to update task status: {error}"),
                        ),
                    })?;
                project_id
            };
            publish_task_changed(state, &id, project_id.as_deref());
            serde_json::Value::Null
        }
        "delete_task" => {
            let id = payload_string(&request.payload, "id")?;
            let service = crate::terminal_task_completion::TerminalTaskCompletionService::new(
                std::sync::Arc::clone(&state.db),
                crate::terminal_task_completion::PtyTerminalTaskRuntime::new(
                    state.pty_manager.clone(),
                ),
                state.task_claims.clone(),
                state.app.clone(),
                state.app_event_bus.clone(),
                state.app_event_tx.clone(),
            );
            service
                .complete(
                    crate::terminal_task_completion::TerminalTaskCompletionRequest::desktop(&id),
                )
                .await
                .map_err(crate::http_server::map_terminal_task_completion_error)?;
            serde_json::Value::Null
        }
        "list_git_branches" => {
            let repo_path = payload_string(&request.payload, "repoPath")?;
            json_value(
                crate::git_worktree::list_git_branches(std::path::Path::new(&repo_path))
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            )?
        }
        "repo_has_commits" => {
            let repo_path = payload_string(&request.payload, "repoPath")?;
            json_value(
                crate::git_worktree::repo_has_commits(std::path::Path::new(&repo_path))
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            )?
        }
        "inspect_existing_branch" => {
            let repo_path = payload_string(&request.payload, "repoPath")?;
            let branch = payload_string(&request.payload, "branch")?;
            json_value(
                crate::git_worktree::inspect_existing_branch(
                    std::path::Path::new(&repo_path),
                    &branch,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            )?
        }
        "delete_project" => {
            let id = payload_string(&request.payload, "id")?;
            let db = crate::db::acquire_db(&state.db);
            let task_ids = db
                .get_tasks_for_project(&id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to load project tasks: {e}"),
                    )
                })?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>();
            let _task_claims = task_ids
                .iter()
                .map(|task_id| {
                    state
                        .task_claims
                        .try_claim(task_id, TaskOperation::HardDelete)
                        .ok_or_else(|| {
                            (
                                StatusCode::CONFLICT,
                                format!(
                                    "Task {task_id} already has a lifecycle operation in progress"
                                ),
                            )
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            db.delete_project(&id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete project: {e}"),
                )
            })?;
            publish_project_changed(state, &id);
            serde_json::Value::Null
        }
        "create_project_from_git" => {
            let url = payload_string(&request.payload, "url")?;
            let parent_dir = payload_string(&request.payload, "parentDir")?;
            let name = payload_string(&request.payload, "name")?;
            let project = crate::git_clone::create_project_from_git(
                &state.db,
                &state.github_client,
                &url,
                &parent_dir,
                &name,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            publish_project_changed(state, &project.id);
            json_value(project)?
        }
        "create_project_from_new_repo" => {
            let name = payload_string(&request.payload, "name")?;
            let parent_dir = payload_string(&request.payload, "parentDir")?;
            let private = payload_bool(&request.payload, "private")?;
            let project = crate::git_clone::create_project_from_new_repo(
                &state.db,
                &state.github_client,
                &name,
                &parent_dir,
                private,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            publish_project_changed(state, &project.id);
            json_value(project)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
