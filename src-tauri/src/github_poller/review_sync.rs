use super::common::GitHubEventTarget;
use crate::authored_pr_sync::{
    enrich_and_persist_authored_prs, AuthoredPrEnrichmentPolicy, AuthoredPrStalePolicy,
    AuthoredPrSyncError,
};
use crate::db::{acquire_db, Database, PrRow};
use crate::github_client::{CompletePrSearchSnapshot, GitHubClient, PullRequestTerminalState};
use crate::review_pr_sync::enrich_and_persist_review_prs;
use log::{error, warn};
use std::collections::HashSet;
use std::fmt;
use std::sync::Mutex;

pub(super) enum PollPhaseError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl From<AuthoredPrSyncError> for PollPhaseError {
    fn from(error: AuthoredPrSyncError) -> Self {
        match error {
            AuthoredPrSyncError::GitHub(error) => Self::GitHub(error),
            AuthoredPrSyncError::Db(message) => Self::Db(message),
        }
    }
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
    Clock(crate::unix_timestamp::UnixTimestampError),
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
            Self::Clock(_) => "clock error".to_string(),
        };

        format!("phase {phase}: {summary}")
    }
}

impl fmt::Display for SyncOpenPrsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Db(message) => f.write_str(message),
            Self::GitHub(error) => write!(f, "{}", error),
            Self::Clock(error) => write!(f, "clock error: {}", error),
        }
    }
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
                if let Some(terminal_state) = details.terminal_state() {
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
            PullRequestTerminalState::Closed => db_lock
                .update_pr_closed(pr_id)
                .map_err(|e| SyncOpenPrsError::Db(format!("Failed to close stale PR: {}", e)))?,
            PullRequestTerminalState::Merged(merged_at) => db_lock
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
    events: &GitHubEventTarget,
    requests: &mut super::refresh_requests::RefreshRequests,
) -> Result<(usize, Option<CompletePrSearchSnapshot>), SyncOpenPrsError> {
    let username = match read_or_fetch_github_username(github_client, db, github_token).await? {
        Some(username) => username,
        None => return Ok((0, None)),
    };

    let snapshot = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;

    let task_ids = {
        let db_lock = acquire_db(db);
        db_lock
            .get_all_task_ids()
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get task IDs: {}", e)))?
    };

    let now = crate::unix_timestamp::seconds(std::time::SystemTime::now())
        .map_err(SyncOpenPrsError::Clock)?;

    let mut synced = 0;
    let mut newly_linked = Vec::new();
    {
        let db_lock = acquire_db(db);
        for pr in &snapshot.prs {
            if let Some(task_id) =
                find_authoritative_task_id(&pr.title, &pr.head_ref, pr.body.as_deref(), &task_ids)
            {
                let outcome = db_lock
                    .associate_pull_request_automatically(crate::db::AutomaticPr {
                        id: pr.id,
                        number: pr.number,
                        task_id: &task_id,
                        owner: &pr.repo_owner,
                        repo: &pr.repo_name,
                        title: &pr.title,
                        url: &pr.html_url,
                        state: &pr.state,
                        now,
                        draft: pr.draft,
                    })
                    .map_err(|e| SyncOpenPrsError::Db(format!("Failed to upsert PR: {}", e)))?;
                if outcome == crate::db::AutomaticAssociation::OwnershipConflict {
                    continue;
                }
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
                if outcome == crate::db::AutomaticAssociation::Created {
                    if let Some(row) = db_lock
                        .get_pull_request_by_id(pr.id)
                        .map_err(|e| SyncOpenPrsError::Db(e.to_string()))?
                    {
                        newly_linked.push(row);
                    }
                    events.emit(
                        "task-pull-request-updated",
                        serde_json::json!({
                            "task_id": task_id, "pr_id": pr.id, "action": "linked"
                        }),
                    );
                }
            }
        }
    }

    // The caller already owns the shared request permit. Keep recovery tickets
    // through the rest of its cycle so normal polling reuses this attempt.
    if !newly_linked.is_empty() && github_client.get_last_rate_limit_reset().is_none() {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            super::persistence::poll_prs_for_project(
                github_client,
                db,
                events,
                github_token,
                Some(&username),
                newly_linked,
                requests,
            ),
        )
        .await;
    }

    reconcile_stale_authored_task_prs(github_client, db, github_token, &snapshot.ids).await?;

    Ok((synced, Some(snapshot)))
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

    let snapshot = github_client
        .search_review_requested_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;
    let count = enrich_and_persist_review_prs(github_client, db, github_token, snapshot)
        .await
        .map_err(PollPhaseError::Db)?
        .iter()
        .filter(|pr| pr.viewed_at.is_none())
        .count();
    events.emit("review-pr-count-changed", serde_json::json!(count));

    Ok(())
}

fn configured_github_username(db: &Mutex<Database>) -> Result<Option<String>, PollPhaseError> {
    acquire_db(db)
        .get_config("github_username")
        .map_err(|error| PollPhaseError::Db(error.to_string()))
}

pub(super) async fn poll_authored_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let Some(username) = configured_github_username(db)? else {
        return Ok(());
    };
    let snapshot = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;
    poll_authored_prs_from_snapshot(github_client, db, events, github_token, snapshot).await
}

pub(super) async fn poll_authored_prs_from_snapshot(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
    snapshot: CompletePrSearchSnapshot,
) -> Result<(), PollPhaseError> {
    let CompletePrSearchSnapshot { prs, ids } = snapshot;
    enrich_and_persist_authored_prs(
        github_client,
        db,
        github_token,
        prs,
        AuthoredPrEnrichmentPolicy::RequireComplete,
        AuthoredPrStalePolicy::DeleteMissing(&ids),
    )
    .await?;

    events.emit("authored-prs-updated", serde_json::Value::Null);
    Ok(())
}
