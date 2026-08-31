use crate::{db, http_server::AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct TaskReadErrorResponse {
    code: &'static str,
    message: String,
}

type TaskReadHttpError = (StatusCode, Json<TaskReadErrorResponse>);

fn task_read_error(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> TaskReadHttpError {
    (
        status,
        Json(TaskReadErrorResponse {
            code,
            message: message.into(),
        }),
    )
}

fn map_task_read_error(error: db::TaskReadError) -> TaskReadHttpError {
    match error {
        db::TaskReadError::ProjectNotFound(_) => task_read_error(
            StatusCode::NOT_FOUND,
            "project_not_found",
            error.to_string(),
        ),
        db::TaskReadError::SearchTooLong { .. } => task_read_error(
            StatusCode::BAD_REQUEST,
            "search_too_long",
            error.to_string(),
        ),
        db::TaskReadError::TooManyLabels { .. } | db::TaskReadError::LabelNameTooLong { .. } => {
            task_read_error(StatusCode::BAD_REQUEST, "invalid_labels", error.to_string())
        }
        db::TaskReadError::InvalidCursor => {
            task_read_error(StatusCode::BAD_REQUEST, "invalid_cursor", error.to_string())
        }
        db::TaskReadError::Database(_) => task_read_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "task_read_failed",
            format!("failed to read Tasks: {error}"),
        ),
    }
}

pub async fn active_tasks_handler(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<db::ActiveTasks>, TaskReadHttpError> {
    let database = db::acquire_db(&state.db);
    database
        .tasks()
        .active(&project_id)
        .map(Json)
        .map_err(map_task_read_error)
}

fn parse_completed_task_query(params: Vec<(String, String)>) -> db::CompletedTaskQuery {
    let mut query = db::CompletedTaskQuery::default();
    for (key, value) in params {
        match key.as_str() {
            "search" => query.search = Some(value),
            "labels" => query.labels.push(value),
            "cursor" => query.cursor = Some(value),
            _ => {}
        }
    }
    query
}

pub async fn completed_tasks_handler(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<db::CompletedTaskPage>, TaskReadHttpError> {
    let query = parse_completed_task_query(params);
    let database = db::acquire_db(&state.db);
    database
        .tasks()
        .completed(&project_id, query)
        .map(Json)
        .map_err(map_task_read_error)
}

pub async fn task_detail_handler(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(String, String)>,
) -> Result<Json<db::TaskRead>, TaskReadHttpError> {
    let database = db::acquire_db(&state.db);
    let detail = database
        .tasks()
        .detail(&project_id, &task_id)
        .map_err(map_task_read_error)?;
    detail.map(Json).ok_or_else(|| {
        task_read_error(
            StatusCode::NOT_FOUND,
            "task_not_found",
            format!("Task {task_id} was not found in project {project_id}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::parse_completed_task_query;

    #[test]
    fn completed_query_accepts_only_canonical_fields() {
        let query = parse_completed_task_query(vec![
            ("search".to_string(), "needle".to_string()),
            ("labels".to_string(), "urgent".to_string()),
            ("labels".to_string(), "backend".to_string()),
            ("limit".to_string(), "200".to_string()),
            ("status".to_string(), "doing".to_string()),
        ]);
        assert_eq!(query.search.as_deref(), Some("needle"));
        assert_eq!(query.labels, ["urgent", "backend"]);
        assert!(query.cursor.is_none());
    }
}
