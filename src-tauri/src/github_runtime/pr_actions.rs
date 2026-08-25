use crate::{db, github_client::GitHubClient};
use std::sync::{Arc, Mutex};

use super::auth::github_token;

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitHubPrLink {
    owner: String,
    repo: String,
    number: i64,
    normalized_url: String,
}

pub fn get_pull_requests(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {e}"))
}

pub fn get_pull_requests_for_task(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_pull_requests_for_task(task_id)
        .map_err(|e| format!("Failed to get pull requests for task: {e}"))
}

pub fn get_pr_comments(
    db: &Arc<Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {e}"))
}

fn parse_github_pr_url(pr_url: &str) -> Result<GitHubPrLink, String> {
    let trimmed = pr_url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| "Invalid pull request URL: expected a GitHub PR URL".to_string())?;
    let without_host = without_scheme
        .strip_prefix("github.com/")
        .ok_or_else(|| "Invalid pull request URL: expected github.com".to_string())?;
    let path = without_host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/');
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() < 4 || segments[2] != "pull" {
        return Err("Invalid pull request URL: expected /owner/repo/pull/number".to_string());
    }

    let owner = segments[0].to_string();
    let repo = segments[1].to_string();
    let number = segments[3]
        .parse::<i64>()
        .map_err(|_| "Invalid pull request URL: pull request number must be numeric".to_string())?;

    if owner.is_empty() || repo.is_empty() || number <= 0 {
        return Err(
            "Invalid pull request URL: expected a positive pull request number".to_string(),
        );
    }

    Ok(GitHubPrLink {
        normalized_url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
        owner,
        repo,
        number,
    })
}

fn synthetic_pr_id(link: &GitHubPrLink) -> i64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let key = format!("{}/{}/{}", link.owner, link.repo, link.number);
    let hash = key.as_bytes().iter().fold(FNV_OFFSET, |acc, byte| {
        (acc ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    let positive = (hash & 0x3fff_ffff_ffff_ffff).max(1);
    -(positive as i64)
}

pub fn link_pull_request(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
    pr_url: &str,
) -> Result<db::PrRow, String> {
    let link = parse_github_pr_url(pr_url)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read current time: {e}"))?
        .as_secs() as i64;

    let db_lock = crate::db::acquire_db(db);
    if db_lock
        .get_task(task_id)
        .map_err(|e| format!("Failed to find task: {e}"))?
        .is_none()
    {
        return Err(format!("Task not found: {task_id}"));
    }

    let existing_pr = db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read existing pull requests: {e}"))?
        .into_iter()
        .find(|pr| {
            pr.repo_owner == link.owner && pr.repo_name == link.repo && pr.pr_number == link.number
        });

    let row_id = existing_pr
        .as_ref()
        .map(|pr| pr.id)
        .unwrap_or_else(|| synthetic_pr_id(&link));
    let title = existing_pr
        .as_ref()
        .map(|pr| pr.title.clone())
        .unwrap_or_else(|| format!("{}/{}#{}", link.owner, link.repo, link.number));
    let url = existing_pr
        .as_ref()
        .map(|pr| pr.url.clone())
        .unwrap_or_else(|| link.normalized_url.clone());
    let state = existing_pr
        .as_ref()
        .map(|pr| pr.state.clone())
        .unwrap_or_else(|| "open".to_string());
    let created_at = existing_pr.as_ref().map(|pr| pr.created_at).unwrap_or(now);
    let draft = existing_pr.as_ref().map(|pr| pr.draft).unwrap_or(false);

    db_lock
        .insert_pull_request_with_number(
            row_id,
            link.number,
            task_id,
            &link.owner,
            &link.repo,
            &title,
            &url,
            &state,
            created_at,
            now,
            draft,
        )
        .map_err(|e| format!("Failed to link pull request: {e}"))?;

    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read linked pull request: {e}"))?
        .into_iter()
        .find(|pr| pr.id == row_id)
        .ok_or_else(|| "Failed to read linked pull request after insert".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPullRequestAction {
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

fn task_pull_request_action_target(
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

pub fn persist_successful_task_pull_request_action(
    db: &db::Database,
    pr_id: i64,
    action: TaskPullRequestAction,
) -> Result<(), String> {
    match action {
        TaskPullRequestAction::Merge => db
            .update_pr_merged(pr_id, current_unix_timestamp())
            .map_err(|e| format!("Failed to persist merged pull request: {e}")),
        TaskPullRequestAction::Enqueue => db
            .update_pr_queued(pr_id)
            .map_err(|e| format!("Failed to persist queued pull request: {e}")),
    }
}

fn current_unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
fn validate_pull_request_merge_method(
    pr: &db::PrRow,
    merge_method: crate::github_client::PullRequestMergeMethod,
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

pub async fn merge_task_pull_request(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
    task_id: &str,
    pr_id: i64,
    merge_method: crate::github_client::PullRequestMergeMethod,
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
    persist_successful_task_pull_request_action(&db_lock, pr_id, TaskPullRequestAction::Merge)?;
    db_lock
        .get_pull_requests_for_task(task_id)
        .map_err(|e| format!("Failed to read merged pull request: {e}"))?
        .into_iter()
        .find(|row| row.id == pr_id)
        .ok_or_else(|| "Merged pull request disappeared from local state".to_string())
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
            github_node_id,
            &pr.repo_owner,
            &pr.repo_name,
            pr.pr_number,
            &token,
            &actor_login,
        )
        .await
        .map_err(|e| format!("Failed to enqueue pull request: {e}"))?;

    let db_lock = crate::db::acquire_db(db);
    persist_successful_task_pull_request_action(&db_lock, pr_id, TaskPullRequestAction::Enqueue)?;
    db_lock
        .get_pull_requests_for_task(task_id)
        .map_err(|e| format!("Failed to read queued pull request: {e}"))?
        .into_iter()
        .find(|row| row.id == pr_id)
        .ok_or_else(|| "Queued pull request disappeared from local state".to_string())
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn parses_github_pull_request_url() {
        let parsed = super::parse_github_pr_url(
            " https://github.com/openforge/app/pull/1431?notification_referrer_id=1 ",
        )
        .expect("valid GitHub PR URL should parse");

        assert_eq!(parsed.owner, "openforge");
        assert_eq!(parsed.repo, "app");
        assert_eq!(parsed.number, 1431);
        assert_eq!(
            parsed.normalized_url,
            "https://github.com/openforge/app/pull/1431"
        );
    }

    #[test]
    fn link_pull_request_persists_synthetic_pr_for_task() {
        let (db, _temp_dir) = make_test_db("link_pull_request_persists");
        let task = db
            .create_task("Link a PR", "doing", None, None, None)
            .expect("create task");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr = super::link_pull_request(&db, &task.id, "https://github.com/owner/repo/pull/77")
            .expect("link PR");

        assert_eq!(pr.ticket_id, task.id);
        assert_eq!(pr.repo_owner, "owner");
        assert_eq!(pr.repo_name, "repo");
        assert_eq!(pr.pr_number, 77);
        assert!(pr.id < 0, "manual links use a synthetic negative row id");
        assert_eq!(pr.title, "owner/repo#77");
        assert_eq!(pr.state, "open");
    }

    #[test]
    fn link_pull_request_reuses_existing_pr_row_for_same_repository_number() {
        let (db, _temp_dir) = make_test_db("link_pull_request_reuses_existing");
        let old_task = db
            .create_task("Old link", "doing", None, None, None)
            .expect("create old task");
        let new_task = db
            .create_task("New link", "doing", None, None, None)
            .expect("create new task");
        db.insert_pull_request_with_number(
            123456,
            77,
            &old_task.id,
            "owner",
            "repo",
            "Fetched GitHub title",
            "https://github.com/owner/repo/pull/77",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert existing PR");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr =
            super::link_pull_request(&db, &new_task.id, "https://github.com/owner/repo/pull/77")
                .expect("link PR");

        assert_eq!(pr.id, 123456);
        assert_eq!(pr.ticket_id, new_task.id);
        assert_eq!(pr.title, "Fetched GitHub title");
    }
    #[test]
    fn successful_task_actions_persist_terminal_local_state() {
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

        super::persist_successful_task_pull_request_action(
            &db,
            1,
            super::TaskPullRequestAction::Merge,
        )
        .expect("persist merge");
        super::persist_successful_task_pull_request_action(
            &db,
            2,
            super::TaskPullRequestAction::Enqueue,
        )
        .expect("persist enqueue");

        let prs = db.get_all_pull_requests().expect("read PRs");
        let merged = prs.iter().find(|pr| pr.id == 1).expect("merged PR");
        let queued = prs.iter().find(|pr| pr.id == 2).expect("queued PR");
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
