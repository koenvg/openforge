use super::*;

fn app_task_workspace_path(
    state: &AppState,
    task_id: &str,
) -> Result<String, (StatusCode, String)> {
    let db = crate::db::acquire_db(&state.db);
    crate::self_review_runtime::resolve_workspace_path(&db, task_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

fn app_project_root(state: &AppState, project_id: &str) -> Result<String, (StatusCode, String)> {
    let db = crate::db::acquire_db(&state.db);
    db.get_project(project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {e}"),
            )
        })?
        .map(|project| project.path)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Project not found: {project_id}"),
            )
        })
}

fn app_project_fs_error(error: crate::project_fs::ProjectFsError) -> (StatusCode, String) {
    let status = match error.kind() {
        crate::project_fs::ProjectFsErrorKind::BadRequest => StatusCode::BAD_REQUEST,
        crate::project_fs::ProjectFsErrorKind::Forbidden => StatusCode::FORBIDDEN,
        crate::project_fs::ProjectFsErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.message())
}

pub(super) async fn handle_app_files_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "fs_read_dir" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let dir_path = payload_optional_string(&request.payload, "dirPath")?;
            let project_root = app_project_root(state, &project_id)?;
            json_value(
                crate::project_fs::read_dir(
                    std::path::Path::new(&project_root),
                    dir_path.as_deref(),
                )
                .await
                .map_err(app_project_fs_error)?,
            )?
        }
        "fs_read_file" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let file_path = payload_string(&request.payload, "filePath")?;
            let project_root = app_project_root(state, &project_id)?;
            let full_path = crate::project_fs::resolve_existing_path(
                std::path::Path::new(&project_root),
                Some(&file_path),
            )
            .map_err(app_project_fs_error)?;
            json_value(
                crate::project_fs::read_file_preview(&full_path)
                    .await
                    .map_err(app_project_fs_error)?,
            )?
        }
        "fs_write_file" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let file_path = payload_string(&request.payload, "filePath")?;
            let content = payload_string(&request.payload, "content")?;
            let project_root = app_project_root(state, &project_id)?;
            crate::project_fs::write_file(
                std::path::Path::new(&project_root),
                &file_path,
                &content,
            )
            .await
            .map_err(app_project_fs_error)?;
            serde_json::Value::Null
        }
        "fs_search_files" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let query = payload_string(&request.payload, "query")?;
            let limit = payload_optional_usize(&request.payload, "limit")?.unwrap_or(50);
            let project_root = match app_project_root(state, &project_id) {
                Ok(path) => path,
                Err((StatusCode::NOT_FOUND, _)) => return Ok(Some(serde_json::json!([]))),
                Err(error) => return Err(error),
            };
            if project_root.is_empty() {
                serde_json::json!([])
            } else {
                json_value(crate::project_fs::search_files(
                    std::path::Path::new(&project_root),
                    &query,
                    limit,
                ))?
            }
        }
        "get_agent_review_comments" => {
            let review_pr_id = payload_i64(&request.payload, "reviewPrId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(
                db.get_agent_review_comments_for_pr(review_pr_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get agent review comments: {e}"),
                        )
                    })?,
            )?
        }
        "update_agent_review_comment_status" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            let status = payload_string(&request.payload, "status")?;
            let db = crate::db::acquire_db(&state.db);
            db.update_agent_review_comment_status(comment_id, &status)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update agent review comment status: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "get_task_diff" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let include_committed = payload_bool(&request.payload, "includeCommitted")?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_diff_for_workspace(
                    &worktree_path,
                    include_committed,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_git_status" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_git_status_for_workspace(&worktree_path)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let path = payload_string(&request.payload, "path")?;
            let old_path = payload_optional_string(&request.payload, "oldPath")?;
            let status = payload_string(&request.payload, "status")?;
            let include_committed = payload_bool(&request.payload, "includeCommitted")?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_file_contents_for_workspace(
                    &worktree_path,
                    &path,
                    old_path.as_deref(),
                    &status,
                    include_committed,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_batch_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let files = payload_field::<Vec<crate::self_review_runtime::FileContentRequest>>(
                &request.payload,
                "files",
            )?;
            let include_committed = payload_bool(&request.payload, "includeCommitted")?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_batch_file_contents_for_workspace(
                    &worktree_path,
                    &files,
                    include_committed,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_commits" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_commits_for_workspace(&worktree_path)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_diff" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_diff_for_workspace(
                    &worktree_path,
                    &commit_sha,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let path = payload_string(&request.payload, "path")?;
            let old_path = payload_optional_string(&request.payload, "oldPath")?;
            let status = payload_string(&request.payload, "status")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_file_contents_for_workspace(
                    &worktree_path,
                    &commit_sha,
                    &path,
                    old_path.as_deref(),
                    &status,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_batch_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let files = payload_field::<Vec<crate::self_review_runtime::FileContentRequest>>(
                &request.payload,
                "files",
            )?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_batch_file_contents_for_workspace(
                    &worktree_path,
                    &commit_sha,
                    &files,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
