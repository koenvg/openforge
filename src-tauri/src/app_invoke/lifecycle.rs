use super::*;
use log::error;
use std::path::{Path, PathBuf};

/// The worktree/branch cleanup work captured for a task before its workspace
/// metadata is removed. Running it needs no DB access: `delete_task` drops the
/// worktree record in the same transaction as completing the task.
pub(super) struct TaskRuntimeCleanup {
    repo_path: PathBuf,
    worktree_path: PathBuf,
    branch_to_delete: Option<String>,
}

/// Kills the task's PTYs and captures its worktree cleanup while the task and
/// worktree rows still exist. The returned cleanup (if any) is safe to run
/// after the worktree row is removed, so `delete_task` can publish the deleted event
pub(super) async fn prepare_task_runtime_cleanup(
    state: &AppState,
    task_id: &str,
    remove_branch: bool,
) -> Result<Option<TaskRuntimeCleanup>, (StatusCode, String)> {
    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(task_id).await;
        pty_manager.kill_shells_for_task(task_id).await;
    }
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
    let delete_worktree_branch = remove_branch && !task_uses_existing_branch;

    Ok(worktree.map(|worktree| TaskRuntimeCleanup {
        repo_path: PathBuf::from(worktree.repo_path),
        worktree_path: PathBuf::from(worktree.worktree_path),
        branch_to_delete: delete_worktree_branch.then_some(worktree.branch_name),
    }))
}

/// Runs a captured worktree/branch cleanup. Failures are logged rather than
/// surfaced: by the time this runs the task is already completed and the deleted event
/// has been published, so there is no caller left to report to.
pub(super) async fn run_task_runtime_cleanup(task_id: &str, cleanup: TaskRuntimeCleanup) {
    let remove_result = crate::git_worktree::remove_worktree_with_branch(
        &cleanup.repo_path,
        &cleanup.worktree_path,
        cleanup.branch_to_delete.as_deref(),
    )
    .await;
    if let Err(e) = remove_result {
        let error_message = e.to_string();
        error!(
            "[app_invoke] Failed to remove worktree for completed task {} error_bytes={}",
            task_id,
            error_message.len()
        );
    }
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
    start_prompt_contributions: Vec<crate::agent_lifecycle::StartPromptContribution>,
    code_cleanup_enabled: bool,
    provider_name: String,
}

pub(super) struct PreparedWorkspace {
    pub(super) working_dir: PathBuf,
    pub(super) kind: &'static str,
    pub(super) branch_name: Option<String>,
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
    let start_prompt_contributions = db
        .get_project_config(
            &project_id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
        )
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    let code_cleanup_enabled = db.resolve_task_bool(&task.id, "code_cleanup_tasks_enabled", false);
    let provider_name = db.resolve_ai_provider_for_task(&task.id);

    Ok(StartImplementationContext {
        task,
        project_id,
        additional_instructions,
        start_prompt_contributions,
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
    divergence_resolution: crate::git_worktree::DivergenceResolution,
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
            divergence_resolution,
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

/// Roll back the workspace prepared for a start attempt whose provider failed to
/// launch. Without this, a failed start leaves an orphaned `worktrees` row (and
/// physical worktree) behind. On the next attempt the leftover row collides with
/// the new INSERT and surfaces a `UNIQUE constraint failed: worktrees.task_id`
/// error that masks the real failure (e.g. the provider binary not being
/// installed). Rolling back keeps a failed start from poisoning the task.
pub(super) async fn rollback_failed_start_workspace(
    state: &AppState,
    task_id: &str,
    repo_path: &str,
    workspace: &PreparedWorkspace,
    uses_existing_branch: bool,
) {
    // A project-directory start ("disabled" worktree source) creates neither a
    // worktree nor a record, so there is nothing to roll back.
    if workspace.kind != "git_worktree" {
        return;
    }

    let repo = Path::new(repo_path);
    let worktree_path = workspace.working_dir.as_path();
    let remove_result = if uses_existing_branch {
        // Never delete a user's pre-existing branch; only detach the worktree.
        crate::git_worktree::remove_worktree(repo, worktree_path).await
    } else {
        crate::git_worktree::remove_worktree_with_branch(
            repo,
            worktree_path,
            workspace.branch_name.as_deref(),
        )
        .await
    };
    if let Err(e) = remove_result {
        let error_message = e.to_string();
        error!(
            "[app_invoke] Failed to remove worktree during failed-start rollback for {} error_bytes={}",
            task_id,
            error_message.len()
        );
    }

    let db = crate::db::acquire_db(&state.db);
    if let Err(e) = db.delete_worktree_record(task_id) {
        error!(
            "[app_invoke] Failed to delete worktree record during failed-start rollback for {}: {}",
            task_id, e
        );
    }
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

pub(crate) async fn start_implementation(
    state: &AppState,
    task_id: &str,
    repo_path: &str,
    divergence_resolution: crate::git_worktree::DivergenceResolution,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let pty_manager = state.pty_manager.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        )
    })?;
    let _start_claim = state
        .task_claims
        .try_claim(task_id, TaskOperation::StartImplementation)
        .ok_or_else(|| {
            (
                StatusCode::CONFLICT,
                "Task already has an implementation start in progress".to_string(),
            )
        })?;

    let start_context = load_start_implementation_context(state, task_id)?;
    let workspace = prepare_start_workspace(
        state,
        &start_context.project_id,
        task_id,
        repo_path,
        start_context.task.worktree_source.as_deref(),
        start_context.task.worktree_branch.as_deref(),
        divergence_resolution,
    )
    .await?;

    let prompt = crate::agent_lifecycle::build_task_prompt(
        &start_context.task,
        start_context.additional_instructions.as_deref(),
        start_context.code_cleanup_enabled,
        &start_context.start_prompt_contributions,
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
        crate::agent_lifecycle::task_prompt_image_attachment_dir(&image_attachment_root, task_id);
    let prompt = crate::agent_lifecycle::materialize_task_prompt_images(
        task_id,
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
    let provider_result = match provider
        .start(
            task_id,
            &workspace.working_dir,
            &prompt,
            provider_options.agent,
            provider_options.permission_mode,
            provider_options.model,
            &provider_start_context,
        )
        .await
    {
        Ok(result) => result,
        Err(e) => {
            // The provider never launched, so undo the workspace prepared for this
            // attempt. Leaving the worktree record behind would block (and mask)
            // every future start with a UNIQUE constraint error instead of
            // resurfacing the real cause.
            let uses_existing_branch =
                start_context.task.worktree_source.as_deref() == Some("existingBranch");
            rollback_failed_start_workspace(
                state,
                task_id,
                repo_path,
                &workspace,
                uses_existing_branch,
            )
            .await;
            return Err(if e.is_invalid_workspace_cwd() {
                (StatusCode::BAD_REQUEST, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            });
        }
    };

    persist_active_task_workspace(
        state,
        task_id,
        &start_context.project_id,
        repo_path,
        &workspace,
        &start_context.provider_name,
    )?;

    let agent_session_id = crate::agent_lifecycle::create_and_record_session(
        &state.db,
        task_id,
        &provider_result,
        &start_context.provider_name,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if start_context.task.status == "backlog" {
        let db = crate::db::acquire_db(&state.db);
        db.update_task_status(task_id, "doing").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update task status: {e}"),
            )
        })?;
        drop(db);
        publish_task_changed(state, task_id);
    }

    Ok(crate::agent_lifecycle::build_start_response(
        task_id,
        &agent_session_id,
        workspace.working_dir.to_str().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid workspace path".to_string(),
            )
        })?,
        provider_result.port,
    ))
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
    // Optional: the frontend divergence gate supplies how to resolve a diverged
    // existing branch. Absent (or null) means the defensive `Auto` behavior.
    let divergence_resolution: crate::git_worktree::DivergenceResolution =
        payload_field(&request.payload, "divergenceResolution")
            .unwrap_or(crate::git_worktree::DivergenceResolution::Auto);

    Ok(Some(
        start_implementation(state, &task_id, &repo_path, divergence_resolution).await?,
    ))
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
            title_source: None,
            title_generated_at: None,
            handoff_notes_enabled: true,
            source_ticket_url: None,
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

    #[test]
    fn start_context_cleanup_reads_task_override() {
        let (state, path) =
            crate::app_invoke::test_support::test_state("start_context_cleanup_task_override");

        let task_id = {
            let db = crate::db::acquire_db(&state.db);
            let project = db.create_project("P", "/tmp/p").unwrap();
            // Global default OFF; the task snapshot overrides it ON.
            db.set_config("code_cleanup_tasks_enabled", "false")
                .unwrap();
            let task = db
                .create_task_with_options(crate::db::NewTaskOptions {
                    initial_prompt: "p",
                    status: "backlog",
                    project_id: Some(&project.id),
                    prompt: None,
                    permission_mode: None,
                    worktree_source: None,
                    worktree_branch: None,
                    title: None,
                    handoff_notes_enabled: true,
                    source_ticket_url: None,
                    code_cleanup_enabled: None,
                    task_display_title_updates_enabled: None,
                    ai_provider: None,
                })
                .unwrap();
            db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "true")
                .unwrap();
            task.id
        };

        let context =
            load_start_implementation_context(&state, &task_id).expect("load start context");
        assert!(
            context.code_cleanup_enabled,
            "task-level code_cleanup override should win over global config"
        );

        drop(state);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn start_context_reads_task_provider_override() {
        let (state, path) =
            crate::app_invoke::test_support::test_state("start_context_task_provider_override");

        let task_id = {
            let db = crate::db::acquire_db(&state.db);
            let project = db.create_project("P", "/tmp/p").unwrap();
            // Global and project providers stay at the default; only the task
            // overrides the provider.
            let task = db
                .create_task_with_options(crate::db::NewTaskOptions {
                    initial_prompt: "p",
                    status: "backlog",
                    project_id: Some(&project.id),
                    prompt: None,
                    permission_mode: None,
                    worktree_source: None,
                    worktree_branch: None,
                    title: None,
                    handoff_notes_enabled: true,
                    source_ticket_url: None,
                    code_cleanup_enabled: None,
                    task_display_title_updates_enabled: None,
                    ai_provider: None,
                })
                .unwrap();
            db.set_task_config(&task.id, "ai_provider", "opencode")
                .unwrap();
            task.id
        };

        let context =
            load_start_implementation_context(&state, &task_id).expect("load start context");
        assert_eq!(
            context.provider_name, "opencode",
            "task-level ai_provider override should win over project/global provider"
        );

        drop(state);
        let _ = std::fs::remove_file(path);
    }
}
