use super::*;

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
        terminal_state_for_pr_details(&details),
        Some(StaleAuthoredPrTerminalState::Merged(Some(1704067200)))
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
        terminal_state_for_pr_details(&details),
        Some(StaleAuthoredPrTerminalState::Closed)
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_leaves_open_pr_open() {
    let details = make_stale_detail("open", serde_json::json!({ "merged": false }));

    assert_eq!(terminal_state_for_pr_details(&details), None);
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
fn authored_task_pr_timestamp_propagates_clock_errors() {
    let before_unix_epoch = std::time::UNIX_EPOCH - std::time::Duration::from_secs(1);

    let error = authored_task_pr_timestamp(before_unix_epoch)
        .expect_err("a pre-epoch clock value should return an error");

    assert!(matches!(error, SyncOpenPrsError::Clock(_)));
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
