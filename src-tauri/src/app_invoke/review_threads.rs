use super::*;
use crate::db::{
    CreateReviewThread, ReplyToReviewThread, ReviewThreadError, ReviewThreadRow, ReviewThreadScope,
    ReviewThreadWrite, SetReviewThreadStatus,
};

fn review_thread_error(error: ReviewThreadError) -> (StatusCode, String) {
    let status = match error {
        ReviewThreadError::InvalidField { .. } => StatusCode::BAD_REQUEST,
        ReviewThreadError::ThreadNotFound(_) => StatusCode::NOT_FOUND,
        ReviewThreadError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string())
}

fn payload_scope(payload: &serde_json::Value) -> AppResult<ReviewThreadScope> {
    Ok(ReviewThreadScope {
        namespace: payload_string(payload, "namespace")?,
        target_key: payload_string(payload, "targetKey")?,
        revision: payload_string(payload, "revision")?,
    })
}

fn thread_scope(thread: &ReviewThreadRow) -> ReviewThreadScope {
    ReviewThreadScope {
        namespace: thread.namespace.clone(),
        target_key: thread.target_key.clone(),
        revision: thread.revision.clone(),
    }
}

fn publish_review_threads_changed(state: &AppState, scope: &ReviewThreadScope) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "review-threads-changed",
        &serde_json::json!({
            "namespace": scope.namespace,
            "targetKey": scope.target_key,
            "revision": scope.revision,
        }),
    );
}

fn parse<T: serde::de::DeserializeOwned>(
    command: &str,
    payload: &serde_json::Value,
) -> AppResult<T> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid {command} payload: {error}"),
        )
    })
}

pub(crate) fn list(state: &AppState, payload: &serde_json::Value) -> AppResult<serde_json::Value> {
    let scope = payload_scope(payload)?;
    let threads = db::acquire_db(&state.db)
        .list_review_threads(&scope)
        .map_err(review_thread_error)?;
    json_value(threads)
}

pub(crate) fn create(
    state: &AppState,
    payload: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let create: CreateReviewThread = parse("create_review_thread", payload)?;
    let write = db::acquire_db(&state.db)
        .create_review_thread(&create)
        .map_err(review_thread_error)?;
    let thread = match write {
        ReviewThreadWrite::Created(thread) => {
            publish_review_threads_changed(state, &create.scope);
            thread
        }
        ReviewThreadWrite::Deduplicated(thread) => thread,
    };
    json_value(thread)
}

pub(crate) fn reply(state: &AppState, payload: &serde_json::Value) -> AppResult<serde_json::Value> {
    let reply: ReplyToReviewThread = parse("reply_to_review_thread", payload)?;
    let thread = db::acquire_db(&state.db)
        .reply_to_review_thread(&reply)
        .map_err(review_thread_error)?;
    publish_review_threads_changed(state, &thread_scope(&thread));
    json_value(thread)
}

pub(crate) fn set_status(
    state: &AppState,
    payload: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let update: SetReviewThreadStatus = parse("set_review_thread_status", payload)?;
    let thread = db::acquire_db(&state.db)
        .set_review_thread_status(&update)
        .map_err(review_thread_error)?;
    publish_review_threads_changed(state, &thread_scope(&thread));
    json_value(thread)
}

/// The plugin host names a command with a runtime string from JS, so an unmatched
/// command is a caller error there rather than a hand-off to the next family.
pub(crate) async fn invoke_review_threads_command(
    state: &AppState,
    command: &str,
    payload: serde_json::Value,
) -> AppResult<serde_json::Value> {
    let request = AppInvokeRequest {
        command: command.to_string(),
        payload,
    };
    handle_app_review_threads_command(state, &request)
        .await?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Review Thread command '{command}' is not handled"),
            )
        })
}

pub(super) async fn handle_app_review_threads_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "list_review_threads" => list(state, &request.payload)?,
        "create_review_thread" => create(state, &request.payload)?,
        "reply_to_review_thread" => reply(state, &request.payload)?,
        "set_review_thread_status" => set_status(state, &request.payload)?,
        _ => return Ok(None),
    };

    Ok(Some(value))
}
