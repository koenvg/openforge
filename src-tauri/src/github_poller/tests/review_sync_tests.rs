use super::*;
use crate::db::{acquire_db, Database, ReviewPrUpsert};
use crate::github_client::PullRequestTerminalState;
use axum::{extract::State, routing::get, Json, Router};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::Notify;

#[tokio::test]
async fn automatic_reconciliation_cannot_undo_manual_reassignment() {
    let (db, _dir) = make_test_db("reconciliation_preserves_manual");
    let automatic = db
        .create_task("automatic", "doing", None, None, None)
        .unwrap();
    let manual = db.create_task("manual", "doing", None, None, None).unwrap();
    db.insert_pull_request_with_number(
        -77,
        7,
        &manual.id,
        "acme",
        "widgets",
        "manual",
        "https://github.com/acme/widgets/pull/7",
        "open",
        1,
        1,
        false,
    )
    .unwrap();
    let search_task = automatic.id.clone();
    let detail_task = automatic.id.clone();
    let router = Router::new()
        .route(
            "/user",
            get(|| async { Json(serde_json::json!({"login":"me"})) }),
        )
        .route(
            "/search/issues",
            get(move || {
                let task = search_task.clone();
                async move {
                    let mut result = review_request_search_response().await.0;
                    result["items"][0]["title"] = task.into();
                    Json(result)
                }
            }),
        )
        .route(
            "/repos/acme/widgets/pulls/7",
            get(move || {
                let task = detail_task.clone();
                async move {
                    let mut result = review_request_detail_response().await.0;
                    result["head"]["ref"] = task.into();
                    Json(result)
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client =
        GitHubClient::with_test_api_base_url(GitHubClient::new(), format!("http://{address}"));
    let db = Mutex::new(db);
    sync_authored_task_prs(&client, &db, "test").await.unwrap();
    server.abort();
    let rows = acquire_db(&db).get_all_pull_requests().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].ticket_id, manual.id);
    assert_eq!(rows[0].title, "manual");
}

async fn review_request_search_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "total_count": 1,
        "items": [{
            "id": 42,
            "number": 7,
            "title": "Review this",
            "body": "A useful description",
            "state": "open",
            "draft": false,
            "html_url": "https://github.com/acme/widgets/pull/7",
            "user": {
                "login": "octocat",
                "avatar_url": "https://avatars.example/octocat"
            },
            "repository_url": "https://api.github.com/repos/acme/widgets",
            "created_at": "2026-09-14T08:30:00Z",
            "updated_at": "2026-09-15T09:45:00Z",
            "labels": [{ "name": "backend", "color": "0052cc" }]
        }]
    }))
}

async fn review_request_detail_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "number": 7,
        "title": "Review this",
        "state": "open",
        "html_url": "https://github.com/acme/widgets/pull/7",
        "user": { "login": "octocat" },
        "head": { "ref": "feature/review-sync", "sha": "abc123" },
        "base": { "ref": "main" },
        "draft": false,
        "mergeable": false,
        "mergeable_state": "blocked",
        "additions": 12,
        "deletions": 3,
        "changed_files": 2
    }))
}

async fn review_request_check_runs_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "total_count": 1,
        "check_runs": [{
            "id": 91,
            "name": "test",
            "status": "completed",
            "conclusion": "success",
            "html_url": "https://github.com/acme/widgets/actions/runs/91"
        }]
    }))
}

async fn review_request_combined_status_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "state": "success",
        "statuses": [],
        "sha": "abc123",
        "total_count": 0
    }))
}

async fn review_request_github_client() -> GitHubClient {
    let router = Router::new()
        .route("/search/issues", get(review_request_search_response))
        .route(
            "/repos/acme/widgets/pulls/7",
            get(review_request_detail_response),
        )
        .route(
            "/repos/acme/widgets/commits/abc123/check-runs",
            get(review_request_check_runs_response),
        )
        .route(
            "/repos/acme/widgets/commits/abc123/status",
            get(review_request_combined_status_response),
        );
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

async fn empty_review_search_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "total_count": 0, "items": [] }))
}

async fn merged_review_request_detail_response() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "number": 7,
        "title": "Review this",
        "state": "closed",
        "html_url": "https://github.com/acme/widgets/pull/7",
        "user": { "login": "octocat" },
        "head": { "ref": "feature/review-sync", "sha": "abc123" },
        "draft": false,
        "merged": true,
        "merged_at": "2023-11-14T22:13:20Z"
    }))
}

async fn merged_review_request_github_client() -> GitHubClient {
    let router = Router::new()
        .route("/search/issues", get(empty_review_search_response))
        .route(
            "/repos/acme/widgets/pulls/7",
            get(merged_review_request_detail_response),
        );
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

fn seed_kept_review_request(db: &Database) {
    db.upsert_review_pr(&ReviewPrUpsert {
        id: 42,
        number: 7,
        title: "Review this".to_string(),
        body: None,
        state: "open".to_string(),
        draft: false,
        html_url: "https://github.com/acme/widgets/pull/7".to_string(),
        user_login: "octocat".to_string(),
        user_avatar_url: None,
        repo_owner: "acme".to_string(),
        repo_name: "widgets".to_string(),
        head_ref: "feature/review-sync".to_string(),
        base_ref: "main".to_string(),
        head_sha: "abc123".to_string(),
        additions: 12,
        deletions: 3,
        changed_files: 2,
        ci_status: Some("failure".to_string()),
        mergeable: Some(true),
        mergeable_state: Some("clean".to_string()),
        merged_at: None,
        labels: vec![],
        created_at: 1,
        updated_at: 2,
    })
    .expect("seed review request");
    db.mark_review_prs_not_requested(&[])
        .expect("mark review request as kept");
}

#[tokio::test]
async fn manual_refresh_and_background_poll_persist_the_same_rows() {
    let client = review_request_github_client().await;
    let (manual_db, _manual_temp_dir) = make_test_db("review_pr_manual_sync");
    manual_db
        .set_config("github_username", "reviewer")
        .expect("configure manual refresh username");
    let manual_db = Arc::new(Mutex::new(manual_db));
    let (poll_db, _poll_temp_dir) = make_test_db("review_pr_poll_sync");
    poll_db
        .set_config("github_username", "reviewer")
        .expect("configure background poll username");
    let poll_db = Mutex::new(poll_db);
    let bus = crate::app_events::AppEventBus::new(16, 8);
    let mut subscription = bus.subscribe(None).expect("subscribe to app events");
    let events = GitHubEventTarget::sidecar(Some(bus.sender()));

    let manual_rows = crate::github_runtime::fetch_review_prs(&manual_db, &client)
        .await
        .expect("manual refresh should persist review requests");
    if let Err(error) = poll_review_prs(&client, &poll_db, &events, "token").await {
        panic!("background poll should persist review requests: {error}");
    }
    let poll_rows = acquire_db(&poll_db)
        .get_all_review_prs()
        .expect("read background poll rows");

    assert_eq!(manual_rows.len(), 1);
    let persisted = &manual_rows[0];
    assert_eq!(persisted.id, 42);
    assert_eq!(persisted.number, 7);
    assert_eq!(persisted.title, "Review this");
    assert_eq!(persisted.body.as_deref(), Some("A useful description"));
    assert_eq!(persisted.head_sha, "abc123");
    assert_eq!(persisted.mergeable, Some(false));
    assert_eq!(persisted.mergeable_state.as_deref(), Some("blocked"));
    assert_eq!(persisted.ci_status.as_deref(), Some("success"));
    assert_eq!(persisted.labels.len(), 1);
    assert_eq!(persisted.labels[0].name, "backend");
    assert_eq!(persisted.created_at, 1_789_374_600);
    assert_eq!(persisted.updated_at, 1_789_465_500);
    assert_eq!(
        serde_json::to_value(manual_rows).expect("manual rows should serialize"),
        serde_json::to_value(poll_rows).expect("poll rows should serialize")
    );

    let crate::app_events::AppEventFrame::Event(event) = subscription
        .recv()
        .await
        .expect("review-request count event should arrive")
    else {
        panic!("expected review-request count event");
    };
    assert_eq!(event.event_name, "review-pr-count-changed");
    assert_eq!(event.payload, serde_json::json!(1));
}

#[tokio::test]
async fn manual_refresh_and_background_poll_reconcile_the_same_merge_outcome() {
    let client = merged_review_request_github_client().await;
    let (manual_db, _manual_temp_dir) = make_test_db("review_pr_manual_merge_reconcile");
    manual_db
        .set_config("github_username", "reviewer")
        .expect("configure manual refresh username");
    seed_kept_review_request(&manual_db);
    let manual_db = Arc::new(Mutex::new(manual_db));
    let (poll_db, _poll_temp_dir) = make_test_db("review_pr_poll_merge_reconcile");
    poll_db
        .set_config("github_username", "reviewer")
        .expect("configure background poll username");
    seed_kept_review_request(&poll_db);
    let poll_db = Mutex::new(poll_db);
    let events = GitHubEventTarget::sidecar(None);

    let manual_rows = crate::github_runtime::fetch_review_prs(&manual_db, &client)
        .await
        .expect("manual refresh should reconcile merge outcome");
    if let Err(error) = poll_review_prs(&client, &poll_db, &events, "token").await {
        panic!("background poll should reconcile merge outcome: {error}");
    }
    let poll_rows = acquire_db(&poll_db)
        .get_all_review_prs()
        .expect("read background poll rows");

    assert_eq!(manual_rows[0].state, "merged");
    assert_eq!(manual_rows[0].merged_at, Some(1_700_000_000));
    assert_eq!(
        serde_json::to_value(manual_rows).expect("manual rows should serialize"),
        serde_json::to_value(poll_rows).expect("poll rows should serialize")
    );
}

#[derive(Default)]
struct OverlappingReviewRefreshState {
    detail_calls: AtomicUsize,
    first_search_started: Notify,
    release_first_search: Notify,
    search_calls: AtomicUsize,
    second_search_started: Notify,
}

async fn overlapping_review_search(
    State(state): State<Arc<OverlappingReviewRefreshState>>,
) -> Json<serde_json::Value> {
    if state.search_calls.fetch_add(1, Ordering::SeqCst) == 0 {
        state.first_search_started.notify_one();
        state.release_first_search.notified().await;
        review_request_search_response().await
    } else {
        state.second_search_started.notify_one();
        empty_review_search_response().await
    }
}

async fn overlapping_review_details(
    State(state): State<Arc<OverlappingReviewRefreshState>>,
) -> Json<serde_json::Value> {
    if state.detail_calls.fetch_add(1, Ordering::SeqCst) == 0 {
        review_request_detail_response().await
    } else {
        merged_review_request_detail_response().await
    }
}

#[tokio::test]
async fn overlapping_manual_refreshes_cannot_restore_an_older_open_state() {
    let state = Arc::new(OverlappingReviewRefreshState::default());
    let router = Router::new()
        .route("/search/issues", get(overlapping_review_search))
        .route(
            "/repos/acme/widgets/pulls/7",
            get(overlapping_review_details),
        )
        .route(
            "/repos/acme/widgets/commits/abc123/check-runs",
            get(review_request_check_runs_response),
        )
        .route(
            "/repos/acme/widgets/commits/abc123/status",
            get(review_request_combined_status_response),
        )
        .with_state(Arc::clone(&state));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind fake GitHub API");
    let address = listener.local_addr().expect("read fake GitHub address");
    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("serve fake GitHub API");
    });
    let client = GitHubClient::with_test_token(Ok(Some("token".to_string())))
        .with_test_api_base_url(format!("http://{address}"));
    let (db, _temp_dir) = make_test_db("overlapping_review_refreshes");
    db.set_config("github_username", "reviewer")
        .expect("configure manual refresh username");
    let db = Arc::new(Mutex::new(db));

    let first_refresh = tokio::spawn({
        let client = client.clone();
        let db = Arc::clone(&db);
        async move { crate::github_runtime::fetch_review_prs(&db, &client).await }
    });
    state.first_search_started.notified().await;

    let second_refresh = tokio::spawn({
        let client = client.clone();
        let db = Arc::clone(&db);
        async move { crate::github_runtime::fetch_review_prs(&db, &client).await }
    });
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            state.second_search_started.notified(),
        )
        .await
        .is_err(),
        "a second refresh reached GitHub before the first refresh finished"
    );

    state.release_first_search.notify_one();
    first_refresh
        .await
        .expect("join first refresh")
        .expect("complete first refresh");
    let rows = second_refresh
        .await
        .expect("join second refresh")
        .expect("complete second refresh");

    assert_eq!(rows[0].state, "merged");
    assert_eq!(rows[0].merged_at, Some(1_700_000_000));
}

fn make_stale_detail(state: &str, extra: serde_json::Value) -> PullRequest {
    PullRequest {
        number: 42,
        title: "Stale authored PR".to_string(),
        state: state.to_string(),
        html_url: "https://github.com/acme/repo/pull/42".to_string(),
        user: GitHubUser {
            login: "octocat".to_string(),
            extra: serde_json::json!({}),
        },
        head: GitHubHead {
            ref_name: "feature/T-100".to_string(),
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
fn test_stale_authored_pr_terminal_state_marks_merged_from_merged_at() {
    let details = make_stale_detail(
        "closed",
        serde_json::json!({
            "merged": true,
            "merged_at": "2024-01-01T00:00:00Z"
        }),
    );

    assert_eq!(
        details.terminal_state(),
        Some(PullRequestTerminalState::Merged(Some(1704067200)))
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_marks_closed_without_merged_evidence() {
    let details = make_stale_detail(
        "closed",
        serde_json::json!({
            "merged": false,
            "merged_at": null
        }),
    );

    assert_eq!(
        details.terminal_state(),
        Some(PullRequestTerminalState::Closed)
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_leaves_open_pr_open() {
    let details = make_stale_detail("open", serde_json::json!({ "merged": false }));

    assert_eq!(details.terminal_state(), None);
}

#[test]
fn test_stale_authored_pr_candidates_preserve_repo_local_pr_identity() {
    let open_prs = vec![
        PrRow {
            id: 1001,
            pr_number: 42,
            ticket_id: "T-100".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "web".to_string(),
            title: "Web".to_string(),
            url: "https://github.com/acme/web/pull/42".to_string(),
            state: "open".to_string(),
            head_sha: "web-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            github_node_id: None,
            merge_methods_policy_known: None,
            allowed_merge_methods: None,
            default_merge_method: None,
            reviewers: None,
            unaddressed_comment_count: 0,
        },
        PrRow {
            id: 2001,
            pr_number: 42,
            ticket_id: "T-100".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "api".to_string(),
            title: "API".to_string(),
            url: "https://github.com/acme/api/pull/42".to_string(),
            state: "open".to_string(),
            head_sha: "api-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            github_node_id: None,
            merge_methods_policy_known: None,
            allowed_merge_methods: None,
            default_merge_method: None,
            reviewers: None,
            unaddressed_comment_count: 0,
        },
    ];

    let candidates = stale_authored_task_pr_candidates(open_prs, &[1001]);

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, 2001);
    assert_eq!(candidates[0].repo_name, "api");
    assert_eq!(candidates[0].pr_number, 42);
}

#[test]
fn test_sync_open_prs_error_rate_limit_detection_uses_typed_github_error() {
    let rate_limited = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "Too Many Requests".to_string(),
    });
    assert!(rate_limited.should_increment_rate_limit_count());

    let forbidden = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 403,
        message: "Forbidden".to_string(),
    });
    assert!(!forbidden.should_increment_rate_limit_count());

    let non_rate_limited = SyncOpenPrsError::Db("boom".to_string());
    assert!(!non_rate_limited.should_increment_rate_limit_count());
}

#[test]
fn test_sync_open_prs_error_sanitized_log_message_redacts_body_and_identity() {
    let error = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "token ghp_secret body https://api.github.com/repos/acme/private/pulls?user=alice"
            .to_string(),
    });

    let sanitized = error.sanitized_log_message("authored task PR link sync");

    assert!(sanitized.contains("phase authored task PR link sync"));
    assert!(sanitized.contains("status 429"));
    assert!(sanitized.contains("rate_limited true"));
    assert!(!sanitized.contains("ghp_secret"));
    assert!(!sanitized.contains("https://api.github.com"));
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
    assert!(!sanitized.contains("alice"));
    assert!(!sanitized.contains("body"));
}

#[test]
fn test_contains_task_id_matches_boundaries() {
    assert!(contains_task_id("T-42 fix auth", "T-42"));
    assert!(contains_task_id("fix auth T-42", "T-42"));
    assert!(contains_task_id("feature/T-42/auth", "T-42"));
    assert!(contains_task_id("feature/T-42-auth", "T-42"));
    assert!(contains_task_id("T-42: fix auth", "T-42"));
}

#[test]
fn test_contains_task_id_rejects_substring_false_positive() {
    assert!(!contains_task_id("fixT-42bug", "T-42"));
    assert!(!contains_task_id("Fix T-12 issue", "T-1"));
    assert!(!contains_task_id("feature/T-123", "T-12"));
}

#[test]
fn test_classify_task_matches_returns_unique_match() {
    let task_ids = vec!["T-42".to_string(), "T-99".to_string()];

    match classify_task_matches("Fix bug T-42", &task_ids) {
        TaskMatchOutcome::Unique(task_id) => assert_eq!(task_id, "T-42"),
        TaskMatchOutcome::None | TaskMatchOutcome::Ambiguous => {
            panic!("expected unique task match")
        }
    }
}

#[test]
fn test_classify_task_matches_rejects_ambiguous_matches() {
    let task_ids = vec!["T-1".to_string(), "T-2".to_string()];

    assert!(matches!(
        classify_task_matches("Fix T-1 and T-2", &task_ids),
        TaskMatchOutcome::Ambiguous
    ));
}

#[test]
fn test_classify_task_matches_returns_none_for_no_matches() {
    let task_ids = vec!["T-100".to_string()];

    assert!(matches!(
        classify_task_matches("Update documentation", &task_ids),
        TaskMatchOutcome::None
    ));
}

#[test]
fn test_find_authoritative_task_id_prefers_branch_match_over_title_and_body_match() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched =
        find_authoritative_task_id("Fix T-2", "feature/T-1-auth", Some("Closes T-3"), &task_ids);

    assert_eq!(matched.as_deref(), Some("T-1"));
}

#[test]
fn test_find_authoritative_task_id_uses_unique_title_match_when_branch_has_none() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched = find_authoritative_task_id("Fix T-3", "feature/auth", None, &task_ids);

    assert_eq!(matched.as_deref(), Some("T-3"));
}

#[test]
fn test_find_authoritative_task_id_uses_unique_body_match_when_branch_and_title_have_none() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched = find_authoritative_task_id(
        "Fix authentication",
        "feature/auth",
        Some("Implementation for Task T-3."),
        &task_ids,
    );

    assert_eq!(matched.as_deref(), Some("T-3"));
}

#[test]
fn test_find_authoritative_task_id_rejects_ambiguous_body_matches() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

    let matched = find_authoritative_task_id(
        "Fix authentication",
        "feature/auth",
        Some("Covers T-1 and T-2."),
        &task_ids,
    );

    assert_eq!(matched, None);
}

#[test]
fn test_find_authoritative_task_id_rejects_ambiguous_title_matches() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

    let matched = find_authoritative_task_id("Fix T-1 before T-2", "feature/auth", None, &task_ids);

    assert_eq!(matched, None);
}

#[test]
fn test_poll_phase_error_rate_limit_detection_uses_typed_github_error() {
    let rate_limited = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "Too Many Requests".to_string(),
    });
    assert!(rate_limited.should_increment_rate_limit_count());

    let forbidden = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 403,
        message: "Forbidden".to_string(),
    });
    assert!(!forbidden.should_increment_rate_limit_count());

    let non_rate_limited = PollPhaseError::Db("boom".to_string());
    assert!(!non_rate_limited.should_increment_rate_limit_count());
}

#[test]
fn test_poll_phase_error_sanitized_log_message_preserves_phase_and_status_only() {
    let error = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "token ghp_secret body https://api.github.com/repos/acme/private/pulls?user=alice"
            .to_string(),
    });

    let sanitized = error.sanitized_log_message("review PRs");

    assert!(sanitized.contains("phase review PRs"));
    assert!(sanitized.contains("status 429"));
    assert!(sanitized.contains("rate_limited true"));
    assert!(!sanitized.contains("ghp_secret"));
    assert!(!sanitized.contains("https://api.github.com"));
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
    assert!(!sanitized.contains("alice"));
    assert!(!sanitized.contains("body"));
}

#[test]
fn test_poll_phase_error_sanitized_log_message_redacts_db_message() {
    let error = PollPhaseError::Db("database path mentions owner acme repo private".to_string());

    let sanitized = error.sanitized_log_message("authored PRs");

    assert_eq!(sanitized, "phase authored PRs: database error");
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
}

#[test]
fn test_count_poll_phase_error_increments_total_errors_and_rate_limit_count_on_failure() {
    let mut total_errors = 0;
    let mut rate_limit_count = 0;

    count_poll_phase_error(
        "review PRs",
        Err(PollPhaseError::GitHub(
            crate::github_client::GitHubError::ApiError {
                status: 429,
                message: "Too Many Requests".to_string(),
            },
        )),
        &mut total_errors,
        &mut rate_limit_count,
    );
    count_poll_phase_error(
        "authored PRs",
        Err(PollPhaseError::Db("boom".to_string())),
        &mut total_errors,
        &mut rate_limit_count,
    );

    assert_eq!(total_errors, 2);
    assert_eq!(rate_limit_count, 1);
}

#[tokio::test]
async fn review_list_sync_recovers_from_poisoned_database_lock() {
    let (db, _temp_dir) = make_test_db("review_list_sync_poisoned_lock");
    let db = Mutex::new(db);
    poison_mutex(&db);
    let client = GitHubClient::new();
    let events = GitHubEventTarget::sidecar(None);

    assert!(
        poll_review_prs(&client, &db, &events, "token")
            .await
            .is_ok(),
        "review PR sync should recover from lock poison"
    );
    assert!(
        poll_authored_prs(&client, &db, &events, "token")
            .await
            .is_ok(),
        "authored PR sync should recover from lock poison"
    );
}

#[test]
fn test_count_poll_phase_error_leaves_counters_unchanged_on_success() {
    let mut total_errors = 3;
    let mut rate_limit_count = 2;

    count_poll_phase_error(
        "review PRs",
        Ok(()),
        &mut total_errors,
        &mut rate_limit_count,
    );

    assert_eq!(total_errors, 3);
    assert_eq!(rate_limit_count, 2);
}
