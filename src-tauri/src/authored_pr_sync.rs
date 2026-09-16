use crate::db::{acquire_db, Database};
use crate::github_client::{
    CiSignal, GitHubClient, GitHubError, GitHubReadinessSnapshot, PrReview, PullRequest,
    SearchPrResult,
};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthoredPrEnrichmentPolicy {
    RequireComplete,
    BestEffort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthoredPrStalePolicy<'a> {
    Preserve,
    DeleteMissing(&'a [i64]),
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AuthoredPrSyncError {
    #[error("{0}")]
    GitHub(#[from] GitHubError),
    #[error("{0}")]
    Db(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AuthoredPrSyncOutcome {
    pub(crate) stale_reconciled: bool,
}

struct EnrichedAuthoredPr {
    pr: SearchPrResult,
    created_at: i64,
    ci_status: Option<String>,
    ci_check_runs: Option<String>,
    review_status: Option<String>,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    is_queued: bool,
}

impl EnrichedAuthoredPr {
    fn from_search_result(pr: SearchPrResult) -> Self {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let mergeable = pr.mergeable;
        let mergeable_state = pr.mergeable_state.clone();

        Self {
            pr,
            created_at,
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable,
            mergeable_state,
            is_queued: false,
        }
    }
}

fn aggregate_ci(signal: CiSignal, enriched: &mut EnrichedAuthoredPr) {
    enriched.ci_status = Some(signal.status);
    enriched.ci_check_runs = Some(
        serde_json::to_string(&signal.check_runs.check_runs).unwrap_or_else(|_| "[]".to_string()),
    );
}

fn aggregate_reviews(reviews: Vec<PrReview>, enriched: &mut EnrichedAuthoredPr) {
    enriched.review_status = Some(crate::github_client::aggregate_review_status(
        &reviews, false, None,
    ));
}

fn aggregate_details(
    details: PullRequest,
    policy: AuthoredPrEnrichmentPolicy,
    enriched: &mut EnrichedAuthoredPr,
) {
    enriched.is_queued = details
        .extra
        .get("merge_queue_entry")
        .map(|value| !value.is_null())
        .unwrap_or(false);
    if policy == AuthoredPrEnrichmentPolicy::RequireComplete {
        enriched.mergeable = details.mergeable;
        enriched.mergeable_state = details.mergeable_state;
    }
}

/// A PR is enqueued when GitHub's GraphQL readiness snapshot reports a
/// `mergeQueueEntry.state`. This is the only reliable queue signal: the REST pull
/// object never carries `merge_queue_entry`, so REST-only enrichment always reads
/// `is_queued = false` and a queued PR renders as "Ready to Merge". Mirrors the
/// task-linked PR path (`github_poller::pr_execution`).
fn is_queued_from_readiness(snapshot: Option<&GitHubReadinessSnapshot>) -> bool {
    snapshot
        .and_then(|snapshot| snapshot.merge_queue_state.as_deref())
        .is_some()
}

fn aggregate_authored_pr_enrichment(
    pr: SearchPrResult,
    ci_signal_result: Result<CiSignal, GitHubError>,
    reviews_result: Result<Vec<PrReview>, GitHubError>,
    details_result: Result<PullRequest, GitHubError>,
    readiness_result: Result<GitHubReadinessSnapshot, GitHubError>,
    policy: AuthoredPrEnrichmentPolicy,
) -> Result<EnrichedAuthoredPr, AuthoredPrSyncError> {
    let mut enriched = EnrichedAuthoredPr::from_search_result(pr);

    match policy {
        AuthoredPrEnrichmentPolicy::RequireComplete => {
            aggregate_ci(ci_signal_result?, &mut enriched);
            aggregate_reviews(reviews_result?, &mut enriched);
            aggregate_details(details_result?, policy, &mut enriched);
        }
        AuthoredPrEnrichmentPolicy::BestEffort => {
            if let Ok(ci_signal) = ci_signal_result {
                aggregate_ci(ci_signal, &mut enriched);
            }
            if let Ok(reviews) = reviews_result {
                aggregate_reviews(reviews, &mut enriched);
            }
            if let Ok(details) = details_result {
                aggregate_details(details, policy, &mut enriched);
            }
        }
    }

    // GraphQL is the authoritative queue signal; keep the REST fallback set above
    // when the snapshot is unavailable. Best-effort in both policies so a GraphQL
    // outage never fails the whole authored-PR sync.
    if is_queued_from_readiness(readiness_result.as_ref().ok()) {
        enriched.is_queued = true;
    }

    Ok(enriched)
}

async fn enrich_authored_pr(
    github_client: &GitHubClient,
    github_token: &str,
    pr: SearchPrResult,
    policy: AuthoredPrEnrichmentPolicy,
) -> Result<EnrichedAuthoredPr, AuthoredPrSyncError> {
    let (ci_signal, reviews, details, readiness) = tokio::join!(
        github_client.get_ci_signal(&pr.repo_owner, &pr.repo_name, &pr.head_sha, github_token),
        github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, github_token),
        github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, github_token),
        github_client.get_pr_readiness_snapshot(
            &pr.repo_owner,
            &pr.repo_name,
            pr.number,
            github_token
        )
    );

    aggregate_authored_pr_enrichment(pr, ci_signal, reviews, details, readiness, policy)
}

fn persist_authored_prs(
    db: &Database,
    enriched_prs: &[EnrichedAuthoredPr],
    stale_policy: AuthoredPrStalePolicy<'_>,
) -> Result<AuthoredPrSyncOutcome, AuthoredPrSyncError> {
    for enriched in enriched_prs {
        let pr = &enriched.pr;
        let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let task_id = db.get_task_id_for_pr(pr.id).map_err(|error| {
            AuthoredPrSyncError::Db(format!("Failed to get Task ID for PR: {error}"))
        })?;

        db.upsert_authored_pr(
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
            enriched.ci_status.as_deref(),
            enriched.ci_check_runs.as_deref(),
            enriched.review_status.as_deref(),
            enriched.is_queued,
            task_id.as_deref(),
            &pr.labels,
            enriched.created_at,
            updated_at,
        )
        .map_err(|error| {
            AuthoredPrSyncError::Db(format!("Failed to upsert authored PR: {error}"))
        })?;
        db.update_authored_pr_mergeability(
            pr.id,
            enriched.mergeable,
            enriched.mergeable_state.as_deref(),
        )
        .map_err(|error| {
            AuthoredPrSyncError::Db(format!(
                "Failed to update authored PR mergeability: {error}"
            ))
        })?;
    }

    let stale_reconciled = match stale_policy {
        AuthoredPrStalePolicy::Preserve => false,
        AuthoredPrStalePolicy::DeleteMissing(current_ids) => {
            db.delete_stale_authored_prs(current_ids).map_err(|error| {
                AuthoredPrSyncError::Db(format!("Failed to delete stale authored PRs: {error}"))
            })?;
            true
        }
    };

    Ok(AuthoredPrSyncOutcome { stale_reconciled })
}

pub(crate) async fn enrich_and_persist_authored_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
    prs: Vec<SearchPrResult>,
    enrichment_policy: AuthoredPrEnrichmentPolicy,
    stale_policy: AuthoredPrStalePolicy<'_>,
) -> Result<AuthoredPrSyncOutcome, AuthoredPrSyncError> {
    let mut enriched_prs = Vec::with_capacity(prs.len());
    for pr in prs {
        enriched_prs
            .push(enrich_authored_pr(github_client, github_token, pr, enrichment_policy).await?);
    }

    let db = acquire_db(db);
    persist_authored_prs(&db, &enriched_prs, stale_policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;
    use crate::github_client::{
        CheckRun, CheckRunsResponse, CombinedStatusResponse, GitHubError, GitHubHead, GitHubUser,
        PrReview, PullRequest, SearchPrResult,
    };

    fn search_pr(id: i64) -> SearchPrResult {
        SearchPrResult {
            id,
            number: id,
            title: format!("Authored PR {id}"),
            body: Some("PR body".to_string()),
            state: "open".to_string(),
            draft: false,
            html_url: format!("https://github.com/acme/repo/pull/{id}"),
            user_login: "octocat".to_string(),
            user_avatar_url: None,
            repo_owner: "acme".to_string(),
            repo_name: "repo".to_string(),
            head_ref: format!("feature/T-{id}"),
            base_ref: "main".to_string(),
            head_sha: format!("sha-{id}"),
            additions: 12,
            deletions: 3,
            changed_files: 2,
            mergeable: Some(false),
            mergeable_state: Some("blocked".to_string()),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-02T00:00:00Z".to_string(),
            labels: vec![],
        }
    }

    fn check_runs(id: i64, conclusion: &str) -> CheckRunsResponse {
        CheckRunsResponse {
            total_count: 1,
            check_runs: vec![CheckRun {
                id,
                name: "test".to_string(),
                status: "completed".to_string(),
                conclusion: Some(conclusion.to_string()),
                html_url: format!("https://github.com/acme/repo/actions/runs/{id}"),
            }],
        }
    }

    fn combined_status(id: i64) -> CombinedStatusResponse {
        CombinedStatusResponse {
            state: "success".to_string(),
            statuses: vec![],
            sha: format!("sha-{id}"),
            total_count: 0,
            extra: serde_json::json!({}),
        }
    }

    fn ci_signal(id: i64, conclusion: &str) -> CiSignal {
        let check_runs = check_runs(id, conclusion);
        let combined_status = combined_status(id);
        CiSignal {
            status: crate::github_client::aggregate_ci_status(&check_runs, &combined_status),
            check_runs,
        }
    }

    fn reviews(id: i64, state: &str, submitted_at: &str) -> Vec<PrReview> {
        vec![PrReview {
            id,
            user: GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            state: state.to_string(),
            body: None,
            submitted_at: Some(submitted_at.to_string()),
            extra: serde_json::json!({}),
        }]
    }

    fn details(id: i64) -> PullRequest {
        PullRequest {
            number: id,
            title: format!("Authored PR {id}"),
            state: "open".to_string(),
            html_url: format!("https://github.com/acme/repo/pull/{id}"),
            user: GitHubUser {
                login: "octocat".to_string(),
                extra: serde_json::json!({}),
            },
            head: GitHubHead {
                ref_name: format!("feature/T-{id}"),
                sha: format!("sha-{id}"),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            extra: serde_json::json!({
                "merge_queue_entry": { "id": id }
            }),
        }
    }

    /// Real production shape: GitHub's REST pull object has no `merge_queue_entry`,
    /// so REST alone can never tell whether a PR is enqueued.
    fn details_without_queue_entry(id: i64) -> PullRequest {
        PullRequest {
            extra: serde_json::json!({}),
            ..details(id)
        }
    }

    fn queued_readiness_snapshot() -> GitHubReadinessSnapshot {
        GitHubReadinessSnapshot {
            merge_queue_state: Some("AWAITING_CHECKS".to_string()),
            ..GitHubReadinessSnapshot::unknown("test")
        }
    }

    fn network_error() -> GitHubError {
        GitHubError::NetworkError("offline".to_string())
    }

    #[test]
    fn graphql_merge_queue_state_marks_authored_pr_queued_without_rest_signal() {
        // Real GitHub data: REST omits merge_queue_entry, so only the GraphQL
        // readiness snapshot reveals that the PR is enqueued (AVIV-395).
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(91),
            Ok(ci_signal(91, "success")),
            Ok(reviews(91, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details_without_queue_entry(91)),
            Ok(queued_readiness_snapshot()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("complete enrichment should succeed");

        assert!(
            enriched.is_queued,
            "a PR in the merge queue must be marked queued from the GraphQL snapshot"
        );
    }

    #[test]
    fn authored_pr_is_not_queued_without_any_queue_signal() {
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(92),
            Ok(ci_signal(92, "success")),
            Ok(reviews(92, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details_without_queue_entry(92)),
            Ok(GitHubReadinessSnapshot::unknown("not queued")),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("complete enrichment should succeed");

        assert!(!enriched.is_queued);
    }

    #[test]
    fn queue_state_falls_back_to_rest_when_graphql_snapshot_unavailable() {
        // details(93) carries a REST merge_queue_entry; with the GraphQL snapshot
        // unavailable the REST heuristic still marks the PR queued.
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(93),
            Ok(ci_signal(93, "success")),
            Ok(reviews(93, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details(93)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("complete enrichment should succeed");

        assert!(enriched.is_queued);
    }

    #[test]
    fn strict_enrichment_fails_when_any_github_signal_is_unavailable() {
        let result = aggregate_authored_pr_enrichment(
            search_pr(71),
            Err(network_error()),
            Ok(reviews(71, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details(71)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        );

        assert!(matches!(result, Err(AuthoredPrSyncError::GitHub(_))));
    }

    #[test]
    fn complete_enrichment_aggregates_ci_review_queue_and_detail_mergeability() {
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(73),
            Ok(ci_signal(73, "success")),
            Ok(reviews(73, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details(73)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("complete enrichment should succeed");

        assert_eq!(enriched.ci_status.as_deref(), Some("success"));
        assert_eq!(enriched.review_status.as_deref(), Some("approved"));
        assert_eq!(enriched.mergeable, Some(true));
        assert_eq!(enriched.mergeable_state.as_deref(), Some("clean"));
        assert!(enriched.is_queued);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                enriched
                    .ci_check_runs
                    .as_deref()
                    .expect("serialized checks")
            )
            .expect("valid check run JSON"),
            serde_json::json!([{
                "id": 73,
                "name": "test",
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://github.com/acme/repo/actions/runs/73"
            }])
        );
    }

    #[test]
    fn best_effort_enrichment_persists_available_signals_and_search_mergeability() {
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(72),
            Err(network_error()),
            Ok(reviews(72, "APPROVED", "2024-01-02T00:00:00Z")),
            Err(network_error()),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::BestEffort,
        )
        .expect("best-effort enrichment should tolerate signal failures");

        assert_eq!(enriched.ci_status, None);
        assert_eq!(enriched.ci_check_runs, None);
        assert_eq!(enriched.review_status.as_deref(), Some("approved"));
        assert_eq!(enriched.mergeable, Some(false));
        assert_eq!(enriched.mergeable_state.as_deref(), Some("blocked"));
        assert!(!enriched.is_queued);
    }

    #[test]
    fn best_effort_persistence_preserves_unavailable_signals_and_replaces_available_signals() {
        let (db, _temp_dir) = make_test_db("authored_pr_signal_preservation");
        let initial = aggregate_authored_pr_enrichment(
            search_pr(74),
            Ok(ci_signal(74, "success")),
            Ok(reviews(74, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details(74)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("enrich initial authored PR");
        persist_authored_prs(&db, &[initial], AuthoredPrStalePolicy::Preserve)
            .expect("persist initial authored PR");

        let missing_ci = aggregate_authored_pr_enrichment(
            search_pr(74),
            Err(network_error()),
            Ok(reviews(74, "CHANGES_REQUESTED", "2024-01-03T00:00:00Z")),
            Ok(details(74)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::BestEffort,
        )
        .expect("best-effort enrichment should tolerate unavailable signals");
        persist_authored_prs(&db, &[missing_ci], AuthoredPrStalePolicy::Preserve)
            .expect("persist authored PR without a CI signal");

        let after_missing_ci = db
            .get_all_authored_prs()
            .expect("read authored PR after unavailable CI signal")
            .pop()
            .expect("persisted authored PR");
        assert_eq!(after_missing_ci.ci_status.as_deref(), Some("success"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                after_missing_ci
                    .ci_check_runs
                    .as_deref()
                    .expect("stored check runs")
            )
            .expect("valid stored check runs")[0]["conclusion"],
            "success"
        );
        assert_eq!(
            after_missing_ci.review_status.as_deref(),
            Some("changes_requested")
        );

        let missing_review = aggregate_authored_pr_enrichment(
            search_pr(74),
            Ok(ci_signal(74, "failure")),
            Err(network_error()),
            Ok(details(74)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::BestEffort,
        )
        .expect("best-effort enrichment should tolerate unavailable signals");
        persist_authored_prs(&db, &[missing_review], AuthoredPrStalePolicy::Preserve)
            .expect("persist authored PR without a review signal");

        let after_missing_review = db
            .get_all_authored_prs()
            .expect("read authored PR after unavailable review signal")
            .pop()
            .expect("persisted authored PR");
        assert_eq!(after_missing_review.ci_status.as_deref(), Some("failure"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                after_missing_review
                    .ci_check_runs
                    .as_deref()
                    .expect("stored check runs")
            )
            .expect("valid stored check runs")[0]["conclusion"],
            "failure"
        );
        assert_eq!(
            after_missing_review.review_status.as_deref(),
            Some("changes_requested")
        );
    }

    #[test]
    fn persistence_applies_the_callers_stale_reconciliation_policy() {
        let (db, _temp_dir) = make_test_db("shared_authored_pr_persistence");
        let first = EnrichedAuthoredPr::from_search_result(search_pr(81));
        let second = aggregate_authored_pr_enrichment(
            search_pr(82),
            Ok(ci_signal(82, "success")),
            Ok(reviews(82, "APPROVED", "2024-01-02T00:00:00Z")),
            Ok(details(82)),
            Err(network_error()),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        )
        .expect("enrich replacement authored PR");

        persist_authored_prs(&db, &[first], AuthoredPrStalePolicy::DeleteMissing(&[81]))
            .expect("persist initial authored PR");
        persist_authored_prs(&db, &[second], AuthoredPrStalePolicy::Preserve)
            .expect("persist authored PR without stale reconciliation");

        let rows = db.get_all_authored_prs().expect("read authored PRs");
        assert_eq!(rows.len(), 2);
        let persisted = rows
            .iter()
            .find(|row| row.id == 82)
            .expect("replacement authored PR");
        assert_eq!(persisted.ci_status.as_deref(), Some("success"));
        assert_eq!(persisted.review_status.as_deref(), Some("approved"));
        assert_eq!(persisted.mergeable, Some(true));
        assert_eq!(persisted.mergeable_state.as_deref(), Some("clean"));
        assert!(persisted.is_queued);

        persist_authored_prs(&db, &[], AuthoredPrStalePolicy::DeleteMissing(&[]))
            .expect("delete stale authored PRs");

        assert!(db
            .get_all_authored_prs()
            .expect("read reconciled authored PRs")
            .is_empty());
    }
}
