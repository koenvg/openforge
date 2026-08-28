use crate::{db, github_client::PullRequestMergeMethod};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TaskPullRequestAction {
    Merge,
    Enqueue,
}

impl TaskPullRequestAction {
    fn readiness(self) -> (&'static str, &'static str) {
        match self {
            Self::Merge => ("ready_to_merge", "merge"),
            Self::Enqueue => ("ready_to_enqueue", "enqueue"),
        }
    }
}

pub(super) fn task_pull_request_action_target(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
    pr_id: i64,
    expected_head_sha: &str,
    action: TaskPullRequestAction,
) -> Result<db::PrRow, String> {
    let db_lock = crate::db::acquire_db(db);
    let pr = db_lock
        .get_pull_requests_for_task(task_id)
        .map_err(|e| format!("Failed to read pull request: {e}"))?
        .into_iter()
        .find(|pr| pr.id == pr_id)
        .ok_or_else(|| "Pull request not found for task".to_string())?;
    let (required_status, required_action) = action.readiness();
    if pr.head_sha != expected_head_sha
        || pr.readiness_source_head_sha.as_deref() != Some(expected_head_sha)
        || pr.merge_readiness_status.as_deref() != Some(required_status)
        || pr.merge_readiness_action.as_deref() != Some(required_action)
    {
        return Err(format!(
            "Pull request is no longer ready to {}",
            required_action
        ));
    }
    Ok(pr)
}

pub(super) fn validate_pull_request_merge_method(
    pr: &db::PrRow,
    merge_method: PullRequestMergeMethod,
) -> Result<(), String> {
    if pr.merge_methods_policy_known != Some(true) {
        return Err(
            "Pull request merge methods are unavailable; refresh GitHub status and try again"
                .to_string(),
        );
    }
    let allowed = pr
        .merge_method_policy()
        .ok_or_else(|| "Pull request merge methods are unavailable".to_string())?
        .allowed;
    if !allowed.contains(&merge_method) {
        return Err(format!(
            "Pull request merge method '{}' is not allowed; refresh GitHub status and choose another method",
            merge_method.as_str()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn task_merge_target_rejects_a_changed_expected_head() {
        let (db, _temp_dir) = make_test_db("task_pr_action_expected_head");
        let task = db
            .create_task("Merge PR", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            1, &task.id, "owner", "repo", "Merge", "url", "open", 1, 1, false,
        )
        .expect("insert PR");
        db.update_pr_head_sha(1, "current-head").expect("set head");
        db.update_pr_merge_readiness(
            1,
            &crate::db::PrMergeReadinessFacts {
                status: Some("ready_to_merge".to_string()),
                action: Some("merge".to_string()),
                blockers_json: Some("[]".to_string()),
                warnings_json: Some("[]".to_string()),
                source_head_sha: Some("current-head".to_string()),
                merge_group_sha: None,
                required_checks_policy_known: Some(true),
                required_reviews_policy_known: Some(true),
                merge_queue_required: Some(false),
                merge_queue_state: None,
                updated_at: 1,
            },
        )
        .expect("set readiness");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let error = super::task_pull_request_action_target(
            &db,
            &task.id,
            1,
            "old-head",
            super::TaskPullRequestAction::Merge,
        )
        .expect_err("changed head must reject merge");

        assert_eq!(error, "Pull request is no longer ready to merge");
    }
}
