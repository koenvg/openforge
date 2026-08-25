use super::common::{parse_github_timestamp, GitHubEventTarget};
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
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    existing_ids: &HashSet<i64>,
    now: i64,
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

            if let Err(e) = events.emit(
                "new-pr-comment",
                serde_json::json!({
                    "ticket_id": result.ticket_id,
                    "comment_id": comment.id
                }),
            ) {
                warn!("[GitHub Poller] Failed to emit new-pr-comment event: {}", e);
            }

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
        return (0, 0, 0, 0, 0);
    }

    let pr_metadata = {
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
            .collect::<rusqlite::Result<Vec<PrMetadata>>>()
    };
    let pr_metadata = match pr_metadata {
        Ok(metadata) => metadata,
        Err(e) => {
            error!("[GitHub Poller] Failed to load PR metadata: {e}");
            return (0, 0, 0, 0, 1);
        }
    };

    let old_ci_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|metadata| (metadata.pr_id, metadata.ci_status.clone()))
        .collect();

    let old_review_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|metadata| (metadata.pr_id, metadata.review_status.clone()))
        .collect();

    let old_mergeability_map: HashMap<i64, (Option<bool>, Option<String>)> = pr_metadata
        .into_iter()
        .map(|metadata| {
            (
                metadata.pr_id,
                (metadata.mergeable, metadata.mergeable_state),
            )
        })
        .collect();

    let changed_pr_numbers: HashSet<i64> = changed_pr_numbers.iter().copied().collect();

    let futures: Vec<_> = open_prs
        .into_iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            // Always full-refetch comments (no `since` delta). A comment going
            // outdated does not bump its updated_at, so a delta fetch would never
            // re-read it and its "outdated" state would go stale. ETag conditional
            // requests keep unchanged fetches cheap (304 Not Modified).
            let since: Option<String> = None;
            let old_ci = old_ci_map.get(&pr.id).cloned().flatten();
            let old_review = old_review_map.get(&pr.id).cloned().flatten();
            let (old_mergeable, old_mergeable_state) = old_mergeability_map
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
        })
        .collect();

    let results = join_all(futures).await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut new_comment_count = 0;
    let mut ci_change_count = 0;
    let mut review_change_count = 0;
    let mut pr_change_count = 0;
    let mut error_count = 0;

    let db_lock = acquire_db(db);

    for result in results {
        if let Some(err) = &result.error {
            error!(
                "[GitHub Poller] Failed to poll PR #{}: {}",
                result.pr_id, err
            );
            error_count += 1;
            continue;
        }

        let project_id = match db_lock.get_task(&result.ticket_id) {
            Ok(Some(task)) => task.project_id,
            Ok(None) => None,
            Err(error) => {
                warn!(
                    "[GitHub Poller] Failed to resolve Project for Task {}: {}",
                    result.ticket_id, error
                );
                error_count += 1;
                None
            }
        };
        let existing_ids = match db_lock.get_existing_comment_ids(result.pr_id) {
            Ok(ids) => ids,
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to get existing comment IDs for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
                continue;
            }
        };

        let persist_result = persist_polled_comments(events, &db_lock, &result, &existing_ids, now);
        new_comment_count += persist_result.new_comment_count;
        error_count += persist_result.error_count;

        if let Some(ci_payload) = ci_persistence_payload(&result) {
            if let Err(e) = db_lock.update_pr_ci_status(
                ci_payload.pr_id,
                &ci_payload.head_sha,
                &ci_payload.status,
                &ci_payload.check_runs_json,
            ) {
                error!(
                    "[GitHub Poller] Failed to update CI status for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
            } else if ci_payload.status_changed {
                if let Err(e) = events.emit(
                    "ci-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "project_id": project_id.as_deref(),
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "ci_status": ci_payload.status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit ci-status-changed event: {}",
                        e
                    );
                }
                ci_change_count += 1;
            }
        }

        if let Some(reviews) = &result.reviews {
            let review_status = aggregate_review_status(
                reviews,
                result.has_requested_reviewers,
                result.required_approving_count,
            );
            if let Err(e) = db_lock.update_pr_review_status(result.pr_id, &review_status) {
                error!(
                    "[GitHub Poller] Failed to update review status for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
            } else if result.old_review_status.as_deref() != Some(review_status.as_str()) {
                if let Err(e) = events.emit(
                    "review-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "project_id": project_id.as_deref(),
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "review_status": review_status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit review-status-changed event: {}",
                        e
                    );
                }
                review_change_count += 1;
            }
        }

        if let Some(github_node_id) = result.github_node_id.as_deref() {
            if let Err(e) = db_lock.update_pr_github_node_id(result.pr_id, github_node_id) {
                error!(
                    "[GitHub Poller] Failed to update GitHub node id for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
            }
        }
        let allowed_merge_methods = serde_json::to_string(&result.allowed_merge_methods)
            .unwrap_or_else(|_| "[]".to_string());
        if let Err(e) = db_lock.update_pr_merge_method_policy(
            result.pr_id,
            result.merge_methods_policy_known,
            &allowed_merge_methods,
            result.default_merge_method.map(|method| method.as_str()),
        ) {
            error!(
                "[GitHub Poller] Failed to update merge method policy for PR #{}: {}",
                result.pr_id, e
            );
            error_count += 1;
        }

        if let Err(e) = db_lock.update_pr_is_queued(result.pr_id, result.is_queued) {
            error!(
                "[GitHub Poller] Failed to update is_queued for PR #{}: {}",
                result.pr_id, e
            );
            error_count += 1;
        }

        if let Err(e) = db_lock.update_pr_mergeability(
            result.pr_id,
            result.mergeable,
            result.mergeable_state.as_deref(),
        ) {
            error!(
                "[GitHub Poller] Failed to update mergeability for PR #{}: {}",
                result.pr_id, e
            );
            error_count += 1;
        }

        let readiness_facts = finalize_readiness_facts_for_poll(
            result.readiness_facts.clone(),
            None,
            &result.head_sha,
            result.is_queued,
            false,
            persist_result.new_comment_count,
            now,
        );
        if let Err(e) = db_lock.update_pr_merge_readiness(result.pr_id, &readiness_facts) {
            error!(
                "[GitHub Poller] Failed to update merge readiness for PR #{}: {}",
                result.pr_id, e
            );
            error_count += 1;
        }

        match apply_terminal_pr_state(&db_lock, &result) {
            Ok(true) => pr_change_count += 1,
            Ok(false) => {}
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to update terminal state for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
            }
        }

        if let Some(project_id) = project_id.as_deref() {
            if let Err(error) = emit_task_updated(events, &result.ticket_id, project_id) {
                warn!(
                    "[GitHub Poller] Failed to emit Task Board invalidation for Task {}: {}",
                    result.ticket_id, error
                );
            }
        }
        if let Err(e) = db_lock.set_pr_last_polled(result.pr_id, now) {
            error!(
                "[GitHub Poller] Failed to set last_polled_at for PR #{}: {}",
                result.pr_id, e
            );
            error_count += 1;
        }
    }

    drop(db_lock);

    (
        new_comment_count,
        ci_change_count,
        review_change_count,
        pr_change_count,
        error_count,
    )
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
