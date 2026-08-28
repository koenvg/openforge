use super::*;

fn make_review_body_poll_result(pr_id: i64) -> PollSinglePrResult {
    let review = PrReview {
        id: 42,
        user: crate::github_client::GitHubUser {
            login: "reviewer".to_string(),
            extra: serde_json::json!({}),
        },
        state: "COMMENTED".to_string(),
        body: Some("Looks good overall".to_string()),
        submitted_at: Some("2024-01-01T00:00:00Z".to_string()),
        extra: serde_json::json!({}),
    };

    PollSinglePrResult {
        pr_id,
        ticket_id: "T-100".to_string(),
        pr_title: "Review body test".to_string(),
        github_node_id: None,
        head_sha: "abc123".to_string(),
        ci_validation_sha: "abc123".to_string(),
        old_ci_status: None,
        old_review_status: None,
        comments: vec![PrComment {
            id: -review.id,
            body: review.body.clone().expect("review body should exist"),
            user: review.user.clone(),
            path: None,
            line: None,
            comment_type: "review_body".to_string(),
            outdated: false,
            created_at: review
                .submitted_at
                .clone()
                .expect("submitted_at should exist"),
        }],
        check_runs: None,
        combined_status: None,
        reviews: Some(vec![review]),
        has_requested_reviewers: false,
        mergeable: None,
        mergeable_state: None,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        merge_methods_policy_known: false,
        allowed_merge_methods: Vec::new(),
        default_merge_method: None,
        readiness_facts: PrMergeReadinessFacts {
            status: None,
            action: None,
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some("abc123".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        },
        terminal_state: None,
        error: None,
    }
}

fn make_review_comment_poll_result(
    pr_id: i64,
    comment_id: i64,
    outdated: bool,
) -> PollSinglePrResult {
    PollSinglePrResult {
        pr_id,
        ticket_id: "T-100".to_string(),
        pr_title: "Outdated test".to_string(),
        github_node_id: None,
        head_sha: "abc123".to_string(),
        ci_validation_sha: "abc123".to_string(),
        old_ci_status: None,
        old_review_status: None,
        comments: vec![PrComment {
            id: comment_id,
            body: "please fix".to_string(),
            user: crate::github_client::GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            path: Some("src/lib.rs".to_string()),
            line: Some(10),
            comment_type: "review_comment".to_string(),
            outdated,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }],
        check_runs: None,
        combined_status: None,
        reviews: None,
        has_requested_reviewers: false,
        mergeable: None,
        mergeable_state: None,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        merge_methods_policy_known: false,
        allowed_merge_methods: Vec::new(),
        default_merge_method: None,
        readiness_facts: PrMergeReadinessFacts {
            status: None,
            action: None,
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some("abc123".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        },
        terminal_state: None,
        error: None,
    }
}

#[test]
fn poll_comment_persistence_records_database_failures() {
    let (db, _temp_dir) = make_test_db("persist_comment_database_failure");
    let result = make_review_comment_poll_result(999, 900, false);

    let persist_result = persist_polled_comments(&db, &result, &HashSet::new(), 1_000, |_| {});

    assert_eq!(persist_result.new_comment_count, 0);
    assert_eq!(persist_result.failed_insert_count, 1);
    assert_eq!(persist_result.error_count, 1);
}

#[test]
fn test_persist_polled_comments_stores_and_refreshes_outdated_without_clobbering_addressed() {
    let (db, _temp_dir) = make_test_db("persist_outdated_refresh");
    insert_test_task(&db);
    db.insert_pull_request(
        142,
        "T-100",
        "acme",
        "repo",
        "Outdated test",
        "https://example.com/pr/142",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    // First poll: the comment arrives outdated.
    let result = make_review_comment_poll_result(142, 900, true);
    let existing = db.get_existing_comment_ids(142).expect("existing ids");
    let first = persist_polled_comments(&db, &result, &existing, 1000, |_| {});
    assert_eq!(first.new_comment_count, 1);
    let comments = db.get_comments_for_pr(142).expect("get comments");
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].outdated, 1, "first poll stores outdated");

    // User addresses the comment locally.
    db.mark_comment_addressed(900).expect("mark addressed");

    // Second poll: the line came back, comment is no longer outdated.
    let result2 = make_review_comment_poll_result(142, 900, false);
    let existing2 = db.get_existing_comment_ids(142).expect("existing ids 2");
    let second = persist_polled_comments(&db, &result2, &existing2, 2000, |_| {});
    assert_eq!(
        second.new_comment_count, 0,
        "existing comment is not re-counted"
    );
    let comments = db.get_comments_for_pr(142).expect("get comments");
    assert_eq!(comments[0].outdated, 0, "outdated refreshed on re-poll");
    assert_eq!(
        comments[0].addressed, 1,
        "addressed preserved across re-poll"
    );

    drop(db);
}

#[test]
fn test_persist_polled_comments_does_not_fail_when_review_body_exists_in_both_sources() {
    let (db, _temp_dir) = make_test_db("persist_polled_comments_review_body_once");
    insert_test_task(&db);
    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/42",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let result = make_review_body_poll_result(42);
    let existing_ids = db
        .get_existing_comment_ids(42)
        .expect("get existing ids failed");

    let persist_result = persist_polled_comments(&db, &result, &existing_ids, 1000, |_| {});
    let comments = db.get_comments_for_pr(42).expect("get comments failed");

    assert_eq!(persist_result.failed_insert_count, 0);
    assert_eq!(persist_result.new_comment_count, 1);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);
    assert_eq!(comments[0].comment_type, "review_body");

    drop(db);
}

#[test]
fn test_persist_polled_comments_is_idempotent_across_poll_cycles_for_review_bodies() {
    let (db, _temp_dir) = make_test_db("persist_polled_comments_review_body_idempotent");
    insert_test_task(&db);
    db.insert_pull_request(
        84,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/84",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let result = make_review_body_poll_result(84);

    let first_existing_ids = db
        .get_existing_comment_ids(84)
        .expect("get initial existing ids failed");
    let first_persist = persist_polled_comments(&db, &result, &first_existing_ids, 1000, |_| {});

    let second_existing_ids = db
        .get_existing_comment_ids(84)
        .expect("get second existing ids failed");
    let second_persist = persist_polled_comments(&db, &result, &second_existing_ids, 1000, |_| {});

    let comments = db.get_comments_for_pr(84).expect("get comments failed");

    assert_eq!(first_persist.failed_insert_count, 0);
    assert_eq!(first_persist.new_comment_count, 1);
    assert_eq!(second_persist.failed_insert_count, 0);
    assert_eq!(second_persist.new_comment_count, 0);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);

    drop(db);
}

#[test]
fn test_persist_polled_comments_deduplicates_repeated_ids_within_batch() {
    let (db, _temp_dir) = make_test_db("persist_polled_comments_batch_dedup");
    insert_test_task(&db);
    db.insert_pull_request(
        126,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/126",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let mut result = make_review_body_poll_result(126);
    result.comments.push(
        result
            .comments
            .first()
            .expect("review body comment should exist")
            .clone(),
    );

    let existing_ids = db
        .get_existing_comment_ids(126)
        .expect("get existing ids failed");

    let persist_result = persist_polled_comments(&db, &result, &existing_ids, 1000, |_| {});
    let comments = db.get_comments_for_pr(126).expect("get comments failed");

    assert_eq!(persist_result.failed_insert_count, 0);
    assert_eq!(persist_result.new_comment_count, 1);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);

    drop(db);
}

#[test]
fn ci_persistence_payload_filters_to_required_checks_and_reports_status_change() {
    let mut result = make_review_body_poll_result(42);
    result.head_sha = "head-sha".to_string();
    result.ci_validation_sha = "merge-group-sha".to_string();
    result.old_ci_status = Some("pending".to_string());
    result.required_check_names = vec!["ci".to_string()];
    result.check_runs = Some(CheckRunsResponse {
        total_count: 2,
        check_runs: vec![
            CheckRun {
                id: 1,
                name: "ci".to_string(),
                status: "completed".to_string(),
                conclusion: Some("success".to_string()),
                html_url: "https://example.com/ci".to_string(),
            },
            CheckRun {
                id: 2,
                name: "optional-lint".to_string(),
                status: "completed".to_string(),
                conclusion: Some("failure".to_string()),
                html_url: "https://example.com/lint".to_string(),
            },
        ],
    });
    result.combined_status = Some(CombinedStatusResponse {
        state: "success".to_string(),
        statuses: vec![],
        sha: "merge-group-sha".to_string(),
        total_count: 0,
        extra: serde_json::json!({}),
    });

    let payload = ci_persistence_payload(&result).expect("CI inputs should produce a payload");
    let persisted_runs: Vec<CheckRun> = serde_json::from_str(&payload.check_runs_json)
        .expect("payload should serialize display check runs");

    assert_eq!(payload.pr_id, 42);
    assert_eq!(payload.head_sha, "head-sha");
    assert_eq!(payload.ci_validation_sha, "merge-group-sha");
    assert_eq!(payload.status, "success");
    assert!(payload.status_changed);
    assert_eq!(persisted_runs.len(), 1);
    assert_eq!(persisted_runs[0].name, "ci");
}

#[test]
fn refresh_task_github_status_reconciles_terminal_pr_state() {
    let (db, _temp_dir) = make_test_db("refresh_task_github_status_terminal_state");
    insert_test_task(&db);
    db.insert_pull_request(
        142,
        "T-100",
        "acme",
        "repo",
        "Merged from manual refresh",
        "https://example.com/pr/142",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let mut result = make_review_body_poll_result(142);
    result.terminal_state = Some(StaleAuthoredPrTerminalState::Merged(Some(1704067200)));

    let changed = apply_terminal_pr_state(&db, &result).expect("terminal state should persist");
    let pr = db
        .get_all_pull_requests()
        .expect("get pull requests failed")
        .into_iter()
        .find(|pr| pr.id == 142)
        .expect("pull request should remain queryable");

    assert!(changed);
    assert_eq!(pr.state, "merged");
    assert_eq!(pr.merged_at, Some(1704067200));
    assert_eq!(pr.merge_readiness_status.as_deref(), Some("blocked"));

    drop(db);
}

#[tokio::test]
async fn github_poller_events_match_renderer_contracts() {
    let bus = crate::app_events::AppEventBus::new(16, 8);
    let mut subscription = bus.subscribe(None).expect("subscribe to app events");
    let events = GitHubEventTarget::sidecar(Some(bus.sender()));

    emit_new_pr_comment(&events, "T-100", 42);
    emit_ci_status_changed(
        &events,
        "T-100",
        Some("P-4"),
        7,
        "Update poller",
        "success",
        1_000,
    );
    emit_review_status_changed(
        &events,
        "T-100",
        Some("P-4"),
        7,
        "Update poller",
        "approved",
        1_000,
    );
    emit_task_updated(&events, "T-100", "P-4");

    let mut received = Vec::new();
    for _ in 0..4 {
        let crate::app_events::AppEventFrame::Event(event) = subscription
            .recv()
            .await
            .expect("GitHub poller event should arrive")
        else {
            panic!("expected GitHub poller event");
        };
        received.push((event.event_name, event.payload));
    }

    assert_eq!(
        received,
        vec![
            (
                "new-pr-comment".to_string(),
                serde_json::json!({
                    "ticket_id": "T-100",
                    "comment_id": 42,
                }),
            ),
            (
                "ci-status-changed".to_string(),
                serde_json::json!({
                    "task_id": "T-100",
                    "project_id": "P-4",
                    "pr_id": 7,
                    "pr_title": "Update poller",
                    "ci_status": "success",
                    "timestamp": 1_000,
                }),
            ),
            (
                "review-status-changed".to_string(),
                serde_json::json!({
                    "task_id": "T-100",
                    "project_id": "P-4",
                    "pr_id": 7,
                    "pr_title": "Update poller",
                    "review_status": "approved",
                    "timestamp": 1_000,
                }),
            ),
            (
                "task-changed".to_string(),
                serde_json::json!({
                    "action": "updated",
                    "task_id": "T-100",
                    "project_id": "P-4",
                }),
            ),
        ]
    );
}

#[test]
#[ignore = "known bug KVG-4224"]
fn polling_refreshes_the_body_of_an_edited_github_comment() {
    let (db, _temp_dir) = make_test_db("persist_edited_comment");
    insert_test_task(&db);
    db.insert_pull_request(
        142,
        "T-100",
        "acme",
        "repo",
        "Edited comment test",
        "https://example.com/pr/142",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert PR");

    let first = make_review_comment_poll_result(142, 900, false);
    let existing = db
        .get_existing_comment_ids(142)
        .expect("existing comment IDs");
    persist_polled_comments(&db, &first, &existing, 1000, |_| {});

    let mut edited = make_review_comment_poll_result(142, 900, false);
    edited.comments[0].body = "please fix the updated implementation".to_string();
    let existing = db
        .get_existing_comment_ids(142)
        .expect("existing comment IDs");
    persist_polled_comments(&db, &edited, &existing, 2000, |_| {});

    let comments = db.get_comments_for_pr(142).expect("get comments");
    assert_eq!(comments[0].body, "please fix the updated implementation");
}

#[test]
#[ignore = "known bug KVG-4224"]
fn polling_removes_a_github_comment_that_was_deleted_remotely() {
    let (db, _temp_dir) = make_test_db("persist_deleted_comment");
    insert_test_task(&db);
    db.insert_pull_request(
        143,
        "T-100",
        "acme",
        "repo",
        "Deleted comment test",
        "https://example.com/pr/143",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert PR");

    let first = make_review_comment_poll_result(143, 901, false);
    let existing = db
        .get_existing_comment_ids(143)
        .expect("existing comment IDs");
    persist_polled_comments(&db, &first, &existing, 1000, |_| {});

    let mut after_deletion = make_review_comment_poll_result(143, 901, false);
    after_deletion.comments.clear();
    let existing = db
        .get_existing_comment_ids(143)
        .expect("existing comment IDs");
    persist_polled_comments(&db, &after_deletion, &existing, 2000, |_| {});

    let comments = db.get_comments_for_pr(143).expect("get comments");
    assert!(
        comments.is_empty(),
        "a full GitHub refresh must remove comments that no longer exist remotely"
    );
}
