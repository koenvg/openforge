use super::{
    json_value, payload_field, payload_i64, payload_optional_string, payload_string, AppResult,
};
use crate::{
    app_events::publish_app_event_to_runtime, http_server::AppInvokeRequest, http_server::AppState,
};
use axum::http::StatusCode;
use serde::Serialize;

fn runtime_error(error: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn link_pull_request_error(error: String) -> (StatusCode, String) {
    if error.starts_with("Invalid pull request URL") {
        (StatusCode::BAD_REQUEST, error)
    } else if error.starts_with("Task not found") || error.starts_with("Pull request not found") {
        (StatusCode::NOT_FOUND, error)
    } else if error.starts_with("Pull request is already linked") {
        (StatusCode::CONFLICT, error)
    } else if error.starts_with("GitHub token not configured")
        || error.starts_with("GitHub authentication failed")
    {
        (StatusCode::UNAUTHORIZED, error)
    } else {
        runtime_error(error)
    }
}

fn mark_comment_addressed_error(error: String) -> (StatusCode, String) {
    if error.starts_with("Comment not found") {
        (StatusCode::NOT_FOUND, error)
    } else {
        runtime_error(error)
    }
}

fn task_pull_request_action_error(error: String) -> (StatusCode, String) {
    if error == "Pull request not found for task" {
        (StatusCode::NOT_FOUND, error)
    } else if error.starts_with("Pull request is no longer ready")
        || error.starts_with("Pull request merge method")
    {
        (StatusCode::CONFLICT, error)
    } else {
        runtime_error(error)
    }
}

fn refresh_task_github_status_error(error: String) -> (StatusCode, String) {
    if error.starts_with("Task not found") {
        (StatusCode::NOT_FOUND, error)
    } else {
        runtime_error(error)
    }
}

fn publish_comment_addressed(state: &AppState) {
    let payload = serde_json::Value::Null;
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "comment-addressed",
        &payload,
    );
}

fn publish_task_pull_request_updated(state: &AppState, task_id: &str, pr_id: i64, action: &str) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "task-pull-request-updated",
        &serde_json::json!({
            "task_id": task_id,
            "pr_id": pr_id,
            "action": action,
        }),
    );
}

/// Notify the renderer that the unopened review-request count may have changed so the
/// sidebar/rail badges refresh promptly. Payload mirrors the poller's event (the current
/// all-repos unopened count); the renderer recomputes badges from its stores on receipt.
fn publish_review_pr_count_changed(state: &AppState) {
    let count = crate::github_runtime::get_review_prs(&state.db)
        .map(|prs| prs.iter().filter(|pr| pr.viewed_at.is_none()).count())
        .unwrap_or(0);
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "review-pr-count-changed",
        &serde_json::json!(count),
    );
}

fn to_app_value<T: Serialize>(value: T) -> AppResult<serde_json::Value> {
    json_value(value)
}

pub(super) async fn handle_app_github_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "get_pull_requests" => {
            let task_id = payload_optional_string(&request.payload, "taskId")?;
            let pull_requests = match task_id {
                Some(task_id) => {
                    crate::github_runtime::get_pull_requests_for_task(&state.db, &task_id)
                }
                None => crate::github_runtime::get_pull_requests(&state.db),
            }
            .map_err(runtime_error)?;
            to_app_value(pull_requests)?
        }
        "link_pull_request" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let pr_url = payload_string(&request.payload, "prUrl")?;
            to_app_value(
                crate::github_runtime::link_pull_request(
                    &state.db,
                    &state.github_client,
                    &task_id,
                    &pr_url,
                )
                .await
                .map_err(link_pull_request_error)?,
            )?
        }
        "get_pr_comments" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            to_app_value(
                crate::github_runtime::get_pr_comments(&state.db, pr_id).map_err(runtime_error)?,
            )?
        }
        "mark_comment_addressed" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            crate::github_runtime::mark_comment_addressed(&state.db, comment_id)
                .map_err(mark_comment_addressed_error)?;
            publish_comment_addressed(state);
            return Ok(Some(serde_json::Value::Null));
        }
        "get_review_prs" => {
            to_app_value(crate::github_runtime::get_review_prs(&state.db).map_err(runtime_error)?)?
        }
        "mark_review_pr_viewed" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            let head_sha = payload_string(&request.payload, "headSha")?;
            crate::github_runtime::mark_review_pr_viewed(&state.db, pr_id, &head_sha)
                .map_err(runtime_error)?;
            publish_review_pr_count_changed(state);
            serde_json::Value::Null
        }
        "mark_review_pr_unviewed" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            crate::github_runtime::mark_review_pr_unviewed(&state.db, pr_id)
                .map_err(runtime_error)?;
            publish_review_pr_count_changed(state);
            serde_json::Value::Null
        }
        "get_authored_prs" => to_app_value(
            crate::github_runtime::get_authored_prs(&state.db).map_err(runtime_error)?,
        )?,
        "get_project_repo" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            to_app_value(
                crate::github_runtime::get_project_repo(&state.db, &project_id)
                    .map_err(runtime_error)?,
            )?
        }
        "force_github_sync" => to_app_value(
            crate::github_poller::poll_github_once_for_sidecar(
                state.db.clone(),
                &state.github_client,
                state.app_event_tx.clone(),
                // A manual "sync now" always does a full, all-repo sync.
                crate::github_poller::PollScope::Global,
            )
            .await,
        )?,
        "refresh_task_github_status" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            to_app_value(
                crate::github_poller::refresh_task_github_status_for_sidecar(
                    state.db.clone(),
                    &state.github_client,
                    state.app_event_tx.clone(),
                    &task_id,
                )
                .await
                .map_err(refresh_task_github_status_error)?,
            )?
        }
        "set_poll_context" => {
            let focused = request
                .payload
                .get("focused")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let active_project_id = request
                .payload
                .get("activeProjectId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let global_view_open = request
                .payload
                .get("globalViewOpen")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            state
                .poll_context
                .set(focused, active_project_id, global_view_open);
            serde_json::Value::Null
        }
        "merge_task_pull_request" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let pr_id = payload_i64(&request.payload, "prId")?;
            let expected_head_sha = payload_string(&request.payload, "expectedHeadSha")?;
            let merge_method = payload_field(&request.payload, "mergeMethod")?;
            let pr = crate::github_runtime::merge_task_pull_request(
                &state.db,
                &state.github_client,
                &task_id,
                pr_id,
                merge_method,
                &expected_head_sha,
            )
            .await
            .map_err(task_pull_request_action_error)?;
            publish_task_pull_request_updated(state, &task_id, pr_id, "merged");
            to_app_value(pr)?
        }
        "enqueue_task_pull_request" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let pr_id = payload_i64(&request.payload, "prId")?;
            let expected_head_sha = payload_string(&request.payload, "expectedHeadSha")?;
            let pr = crate::github_runtime::enqueue_task_pull_request(
                &state.db,
                &state.github_client,
                &task_id,
                pr_id,
                &expected_head_sha,
            )
            .await
            .map_err(task_pull_request_action_error)?;
            publish_task_pull_request_updated(state, &task_id, pr_id, "enqueued");
            to_app_value(pr)?
        }
        "get_github_username" => to_app_value(
            crate::github_runtime::github_username(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "fetch_review_prs" => to_app_value(
            crate::github_runtime::fetch_review_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "get_pr_file_diffs" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_pr_file_diffs(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_file_content" | "get_file_content_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let sha = payload_string(&request.payload, "sha")?;
            if request.command == "get_file_content" {
                to_app_value(
                    crate::github_runtime::get_file_content(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                to_app_value(
                    crate::github_runtime::get_file_content_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "get_file_at_ref" | "get_file_at_ref_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let path = payload_string(&request.payload, "path")?;
            let ref_sha = payload_string(&request.payload, "refSha")?;
            if request.command == "get_file_at_ref" {
                to_app_value(
                    crate::github_runtime::get_file_at_ref(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                to_app_value(
                    crate::github_runtime::get_file_at_ref_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "resolve_github_asset" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let url = payload_string(&request.payload, "url")?;
            to_app_value(
                crate::github_runtime::resolve_github_asset(
                    &state.github_client,
                    &owner,
                    &repo,
                    &url,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_review_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_review_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_pr_overview_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_pr_overview_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "submit_pr_review" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            let event = payload_string(&request.payload, "event")?;
            let body = payload_string(&request.payload, "body")?;
            let commit_id = payload_string(&request.payload, "commitId")?;
            let comments = if request.payload.get("comments").is_some() {
                payload_field::<Vec<crate::github_client::ReviewSubmitComment>>(
                    &request.payload,
                    "comments",
                )?
            } else {
                Vec::new()
            };
            crate::github_runtime::submit_pr_review(
                &state.github_client,
                crate::github_runtime::SubmitPrReviewRequest {
                    owner: &owner,
                    repo: &repo,
                    pr_number,
                    event: &event,
                    body: &body,
                    comments,
                    commit_id: &commit_id,
                },
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "create_review_comment_reply" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            let comment_id = payload_i64(&request.payload, "commentId")?;
            let body = payload_string(&request.payload, "body")?;
            crate::github_runtime::create_review_comment_reply(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
                comment_id,
                &body,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "create_review_comment" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            let commit_id = payload_string(&request.payload, "commitId")?;
            let path = payload_string(&request.payload, "path")?;
            let line = payload_i64(&request.payload, "line")? as i32;
            let side = payload_string(&request.payload, "side")?;
            let body = payload_string(&request.payload, "body")?;
            crate::github_runtime::create_review_comment(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
                &commit_id,
                &path,
                line,
                &side,
                &body,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "fetch_authored_prs" => to_app_value(
            crate::github_runtime::fetch_authored_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        _ => return Ok(None),
    };

    Ok(Some(value))
}
