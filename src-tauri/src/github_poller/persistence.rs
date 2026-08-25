use super::common::{parse_github_timestamp, GitHubEventTarget};
use super::poll_events::{
    emit_ci_status_changed, emit_new_pr_comment, emit_review_status_changed, emit_task_updated,
};
use super::pr_execution::{poll_single_pr, should_fetch_comments_for_pr, PollSinglePrResult};
use super::review_sync::StaleAuthoredPrTerminalState;
use crate::db::{acquire_db, finalize_readiness_facts_for_poll, Database, PrRow};
use crate::github_client::{
    aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required,
    GitHubClient,
};
use futures::future::join_all;
use log::{error, warn};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

pub(super) fn get_open_prs_for_task(
    db: &Mutex<Database>,
    task_id: &str,
) -> Result<Vec<PrRow>, String> {
    let db_lock = acquire_db(db);
    if db_lock
        .get_task(task_id)
        .map_err(|e| format!("Failed to find task: {e}"))?
        .is_none()
    {
        return Err(format!("Task not found: {task_id}"));
    }

    let all_open_prs = db_lock.get_open_prs().map_err(|e| e.to_string())?;
    Ok(all_open_prs
        .into_iter()
        .filter(|pr| pr.ticket_id == task_id)
        .collect())
}

#[derive(Debug)]
struct PrMetadata {
    pr_id: i64,
    ci_status: Option<String>,
    review_status: Option<String>,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CiPersistencePayload {
    pub(super) pr_id: i64,
    /// PR source head SHA persisted on the pull_requests row.
    pub(super) head_sha: String,
    /// SHA whose CI signals were evaluated; kept separate from the persisted PR head SHA.
    pub(super) ci_validation_sha: String,
    pub(super) status: String,
    pub(super) check_runs_json: String,
    pub(super) status_changed: bool,
}

#[derive(Debug, Default)]
pub(super) struct PersistCommentsResult {
    pub(super) new_comment_count: usize,
    pub(super) failed_insert_count: usize,
    pub(super) error_count: usize,
}

pub(super) fn persist_polled_comments(
    db: &Database,
    result: &PollSinglePrResult,
    existing_ids: &HashSet<i64>,
    now: i64,
    mut on_new_comment: impl FnMut(i64),
) -> PersistCommentsResult {
    let mut persist_result = PersistCommentsResult::default();
    let mut inserted_this_batch: HashSet<i64> = HashSet::new();

    for comment in &result.comments {
        let already_seen =
            existing_ids.contains(&comment.id) || inserted_this_batch.contains(&comment.id);

        if !already_seen {
            let created_at = parse_github_timestamp(&comment.created_at).unwrap_or(now);

            if let Err(e) = db.insert_pr_comment(
                comment.id,
                result.pr_id,
                &comment.user.login,
                &comment.body,
                &comment.comment_type,
                comment.path.as_deref(),
                comment.line,
                false,
                created_at,
            ) {
                error!(
                    "[GitHub Poller] Failed to insert comment {}: {}",
                    comment.id, e
                );
                persist_result.failed_insert_count += 1;
                persist_result.error_count += 1;
                continue;
            }

            on_new_comment(comment.id);
            persist_result.new_comment_count += 1;
            inserted_this_batch.insert(comment.id);
        }

        // Refresh the GitHub "outdated" state for every fetched comment — new or
        // pre-existing. This never touches the local `addressed` flag, so an
        // addressed comment stays addressed even after it becomes outdated.
        if let Err(e) = db.update_comment_outdated(comment.id, comment.outdated) {
            warn!(
                "[GitHub Poller] Failed to update outdated for comment {}: {}",
                comment.id, e
            );
            persist_result.error_count += 1;
        }
    }

    persist_result
}

pub(super) fn apply_terminal_pr_state(
    db: &Database,
    result: &PollSinglePrResult,
) -> rusqlite::Result<bool> {
    match &result.terminal_state {
        Some(StaleAuthoredPrTerminalState::Closed) => {
            db.update_pr_closed(result.pr_id)?;
            Ok(true)
        }
        Some(StaleAuthoredPrTerminalState::Merged(merged_at)) => {
            db.update_pr_merged_state(result.pr_id, *merged_at)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(Debug)]
struct PrMetadataSnapshot {
    ci_statuses: HashMap<i64, Option<String>>,
    review_statuses: HashMap<i64, Option<String>>,
    mergeability: HashMap<i64, (Option<bool>, Option<String>)>,
}

#[derive(Debug, Default)]
struct PollPersistenceCounts {
    new_comments: usize,
    ci_changes: usize,
    review_changes: usize,
    pr_changes: usize,
    errors: usize,
}

impl PollPersistenceCounts {
    fn absorb(&mut self, other: Self) {
        self.new_comments += other.new_comments;
        self.ci_changes += other.ci_changes;
        self.review_changes += other.review_changes;
        self.pr_changes += other.pr_changes;
        self.errors += other.errors;
    }

    fn into_tuple(self) -> (usize, usize, usize, usize, usize) {
        (
            self.new_comments,
            self.ci_changes,
            self.review_changes,
            self.pr_changes,
            self.errors,
        )
    }
}

pub(super) async fn poll_prs_for_project(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
    configured_github_username: Option<&str>,
    open_prs: Vec<PrRow>,
    changed_pr_numbers: &[i64],
) -> (usize, usize, usize, usize, usize) {
    if open_prs.is_empty() {
        return PollPersistenceCounts::default().into_tuple();
    }

    let metadata = match load_pr_metadata(db, &open_prs) {
        Ok(metadata) => metadata,
        Err(error) => {
            error!("[GitHub Poller] Failed to load PR metadata: {error}");
            return (0, 0, 0, 0, 1);
        }
    };
    let results = poll_project_prs(
        github_client,
        github_token,
        configured_github_username,
        open_prs,
        changed_pr_numbers,
        metadata,
    )
    .await;
    let now = match current_unix_timestamp() {
        Ok(now) => now,
        Err(error) => {
            error!("[GitHub Poller] Failed to read current timestamp: {error}");
            return (0, 0, 0, 0, 1);
        }
    };

    let db_lock = acquire_db(db);
    persist_poll_results(events, &db_lock, results, now).into_tuple()
}

fn load_pr_metadata(
    db: &Mutex<Database>,
    open_prs: &[PrRow],
) -> rusqlite::Result<PrMetadataSnapshot> {
    let metadata = {
        let db_lock = acquire_db(db);
        open_prs
            .iter()
            .map(|pr| {
                Ok(PrMetadata {
                    pr_id: pr.id,
                    ci_status: db_lock.get_pr_ci_status(pr.id)?,
                    review_status: db_lock.get_pr_review_status(pr.id)?,
                    mergeable: pr.mergeable,
                    mergeable_state: pr.mergeable_state.clone(),
                })
            })
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    Ok(PrMetadataSnapshot {
        ci_statuses: metadata
            .iter()
            .map(|metadata| (metadata.pr_id, metadata.ci_status.clone()))
            .collect(),
        review_statuses: metadata
            .iter()
            .map(|metadata| (metadata.pr_id, metadata.review_status.clone()))
            .collect(),
        mergeability: metadata
            .into_iter()
            .map(|metadata| {
                (
                    metadata.pr_id,
                    (metadata.mergeable, metadata.mergeable_state),
                )
            })
            .collect(),
    })
}

async fn poll_project_prs(
    github_client: &GitHubClient,
    github_token: &str,
    configured_github_username: Option<&str>,
    open_prs: Vec<PrRow>,
    changed_pr_numbers: &[i64],
    metadata: PrMetadataSnapshot,
) -> Vec<PollSinglePrResult> {
    let changed_pr_numbers: HashSet<i64> = changed_pr_numbers.iter().copied().collect();
    let futures = open_prs.into_iter().map(|pr| {
        let client = github_client.clone();
        let token = github_token.to_string();
        // Always full-refetch comments (no `since` delta). A comment going
        // outdated does not bump its updated_at, so a delta fetch would never
        // re-read it and its "outdated" state would go stale. ETag conditional
        // requests keep unchanged fetches cheap (304 Not Modified).
        let since: Option<String> = None;
        let old_ci = metadata.ci_statuses.get(&pr.id).cloned().flatten();
        let old_review = metadata.review_statuses.get(&pr.id).cloned().flatten();
        let (old_mergeable, old_mergeable_state) = metadata
            .mergeability
            .get(&pr.id)
            .cloned()
            .unwrap_or((None, None));
        let fetch_comments = should_fetch_comments_for_pr(pr.pr_number, &changed_pr_numbers);
        let configured_github_username = configured_github_username.map(ToOwned::to_owned);
        poll_single_pr(
            client,
            token,
            configured_github_username,
            pr,
            since,
            old_ci,
            old_review,
            old_mergeable,
            old_mergeable_state,
            fetch_comments,
        )
    });

    join_all(futures).await
}

fn current_unix_timestamp() -> Result<i64, String> {
    crate::unix_timestamp::seconds(std::time::SystemTime::now()).map_err(|error| match error {
        crate::unix_timestamp::UnixTimestampError::BeforeEpoch(error) => {
            format!("system clock predates Unix epoch: {error}")
        }
        crate::unix_timestamp::UnixTimestampError::OutOfRange(_) => {
            "unix timestamp exceeds supported range".to_string()
        }
    })
}

fn persist_poll_results(
    events: &GitHubEventTarget,
    db: &Database,
    results: Vec<PollSinglePrResult>,
    now: i64,
) -> PollPersistenceCounts {
    let mut counts = PollPersistenceCounts::default();
    for result in results {
        counts.absorb(persist_poll_result(events, db, &result, now));
    }
    counts
}

fn persist_poll_result(
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    now: i64,
) -> PollPersistenceCounts {
    let mut counts = PollPersistenceCounts::default();
    if let Some(error) = &result.error {
        error!(
            "[GitHub Poller] Failed to poll PR #{}: {}",
            result.pr_id, error
        );
        counts.errors += 1;
        return counts;
    }

    let project_id = match project_id_for_task(db, &result.ticket_id) {
        Ok(project_id) => project_id,
        Err(error) => {
            warn!(
                "[GitHub Poller] Failed to resolve Project for Task {}: {}",
                result.ticket_id, error
            );
            counts.errors += 1;
            None
        }
    };
    let comments = match persist_comments_and_publish_new(events, db, result, now) {
        Ok(comments) => comments,
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to get existing comment IDs for PR #{}: {}",
                result.pr_id, error
            );
            counts.errors += 1;
            return counts;
        }
    };

    counts.new_comments += comments.new_comment_count;
    counts.errors += comments.error_count;
    counts.absorb(persist_ci_and_publish_change(
        events,
        db,
        result,
        project_id.as_deref(),
        now,
    ));
    counts.absorb(persist_review_and_publish_change(
        events,
        db,
        result,
        project_id.as_deref(),
        now,
    ));
    counts.errors += persist_pr_snapshot(db, result);
    counts.errors += reconcile_poll_readiness(db, result, comments.new_comment_count, now);
    counts.absorb(persist_terminal_change(db, result));

    emit_task_invalidation(events, result, project_id.as_deref());
    counts.errors += record_last_polled(db, result.pr_id, now);
    counts
}

fn persist_comments_and_publish_new(
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    now: i64,
) -> rusqlite::Result<PersistCommentsResult> {
    let existing_ids = db.get_existing_comment_ids(result.pr_id)?;
    Ok(persist_polled_comments(
        db,
        result,
        &existing_ids,
        now,
        |comment_id| {
            emit_new_pr_comment(events, &result.ticket_id, comment_id);
        },
    ))
}

fn persist_ci_and_publish_change(
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    project_id: Option<&str>,
    now: i64,
) -> PollPersistenceCounts {
    let mut counts = PollPersistenceCounts::default();
    match persist_ci_status(db, result) {
        Ok(Some(status)) => {
            emit_ci_status_changed(
                events,
                &result.ticket_id,
                project_id,
                result.pr_id,
                &result.pr_title,
                &status,
                now,
            );
            counts.ci_changes += 1;
        }
        Ok(None) => {}
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to update CI status for PR #{}: {}",
                result.pr_id, error
            );
            counts.errors += 1;
        }
    }
    counts
}

fn persist_review_and_publish_change(
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    project_id: Option<&str>,
    now: i64,
) -> PollPersistenceCounts {
    let mut counts = PollPersistenceCounts::default();
    match persist_review_status(db, result) {
        Ok(Some(status)) => {
            emit_review_status_changed(
                events,
                &result.ticket_id,
                project_id,
                result.pr_id,
                &result.pr_title,
                &status,
                now,
            );
            counts.review_changes += 1;
        }
        Ok(None) => {}
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to update review status for PR #{}: {}",
                result.pr_id, error
            );
            counts.errors += 1;
        }
    }
    counts
}

fn reconcile_poll_readiness(
    db: &Database,
    result: &PollSinglePrResult,
    new_comment_count: usize,
    now: i64,
) -> usize {
    match persist_readiness(db, result, new_comment_count, now) {
        Ok(()) => 0,
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to update merge readiness for PR #{}: {}",
                result.pr_id, error
            );
            1
        }
    }
}

fn persist_terminal_change(db: &Database, result: &PollSinglePrResult) -> PollPersistenceCounts {
    let mut counts = PollPersistenceCounts::default();
    match apply_terminal_pr_state(db, result) {
        Ok(true) => counts.pr_changes += 1,
        Ok(false) => {}
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to update terminal state for PR #{}: {}",
                result.pr_id, error
            );
            counts.errors += 1;
        }
    }
    counts
}

fn record_last_polled(db: &Database, pr_id: i64, now: i64) -> usize {
    match db.set_pr_last_polled(pr_id, now) {
        Ok(()) => 0,
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to set last_polled_at for PR #{}: {}",
                pr_id, error
            );
            1
        }
    }
}

fn project_id_for_task(db: &Database, task_id: &str) -> rusqlite::Result<Option<String>> {
    Ok(db.get_task(task_id)?.and_then(|task| task.project_id))
}

fn persist_ci_status(
    db: &Database,
    result: &PollSinglePrResult,
) -> rusqlite::Result<Option<String>> {
    let Some(payload) = ci_persistence_payload(result) else {
        return Ok(None);
    };
    db.update_pr_ci_status(
        payload.pr_id,
        &payload.head_sha,
        &payload.status,
        &payload.check_runs_json,
    )?;
    Ok(payload.status_changed.then_some(payload.status))
}

fn persist_review_status(
    db: &Database,
    result: &PollSinglePrResult,
) -> rusqlite::Result<Option<String>> {
    let Some(reviews) = &result.reviews else {
        return Ok(None);
    };
    let status = aggregate_review_status(
        reviews,
        result.has_requested_reviewers,
        result.required_approving_count,
    );
    db.update_pr_review_status(result.pr_id, &status)?;
    let changed = result.old_review_status.as_deref() != Some(status.as_str());
    Ok(changed.then_some(status))
}

fn persist_pr_snapshot(db: &Database, result: &PollSinglePrResult) -> usize {
    let mut errors = 0;
    if let Some(github_node_id) = result.github_node_id.as_deref() {
        errors += log_pr_update_error(
            result.pr_id,
            "update GitHub node id",
            db.update_pr_github_node_id(result.pr_id, github_node_id),
        );
    }

    let allowed_merge_methods =
        serde_json::to_string(&result.allowed_merge_methods).unwrap_or_else(|_| "[]".to_string());
    errors += log_pr_update_error(
        result.pr_id,
        "update merge method policy",
        db.update_pr_merge_method_policy(
            result.pr_id,
            result.merge_methods_policy_known,
            &allowed_merge_methods,
            result.default_merge_method.map(|method| method.as_str()),
        ),
    );
    errors += log_pr_update_error(
        result.pr_id,
        "update is_queued",
        db.update_pr_is_queued(result.pr_id, result.is_queued),
    );
    errors += log_pr_update_error(
        result.pr_id,
        "update mergeability",
        db.update_pr_mergeability(
            result.pr_id,
            result.mergeable,
            result.mergeable_state.as_deref(),
        ),
    );
    errors
}

fn log_pr_update_error(pr_id: i64, operation: &str, result: rusqlite::Result<()>) -> usize {
    match result {
        Ok(()) => 0,
        Err(error) => {
            error!(
                "[GitHub Poller] Failed to {} for PR #{}: {}",
                operation, pr_id, error
            );
            1
        }
    }
}

fn persist_readiness(
    db: &Database,
    result: &PollSinglePrResult,
    new_comment_count: usize,
    now: i64,
) -> rusqlite::Result<()> {
    let readiness_facts = finalize_readiness_facts_for_poll(
        result.readiness_facts.clone(),
        None,
        &result.head_sha,
        result.is_queued,
        false,
        new_comment_count,
        now,
    );
    db.update_pr_merge_readiness(result.pr_id, &readiness_facts)
}

fn emit_task_invalidation(
    events: &GitHubEventTarget,
    result: &PollSinglePrResult,
    project_id: Option<&str>,
) {
    let Some(project_id) = project_id else {
        return;
    };
    emit_task_updated(events, &result.ticket_id, project_id);
}

pub(super) fn ci_persistence_payload(result: &PollSinglePrResult) -> Option<CiPersistencePayload> {
    let (Some(check_runs), Some(combined_status)) = (&result.check_runs, &result.combined_status)
    else {
        return None;
    };

    let check_runs = deduplicate_check_runs(check_runs);
    let (display_runs, status) = if result.required_check_names.is_empty() {
        (
            check_runs.check_runs.clone(),
            aggregate_ci_status(&check_runs, combined_status),
        )
    } else {
        let (filtered_runs, filtered_combined) =
            filter_to_required(&check_runs, combined_status, &result.required_check_names);
        let status = if filtered_runs.check_runs.is_empty() && filtered_combined.statuses.is_empty()
        {
            "pending".to_string()
        } else {
            aggregate_ci_status(&filtered_runs, &filtered_combined)
        };
        (filtered_runs.check_runs, status)
    };
    let check_runs_json = serde_json::to_string(&display_runs).unwrap_or_else(|_| "[]".to_string());
    let status_changed = result.old_ci_status.as_deref() != Some(status.as_str());

    Some(CiPersistencePayload {
        pr_id: result.pr_id,
        head_sha: result.head_sha.clone(),
        ci_validation_sha: result.ci_validation_sha.clone(),
        status,
        check_runs_json,
        status_changed,
    })
}
