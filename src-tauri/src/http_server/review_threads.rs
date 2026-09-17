//! Agent-facing Review Thread routes. Auth is the agent ingress middleware's job
//! and the domain work belongs to `app_invoke`, so these routes only adapt types.
use super::AppState;
use crate::app_invoke::review_threads;
use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    routing::post,
    Router,
};

type RouteResult = Result<Json<serde_json::Value>, (StatusCode, String)>;

async fn list_handler(
    State(state): State<AppState>,
    principal: Option<Extension<crate::agent_generation_identity::ScopedAgentPrincipal>>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    enforce_payload_scope(principal.as_deref(), &payload)?;
    review_threads::list(&state, &payload).map(Json)
}

async fn create_handler(
    State(state): State<AppState>,
    principal: Option<Extension<crate::agent_generation_identity::ScopedAgentPrincipal>>,
    Json(mut payload): Json<serde_json::Value>,
) -> RouteResult {
    enforce_payload_scope(principal.as_deref(), &payload)?;
    if principal.is_some() {
        payload["origin"] = serde_json::Value::String("agent".to_string());
    }
    review_threads::create(&state, &payload).map(Json)
}

async fn reply_handler(
    State(state): State<AppState>,
    principal: Option<Extension<crate::agent_generation_identity::ScopedAgentPrincipal>>,
    Json(mut payload): Json<serde_json::Value>,
) -> RouteResult {
    enforce_thread_scope(&state, principal.as_deref(), &payload)?;
    if principal.is_some() {
        payload["role"] = serde_json::Value::String("agent".to_string());
    }
    review_threads::reply(&state, &payload).map(Json)
}

async fn status_handler(
    State(state): State<AppState>,
    principal: Option<Extension<crate::agent_generation_identity::ScopedAgentPrincipal>>,
    Json(payload): Json<serde_json::Value>,
) -> RouteResult {
    enforce_thread_scope(&state, principal.as_deref(), &payload)?;
    review_threads::set_status(&state, &payload).map(Json)
}

fn enforce_payload_scope(
    principal: Option<&crate::agent_generation_identity::ScopedAgentPrincipal>,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let Some(principal) = principal else {
        return Ok(());
    };
    let matches = payload.get("namespace").and_then(serde_json::Value::as_str)
        == Some(&principal.namespace)
        && payload.get("targetKey").and_then(serde_json::Value::as_str)
            == Some(&principal.target_key)
        && payload.get("revision").and_then(serde_json::Value::as_str) == Some(&principal.revision);
    if matches {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            "Review Thread scope is outside the Scoped Agent Session".to_string(),
        ))
    }
}

fn enforce_thread_scope(
    state: &AppState,
    principal: Option<&crate::agent_generation_identity::ScopedAgentPrincipal>,
    payload: &serde_json::Value,
) -> Result<(), (StatusCode, String)> {
    let Some(principal) = principal else {
        return Ok(());
    };
    let thread_id = payload
        .get("threadId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "threadId is required".to_string()))?;
    let thread = crate::db::acquire_db(&state.db)
        .review_thread(thread_id)
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                "Review Thread does not exist".to_string(),
            )
        })?;
    if thread.namespace == principal.namespace
        && thread.target_key == principal.target_key
        && thread.revision == principal.revision
    {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            "Review Thread scope is outside the Scoped Agent Session".to_string(),
        ))
    }
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/review_threads/list", post(list_handler))
        .route("/review_threads/create", post(create_handler))
        .route("/review_threads/reply", post(reply_handler))
        .route("/review_threads/status", post(status_handler))
}
