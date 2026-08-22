use super::{
    authorization_error_response, authorize_versioned_request, error_response,
    CompanionAttentionItem, CompanionAttentionSnapshot, CompanionDependentTaskResponse,
    CompanionErrorCode, CompanionHostStatusResponse, CompanionProjectBoardCounts,
    CompanionProjectBoardLanes, CompanionProjectBoardResponse, CompanionProjectBoardTask,
    CompanionProjectCatalogItem, CompanionProjectCatalogResponse, CompanionRouterState,
    CompanionTaskDetailResponse, CompanionTaskRelationshipResponse, PROTOCOL_VERSION,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};

pub(super) fn routes() -> Router<CompanionRouterState> {
    Router::new()
        .route("/companion/v1/status", get(status_handler))
        .route("/companion/v1/attention", get(attention_handler))
        .route("/companion/v1/projects", get(project_catalog_handler))
        .route(
            "/companion/v1/projects/:project_id/board",
            get(project_board_handler),
        )
        .route("/companion/v1/tasks/:task_id", get(task_detail_handler))
}

async fn status_handler(State(state): State<CompanionRouterState>, headers: HeaderMap) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    Json(CompanionHostStatusResponse {
        host_id: state.host.host_id,
        protocol_version: PROTOCOL_VERSION,
        server_time: chrono::Utc::now().to_rfc3339(),
    })
    .into_response()
}

fn attention_activity_at(timestamp: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|value| value.to_rfc3339())
}

fn attention_unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        "Task attention is temporarily unavailable",
    )
}
async fn attention_handler(
    State(state): State<CompanionRouterState>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    let rows = match state.attention.snapshot() {
        Ok(rows) => rows,
        Err(_) => return attention_unavailable(),
    };
    let mut items = Vec::new();
    for row in rows {
        match state.project_board.is_project_visible(&row.project_id) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(_) => return attention_unavailable(),
        }
        let Some(activity_at) = attention_activity_at(row.activity_at) else {
            return attention_unavailable();
        };
        items.push(CompanionAttentionItem {
            task_id: row.task_id,
            project_id: row.project_id,
            project_name: row.project_name,
            title: row.title,
            state: row.state,
            reason: row.reason,
            activity_at,
        });
    }

    Json(CompanionAttentionSnapshot {
        snapshot_at: chrono::Utc::now().to_rfc3339(),
        items,
    })
    .into_response()
}

async fn project_catalog_handler(
    State(state): State<CompanionRouterState>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }
    let projects = match state.project_board.catalog() {
        Ok(projects) => projects,
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Project catalog is temporarily unavailable",
            );
        }
    };
    Json(CompanionProjectCatalogResponse {
        snapshot_at: chrono::Utc::now().to_rfc3339(),
        projects: projects
            .into_iter()
            .map(|project| CompanionProjectCatalogItem {
                project_id: project.project_id,
                name: project.name,
            })
            .collect(),
    })
    .into_response()
}

fn board_task(row: crate::project_board::ProjectBoardTask) -> Option<CompanionProjectBoardTask> {
    Some(CompanionProjectBoardTask {
        task_id: row.task_id,
        title: row.title,
        lane: row.lane,
        state: row.state,
        reason: row.reason,
        activity_at: detail_timestamp(row.activity_at)?,
        dependency_count: row.dependency_count,
        waiting_dependency_count: row.waiting_dependency_count,
        labels: row.labels,
        pull_request_count: row.pull_request_count,
        primary_pull_request_number: row.primary_pull_request_number,
    })
}

fn board_lane(
    rows: Vec<crate::project_board::ProjectBoardTask>,
) -> Option<Vec<CompanionProjectBoardTask>> {
    rows.into_iter().map(board_task).collect()
}

async fn project_board_handler(
    State(state): State<CompanionRouterState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }
    let board = match state.project_board.board(&project_id) {
        Ok(Some(board)) => board,
        Ok(None) => {
            return error_response(
                StatusCode::NOT_FOUND,
                CompanionErrorCode::NotFound,
                "Project Board was not found",
            );
        }
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Project Board is temporarily unavailable",
            );
        }
    };
    let counts = CompanionProjectBoardCounts {
        focus: board.focus.len(),
        in_flight: board.in_flight.len(),
        out_of_focus: board.out_of_focus.len(),
        backlog: board.backlog.len(),
    };
    let Some(focus) = board_lane(board.focus) else {
        return project_board_unavailable();
    };
    let Some(in_flight) = board_lane(board.in_flight) else {
        return project_board_unavailable();
    };
    let Some(out_of_focus) = board_lane(board.out_of_focus) else {
        return project_board_unavailable();
    };
    let Some(backlog) = board_lane(board.backlog) else {
        return project_board_unavailable();
    };
    Json(CompanionProjectBoardResponse {
        snapshot_at: chrono::Utc::now().to_rfc3339(),
        project_id: board.project_id,
        project_name: board.project_name,
        counts,
        lanes: CompanionProjectBoardLanes {
            focus,
            in_flight,
            out_of_focus,
            backlog,
        },
    })
    .into_response()
}

fn project_board_unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        CompanionErrorCode::TemporarilyUnavailable,
        "Project Board is temporarily unavailable",
    )
}
fn detail_timestamp(timestamp: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|value| value.to_rfc3339())
}

async fn task_detail_handler(
    State(state): State<CompanionRouterState>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    let detail = match state.task_detail.get(&task_id) {
        Ok(Some(detail)) => detail,
        Ok(None) => {
            return error_response(
                StatusCode::NOT_FOUND,
                CompanionErrorCode::NotFound,
                "Task was not found",
            );
        }
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Task detail is temporarily unavailable",
            );
        }
    };

    match state.project_board.is_project_visible(&detail.project_id) {
        Ok(true) => {}
        Ok(false) => {
            return error_response(
                StatusCode::NOT_FOUND,
                CompanionErrorCode::NotFound,
                "Task was not found",
            );
        }
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Task detail is temporarily unavailable",
            );
        }
    }
    let Some(created_at) = detail_timestamp(detail.created_at) else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task detail is temporarily unavailable",
        );
    };
    let Some(updated_at) = detail_timestamp(detail.updated_at) else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task detail is temporarily unavailable",
        );
    };
    let agent_updated_at = match detail.agent_updated_at {
        Some(timestamp) => {
            let Some(timestamp) = detail_timestamp(timestamp) else {
                return error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    CompanionErrorCode::TemporarilyUnavailable,
                    "Task detail is temporarily unavailable",
                );
            };
            Some(timestamp)
        }
        None => None,
    };
    let agent_terminal_available = state.pty_manager.agent_terminal_available(&task_id).await;

    Json(CompanionTaskDetailResponse {
        task_id: detail.task_id,
        initial_prompt: detail.initial_prompt,
        title: detail.title,
        project_id: detail.project_id,
        project_name: detail.project_name,
        board_status: detail.board_status,
        agent_state: detail.agent_state,
        agent_terminal_available,
        agent_error_summary: detail.agent_error_summary,
        labels: detail.labels,
        dependencies: detail
            .dependencies
            .into_iter()
            .map(|dependency| CompanionTaskRelationshipResponse {
                task_id: dependency.task_id,
                title: dependency.title,
                board_status: dependency.board_status,
                project_id: dependency.project_id,
                project_name: dependency.project_name,
            })
            .collect(),
        dependent_tasks: detail
            .dependent_tasks
            .into_iter()
            .map(|dependent| CompanionDependentTaskResponse {
                task_id: dependent.task_id,
                title: dependent.title,
                board_status: dependent.board_status,
                project_id: dependent.project_id,
                project_name: dependent.project_name,
                remaining_dependency_count: dependent.remaining_dependency_count,
            })
            .collect(),
        created_at,
        updated_at,
        agent_updated_at,
    })
    .into_response()
}
