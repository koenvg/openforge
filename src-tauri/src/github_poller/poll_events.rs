use super::common::GitHubEventTarget;

pub(super) fn emit_new_pr_comment(
    events: &GitHubEventTarget,
    task_id: &str,
    comment_id: i64,
) -> Result<(), String> {
    events.emit(
        "new-pr-comment",
        serde_json::json!({
            "ticket_id": task_id,
            "comment_id": comment_id,
        }),
    )
}

pub(super) fn emit_ci_status_changed(
    events: &GitHubEventTarget,
    task_id: &str,
    project_id: Option<&str>,
    pr_id: i64,
    pr_title: &str,
    ci_status: &str,
    timestamp: i64,
) -> Result<(), String> {
    events.emit(
        "ci-status-changed",
        serde_json::json!({
            "task_id": task_id,
            "project_id": project_id,
            "pr_id": pr_id,
            "pr_title": pr_title,
            "ci_status": ci_status,
            "timestamp": timestamp,
        }),
    )
}

pub(super) fn emit_review_status_changed(
    events: &GitHubEventTarget,
    task_id: &str,
    project_id: Option<&str>,
    pr_id: i64,
    pr_title: &str,
    review_status: &str,
    timestamp: i64,
) -> Result<(), String> {
    events.emit(
        "review-status-changed",
        serde_json::json!({
            "task_id": task_id,
            "project_id": project_id,
            "pr_id": pr_id,
            "pr_title": pr_title,
            "review_status": review_status,
            "timestamp": timestamp,
        }),
    )
}

pub(super) fn emit_task_updated(
    events: &GitHubEventTarget,
    task_id: &str,
    project_id: &str,
) -> Result<(), String> {
    events.emit(
        "task-changed",
        serde_json::json!({
            "action": "updated",
            "task_id": task_id,
            "project_id": project_id,
        }),
    )
}
