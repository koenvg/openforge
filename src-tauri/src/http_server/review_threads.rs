//! Agent-facing Review Thread routes. Auth is the agent ingress middleware's job
//! and the domain work belongs to `app_invoke`, so these routes only adapt types.
use super::AppState;
use crate::app_invoke::review_threads;
use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::post,
    Router,
};

type RouteResult = Result<Json<serde_json::Value>, (StatusCode, String)>;

async fn list_handler(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    review_threads::list(&state, &payload).map(Json)
}

async fn create_handler(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    review_threads::create(&state, &payload).map(Json)
}

async fn reply_handler(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    review_threads::reply(&state, &payload).map(Json)
}

async fn status_handler(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    review_threads::set_status(&state, &payload).map(Json)
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/review_threads/list", post(list_handler))
        .route("/review_threads/create", post(create_handler))
        .route("/review_threads/reply", post(reply_handler))
        .route("/review_threads/status", post(status_handler))
}
