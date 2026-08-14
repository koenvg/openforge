use super::{
    authorization_error_response, authorize_versioned_request, error_response, CompanionErrorCode,
    CompanionProjectActionsResponse, CompanionRouterState, CompanionTaskActionsResponse,
};
use crate::companion_gateway::{
    action_diagnostics::record_task_action,
    action_palette::{CompanionActionPaletteError, CompanionTaskActionId},
    action_presentation::{project_action_presentations, task_action_presentations},
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new()
        .route(
            "/companion/v1/tasks/:task_id/actions",
            get(task_actions_handler),
        )
        .route(
            "/companion/v1/tasks/:task_id/set-aside",
            post(set_aside_handler),
        )
        .route(
            "/companion/v1/tasks/:task_id/return-to-board",
            post(return_to_board_handler),
        )
        .route("/companion/v1/tasks/:task_id/merge", post(merge_handler))
        .route(
            "/companion/v1/tasks/:task_id/enqueue",
            post(enqueue_handler),
        )
        .route(
            "/companion/v1/tasks/:task_id/run-app",
            post(run_app_handler),
        )
        .route(
            "/companion/v1/projects/:project_id/actions",
            get(project_actions_handler),
        )
        .route(
            "/companion/v1/projects/:project_id/refresh-github",
            post(refresh_github_handler),
        )
        .route_layer(middleware::from_fn(record_task_action))
}

async fn task_actions_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }
    match state.action_palette.available_actions(&task_id) {
        Ok(available) => match task_action_presentations(&available) {
            Ok(actions) => Json(CompanionTaskActionsResponse { task_id, actions }).into_response(),
            Err(error) => action_error_response(error),
        },
        Err(error) => action_error_response(error),
    }
}

async fn project_actions_handler(
    State(state): State<CompanionRouterState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }
    match state.action_palette.available_project_actions(&project_id) {
        Ok(available) => match project_action_presentations(&available) {
            Ok(actions) => Json(CompanionProjectActionsResponse {
                project_id,
                actions,
            })
            .into_response(),
            Err(error) => action_error_response(error),
        },
        Err(error) => action_error_response(error),
    }
}
macro_rules! task_action_handler {
    ($name:ident, $action:expr) => {
        async fn $name(
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
                    "Companion action does not accept a request body",
                );
            }
            match state.action_palette.execute(&task_id, $action).await {
                Ok(()) => StatusCode::NO_CONTENT.into_response(),
                Err(error) => action_error_response(error),
            }
        }
    };
}

task_action_handler!(set_aside_handler, CompanionTaskActionId::SetAsideTask);
task_action_handler!(
    return_to_board_handler,
    CompanionTaskActionId::ReturnToBoard
);
task_action_handler!(merge_handler, CompanionTaskActionId::MergePullRequest);
task_action_handler!(enqueue_handler, CompanionTaskActionId::EnqueuePullRequest);
task_action_handler!(run_app_handler, CompanionTaskActionId::RunApp);

async fn refresh_github_handler(
    State(state): State<CompanionRouterState>,
    Path(project_id): Path<String>,
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
            "Companion GitHub refresh does not accept a request body",
        );
    }
    match state.action_palette.refresh_github(&project_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => action_error_response(error),
    }
}

fn action_error_response(error: CompanionActionPaletteError) -> Response {
    match error {
        CompanionActionPaletteError::NotFound => error_response(
            StatusCode::NOT_FOUND,
            CompanionErrorCode::NotFound,
            "Task or Project was not found",
        ),
        CompanionActionPaletteError::InvalidTaskState => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::InvalidTaskState,
            "Action is no longer available for the current Task state",
        ),
        CompanionActionPaletteError::OperationInProgress => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::OperationInProgress,
            "Another Task action is already in progress",
        ),
        CompanionActionPaletteError::DesktopActionRequired => error_response(
            StatusCode::CONFLICT,
            CompanionErrorCode::DesktopActionRequired,
            "Open the Task on desktop before running this action",
        ),
        CompanionActionPaletteError::TemporarilyUnavailable => error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Companion action is temporarily unavailable",
        ),
    }
}
