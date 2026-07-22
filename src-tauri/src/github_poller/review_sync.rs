use super::common::{parse_github_timestamp, GitHubEventTarget};
use crate::db::{Database, PrRow};
use crate::github_client::GitHubClient;
use log::{debug, error, warn};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
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
        let db_lock = db.lock().unwrap();
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

    let db_lock = db.lock().unwrap();
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
        let db_lock = db.lock().unwrap();
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

    // Built outside the DB lock below: it performs git subprocess calls, and the
    // std Mutex guarding the DB is not reentrant.
    let worktree_index = build_worktree_branch_index(db).await;

    {
        let db_lock = db.lock().unwrap();
        for pr in &github_prs {
            if let Some(task_id) = resolve_authored_pr_task_id(
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_ref,
                &pr.title,
                pr.body.as_deref(),
                &task_ids,
                &worktree_index,
            ) {
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

/// Build a repo-scoped index of the branches OpenForge's active worktrees
/// currently occupy, so an authored PR can be linked to its task by head branch
/// even when the task id appears nowhere in the PR's branch, title, or body.
///
/// For each active worktree it records the provisioned branch (from the DB) and,
/// when it differs, the branch actually checked out now (resolved via git). Both
/// are scoped by the repo's GitHub `(owner, name)`. Worktrees whose repo or path
/// can no longer be resolved are skipped rather than failing the sync.
pub(super) async fn build_worktree_branch_index(db: &Mutex<Database>) -> WorktreeBranchIndex {
    let worktrees = {
        let db_lock = db.lock().unwrap();
        db_lock.get_active_worktrees().unwrap_or_default()
    };

    let mut entries: Vec<WorktreeBranchEntry> = Vec::new();
    let mut repo_cache: HashMap<String, Option<(String, String)>> = HashMap::new();

    for worktree in worktrees {
        let repo = match repo_cache.get(&worktree.repo_path) {
            Some(cached) => cached.clone(),
            None => {
                let resolved =
                    crate::git_worktree::remote_owner_repo(Path::new(&worktree.repo_path)).await;
                repo_cache.insert(worktree.repo_path.clone(), resolved.clone());
                resolved
            }
        };
        let Some((repo_owner, repo_name)) = repo else {
            continue;
        };

        // The branch OpenForge provisioned/created for the worktree (persisted,
        // no git call needed).
        entries.push(WorktreeBranchEntry {
            task_id: worktree.task_id.clone(),
            repo_owner: repo_owner.clone(),
            repo_name: repo_name.clone(),
            branch: worktree.branch_name.clone(),
        });

        // The branch actually checked out now — e.g. a hand-named branch the
        // user switched to after provisioning. This is the case the provisioned
        // branch alone cannot cover.
        match crate::git_worktree::current_worktree_branch(Path::new(&worktree.worktree_path)).await
        {
            Ok(current)
                if !current.is_empty()
                    && current != "HEAD"
                    && current != worktree.branch_name =>
            {
                entries.push(WorktreeBranchEntry {
                    task_id: worktree.task_id.clone(),
                    repo_owner,
                    repo_name,
                    branch: current,
                });
            }
            Ok(_) => {}
            Err(e) => {
                debug!(
                    "[GitHub Poller] Skipping current-branch resolution for task {}: {}",
                    worktree.task_id, e
                );
            }
        }
    }

    WorktreeBranchIndex::build(entries)
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
        let db_lock = db.lock().unwrap();
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

/// A task's worktree occupies `branch` in the GitHub repo identified by
/// `repo_owner`/`repo_name`. Feeds [`WorktreeBranchIndex`] so an authored PR can
/// be linked by its actual head branch even when the task id never appears in
/// the PR's branch, title, or body (e.g. a descriptively named branch).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorktreeBranchEntry {
    pub(super) task_id: String,
    pub(super) repo_owner: String,
    pub(super) repo_name: String,
    pub(super) branch: String,
}

/// Repo-scoped index from a PR head branch to the single task whose worktree
/// occupies it.
///
/// Scoping by `(repo_owner, repo_name, branch)` is deliberate: task ids are
/// globally unique so the textual matcher can search across repos safely, but
/// branch names are not — two repos can both have a `dev` branch — so an
/// exact-branch match must be qualified by the repo. Branches claimed by more
/// than one task are dropped (mapped to `None`) so an ambiguous branch never
/// produces a wrong link; the textual matcher still applies as a fallback.
#[derive(Debug, Default)]
pub(super) struct WorktreeBranchIndex {
    by_repo_branch: HashMap<(String, String, String), Option<String>>,
}

impl WorktreeBranchIndex {
    pub(super) fn build(entries: impl IntoIterator<Item = WorktreeBranchEntry>) -> Self {
        let mut by_repo_branch: HashMap<(String, String, String), Option<String>> = HashMap::new();
        for entry in entries {
            let key = (entry.repo_owner, entry.repo_name, entry.branch);
            match by_repo_branch.get_mut(&key) {
                None => {
                    by_repo_branch.insert(key, Some(entry.task_id));
                }
                Some(existing) => {
                    // A different task claiming the same repo+branch is
                    // ambiguous; repeating the same task (e.g. its provisioned
                    // branch equals its current branch) is not.
                    if existing.as_deref() != Some(entry.task_id.as_str()) {
                        *existing = None;
                    }
                }
            }
        }
        Self { by_repo_branch }
    }

    pub(super) fn task_for(&self, repo_owner: &str, repo_name: &str, branch: &str) -> Option<&str> {
        self.by_repo_branch
            .get(&(
                repo_owner.to_string(),
                repo_name.to_string(),
                branch.to_string(),
            ))
            .and_then(|task| task.as_deref())
    }
}

/// Resolve the task an authored PR belongs to.
///
/// Prefers an exact, repo-scoped match on the PR's actual head branch so PRs
/// opened from a descriptively named branch still link to their task. Falls
/// back to the textual task-id search in branch/title/body when the worktree
/// index has no entry for the branch.
pub(super) fn resolve_authored_pr_task_id(
    pr_repo_owner: &str,
    pr_repo_name: &str,
    pr_head_ref: &str,
    pr_title: &str,
    pr_body: Option<&str>,
    task_ids: &[String],
    worktree_index: &WorktreeBranchIndex,
) -> Option<String> {
    if let Some(task_id) = worktree_index.task_for(pr_repo_owner, pr_repo_name, pr_head_ref) {
        return Some(task_id.to_string());
    }
    find_authoritative_task_id(pr_title, pr_head_ref, pr_body, task_ids)
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
        let db_lock = db.lock().unwrap();
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
        let db_lock = db.lock().unwrap();
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let _ = db_lock.upsert_review_pr(
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
            );
            let _ = db_lock.update_review_pr_mergeability(
                pr.id,
                pr.mergeable,
                pr.mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_review_prs(&all_search_ids);
        }
        let count = db_lock
            .get_all_review_prs()
            .map(|prs| prs.iter().filter(|p| p.viewed_at.is_none()).count())
            .unwrap_or(0);
        let _ = events.emit("review-pr-count-changed", serde_json::json!(count));
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
        let db_lock = db.lock().unwrap();
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

        let (ci_status, ci_check_runs) = match (check_runs_result, combined_status_result) {
            (Ok(check_runs), Ok(combined_status)) => {
                let status =
                    crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
                let check_runs_json = serde_json::to_string(&check_runs.check_runs)
                    .unwrap_or_else(|_| "[]".to_string());
                (Some(status), Some(check_runs_json))
            }
            _ => (None, None),
        };

        let review_status = reviews_result
            .ok()
            .map(|reviews| crate::github_client::aggregate_review_status(&reviews, false, None));

        let pr_details = pr_details_result.ok();

        let is_queued = pr_details
            .as_ref()
            .and_then(|details| details.extra.get("merge_queue_entry").map(|v| !v.is_null()))
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                pr_details.as_ref().and_then(|details| details.mergeable),
                pr_details
                    .as_ref()
                    .and_then(|details| details.mergeable_state.clone()),
                is_queued,
            ),
        );
    }

    {
        let db_lock = db.lock().unwrap();
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

            let task_id = db_lock.get_task_id_for_pr(pr.id).ok().flatten();

            let _ = db_lock.upsert_authored_pr(
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
            );
            let _ = db_lock.update_authored_pr_mergeability(
                pr.id,
                *mergeable,
                mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_authored_prs(&all_search_ids);
        }

        let _ = events.emit("authored-prs-updated", serde_json::Value::Null);
    }

    Ok(())
}
