use super::{
    authorization_error_response, authorize_versioned_request, error_response, CompanionErrorCode,
    CompanionRouterState, CompanionTaskCreateResponse,
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

const MAX_INITIAL_PROMPT_CHARS: usize = 64_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompanionTaskCreateRequest {
    initial_prompt: String,
}

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new()
        .route(
            "/companion/v1/projects/:project_id/tasks",
            post(create_task_handler),
        )
        .route(
            "/companion/v1/projects/:project_id/task-prompt-catalog",
            get(task_prompt_catalog_handler),
        )
}

async fn task_prompt_catalog_handler(
    State(state): State<CompanionRouterState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    match state.project_board.is_project_visible(&project_id) {
        Ok(true) => {}
        Ok(false) => return task_creation_not_found(),
        Err(_) => return task_prompt_catalog_unavailable(),
    }

    match state.task_creator.prompt_catalog(&project_id) {
        Ok(catalog) => Json(catalog).into_response(),
        Err(_) => task_prompt_catalog_unavailable(),
    }
}

async fn create_task_handler(
    State(state): State<CompanionRouterState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    let request: CompanionTaskCreateRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return invalid_request("Task creation request body is invalid"),
    };
    let initial_prompt = request.initial_prompt.trim();
    if initial_prompt.is_empty() {
        return invalid_request("Task initial prompt is required");
    }
    if initial_prompt.chars().count() > MAX_INITIAL_PROMPT_CHARS {
        return invalid_request("Task initial prompt is too long");
    }

    match state.project_board.is_project_visible(&project_id) {
        Ok(true) => {}
        Ok(false) => return task_creation_not_found(),
        Err(_) => return task_creation_unavailable(),
    }

    match state.task_creator.create(&project_id, initial_prompt) {
        Ok(task) => Json(CompanionTaskCreateResponse {
            task_id: task.task_id,
            project_id: task.project_id,
            board_status: "backlog".to_string(),
        })
        .into_response(),
        Err(_) => task_creation_unavailable(),
    }
}

fn invalid_request(message: &str) -> Response {
    error_response(
        StatusCode::BAD_REQUEST,
        CompanionErrorCode::InvalidRequest,
        message,
    )
}

fn task_creation_not_found() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Project was not found",
    )
}

fn task_prompt_catalog_unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        "Task prompt suggestions are temporarily unavailable",
    )
}

fn task_creation_unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        "Task creation is temporarily unavailable",
    )
}
