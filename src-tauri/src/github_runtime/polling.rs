use crate::authored_pr_sync::{
    enrich_and_persist_authored_prs, AuthoredPrEnrichmentPolicy, AuthoredPrStalePolicy,
};
use crate::{db, github_client::GitHubClient};
use futures::future::join_all;
use log::error;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::github_client::{
    dedupe_pr_refs, extract_authored_pr_refs_from_user_events, PrRef, SearchPrResult,
};

use super::auth::{github_token, github_username};

const AUTHORED_PRS_RECONCILE_INTERVAL_SECS: i64 = 300;

pub fn get_review_prs(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::ReviewPrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {e}"))
}

pub fn mark_review_pr_viewed(
    db: &Arc<Mutex<db::Database>>,
    pr_id: i64,
    head_sha: &str,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .mark_review_pr_viewed(pr_id, head_sha)
        .map_err(|e| format!("Failed to mark review PR viewed: {e}"))
}

pub fn mark_review_pr_unviewed(db: &Arc<Mutex<db::Database>>, pr_id: i64) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .mark_review_pr_unviewed(pr_id)
        .map_err(|e| format!("Failed to mark review PR unviewed: {e}"))
}

pub fn get_authored_prs(db: &Arc<Mutex<db::Database>>) -> Result<Vec<db::AuthoredPrRow>, String> {
    let db_lock = crate::db::acquire_db(db);
    db_lock
        .get_all_authored_prs()
        .map_err(|e| format!("Failed to get authored PRs: {e}"))
}

pub async fn fetch_review_prs(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let username = github_username(db, github_client).await?;
    let token = github_token().await?;

    let (prs, all_search_ids) = github_client
        .search_review_requested_prs(&username, &token)
        .await
        .map_err(|e| format!("Failed to search review PRs: {e}"))?;

    {
        let db_lock = crate::db::acquire_db(db);
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
                .map_err(|e| format!("Failed to upsert review PR: {e}"))?;
            db_lock
                .update_review_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                .map_err(|e| format!("Failed to update review PR mergeability: {e}"))?;
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            db_lock
                .delete_stale_review_prs(&all_search_ids)
                .map_err(|e| format!("Failed to delete stale review PRs: {e}"))?;
        }
    }

    get_review_prs(db)
}

fn should_fallback_to_search(
    existing_rows: usize,
    event_refs: usize,
    uncovered_event_refs: usize,
    last_reconciled_at: Option<i64>,
    now: i64,
) -> bool {
    existing_rows == 0
        || event_refs == 0
        || uncovered_event_refs > 0
        || last_reconciled_at
            .map(|ts| now.saturating_sub(ts) >= AUTHORED_PRS_RECONCILE_INTERVAL_SECS)
            .unwrap_or(true)
}

fn key_for_pr_ref(pr_ref: &PrRef) -> String {
    format!(
        "{}/{}/{}",
        pr_ref.repo_owner, pr_ref.repo_name, pr_ref.number
    )
}

fn key_for_row(row: &db::AuthoredPrRow) -> String {
    format!("{}/{}/{}", row.repo_owner, row.repo_name, row.number)
}

fn covered_event_signal_refs<'a>(
    event_refs: &'a [PrRef],
    existing_id_by_ref: &HashMap<String, i64>,
) -> Vec<(&'a PrRef, i64)> {
    event_refs
        .iter()
        .filter_map(|pr_ref| {
            existing_id_by_ref
                .get(&key_for_pr_ref(pr_ref))
                .copied()
                .map(|id| (pr_ref, id))
        })
        .collect()
}

async fn fetch_event_signal_prs(
    github_client: &GitHubClient,
    token: &str,
    event_refs: &[PrRef],
    existing_id_by_ref: &HashMap<String, i64>,
) -> Vec<SearchPrResult> {
    let signal_refs = covered_event_signal_refs(event_refs, existing_id_by_ref);
    let fetch_futures: Vec<_> = signal_refs
        .iter()
        .map(|(pr_ref, _)| {
            github_client.get_pr_details(
                &pr_ref.repo_owner,
                &pr_ref.repo_name,
                pr_ref.number,
                token,
            )
        })
        .collect();

    let fetch_results = join_all(fetch_futures).await;

    let mut results = Vec::new();
    for ((pr_ref, existing_id), detail_result) in signal_refs.into_iter().zip(fetch_results) {
        match detail_result {
            Ok(pr_details) => {
                results.push(SearchPrResult {
                    id: existing_id,
                    number: pr_details.number,
                    title: pr_details.title,
                    body: pr_details
                        .extra
                        .get("body")
                        .and_then(|body| body.as_str())
                        .map(ToOwned::to_owned),
                    state: pr_details.state,
                    draft: pr_details.draft.unwrap_or(false),
                    html_url: pr_details.html_url,
                    user_login: pr_details.user.login,
                    user_avatar_url: pr_details
                        .user
                        .extra
                        .get("avatar_url")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    repo_owner: pr_ref.repo_owner.clone(),
                    repo_name: pr_ref.repo_name.clone(),
                    head_ref: pr_details.head.ref_name,
                    base_ref: pr_details
                        .extra
                        .get("base")
                        .and_then(|base| base.get("ref"))
                        .and_then(|ref_name| ref_name.as_str())
                        .unwrap_or("main")
                        .to_string(),
                    head_sha: pr_details.head.sha,
                    additions: pr_details
                        .extra
                        .get("additions")
                        .and_then(|additions| additions.as_i64())
                        .unwrap_or(0),
                    deletions: pr_details
                        .extra
                        .get("deletions")
                        .and_then(|deletions| deletions.as_i64())
                        .unwrap_or(0),
                    changed_files: pr_details
                        .extra
                        .get("changed_files")
                        .and_then(|changed_files| changed_files.as_i64())
                        .unwrap_or(0),
                    mergeable: pr_details.mergeable,
                    mergeable_state: pr_details.mergeable_state,
                    created_at: pr_details
                        .extra
                        .get("created_at")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    updated_at: pr_details
                        .extra
                        .get("updated_at")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    labels: pr_details
                        .extra
                        .get("labels")
                        .and_then(|value| {
                            serde_json::from_value::<Vec<crate::github_client::PrLabel>>(
                                value.clone(),
                            )
                            .ok()
                        })
                        .unwrap_or_default(),
                });
            }
            Err(e) => {
                error!(
                    "[authored_prs] Failed to fetch PR details pr_number={} detail_suppressed=true: {}",
                    pr_ref.number, e
                );
            }
        }
    }

    results
}

pub async fn fetch_authored_prs(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    let username = github_username(db, github_client).await?;
    let token = github_token().await?;

    let existing_rows = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_all_authored_prs()
            .map_err(|e| format!("Failed to read authored PR cache: {e}"))?
    };

    let last_reconciled_at = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_config("authored_prs_last_reconciled_at")
            .map_err(|e| format!("Failed to read authored PR reconcile timestamp: {e}"))?
            .and_then(|value| value.parse::<i64>().ok())
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read current time: {e}"))?
        .as_secs() as i64;

    let existing_id_by_ref: HashMap<String, i64> = existing_rows
        .iter()
        .map(|row| (key_for_row(row), row.id))
        .collect();

    let user_events = github_client
        .list_user_events(&username, &token)
        .await
        .unwrap_or_else(|e| {
            error!(
                "[authored_prs] Failed to fetch user events username_suppressed=true: {}",
                e
            );
            Vec::new()
        });

    let event_refs = dedupe_pr_refs(extract_authored_pr_refs_from_user_events(
        &user_events,
        &username,
    ));

    let uncovered_event_refs = event_refs
        .iter()
        .filter(|pr_ref| !existing_id_by_ref.contains_key(&key_for_pr_ref(pr_ref)))
        .count();

    let should_run_search = should_fallback_to_search(
        existing_rows.len(),
        event_refs.len(),
        uncovered_event_refs,
        last_reconciled_at,
        now,
    );

    let (prs, all_search_ids, can_delete_stale) = if should_run_search {
        let (search_prs, search_ids) =
            github_client
                .search_authored_prs(&username, &token)
                .await
                .map_err(|e| format!("Failed to search authored PRs: {e}"))?;
        (search_prs, search_ids, true)
    } else {
        let event_signal_prs =
            fetch_event_signal_prs(github_client, &token, &event_refs, &existing_id_by_ref).await;
        (event_signal_prs, Vec::new(), false)
    };

    let stale_policy = if can_delete_stale && (!all_search_ids.is_empty() || prs.is_empty()) {
        AuthoredPrStalePolicy::DeleteMissing(&all_search_ids)
    } else {
        AuthoredPrStalePolicy::Preserve
    };
    let outcome = enrich_and_persist_authored_prs(
        github_client,
        db,
        &token,
        prs,
        AuthoredPrEnrichmentPolicy::BestEffort,
        stale_policy,
    )
    .await
    .map_err(|error| error.to_string())?;

    if outcome.stale_reconciled {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .set_config("authored_prs_last_reconciled_at", &now.to_string())
            .map_err(|e| format!("Failed to persist authored PR reconcile timestamp: {e}"))?;
    }

    get_authored_prs(db)
}

#[cfg(test)]
mod tests {
    use super::{covered_event_signal_refs, should_fallback_to_search};
    use crate::github_client::PrRef;
    use std::collections::HashMap;

    fn pr_ref(repo_owner: &str, repo_name: &str, number: i64) -> PrRef {
        PrRef {
            repo_owner: repo_owner.to_string(),
            repo_name: repo_name.to_string(),
            number,
        }
    }

    #[test]
    fn selects_only_event_refs_covered_by_the_authored_pr_cache() {
        let event_refs = vec![
            pr_ref("acme", "api", 11),
            pr_ref("acme", "web", 22),
            pr_ref("other", "cli", 33),
        ];
        let existing_id_by_ref = HashMap::from([
            ("acme/api/11".to_string(), 101),
            ("other/cli/33".to_string(), 303),
        ]);

        let covered_refs = covered_event_signal_refs(&event_refs, &existing_id_by_ref);

        assert_eq!(covered_refs.len(), 2);
        assert_eq!(covered_refs[0].0.number, 11);
        assert_eq!(covered_refs[0].1, 101);
        assert_eq!(covered_refs[1].0.number, 33);
        assert_eq!(covered_refs[1].1, 303);
    }

    #[test]
    fn falls_back_to_authored_search_when_events_include_an_uncached_pr() {
        assert!(should_fallback_to_search(4, 3, 1, Some(100), 120));
    }

    #[test]
    fn falls_back_to_authored_search_when_db_is_empty() {
        assert!(should_fallback_to_search(0, 2, 0, Some(100), 120));
    }

    #[test]
    fn skips_authored_search_when_recent_events_cover_existing_cache() {
        assert!(!should_fallback_to_search(4, 2, 0, Some(100), 120));
    }

    #[test]
    fn falls_back_to_authored_search_when_reconciliation_is_stale() {
        assert!(should_fallback_to_search(4, 2, 0, Some(100), 401));
    }
}
