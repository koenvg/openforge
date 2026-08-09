use super::{
    authorization_error_response, authorize_versioned_request, error_response, CompanionErrorCode,
    CompanionRouterState, CompanionTaskCompleteResponse,
};
use crate::terminal_task_completion::{TerminalTaskCompletionError, TerminalTaskCompletionOutcome};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new().route(
        "/companion/v1/tasks/:task_id/complete",
        post(complete_task_handler),
    )
}

async fn complete_task_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    let detail = match state.task_detail.get(&task_id) {
        Ok(Some(detail)) => detail,
        Ok(None) => return task_not_found(),
        Err(_) => return task_actions_unavailable(),
    };
    match state.project_board.is_project_visible(&detail.project_id) {
        Ok(true) => {}
        Ok(false) => return task_not_found(),
        Err(_) => return task_actions_unavailable(),
    }

    match state.task_actions.complete(&task_id).await {
        Ok(TerminalTaskCompletionOutcome::Completed {
            task_id,
            cleanup_scheduled,
        }) => Json(CompanionTaskCompleteResponse {
            task_id,
            board_status: "done".to_string(),
            cleanup_scheduled,
        })
        .into_response(),
        Ok(TerminalTaskCompletionOutcome::Deleted { .. }) => task_actions_unavailable(),
        Err(TerminalTaskCompletionError::NotFound) => task_not_found(),
        Err(TerminalTaskCompletionError::AlreadyClaimed) => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::OperationInProgress,
            "Task already has a lifecycle operation in progress",
        ),
        Err(TerminalTaskCompletionError::InvalidState { .. }) => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::InvalidTaskState,
            "Complete is not available for the current Task state",
        ),
        Err(
            TerminalTaskCompletionError::RuntimeShutdown(_)
            | TerminalTaskCompletionError::Persistence(_),
        ) => task_actions_unavailable(),
    }
}

fn task_not_found() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Task was not found",
    )
}

fn task_actions_unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        "Task completion is temporarily unavailable",
    )
}
