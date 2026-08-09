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
            {
                let db = crate::db::acquire_db(&state.db);
                db.update_task_status(&id, status.as_str()).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update task status: {e}"),
                    )
                })?;
            }
            publish_task_changed(state, &id);
            serde_json::Value::Null
        }
        "delete_task" => {
            let id = payload_string(&request.payload, "id")?;
            // Held until the background cleanup finishes so a second Complete
            // cannot start a duplicate delete while cleanup is in flight.
            let delete_claim = state
                .task_claims
                .try_claim(&id, TaskOperation::DeleteTask)
                .ok_or_else(|| {
                    (
                        StatusCode::CONFLICT,
                        "Task already has a delete in progress".to_string(),
                    )
                })?;
            let cleanup = prepare_task_runtime_cleanup(state, &id, true).await?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.delete_task(&id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to delete task: {e}"),
                    )
                })?;
            }
            publish_task_changed_payload(
                state,
                serde_json::json!({ "action": "deleted", "task_id": id }),
            );
            // The board is already updated; the slow worktree/branch cleanup
            // (repo lock, git subprocesses, rm -rf) must not delay the response.
            if let Some(cleanup) = cleanup {
                tokio::spawn(async move {
                    let _delete_claim = delete_claim;
                    run_task_runtime_cleanup(&id, cleanup).await;
                });
            }
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
            db.delete_project(&id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete project: {e}"),
                )
            })?;
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
            json_value(project)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
