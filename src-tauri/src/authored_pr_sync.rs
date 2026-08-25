use crate::db::{acquire_db, Database};
use crate::github_client::{
    CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubError, PrReview, PullRequest,
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

fn aggregate_ci(
    check_runs: CheckRunsResponse,
    combined_status: CombinedStatusResponse,
    enriched: &mut EnrichedAuthoredPr,
) {
    enriched.ci_status = Some(crate::github_client::aggregate_ci_status(
        &check_runs,
        &combined_status,
    ));
    enriched.ci_check_runs =
        Some(serde_json::to_string(&check_runs.check_runs).unwrap_or_else(|_| "[]".to_string()));
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

fn aggregate_authored_pr_enrichment(
    pr: SearchPrResult,
    check_runs_result: Result<CheckRunsResponse, GitHubError>,
    combined_status_result: Result<CombinedStatusResponse, GitHubError>,
    reviews_result: Result<Vec<PrReview>, GitHubError>,
    details_result: Result<PullRequest, GitHubError>,
    policy: AuthoredPrEnrichmentPolicy,
) -> Result<EnrichedAuthoredPr, AuthoredPrSyncError> {
    let mut enriched = EnrichedAuthoredPr::from_search_result(pr);

    match policy {
        AuthoredPrEnrichmentPolicy::RequireComplete => {
            aggregate_ci(check_runs_result?, combined_status_result?, &mut enriched);
            aggregate_reviews(reviews_result?, &mut enriched);
            aggregate_details(details_result?, policy, &mut enriched);
        }
        AuthoredPrEnrichmentPolicy::BestEffort => {
            if let (Ok(check_runs), Ok(combined_status)) =
                (check_runs_result, combined_status_result)
            {
                aggregate_ci(check_runs, combined_status, &mut enriched);
            }
            if let Ok(reviews) = reviews_result {
                aggregate_reviews(reviews, &mut enriched);
            }
            if let Ok(details) = details_result {
                aggregate_details(details, policy, &mut enriched);
            }
        }
    }

    Ok(enriched)
}

async fn enrich_authored_pr(
    github_client: &GitHubClient,
    github_token: &str,
    pr: SearchPrResult,
    policy: AuthoredPrEnrichmentPolicy,
) -> Result<EnrichedAuthoredPr, AuthoredPrSyncError> {
    let (check_runs, combined_status, reviews, details) = tokio::join!(
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

    aggregate_authored_pr_enrichment(pr, check_runs, combined_status, reviews, details, policy)
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
            None,
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

    fn check_runs(id: i64) -> CheckRunsResponse {
        CheckRunsResponse {
            total_count: 1,
            check_runs: vec![CheckRun {
                id,
                name: "test".to_string(),
                status: "completed".to_string(),
                conclusion: Some("success".to_string()),
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

    fn reviews(id: i64) -> Vec<PrReview> {
        vec![PrReview {
            id,
            user: GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            state: "APPROVED".to_string(),
            body: None,
            submitted_at: Some("2024-01-02T00:00:00Z".to_string()),
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

    fn network_error() -> GitHubError {
        GitHubError::NetworkError("offline".to_string())
    }

    #[test]
    fn strict_enrichment_fails_when_any_github_signal_is_unavailable() {
        let result = aggregate_authored_pr_enrichment(
            search_pr(71),
            Ok(check_runs(71)),
            Err(network_error()),
            Ok(reviews(71)),
            Ok(details(71)),
            AuthoredPrEnrichmentPolicy::RequireComplete,
        );

        assert!(matches!(result, Err(AuthoredPrSyncError::GitHub(_))));
    }

    #[test]
    fn complete_enrichment_aggregates_ci_review_queue_and_detail_mergeability() {
        let enriched = aggregate_authored_pr_enrichment(
            search_pr(73),
            Ok(check_runs(73)),
            Ok(combined_status(73)),
            Ok(reviews(73)),
            Ok(details(73)),
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
            Ok(check_runs(72)),
            Err(network_error()),
            Ok(reviews(72)),
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
    fn persistence_applies_the_callers_stale_reconciliation_policy() {
        let (db, _temp_dir) = make_test_db("shared_authored_pr_persistence");
        let first = EnrichedAuthoredPr::from_search_result(search_pr(81));
        let second = aggregate_authored_pr_enrichment(
            search_pr(82),
            Ok(check_runs(82)),
            Ok(combined_status(82)),
            Ok(reviews(82)),
            Ok(details(82)),
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
