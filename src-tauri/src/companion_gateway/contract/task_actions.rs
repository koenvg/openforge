use super::{
    authorization_error_response, authorize_versioned_request, error_response, CompanionErrorCode,
    CompanionRouterState, CompanionTaskCompleteResponse, CompanionTaskDeleteOutcome,
    CompanionTaskDeleteResponse,
};
use crate::terminal_task_completion::{TerminalTaskCompletionError, TerminalTaskCompletionOutcome};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new()
        .route(
            "/companion/v1/tasks/:task_id/complete",
            post(complete_task_handler),
        )
        .route(
            "/companion/v1/tasks/:task_id/delete",
            post(delete_task_handler),
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
        Err(_) => return task_actions_unavailable("Task completion"),
    };
    match state.project_board.is_project_visible(&detail.project_id) {
        Ok(true) => {}
        Ok(false) => return task_not_found(),
        Err(_) => return task_actions_unavailable("Task completion"),
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
        Ok(TerminalTaskCompletionOutcome::Deleted { .. }) => {
            task_actions_unavailable("Task completion")
        }
        Err(error) => lifecycle_error_response(error, "Complete"),
    }
}

async fn delete_task_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }
    if !body.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            CompanionErrorCode::InvalidRequest,
            "Companion Task Delete does not accept a request body",
        );
    }

    let detail = match state.task_detail.get(&task_id) {
        Ok(Some(detail)) => detail,
        Ok(None) => return task_not_found(),
        Err(_) => return task_actions_unavailable("Task Delete"),
    };
    match state.project_board.is_project_visible(&detail.project_id) {
        Ok(true) => {}
        Ok(false) => return task_not_found(),
        Err(_) => return task_actions_unavailable("Task Delete"),
    }
    if detail.board_status != "backlog" {
        return error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::InvalidTaskState,
            "Task Delete is only available for a current backlog Task",
        );
    }

    match state.task_actions.delete(&task_id).await {
        Ok(TerminalTaskCompletionOutcome::Deleted { task_id, .. }) => {
            Json(CompanionTaskDeleteResponse {
                task_id,
                outcome: CompanionTaskDeleteOutcome::Deleted,
            })
            .into_response()
        }
        Ok(TerminalTaskCompletionOutcome::Completed { .. }) => {
            task_actions_unavailable("Task Delete")
        }
        Err(error) => lifecycle_error_response(error, "Delete"),
    }
}

fn lifecycle_error_response(error: TerminalTaskCompletionError, action: &str) -> Response {
    match error {
        TerminalTaskCompletionError::NotFound => task_not_found(),
        TerminalTaskCompletionError::AlreadyClaimed => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::OperationInProgress,
            "Task already has a lifecycle operation in progress",
        ),
        TerminalTaskCompletionError::InvalidState { .. } => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::InvalidTaskState,
            &format!("{action} is not available for the current Task state"),
        ),
        TerminalTaskCompletionError::RuntimeShutdown(_)
        | TerminalTaskCompletionError::Persistence(_) => task_actions_unavailable(action),
    }
}

fn task_not_found() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Task was not found",
    )
}

fn task_actions_unavailable(action: &str) -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        &format!("{action} is temporarily unavailable"),
    )
}
