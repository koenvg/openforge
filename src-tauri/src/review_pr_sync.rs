use crate::db::{acquire_db, Database, ReviewPrRow, ReviewPrUpsert};
use crate::github_client::{CiSignal, GitHubClient, GitHubError, SearchPrResult};
use futures::future::join_all;
use log::warn;
use std::sync::Mutex;

fn review_ci_status(result: Result<CiSignal, GitHubError>) -> Option<String> {
    match result {
        Ok(signal) => Some(signal.status),
        Err(error) => {
            warn!(
                "[GitHub] Keeping the stored review PR check state after a failed fetch: {}",
                error.sanitized_log_message()
            );
            None
        }
    }
}

async fn review_pr_upsert(
    github_client: &GitHubClient,
    github_token: &str,
    viewer_login: &str,
    pr: SearchPrResult,
) -> ReviewPrUpsert {
    let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
        .map(|timestamp| timestamp.timestamp())
        .unwrap_or(0);
    let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
        .map(|timestamp| timestamp.timestamp())
        .unwrap_or(0);
    let ci_status = review_ci_status(
        github_client
            .get_ci_signal(&pr.repo_owner, &pr.repo_name, &pr.head_sha, github_token)
            .await,
    );
    // Unlike CI (preserved on a failed fetch via COALESCE), the viewer's verdict
    // is written straight through: a dismissed review must be able to clear a
    // stale "approved"/"changes_requested". A failed fetch drops the chip for one
    // sync; the next poll restores it.
    let viewer_review_state = match github_client
        .get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, github_token)
        .await
    {
        Ok(reviews) => crate::github_client::viewer_review_state(&reviews, viewer_login),
        Err(error) => {
            warn!(
                "[GitHub] Clearing the review PR viewer verdict after a failed reviews fetch: {}",
                error.sanitized_log_message()
            );
            None
        }
    };

    ReviewPrUpsert {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        draft: pr.draft,
        html_url: pr.html_url,
        user_login: pr.user_login,
        user_avatar_url: pr.user_avatar_url,
        repo_owner: pr.repo_owner,
        repo_name: pr.repo_name,
        head_ref: pr.head_ref,
        base_ref: pr.base_ref,
        head_sha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        ci_status,
        mergeable: pr.mergeable,
        mergeable_state: pr.mergeable_state,
        merged_at: None,
        viewer_review_state,
        labels: pr.labels,
        created_at,
        updated_at,
    }
}

async fn reconcile_kept_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
) -> Result<(), String> {
    let candidates = acquire_db(db)
        .get_review_pr_reconcile_candidates()
        .map_err(|error| format!("Failed to get kept review PRs: {error}"))?;

    let terminal_states = join_all(candidates.into_iter().map(|candidate| async move {
        match github_client
            .get_pr_details(
                &candidate.repo_owner,
                &candidate.repo_name,
                candidate.number,
                github_token,
            )
            .await
        {
            Ok(details) => details
                .terminal_state()
                .map(|terminal_state| (candidate.id, terminal_state)),
            Err(error) => {
                warn!(
                    "[GitHub] Leaving kept review PR open after failed detail fetch: {}",
                    error.sanitized_log_message()
                );
                None
            }
        }
    }))
    .await
    .into_iter()
    .flatten();

    let db = acquire_db(db);
    for (pr_id, terminal_state) in terminal_states {
        db.update_review_pr_terminal_state(pr_id, terminal_state)
            .map_err(|error| format!("Failed to update kept review PR: {error}"))?;
    }
    Ok(())
}

pub(crate) async fn enrich_and_persist_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
    viewer_login: &str,
    prs: Vec<SearchPrResult>,
    all_search_ids: &[i64],
) -> Result<Vec<ReviewPrRow>, String> {
    let search_is_empty = prs.is_empty();
    let should_reconcile = !all_search_ids.is_empty() || search_is_empty;
    let rows = join_all(
        prs.into_iter()
            .map(|pr| review_pr_upsert(github_client, github_token, viewer_login, pr)),
    )
    .await;

    {
        let db = acquire_db(db);
        for row in &rows {
            db.upsert_review_pr(row)
                .map_err(|error| format!("Failed to upsert review PR: {error}"))?;
        }

        if should_reconcile {
            db.mark_review_prs_not_requested(all_search_ids)
                .map_err(|error| format!("Failed to update review PR request state: {error}"))?;
        }
    }

    if should_reconcile {
        reconcile_kept_review_prs(github_client, db, github_token).await?;
    }

    acquire_db(db)
        .get_all_review_prs()
        .map_err(|error| format!("Failed to get review PRs: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_client::{CheckRunsResponse, GitHubHead, GitHubUser, PullRequest};
    use axum::{
        extract::State,
        http::{header::IF_NONE_MATCH, HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::get,
        Json, Router,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    fn search_pr(head_sha: &str) -> SearchPrResult {
        SearchPrResult {
            id: 42,
            number: 7,
            title: "Review this".to_string(),
            body: Some("A useful description".to_string()),
            state: "open".to_string(),
            draft: false,
            html_url: "https://github.com/acme/widgets/pull/7".to_string(),
            user_login: "octocat".to_string(),
            user_avatar_url: None,
            repo_owner: "acme".to_string(),
            repo_name: "widgets".to_string(),
            head_ref: "feature/review-sync".to_string(),
            base_ref: "main".to_string(),
            head_sha: head_sha.to_string(),
            additions: 12,
            deletions: 3,
            changed_files: 2,
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            created_at: "2026-09-14T08:30:00Z".to_string(),
            updated_at: "2026-09-15T09:45:00Z".to_string(),
            labels: vec![],
        }
    }

    fn check_runs_response(status: &str, conclusion: Option<&str>) -> serde_json::Value {
        serde_json::json!({
            "total_count": 1,
            "check_runs": [{
                "id": 91,
                "name": "test",
                "status": status,
                "conclusion": conclusion,
                "html_url": "https://github.com/acme/widgets/actions/runs/91"
            }]
        })
    }

    fn combined_status_response(sha: &str) -> serde_json::Value {
        serde_json::json!({
            "state": "pending",
            "statuses": [],
            "sha": sha,
            "total_count": 0
        })
    }

    async fn test_client(router: Router) -> GitHubClient {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind fake GitHub API");
        let address = listener.local_addr().expect("read fake GitHub address");
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("serve fake GitHub API");
        });

        GitHubClient::with_test_token(Ok(Some("token".to_string())))
            .with_test_api_base_url(format!("http://{address}"))
    }

    fn details(state: &str, extra: serde_json::Value) -> PullRequest {
        PullRequest {
            number: 7,
            title: "Review this".to_string(),
            state: state.to_string(),
            html_url: "https://github.com/acme/widgets/pull/7".to_string(),
            user: GitHubUser {
                login: "octocat".to_string(),
                extra: serde_json::json!({}),
            },
            head: GitHubHead {
                ref_name: "feature/review-sync".to_string(),
                sha: "abc123".to_string(),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: None,
            mergeable_state: None,
            extra,
        }
    }

    #[test]
    fn terminal_state_distinguishes_merged_closed_and_open_pull_requests() {
        assert_eq!(
            details(
                "closed",
                serde_json::json!({
                    "merged": true,
                    "merged_at": "2023-11-14T22:13:20Z"
                }),
            )
            .terminal_state(),
            Some(crate::github_client::PullRequestTerminalState::Merged(
                Some(1_700_000_000)
            ))
        );
        assert_eq!(
            details(
                "closed",
                serde_json::json!({ "merged": false, "merged_at": null }),
            )
            .terminal_state(),
            Some(crate::github_client::PullRequestTerminalState::Closed)
        );
        assert_eq!(
            details("open", serde_json::json!({})).terminal_state(),
            None
        );
    }

    #[test]
    fn failed_ci_fetch_produces_no_database_update() {
        let error = GitHubError::NetworkError("offline".to_string());
        assert_eq!(review_ci_status(Err(error)), None);

        let signal = CiSignal {
            status: "none".to_string(),
            check_runs: CheckRunsResponse {
                total_count: 0,
                check_runs: vec![],
            },
        };
        assert_eq!(review_ci_status(Ok(signal)).as_deref(), Some("none"));
    }

    #[tokio::test]
    async fn sync_updates_ci_for_a_new_head_and_preserves_it_after_a_failed_fetch() {
        let router = Router::new()
            .route(
                "/repos/acme/widgets/commits/sha-green/check-runs",
                get(|| async { Json(check_runs_response("completed", Some("success"))) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-green/status",
                get(|| async { Json(combined_status_response("sha-green")) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-red/check-runs",
                get(|| async { Json(check_runs_response("completed", Some("failure"))) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-red/status",
                get(|| async { Json(combined_status_response("sha-red")) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-error/check-runs",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-error/status",
                get(|| async { Json(combined_status_response("sha-error")) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-status-error/check-runs",
                get(|| async { Json(check_runs_response("completed", Some("success"))) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-status-error/status",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            );
        let client = test_client(router).await;
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("review_pr_ci_refresh");
        let db = Mutex::new(db);

        let rows = enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-green")],
            &[42],
        )
        .await
        .expect("persist passing CI");
        assert_eq!(rows[0].ci_status.as_deref(), Some("success"));

        let rows = enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-red")],
            &[42],
        )
        .await
        .expect("persist failing CI on the new head");
        assert_eq!(rows[0].ci_status.as_deref(), Some("failure"));

        let rows = enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-error")],
            &[42],
        )
        .await
        .expect("keep the row after a failed CI fetch");
        assert_eq!(rows[0].head_sha, "sha-error");
        assert_eq!(rows[0].ci_status.as_deref(), Some("failure"));

        let rows = enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-status-error")],
            &[42],
        )
        .await
        .expect("keep the row after a failed commit-status fetch");
        assert_eq!(rows[0].head_sha, "sha-status-error");
        assert_eq!(rows[0].ci_status.as_deref(), Some("failure"));
    }

    #[tokio::test]
    async fn sync_marks_a_kept_review_request_merged_after_it_leaves_search() {
        let router = Router::new()
            .route(
                "/repos/acme/widgets/commits/sha-green/check-runs",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-green/status",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route(
                "/repos/acme/widgets/pulls/7",
                get(|| async {
                    Json(serde_json::json!({
                        "number": 7,
                        "title": "Review this",
                        "state": "closed",
                        "html_url": "https://github.com/acme/widgets/pull/7",
                        "user": { "login": "octocat" },
                        "head": { "ref": "feature/review-sync", "sha": "sha-green" },
                        "draft": false,
                        "merged": true,
                        "merged_at": "2023-11-14T22:13:20Z"
                    }))
                }),
            );
        let client = test_client(router).await;
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("review_pr_merge_reconcile");
        let db = Mutex::new(db);

        enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-green")],
            &[42],
        )
        .await
        .expect("seed requested PR");
        let rows = enrich_and_persist_review_prs(&client, &db, "token", "reviewer", vec![], &[])
            .await
            .expect("reconcile kept PR");

        assert_eq!(rows[0].state, "merged");
        assert_eq!(rows[0].merged_at, Some(1_700_000_000));
        assert!(acquire_db(&db)
            .get_review_pr_reconcile_candidates()
            .expect("read candidates")
            .is_empty());
    }

    #[tokio::test]
    async fn failed_terminal_fetch_keeps_the_review_request_open_and_listed() {
        let router = Router::new()
            .route(
                "/repos/acme/widgets/commits/sha-green/check-runs",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-green/status",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route(
                "/repos/acme/widgets/pulls/7",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            );
        let client = test_client(router).await;
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("review_pr_failed_reconcile");
        let db = Mutex::new(db);

        enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-green")],
            &[42],
        )
        .await
        .expect("seed requested PR");
        let rows = enrich_and_persist_review_prs(&client, &db, "token", "reviewer", vec![], &[])
            .await
            .expect("keep PR after failed terminal fetch");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, "open");
        assert_eq!(rows[0].merged_at, None);
    }

    #[derive(Default)]
    struct CacheBodyCounts {
        check_runs: AtomicUsize,
        combined_status: AtomicUsize,
    }

    async fn cached_check_runs(
        State(counts): State<Arc<CacheBodyCounts>>,
        headers: HeaderMap,
    ) -> Response {
        if headers
            .get(IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            == Some("\"checks-v1\"")
        {
            return StatusCode::NOT_MODIFIED.into_response();
        }
        counts.check_runs.fetch_add(1, Ordering::SeqCst);
        (
            [("etag", "\"checks-v1\"")],
            Json(check_runs_response("completed", Some("success"))),
        )
            .into_response()
    }

    async fn cached_combined_status(
        State(counts): State<Arc<CacheBodyCounts>>,
        headers: HeaderMap,
    ) -> Response {
        if headers
            .get(IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            == Some("\"status-v1\"")
        {
            return StatusCode::NOT_MODIFIED.into_response();
        }
        counts.combined_status.fetch_add(1, Ordering::SeqCst);
        (
            [("etag", "\"status-v1\"")],
            Json(combined_status_response("sha-green")),
        )
            .into_response()
    }

    #[tokio::test]
    async fn unchanged_head_reuses_conditionally_cached_check_data() {
        let counts = Arc::new(CacheBodyCounts::default());
        let router = Router::new()
            .route(
                "/repos/acme/widgets/commits/sha-green/check-runs",
                get(cached_check_runs),
            )
            .route(
                "/repos/acme/widgets/commits/sha-green/status",
                get(cached_combined_status),
            )
            .with_state(Arc::clone(&counts));
        let client = test_client(router).await;
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("review_pr_etag_cache");
        let db = Mutex::new(db);

        for _ in 0..2 {
            enrich_and_persist_review_prs(
                &client,
                &db,
                "token",
                "reviewer",
                vec![search_pr("sha-green")],
                &[42],
            )
            .await
            .expect("sync unchanged review PR");
        }

        assert_eq!(counts.check_runs.load(Ordering::SeqCst), 1);
        assert_eq!(counts.combined_status.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn sync_records_the_viewers_own_approval() {
        let router = Router::new()
            .route(
                "/repos/acme/widgets/commits/sha-green/check-runs",
                get(|| async { Json(check_runs_response("completed", Some("success"))) }),
            )
            .route(
                "/repos/acme/widgets/commits/sha-green/status",
                get(|| async { Json(combined_status_response("sha-green")) }),
            )
            .route(
                "/repos/acme/widgets/pulls/7/reviews",
                get(|| async {
                    Json(serde_json::json!([
                        {
                            "id": 1,
                            "user": { "login": "reviewer" },
                            "state": "APPROVED",
                            "body": null,
                            "submitted_at": "2026-09-15T10:00:00Z"
                        }
                    ]))
                }),
            );
        let client = test_client(router).await;
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("review_pr_viewer_verdict");
        let db = Mutex::new(db);

        let rows = enrich_and_persist_review_prs(
            &client,
            &db,
            "token",
            "reviewer",
            vec![search_pr("sha-green")],
            &[42],
        )
        .await
        .expect("persist review PR with viewer verdict");

        assert_eq!(rows[0].viewer_review_state.as_deref(), Some("approved"));
    }
}
