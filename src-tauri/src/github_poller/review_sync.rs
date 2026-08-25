use super::common::{parse_github_timestamp, GitHubEventTarget};
use crate::db::{acquire_db, Database, PrRow};
use crate::github_client::GitHubClient;
use log::{error, warn};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Mutex;

pub(super) enum PollPhaseError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl PollPhaseError {
    pub(super) fn should_increment_rate_limit_count(&self) -> bool {
        matches!(
            self,
            Self::GitHub(crate::github_client::GitHubError::ApiError { status: 429, .. })
        )
    }

    pub(super) fn sanitized_log_message(&self, phase: &str) -> String {
        let summary = match self {
            Self::GitHub(error) => {
                let mut message = error.sanitized_log_message();
                if self.should_increment_rate_limit_count() {
                    message.push_str("; rate_limited true");
                }
                message
            }
            Self::Db(_) => "database error".to_string(),
        };

        format!("phase {phase}: {summary}")
    }
}

impl fmt::Display for PollPhaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GitHub(error) => write!(f, "{}", error),
            Self::Db(message) => f.write_str(message),
        }
    }
}

#[derive(Debug)]
pub(super) enum SyncOpenPrsError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl SyncOpenPrsError {
    pub(super) fn should_increment_rate_limit_count(&self) -> bool {
        matches!(
            self,
            Self::GitHub(crate::github_client::GitHubError::ApiError { status: 429, .. })
        )
    }

    pub(super) fn sanitized_log_message(&self, phase: &str) -> String {
        let summary = match self {
            Self::GitHub(error) => {
                let mut message = error.sanitized_log_message();
                if self.should_increment_rate_limit_count() {
                    message.push_str("; rate_limited true");
                }
                message
            }
            Self::Db(_) => "database error".to_string(),
        };

        format!("phase {phase}: {summary}")
    }
}

impl fmt::Display for SyncOpenPrsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Db(message) => f.write_str(message),
            Self::GitHub(error) => write!(f, "{}", error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum StaleAuthoredPrTerminalState {
    Closed,
    Merged(Option<i64>),
}

pub(super) fn stale_authored_task_pr_candidates(
    open_prs: Vec<PrRow>,
    open_search_ids: &[i64],
) -> Vec<PrRow> {
    let open_search_ids: HashSet<i64> = open_search_ids.iter().copied().collect();
    open_prs
        .into_iter()
        .filter(|pr| !open_search_ids.contains(&pr.id))
        .collect()
}

pub(super) fn terminal_state_for_pr_details(
    details: &crate::github_client::PullRequest,
) -> Option<StaleAuthoredPrTerminalState> {
    let state = details.state.to_ascii_lowercase();
    if state == "open" {
        return None;
    }

    let merged_at = details
        .extra
        .get("merged_at")
        .and_then(|value| value.as_str())
        .and_then(parse_github_timestamp);
    let merged = details
        .extra
        .get("merged")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        || merged_at.is_some();

    match state.as_str() {
        "closed" if merged => Some(StaleAuthoredPrTerminalState::Merged(merged_at)),
        "closed" => Some(StaleAuthoredPrTerminalState::Closed),
        "merged" => Some(StaleAuthoredPrTerminalState::Merged(merged_at)),
        _ => None,
    }
}

pub(super) async fn reconcile_stale_authored_task_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
    open_search_ids: &[i64],
) -> Result<usize, SyncOpenPrsError> {
    let candidates = {
        let db_lock = acquire_db(db);
        let open_prs = db_lock
            .get_open_prs()
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get open PRs: {}", e)))?;
        stale_authored_task_pr_candidates(open_prs, open_search_ids)
    };

    let mut terminal_states = Vec::new();
    for pr in candidates {
        match github_client
            .get_pr_details(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token)
            .await
        {
            Ok(details) => {
                if let Some(terminal_state) = terminal_state_for_pr_details(&details) {
                    terminal_states.push((pr.id, terminal_state));
                }
            }
            Err(error) => warn!(
                "[GitHub Poller] Leaving stale authored PR open after failed detail fetch: {}",
                error.sanitized_log_message()
            ),
        }
    }

    if terminal_states.is_empty() {
        return Ok(0);
    }

    let db_lock = acquire_db(db);
    let mut updated = 0;
    for (pr_id, terminal_state) in terminal_states {
        match terminal_state {
            StaleAuthoredPrTerminalState::Closed => db_lock
                .update_pr_closed(pr_id)
                .map_err(|e| SyncOpenPrsError::Db(format!("Failed to close stale PR: {}", e)))?,
            StaleAuthoredPrTerminalState::Merged(merged_at) => db_lock
                .update_pr_merged_state(pr_id, merged_at)
                .map_err(|e| {
                    SyncOpenPrsError::Db(format!("Failed to mark stale PR merged: {}", e))
                })?,
        }
        updated += 1;
    }

    Ok(updated)
}

pub(super) async fn sync_authored_task_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
) -> Result<usize, SyncOpenPrsError> {
    let username = match read_or_fetch_github_username(github_client, db, github_token).await? {
        Some(username) => username,
        None => return Ok(0),
    };

    let (github_prs, all_search_ids) = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;

    let task_ids: Vec<String> = {
        let db_lock = acquire_db(db);
        db_lock
            .get_all_tasks()
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get task data: {}", e)))?
            .into_iter()
            .map(|task| task.id)
            .collect()
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut synced = 0;
    let should_reconcile_stale = !all_search_ids.is_empty() || github_prs.is_empty();
    {
        let db_lock = acquire_db(db);
        for pr in &github_prs {
            if let Some(task_id) =
                find_authoritative_task_id(&pr.title, &pr.head_ref, pr.body.as_deref(), &task_ids)
            {
                db_lock
                    .insert_pull_request_with_number(
                        pr.id,
                        pr.number,
                        &task_id,
                        &pr.repo_owner,
                        &pr.repo_name,
                        &pr.title,
                        &pr.html_url,
                        &pr.state,
                        now,
                        now,
                        pr.draft,
                    )
                    .map_err(|e| SyncOpenPrsError::Db(format!("Failed to upsert PR: {}", e)))?;
                db_lock
                    .update_pr_head_sha(pr.id, &pr.head_sha)
                    .map_err(|e| {
                        SyncOpenPrsError::Db(format!("Failed to update PR head SHA: {}", e))
                    })?;
                db_lock
                    .update_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                    .map_err(|e| {
                        SyncOpenPrsError::Db(format!("Failed to update PR mergeability: {}", e))
                    })?;
                synced += 1;
            }
        }
    }

    if should_reconcile_stale {
        reconcile_stale_authored_task_prs(github_client, db, github_token, &all_search_ids).await?;
    }

    Ok(synced)
}

pub(super) async fn read_or_fetch_github_username(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
) -> Result<Option<String>, SyncOpenPrsError> {
    let username = github_client
        .get_authenticated_user(github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;
    {
        let db_lock = acquire_db(db);
        db_lock
            .set_config("github_username", &username)
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to cache GitHub username: {}", e)))?;
    }

    Ok(Some(username))
}

pub(super) fn find_task_id_position(text: &str, task_id: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let pattern = task_id.as_bytes();
    let pat_len = pattern.len();
    if pat_len > bytes.len() {
        return None;
    }
    for i in 0..=(bytes.len() - pat_len) {
        if &bytes[i..i + pat_len] == pattern {
            // Check left boundary: must be start-of-string or non-alphanumeric
            if i > 0 && (bytes[i - 1] as char).is_alphanumeric() {
                continue;
            }
            // Check right boundary: must be end-of-string or non-digit
            let after = i + pat_len;
            if after < bytes.len() && (bytes[after] as char).is_ascii_digit() {
                continue;
            }
            return Some(i);
        }
    }
    None
}

pub(super) fn contains_task_id(text: &str, task_id: &str) -> bool {
    find_task_id_position(text, task_id).is_some()
}

pub(super) enum TaskMatchOutcome {
    None,
    Unique(String),
    Ambiguous,
}

pub(super) fn classify_task_matches(text: &str, task_ids: &[String]) -> TaskMatchOutcome {
    let mut matched_task_ids = task_ids
        .iter()
        .filter(|task_id| contains_task_id(text, task_id.as_str()))
        .cloned();

    let Some(first_match) = matched_task_ids.next() else {
        return TaskMatchOutcome::None;
    };

    if matched_task_ids.next().is_some() {
        TaskMatchOutcome::Ambiguous
    } else {
        TaskMatchOutcome::Unique(first_match)
    }
}

pub(super) fn find_authoritative_task_id(
    pr_title: &str,
    pr_branch: &str,
    pr_body: Option<&str>,
    task_ids: &[String],
) -> Option<String> {
    match classify_task_matches(pr_branch, task_ids) {
        TaskMatchOutcome::Unique(task_id) => Some(task_id),
        TaskMatchOutcome::Ambiguous => None,
        TaskMatchOutcome::None => match classify_task_matches(pr_title, task_ids) {
            TaskMatchOutcome::Unique(task_id) => Some(task_id),
            TaskMatchOutcome::Ambiguous => None,
            TaskMatchOutcome::None => {
                pr_body.and_then(|body| match classify_task_matches(body, task_ids) {
                    TaskMatchOutcome::Unique(task_id) => Some(task_id),
                    TaskMatchOutcome::Ambiguous | TaskMatchOutcome::None => None,
                })
            }
        },
    }
}

pub(super) fn count_poll_phase_error(
    phase: &str,
    result: Result<(), PollPhaseError>,
    total_errors: &mut usize,
    rate_limit_count: &mut usize,
) {
    if let Err(e) = result {
        error!(
            "[GitHub Poller] Failed to poll: {}",
            e.sanitized_log_message(phase)
        );
        *total_errors += 1;
        if e.should_increment_rate_limit_count() {
            *rate_limit_count += 1;
        }
    }
}

pub(super) async fn poll_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = acquire_db(db);
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_review_requested_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

    {
        let db_lock = acquire_db(db);
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            db_lock
                .upsert_review_pr(
                    pr.id,
                    pr.number,
                    &pr.title,
                    pr.body.as_deref(),
                    &pr.state,
                    pr.draft,
                    &pr.html_url,
                    &pr.user_login,
                    pr.user_avatar_url.as_deref(),
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_ref,
                    &pr.base_ref,
                    &pr.head_sha,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    &pr.labels,
                    created_at,
                    updated_at,
                )
                .map_err(|e| PollPhaseError::Db(format!("Failed to upsert review PR: {e}")))?;
            db_lock
                .update_review_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                .map_err(|e| {
                    PollPhaseError::Db(format!("Failed to update review PR mergeability: {e}"))
                })?;
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            db_lock
                .delete_stale_review_prs(&all_search_ids)
                .map_err(|e| {
                    PollPhaseError::Db(format!("Failed to delete stale review PRs: {e}"))
                })?;
        }
        let count = db_lock
            .get_all_review_prs()
            .map_err(|e| PollPhaseError::Db(format!("Failed to get review PRs: {e}")))?
            .iter()
            .filter(|pr| pr.viewed_at.is_none())
            .count();
        events.emit("review-pr-count-changed", serde_json::json!(count));
    }

    Ok(())
}

pub(super) async fn poll_authored_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = acquire_db(db);
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

    type EnrichedPrData = (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
        bool,
    );
    let mut enriched: HashMap<i64, EnrichedPrData> = HashMap::with_capacity(prs.len());

    for pr in &prs {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let (check_runs_result, combined_status_result, reviews_result, pr_details_result) = tokio::join!(
            github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, github_token),
            github_client.get_combined_status(
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_sha,
                github_token
            ),
            github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, github_token),
            github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, github_token)
        );

        let check_runs = check_runs_result.map_err(PollPhaseError::GitHub)?;
        let combined_status = combined_status_result.map_err(PollPhaseError::GitHub)?;
        let reviews = reviews_result.map_err(PollPhaseError::GitHub)?;
        let pr_details = pr_details_result.map_err(PollPhaseError::GitHub)?;

        let ci_status = Some(crate::github_client::aggregate_ci_status(
            &check_runs,
            &combined_status,
        ));
        let ci_check_runs = Some(
            serde_json::to_string(&check_runs.check_runs).unwrap_or_else(|_| "[]".to_string()),
        );
        let review_status = Some(crate::github_client::aggregate_review_status(
            &reviews, false, None,
        ));

        let is_queued = pr_details
            .extra
            .get("merge_queue_entry")
            .map(|value| !value.is_null())
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                pr_details.mergeable,
                pr_details.mergeable_state,
                is_queued,
            ),
        );
    }

    {
        let db_lock = acquire_db(db);
        for pr in &prs {
            let (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                mergeable,
                mergeable_state,
                is_queued,
            ) = match enriched.get(&pr.id) {
                Some(data) => data,
                None => continue,
            };

            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let task_id = db_lock
                .get_task_id_for_pr(pr.id)
                .map_err(|e| PollPhaseError::Db(format!("Failed to get Task ID for PR: {e}")))?;

            db_lock
                .upsert_authored_pr(
                    pr.id,
                    pr.number,
                    &pr.title,
                    pr.body.as_deref(),
                    &pr.state,
                    pr.draft,
                    &pr.html_url,
                    &pr.user_login,
                    pr.user_avatar_url.as_deref(),
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_ref,
                    &pr.base_ref,
                    &pr.head_sha,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    ci_status.as_deref(),
                    ci_check_runs.as_deref(),
                    review_status.as_deref(),
                    None,
                    *is_queued,
                    task_id.as_deref(),
                    &pr.labels,
                    *created_at,
                    updated_at,
                )
                .map_err(|e| PollPhaseError::Db(format!("Failed to upsert authored PR: {e}")))?;
            db_lock
                .update_authored_pr_mergeability(pr.id, *mergeable, mergeable_state.as_deref())
                .map_err(|e| {
                    PollPhaseError::Db(format!("Failed to update authored PR mergeability: {e}"))
                })?;
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            db_lock
                .delete_stale_authored_prs(&all_search_ids)
                .map_err(|e| {
                    PollPhaseError::Db(format!("Failed to delete stale authored PRs: {e}"))
                })?;
        }

        events.emit("authored-prs-updated", serde_json::Value::Null);
    }

    Ok(())
}
