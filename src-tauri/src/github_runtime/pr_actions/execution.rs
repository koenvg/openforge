use crate::{
    db,
    github_client::{EnqueuePullRequestRequest, GitHubClient, PullRequestMergeMethod},
};
use std::sync::{Arc, Mutex};

use super::{
    current_unix_timestamp,
    validation::{
        task_pull_request_action_target, validate_pull_request_merge_method, TaskPullRequestAction,
    },
};
use crate::github_runtime::auth::github_token;

fn persist_and_reload_task_pull_request(
    db: &db::Database,
    task_id: &str,
    pr_id: i64,
    action: TaskPullRequestAction,
) -> Result<db::PrRow, String> {
    let (read_error_context, missing_row_error) = match action {
        TaskPullRequestAction::Merge => (
            "Failed to read merged pull request",
            "Merged pull request disappeared from local state",
        ),
        TaskPullRequestAction::Enqueue => (
            "Failed to read queued pull request",
            "Queued pull request disappeared from local state",
        ),
    };

    match action {
        TaskPullRequestAction::Merge => db
            .update_pr_merged(pr_id, current_unix_timestamp()?)
            .map_err(|e| format!("Failed to persist merged pull request: {e}"))?,
        TaskPullRequestAction::Enqueue => db
            .update_pr_queued(pr_id)
            .map_err(|e| format!("Failed to persist queued pull request: {e}"))?,
    }

    db.get_pull_requests_for_task(task_id)
        .map_err(|e| format!("{read_error_context}: {e}"))?
        .into_iter()
        .find(|row| row.id == pr_id)
        .ok_or_else(|| missing_row_error.to_string())
}

pub async fn merge_task_pull_request(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
    task_id: &str,
    pr_id: i64,
    merge_method: PullRequestMergeMethod,
    expected_head_sha: &str,
) -> Result<db::PrRow, String> {
    let pr = task_pull_request_action_target(
        db,
        task_id,
        pr_id,
        expected_head_sha,
        TaskPullRequestAction::Merge,
    )?;
    validate_pull_request_merge_method(&pr, merge_method)?;
    let token = github_token().await?;
    let response = github_client
        .merge_pr(
            &pr.repo_owner,
            &pr.repo_name,
            pr.pr_number,
            &token,
            merge_method,
            Some(expected_head_sha),
        )
        .await
        .map_err(|e| format!("Failed to merge pull request: {e}"))?;
    if !response.merged {
        return Err(format!(
            "Failed to merge pull request: {}",
            response.message
        ));
    }

    let db_lock = crate::db::acquire_db(db);
    persist_and_reload_task_pull_request(&db_lock, task_id, pr_id, TaskPullRequestAction::Merge)
}

pub async fn enqueue_task_pull_request(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
    task_id: &str,
    pr_id: i64,
    expected_head_sha: &str,
) -> Result<db::PrRow, String> {
    let pr = task_pull_request_action_target(
        db,
        task_id,
        pr_id,
        expected_head_sha,
        TaskPullRequestAction::Enqueue,
    )?;
    let github_node_id = pr.github_node_id.as_deref().ok_or_else(|| {
        "Pull request enqueue identity is not cached yet; wait for background GitHub Sync"
            .to_string()
    })?;
    let token = github_token().await?;
    let actor_login = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_config("github_username")
            .map_err(|e| format!("Failed to read cached GitHub username: {e}"))?
            .unwrap_or_else(|| "the authenticated GitHub user".to_string())
    };
    github_client
        .enqueue_pull_request_by_node_id(
            EnqueuePullRequestRequest {
                pull_request_id: github_node_id,
                expected_head_oid: expected_head_sha,
                owner: &pr.repo_owner,
                repo: &pr.repo_name,
                pr_number: pr.pr_number,
                actor_login: &actor_login,
            },
            &token,
        )
        .await
        .map_err(|e| format!("Failed to enqueue pull request: {e}"))?;

    let db_lock = crate::db::acquire_db(db);
    persist_and_reload_task_pull_request(&db_lock, task_id, pr_id, TaskPullRequestAction::Enqueue)
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn successful_task_actions_persist_and_reload_terminal_local_state() {
        let (db, _temp_dir) = make_test_db("task_pr_action_local_state");
        let merged_task = db
            .create_task("Merge PR", "doing", None, None, None)
            .expect("create merge task");
        let queued_task = db
            .create_task("Queue PR", "doing", None, None, None)
            .expect("create queue task");
        db.insert_pull_request(
            1,
            &merged_task.id,
            "owner",
            "repo",
            "Merge",
            "url",
            "open",
            1,
            1,
            false,
        )
        .expect("insert merge PR");
        db.insert_pull_request(
            2,
            &queued_task.id,
            "owner",
            "repo",
            "Queue",
            "url",
            "open",
            1,
            1,
            false,
        )
        .expect("insert queue PR");

        let merged = super::persist_and_reload_task_pull_request(
            &db,
            &merged_task.id,
            1,
            super::TaskPullRequestAction::Merge,
        )
        .expect("persist and reload merge");
        let queued = super::persist_and_reload_task_pull_request(
            &db,
            &queued_task.id,
            2,
            super::TaskPullRequestAction::Enqueue,
        )
        .expect("persist and reload enqueue");

        assert_eq!(merged.state, "merged");
        assert!(merged.merged_at.is_some());
        assert!(queued.is_queued);
        assert_eq!(
            queued.merge_readiness_status.as_deref(),
            Some("queued_pull_request")
        );
        assert_eq!(
            queued.merge_readiness_action.as_deref(),
            Some("wait_for_queue")
        );
    }

    #[test]
    fn post_action_reload_preserves_action_specific_missing_row_errors() {
        let (db, _temp_dir) = make_test_db("task_pr_action_missing_after_update");
        let task = db
            .create_task("Act on PR", "doing", None, None, None)
            .expect("create task");
        for pr_id in [1, 2] {
            db.insert_pull_request(
                pr_id, &task.id, "owner", "repo", "PR", "url", "open", 1, 1, false,
            )
            .expect("insert PR");
        }

        let merge_error = super::persist_and_reload_task_pull_request(
            &db,
            "another-task",
            1,
            super::TaskPullRequestAction::Merge,
        )
        .expect_err("merge row should be absent from another task");
        let enqueue_error = super::persist_and_reload_task_pull_request(
            &db,
            "another-task",
            2,
            super::TaskPullRequestAction::Enqueue,
        )
        .expect_err("queued row should be absent from another task");

        assert_eq!(
            merge_error,
            "Merged pull request disappeared from local state"
        );
        assert_eq!(
            enqueue_error,
            "Queued pull request disappeared from local state"
        );
    }
}
