use super::common::{parse_github_timestamp, GitHubEventTarget};
use super::pr_execution::{poll_single_pr, should_fetch_comments_for_pr, PollSinglePrResult};
use crate::db::{finalize_readiness_facts_for_poll, Database, PrRow};
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
    let db_lock = db.lock().unwrap();
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
        if existing_ids.contains(&comment.id) || inserted_this_batch.contains(&comment.id) {
            continue;
        }

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

    persist_result
}

pub(super) async fn poll_prs_for_project(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
    configured_github_username: Option<&str>,
    open_prs: Vec<PrRow>,
    changed_pr_numbers: &[i64],
) -> (usize, usize, usize, usize) {
    if open_prs.is_empty() {
        return (0, 0, 0, 0);
    }

    type PrMetadata = (
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
    );
    let pr_metadata: Vec<PrMetadata> = {
        let db_lock = db.lock().unwrap();
        open_prs
            .iter()
            .map(|pr| {
                let last_polled = db_lock.get_pr_last_polled(pr.id).ok().flatten();
                let old_ci = db_lock.get_pr_ci_status(pr.id).ok().flatten();
                let old_review = db_lock.get_pr_review_status(pr.id).ok().flatten();
                (
                    pr.id,
                    last_polled,
                    old_ci,
                    old_review,
                    pr.mergeable,
                    pr.mergeable_state.clone(),
                )
            })
            .collect()
    };

    let since_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, last_polled, _, _, _, _)| {
            let since = last_polled.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });
            (*pr_id, since)
        })
        .collect();

    let old_ci_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, old_ci, _, _, _)| (*pr_id, old_ci.clone()))
        .collect();

    let old_review_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, _, old_review, _, _)| (*pr_id, old_review.clone()))
        .collect();

    let old_mergeability_map: HashMap<i64, (Option<bool>, Option<String>)> = pr_metadata
        .into_iter()
        .map(|(pr_id, _, _, _, old_mergeable, old_mergeable_state)| {
            (pr_id, (old_mergeable, old_mergeable_state))
        })
        .collect();

    let changed_pr_numbers: HashSet<i64> = changed_pr_numbers.iter().copied().collect();

    let futures: Vec<_> = open_prs
        .into_iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            let since = since_map.get(&pr.id).cloned().flatten();
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
    let mut error_count = 0;

    let db_lock = db.lock().unwrap();

    for result in results {
        if let Some(err) = &result.error {
            error!(
                "[GitHub Poller] Failed to poll PR #{}: {}",
                result.pr_id, err
            );
            error_count += 1;
            continue;
        }

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
            } else if ci_payload.status_changed {
                if let Err(e) = events.emit(
                    "ci-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
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
            } else if result.old_review_status.as_deref() != Some(review_status.as_str()) {
                if let Err(e) = events.emit(
                    "review-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
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

        if let Err(e) = db_lock.update_pr_is_queued(result.pr_id, result.is_queued) {
            error!(
                "[GitHub Poller] Failed to update is_queued for PR #{}: {}",
                result.pr_id, e
            );
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
        }

        let readiness_facts = finalize_readiness_facts_for_poll(
            result.readiness_facts,
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
        }

        if let Err(e) = db_lock.set_pr_last_polled(result.pr_id, now) {
            error!(
                "[GitHub Poller] Failed to set last_polled_at for PR #{}: {}",
                result.pr_id, e
            );
        }
    }

    drop(db_lock);

    (
        new_comment_count,
        ci_change_count,
        review_change_count,
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
