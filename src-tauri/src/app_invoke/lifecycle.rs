use super::*;
use log::error;

pub(super) async fn cleanup_task_runtime_for_app(
    state: &AppState,
    task_id: &str,
    remove_branch: bool,
) -> Result<(), (StatusCode, String)> {
    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(task_id).await;
        pty_manager.kill_shells_for_task(task_id).await;
    }
    let worktree = {
        let db = crate::db::acquire_db(&state.db);
        db.get_worktree_for_task(task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get worktree: {e}"),
            )
        })?
    };

    if let Some(worktree) = worktree {
        let repo_path = std::path::Path::new(&worktree.repo_path);
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        let remove_result = if remove_branch {
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

        if !remove_branch {
            let db = crate::db::acquire_db(&state.db);
            if let Err(e) = db.delete_worktree_record(task_id) {
                error!(
                    "[app_invoke] Failed to delete worktree record for {}: {}",
                    task_id, e
                );
            }
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

pub(super) async fn handle_app_abort_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "abort_implementation" {
        return Ok(None);
    }

    let task_id = payload_string(&request.payload, "taskId")?;
    let session = {
        let db = crate::db::acquire_db(&state.db);
        db.get_latest_session_for_ticket(&task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get latest session: {e}"),
            )
        })?
    };

    if let Some(session) = session {
        match session.provider.as_str() {
            "opencode" => {
                if let Some(pty_manager) = state.pty_manager.as_ref() {
                    pty_manager.kill_shells_for_task(&task_id).await;
                    let _ = pty_manager.kill_pty(&task_id).await;
                }
            }
            "claude-code" | "pi" => {
                if let Some(pty_manager) = state.pty_manager.as_ref() {
                    pty_manager.kill_shells_for_task(&task_id).await;
                    let _ = pty_manager.kill_pty(&task_id).await;
                }
            }
            _ => {}
        }

        let abort_status = if matches!(session.provider.as_str(), "claude-code" | "pi" | "opencode")
        {
            "interrupted"
        } else {
            "failed"
        };
        {
            let db = crate::db::acquire_db(&state.db);
            let _ = db.update_agent_session(
                &session.id,
                "implementing",
                abort_status,
                None,
                Some("Aborted by user"),
            );
            if session.provider != "claude-code" {
                let _ = db.update_worktree_status(&task_id, "stopped");
                let _ = db.update_task_workspace_status(&task_id, "stopped");
            }
        }
    }

    publish_task_changed(state, &task_id);
    Ok(Some(serde_json::Value::Null))
}

#[derive(Debug, Default)]
struct AgentRunRequestOptions {
    provider: Option<String>,
    agent: Option<String>,
    permission_mode: Option<String>,
    action_prompt: Option<String>,
    model: Option<crate::opencode_client::PromptModel>,
}

fn optional_run_model(
    payload: &serde_json::Value,
) -> Result<Option<crate::opencode_client::PromptModel>, (StatusCode, String)> {
    let Some(value) = payload.get("model") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid model selection: {e}"),
            )
        })
}

fn run_request_options(
    payload: &serde_json::Value,
) -> Result<AgentRunRequestOptions, (StatusCode, String)> {
    Ok(AgentRunRequestOptions {
        provider: payload_optional_string(payload, "provider")?,
        agent: payload_optional_string(payload, "agent")?,
        permission_mode: payload_optional_string(payload, "permissionMode")?,
        action_prompt: payload_optional_string(payload, "actionPrompt")?,
        model: optional_run_model(payload)?,
    })
}

fn prompt_with_action_prompt(prompt: String, action_prompt: Option<&str>) -> String {
    let Some(action_prompt) = action_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return prompt;
    };

    format!("{prompt}\n\nAdditional user request:\n{action_prompt}")
}

fn resolve_project_repo_path(
    db: &crate::db::Database,
    project_id: &str,
) -> Result<String, (StatusCode, String)> {
    db.get_project(project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project: {e}"),
            )
        })?
        .map(|project| project.path)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Project not found".to_string()))
}

fn resolve_resume_target(
    db: &crate::db::Database,
    task_id: &str,
) -> Result<crate::startup_resume::ResumeTarget, (StatusCode, String)> {
    if let Some(workspace) = db.get_task_workspace_for_task(task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get task workspace: {e}"),
        )
    })? {
        return Ok(crate::startup_resume::ResumeTarget {
            task_id: workspace.task_id,
            project_id: workspace.project_id,
            repo_path: workspace.repo_path,
            workspace_path: workspace.workspace_path,
            kind: workspace.kind,
            branch_name: workspace.branch_name,
        });
    }

    if let Some(worktree) = db.get_worktree_for_task(task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get worktree: {e}"),
        )
    })? {
        return Ok(crate::startup_resume::ResumeTarget {
            task_id: worktree.task_id,
            project_id: worktree.project_id,
            repo_path: worktree.repo_path,
            workspace_path: worktree.worktree_path,
            kind: "git_worktree".to_string(),
            branch_name: Some(worktree.branch_name),
        });
    }

    Err((
        StatusCode::NOT_FOUND,
        "Task workspace not found for resume".to_string(),
    ))
}

async fn start_implementation_for_task(
    state: &AppState,
    task_id: String,
    repo_path_override: Option<String>,
    project_id_override: Option<String>,
    options: AgentRunRequestOptions,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let pty_manager = state.pty_manager.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        )
    })?;

    let (
        task,
        project_id_owned,
        repo_path,
        additional_instructions,
        code_cleanup_enabled,
        use_worktrees,
        provider_name,
    ) = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .get_task(&task_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get task: {e}"),
                )
            })?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "Task not found".to_string()))?;
        let project_id = project_id_override
            .clone()
            .or_else(|| task.project_id.clone())
            .unwrap_or_default();
        let repo_path = match repo_path_override {
            Some(repo_path) => repo_path,
            None => resolve_project_repo_path(&db, &project_id)?,
        };
        let instructions = db
            .get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        let cleanup = db
            .get_config("code_cleanup_tasks_enabled")
            .ok()
            .flatten()
            .map(|value| value == "true")
            .unwrap_or(false);
        let worktrees = db.resolve_use_worktrees(&project_id);
        let provider_name = options
            .provider
            .clone()
            .unwrap_or_else(|| db.resolve_ai_provider(&project_id));
        (
            task,
            project_id,
            repo_path,
            instructions,
            cleanup,
            worktrees,
            provider_name,
        )
    };

    let (working_dir, workspace_kind, branch_name) = if use_worktrees {
        let branch = crate::git_worktree::slugify_branch_name(
            &task_id,
            task.prompt.as_deref().unwrap_or(&task.initial_prompt),
        );
        let home = dirs::home_dir().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get home directory".to_string(),
            )
        })?;
        let repo_name = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid repo path".to_string()))?;
        let worktree_path = home
            .join(".openforge")
            .join("worktrees")
            .join(repo_name)
            .join(&task_id);

        crate::git_worktree::create_worktree(
            std::path::Path::new(&repo_path),
            &worktree_path,
            &branch,
            "origin/main",
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        {
            let db = crate::db::acquire_db(&state.db);
            db.create_worktree_record(
                &task_id,
                &project_id_owned,
                &repo_path,
                worktree_path.to_str().ok_or_else(|| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Invalid worktree path".to_string(),
                    )
                })?,
                &branch,
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }

        (worktree_path, "git_worktree", Some(branch))
    } else {
        (std::path::PathBuf::from(&repo_path), "project_dir", None)
    };

    let prompt = prompt_with_action_prompt(
        crate::agent_lifecycle::build_task_prompt(
            &task,
            additional_instructions.as_deref(),
            code_cleanup_enabled,
        ),
        options.action_prompt.as_deref(),
    );

    let provider = crate::providers::Provider::from_name(&provider_name, pty_manager.clone())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let start_context =
        crate::providers::ProviderStartContext::new(state.app.clone(), state.app_event_tx.clone());
    let provider_result = provider
        .start(
            &task_id,
            &working_dir,
            &prompt,
            options.agent.as_deref().or(task.agent.as_deref()),
            options
                .permission_mode
                .as_deref()
                .or(task.permission_mode.as_deref()),
            options.model.as_ref(),
            &start_context,
        )
        .await
        .map_err(|e| {
            if e.is_invalid_workspace_cwd() {
                (StatusCode::BAD_REQUEST, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    {
        let db = crate::db::acquire_db(&state.db);
        db.upsert_task_workspace_record(
            &task_id,
            &project_id_owned,
            working_dir.to_str().ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Invalid workspace path".to_string(),
                )
            })?,
            &repo_path,
            workspace_kind,
            branch_name.as_deref(),
            &provider_name,
            "active",
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to persist task workspace: {e}"),
            )
        })?;
    }

    let agent_session_id = crate::agent_lifecycle::create_and_record_session(
        &state.db,
        &task_id,
        &provider_result,
        &provider_name,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if task.status == "backlog" {
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

    Ok(crate::agent_lifecycle::build_start_response(
        &task_id,
        &agent_session_id,
        working_dir.to_str().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid workspace path".to_string(),
            )
        })?,
        provider_result.port,
    ))
}

async fn resume_implementation_for_task(
    state: &AppState,
    task_id: String,
    session_id: Option<String>,
    options: AgentRunRequestOptions,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let pty_manager = state.pty_manager.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        )
    })?;

    let (session, target, provider_name) = {
        let db = crate::db::acquire_db(&state.db);
        let session = match session_id {
            Some(session_id) => db.get_agent_session(&session_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get session: {e}"),
                )
            })?,
            None => db.get_latest_session_for_ticket(&task_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get latest session: {e}"),
                )
            })?,
        }
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Session not found".to_string()))?;

        if session.ticket_id != task_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "session does not belong to task".to_string(),
            ));
        }

        let target = resolve_resume_target(&db, &task_id)?;
        let provider_name = options
            .provider
            .clone()
            .unwrap_or_else(|| session.provider.clone());
        (session, target, provider_name)
    };

    let provider = crate::providers::Provider::from_name(&provider_name, pty_manager.clone())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let start_context =
        crate::providers::ProviderStartContext::new(state.app.clone(), state.app_event_tx.clone());
    let prompt = options
        .action_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_result = provider
        .resume(
            &task_id,
            &session,
            std::path::Path::new(&target.workspace_path),
            prompt,
            options.agent.as_deref(),
            options.permission_mode.as_deref(),
            options.model.as_ref(),
            &start_context,
        )
        .await
        .map_err(|e| {
            if e.is_invalid_workspace_cwd() {
                (StatusCode::BAD_REQUEST, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    {
        let db = crate::db::acquire_db(&state.db);
        if provider_name == "pi" {
            if let Some(pi_session_id) = provider_result.pi_session_id.as_deref() {
                if session.pi_session_id.as_deref() != Some(pi_session_id) {
                    let _ = db.set_agent_session_pi_id(&session.id, pi_session_id);
                }
            }
        }
        crate::startup_resume::restore_resumed_session_state(
            &db,
            Some(&session),
            &target,
            &provider_name,
            provider_result.pty_instance_id,
        );
    }

    publish_task_changed(state, &task_id);

    Ok(crate::agent_lifecycle::build_start_response(
        &task_id,
        &session.id,
        &target.workspace_path,
        provider_result.port,
    ))
}

pub(super) async fn handle_app_start_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    match request.command.as_str() {
        "start_implementation" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let repo_path = payload_string(&request.payload, "repoPath")?;
            let options = run_request_options(&request.payload)?;
            start_implementation_for_task(state, task_id, Some(repo_path), None, options)
                .await
                .map(Some)
        }
        "plugin_start_implementation" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let project_id = payload_optional_string(&request.payload, "projectId")?;
            let options = run_request_options(&request.payload)?;
            start_implementation_for_task(state, task_id, None, project_id, options)
                .await
                .map(Some)
        }
        "resume_implementation" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let session_id = payload_optional_string(&request.payload, "sessionId")?;
            let options = run_request_options(&request.payload)?;
            resume_implementation_for_task(state, task_id, session_id, options)
                .await
                .map(Some)
        }
        _ => Ok(None),
    }
}
