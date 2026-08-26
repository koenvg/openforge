use super::*;
use std::sync::Arc;

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

fn task_start_service(state: &AppState) -> crate::task_start::TaskStartService {
    crate::task_start::TaskStartService::new(
        state.app.clone(),
        Arc::clone(&state.db),
        state.pty_manager.clone(),
        state.app_event_tx.clone(),
        state.task_claims.clone(),
        state.task_start_worktree_root.clone(),
    )
}

fn map_task_start_error(error: crate::task_start::TaskStartError) -> (StatusCode, String) {
    use crate::task_start::TaskStartError;

    let status = match &error {
        TaskStartError::NotFound | TaskStartError::ProjectNotFound { .. } => StatusCode::NOT_FOUND,
        TaskStartError::ProjectRequired => StatusCode::UNPROCESSABLE_ENTITY,
        TaskStartError::InvalidState { .. }
        | TaskStartError::StaleState
        | TaskStartError::AlreadyInProgress
        | TaskStartError::ActiveSession
        | TaskStartError::DependencyBlocked { .. } => StatusCode::CONFLICT,
        TaskStartError::RuntimeUnavailable => StatusCode::SERVICE_UNAVAILABLE,
        TaskStartError::InvalidConfiguration(_) | TaskStartError::InvalidWorkspace(_) => {
            StatusCode::BAD_REQUEST
        }
        TaskStartError::Workspace(_)
        | TaskStartError::ProviderLaunch(_)
        | TaskStartError::Persistence(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string())
}

fn desktop_start_response(
    execution: crate::task_start::TaskStartExecution,
) -> Result<serde_json::Value, (StatusCode, String)> {
    match execution.outcome {
        crate::task_start::TaskStartOutcome::Started { .. } => {
            let receipt = execution.receipt.ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Task Start completed without desktop launch details".to_string(),
                )
            })?;
            Ok(crate::agent_lifecycle::build_start_response(
                &receipt.task_id,
                &receipt.session_id,
                receipt.workspace_path.to_str().ok_or_else(|| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Invalid workspace path".to_string(),
                    )
                })?,
                receipt.port,
            ))
        }
        crate::task_start::TaskStartOutcome::DesktopActionRequired { .. } => Err((
            StatusCode::CONFLICT,
            "Task Start requires desktop action because the existing branch has diverged"
                .to_string(),
        )),
    }
}

pub(crate) async fn start_task(
    state: &AppState,
    task_id: &str,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let execution = task_start_service(state)
        .start(crate::task_start::TaskStartRequest::safe(task_id))
        .await
        .map_err(|error| match error {
            crate::task_start::TaskStartError::NotFound => {
                (StatusCode::NOT_FOUND, format!("Task not found: {task_id}"))
            }
            other => map_task_start_error(other),
        })?;
    desktop_start_response(execution)
}

pub(crate) async fn start_implementation(
    state: &AppState,
    task_id: &str,
    _legacy_repo_path: &str,
    divergence_resolution: crate::git_worktree::DivergenceResolution,
    terminal_image_protocol: Option<crate::pty_manager::TerminalImageProtocol>,
    prompt_prefix: Option<&str>,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let execution = task_start_service(state)
        .start(crate::task_start::TaskStartRequest::desktop(
            task_id,
            divergence_resolution,
            terminal_image_protocol,
            prompt_prefix,
        ))
        .await
        .map_err(map_task_start_error)?;
    desktop_start_response(execution)
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
    let terminal_image_protocol =
        match payload_optional_string(&request.payload, "terminalImageProtocol")?.as_deref() {
            None => None,
            Some("iterm2") => Some(crate::pty_manager::TerminalImageProtocol::Iterm2),
            Some(value) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("Unsupported terminal image protocol: {value}"),
                ));
            }
        };
    // Optional: a one-off prefix chosen at start time. Absent means today's
    // behavior exactly.
    let prompt_prefix = payload_optional_string(&request.payload, "promptPrefix")?;

    Ok(Some(
        start_implementation(
            state,
            &task_id,
            &repo_path,
            divergence_resolution,
            terminal_image_protocol,
            prompt_prefix.as_deref(),
        )
        .await?,
    ))
}
