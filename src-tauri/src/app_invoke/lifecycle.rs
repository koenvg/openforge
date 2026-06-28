use super::*;
use log::error;
use std::path::{Path, PathBuf};

pub(super) async fn cleanup_task_runtime_for_app(
    state: &AppState,
    task_id: &str,
    remove_branch: bool,
) -> Result<(), (StatusCode, String)> {
    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(task_id).await;
        pty_manager.kill_shells_for_task(task_id).await;
    }
    let (worktree, delete_worktree_branch) = {
        let db = crate::db::acquire_db(&state.db);
        let worktree = db.get_worktree_for_task(task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get worktree: {e}"),
            )
        })?;
        let task_uses_existing_branch = db
            .get_task(task_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get task: {e}"),
                )
            })?
            .and_then(|task| task.worktree_source)
            .as_deref()
            == Some("existingBranch");
        (worktree, remove_branch && !task_uses_existing_branch)
    };

    if let Some(worktree) = worktree {
        let repo_path = std::path::Path::new(&worktree.repo_path);
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        let remove_result = if delete_worktree_branch {
            crate::git_worktree::remove_worktree_with_branch(
                repo_path,
                worktree_path,
                Some(&worktree.branch_name),
            )
            .await
        } else {
            crate::git_worktree::remove_worktree(repo_path, worktree_path).await
        };
        if let Err(e) = remove_result {
            error!(
                "[app_invoke] Failed to remove worktree at {}: {}",
                worktree_path.display(),
                e
            );
        }

        // The worktree directory is gone, so its DB record is now stale and must
        // be dropped regardless of whether the branch was deleted or preserved.
        // On the delete-task path `delete_task` deletes it again inside its own
        // transaction, which is a harmless no-op.
        let db = crate::db::acquire_db(&state.db);
        if let Err(e) = db.delete_worktree_record(task_id) {
            error!(
                "[app_invoke] Failed to delete worktree record for {}: {}",
                task_id, e
            );
        }
    }

    Ok(())
}

pub(super) async fn handle_app_resume_startup_sessions_command(
    _state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "resume_startup_sessions" {
        return Ok(None);
    }

    // Startup resume orchestration is owned by `crate::startup_resume` and is
    // launched once by the sidecar startup task. This command remains as a
    // compatibility no-op for older renderer flows so provider PTY resume,
    // persistence, events, and failure handling cannot diverge.
    Ok(Some(serde_json::Value::Null))
}

struct StartImplementationContext {
    task: crate::db::TaskRow,
    project_id: String,
    additional_instructions: Option<String>,
    handoff_notes_template: Option<String>,
    code_cleanup_enabled: bool,
    provider_name: String,
}

struct PreparedWorkspace {
    working_dir: PathBuf,
    kind: &'static str,
    branch_name: Option<String>,
}

struct ProviderRunOptions<'a> {
    agent: Option<&'a str>,
    permission_mode: Option<&'a str>,
    model: Option<&'a crate::opencode_client::PromptModel>,
}

fn provider_run_options_for_task(task: &crate::db::TaskRow) -> ProviderRunOptions<'_> {
    ProviderRunOptions {
        agent: task.agent.as_deref(),
        permission_mode: task.permission_mode.as_deref(),
        model: None,
    }
}

fn load_start_implementation_context(
    state: &AppState,
    task_id: &str,
) -> AppResult<StartImplementationContext> {
    let db = crate::db::acquire_db(&state.db);
    let task = db
        .get_task(task_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get task: {e}"),
            )
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Task not found".to_string()))?;

    if let Some(active_session) = db.get_latest_session_for_ticket(task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get latest session: {e}"),
        )
    })? {
        if matches!(active_session.status.as_str(), "running" | "paused") {
            return Err((
                StatusCode::CONFLICT,
                "Task already has an active agent session".to_string(),
            ));
        }
    }

    for dependency_id in &task.depends_on {
        let dependency = db.get_task(dependency_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get dependency task: {e}"),
            )
        })?;
        if !matches!(
            dependency.as_ref().map(|task| task.status.as_str()),
            Some("done")
        ) {
            return Err((
                StatusCode::CONFLICT,
                format!("Task dependency {dependency_id} is not done"),
            ));
        }
    }

    let project_id = task.project_id.clone().unwrap_or_default();
    let additional_instructions = db
        .get_project_config(&project_id, "additional_instructions")
        .ok()
        .flatten();
    let handoff_notes_template = db
        .get_project_config(&project_id, "handoff_notes_template")
        .ok()
        .flatten();
    let code_cleanup_enabled = db
        .get_config("code_cleanup_tasks_enabled")
        .ok()
        .flatten()
        .map(|value| value == "true")
        .unwrap_or(false);
    let provider_name = db.resolve_ai_provider(&project_id);

    Ok(StartImplementationContext {
        task,
        project_id,
        additional_instructions,
        handoff_notes_template,
        code_cleanup_enabled,
        provider_name,
    })
}

async fn prepare_start_workspace(
    state: &AppState,
    project_id: &str,
    task_id: &str,
    repo_path: &str,
    worktree_source: Option<&str>,
    worktree_branch: Option<&str>,
) -> AppResult<PreparedWorkspace> {
    if worktree_source == Some("disabled") {
        return Ok(PreparedWorkspace {
            working_dir: PathBuf::from(repo_path),
            kind: "project_dir",
            branch_name: None,
        });
    }

    let home = dirs::home_dir().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to get home directory".to_string(),
        )
    })?;
    let repo_name = Path::new(repo_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid repo path".to_string()))?;
    let working_dir = home
        .join(".openforge")
        .join("worktrees")
        .join(repo_name)
        .join(task_id);

    let branch = if worktree_source == Some("existingBranch") {
        let branch = worktree_branch
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    "Existing branch worktrees require a branch".to_string(),
                )
            })?;
        crate::git_worktree::create_worktree_from_existing_branch(
            Path::new(repo_path),
            &working_dir,
            branch,
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        let branch = crate::git_worktree::task_branch_name(task_id);
        crate::git_worktree::create_worktree(
            Path::new(repo_path),
            &working_dir,
            &branch,
            "origin/main",
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        branch
    };

    {
        let db = crate::db::acquire_db(&state.db);
        db.create_worktree_record(
            task_id,
            project_id,
            repo_path,
            working_dir.to_str().ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Invalid worktree path".to_string(),
                )
            })?,
            &branch,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(PreparedWorkspace {
        working_dir,
        kind: "git_worktree",
        branch_name: Some(branch),
    })
}

fn persist_active_task_workspace(
    state: &AppState,
    task_id: &str,
    project_id: &str,
    repo_path: &str,
    workspace: &PreparedWorkspace,
    provider_name: &str,
) -> AppResult<()> {
    let db = crate::db::acquire_db(&state.db);
    db.upsert_task_workspace_record(
        task_id,
        project_id,
        workspace.working_dir.to_str().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid workspace path".to_string(),
            )
        })?,
        repo_path,
        workspace.kind,
        workspace.branch_name.as_deref(),
        provider_name,
        "active",
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to persist task workspace: {e}"),
        )
    })
}

pub(super) async fn handle_app_start_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "start_implementation" {
        return Ok(None);
    }

    let task_id = payload_string(&request.payload, "taskId")?;
    let repo_path = payload_string(&request.payload, "repoPath")?;
    let pty_manager = state.pty_manager.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        )
    })?;
    let _start_claim = state
        .start_implementation_claims
        .try_claim(&task_id)
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                "Task already has an implementation start in progress".to_string(),
            )
        })?;

    let start_context = load_start_implementation_context(state, &task_id)?;
    let workspace = prepare_start_workspace(
        state,
        &start_context.project_id,
        &task_id,
        &repo_path,
        start_context.task.worktree_source.as_deref(),
        start_context.task.worktree_branch.as_deref(),
    )
    .await?;

    let prompt = crate::agent_lifecycle::build_task_prompt(
        &start_context.task,
        start_context.additional_instructions.as_deref(),
        start_context.code_cleanup_enabled,
        start_context.handoff_notes_template.as_deref(),
    );
    let image_attachment_root = state
        .app
        .as_ref()
        .map(|app| app.path().app_data_dir())
        .transpose()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to resolve app data directory: {e}"),
            )
        })?
        .unwrap_or_else(|| std::env::temp_dir().join("openforge"));
    let image_attachment_dir =
        crate::agent_lifecycle::task_prompt_image_attachment_dir(&image_attachment_root, &task_id);
    let prompt = crate::agent_lifecycle::materialize_task_prompt_images(
        &task_id,
        &prompt,
        &image_attachment_dir,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let provider_options = provider_run_options_for_task(&start_context.task);

    let provider =
        crate::providers::Provider::from_name(&start_context.provider_name, pty_manager.clone())
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let provider_start_context =
        crate::providers::ProviderStartContext::new(state.app.clone(), state.app_event_tx.clone());
    let provider_result = provider
        .start(
            &task_id,
            &workspace.working_dir,
            &prompt,
            provider_options.agent,
            provider_options.permission_mode,
            provider_options.model,
            &provider_start_context,
        )
        .await
        .map_err(|e| {
            if e.is_invalid_workspace_cwd() {
                (StatusCode::BAD_REQUEST, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    persist_active_task_workspace(
        state,
        &task_id,
        &start_context.project_id,
        &repo_path,
        &workspace,
        &start_context.provider_name,
    )?;

    let agent_session_id = crate::agent_lifecycle::create_and_record_session(
        &state.db,
        &task_id,
        &provider_result,
        &start_context.provider_name,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if start_context.task.status == "backlog" {
        let db = crate::db::acquire_db(&state.db);
        db.update_task_status(&task_id, "doing").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update task status: {e}"),
            )
        })?;
        drop(db);
        publish_task_changed(state, &task_id);
    }

    Ok(Some(crate::agent_lifecycle::build_start_response(
        &task_id,
        &agent_session_id,
        workspace.working_dir.to_str().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid workspace path".to_string(),
            )
        })?,
        provider_result.port,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task_with_provider_options(
        agent: Option<&str>,
        permission_mode: Option<&str>,
    ) -> crate::db::TaskRow {
        crate::db::TaskRow {
            id: "T-provider-options".to_string(),
            initial_prompt: "Implement provider options".to_string(),
            status: "backlog".to_string(),
            project_id: Some("P-provider-options".to_string()),
            created_at: 1,
            updated_at: 1,
            prompt: None,
            summary: None,
            agent: agent.map(str::to_string),
            permission_mode: permission_mode.map(str::to_string),
            worktree_source: None,
            worktree_branch: None,
            title: None,
            depends_on: Vec::new(),
            labels: Vec::new(),
        }
    }

    #[test]
    fn provider_run_options_borrow_task_agent_and_permission_mode() {
        let task = task_with_provider_options(Some("rust-specialist"), Some("trusted"));

        let options = provider_run_options_for_task(&task);

        assert_eq!(options.agent, Some("rust-specialist"));
        assert_eq!(options.permission_mode, Some("trusted"));
        assert!(options.model.is_none());
    }

    #[test]
    fn provider_run_options_keep_missing_task_options_empty() {
        let task = task_with_provider_options(None, None);

        let options = provider_run_options_for_task(&task);

        assert_eq!(options.agent, None);
        assert_eq!(options.permission_mode, None);
        assert!(options.model.is_none());
    }
}
