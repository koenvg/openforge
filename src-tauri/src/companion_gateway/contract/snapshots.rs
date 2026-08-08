use super::{
    authorization_error_response, authorize_versioned_request, error_response,
    CompanionAttentionItem, CompanionAttentionSnapshot, CompanionErrorCode,
    CompanionHostStatusResponse, CompanionRouterState, CompanionTaskDetailResponse,
    PROTOCOL_VERSION,
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

async fn attention_handler(
    State(state): State<CompanionRouterState>,
    headers: HeaderMap,
) -> Response {
    if let Err(code) = authorize_versioned_request(&state, &headers) {
        return authorization_error_response(code);
    }

    let rows = match state.attention.snapshot() {
        Ok(rows) => rows,
        Err(_) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                CompanionErrorCode::TemporarilyUnavailable,
                "Task attention is temporarily unavailable",
            );
        }
    };
    let items = rows
        .into_iter()
        .map(|row| {
            Some(CompanionAttentionItem {
                task_id: row.task_id,
                project_id: row.project_id,
                project_name: row.project_name,
                title: row.title,
                state: row.state,
                reason: row.reason,
                activity_at: attention_activity_at(row.activity_at)?,
            })
        })
        .collect::<Option<Vec<_>>>();
    let Some(items) = items else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Task attention is temporarily unavailable",
        );
    };

    Json(CompanionAttentionSnapshot {
        snapshot_at: chrono::Utc::now().to_rfc3339(),
        items,
    })
    .into_response()
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
        title: detail.title,
        project_id: detail.project_id,
        project_name: detail.project_name,
        board_status: detail.board_status,
        handoff_notes: detail.handoff_notes,
        agent_state: detail.agent_state,
        agent_terminal_available,
        agent_error_summary: detail.agent_error_summary,
        created_at,
        updated_at,
        agent_updated_at,
    })
    .into_response()
}
