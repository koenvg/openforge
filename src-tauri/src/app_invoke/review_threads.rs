use super::*;
use crate::db::{CreateReviewThread, ReplyToReviewThread, ReviewThreadError, ReviewThreadScope};

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

pub(super) async fn handle_app_review_threads_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "list_review_threads" => {
            let scope = payload_scope(&request.payload)?;
            let threads = db::acquire_db(&state.db)
                .list_review_threads(&scope)
                .map_err(review_thread_error)?;
            json_value(threads)?
        }
        "create_review_thread" => {
            let create: CreateReviewThread =
                serde_json::from_value(request.payload.clone()).map_err(|error| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Invalid create_review_thread payload: {error}"),
                    )
                })?;
            let thread = db::acquire_db(&state.db)
                .create_review_thread(&create)
                .map_err(review_thread_error)?;
            publish_review_threads_changed(state, &create.scope);
            json_value(thread)?
        }
        "reply_to_review_thread" => {
            let reply: ReplyToReviewThread = serde_json::from_value(request.payload.clone())
                .map_err(|error| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Invalid reply_to_review_thread payload: {error}"),
                    )
                })?;
            let thread = db::acquire_db(&state.db)
                .reply_to_review_thread(&reply)
                .map_err(review_thread_error)?;
            publish_review_threads_changed(
                state,
                &ReviewThreadScope {
                    namespace: thread.namespace.clone(),
                    target_key: thread.target_key.clone(),
                    revision: thread.revision.clone(),
                },
            );
            json_value(thread)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
