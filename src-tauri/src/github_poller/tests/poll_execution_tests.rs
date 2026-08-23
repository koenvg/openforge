use super::*;

#[test]
fn refresh_task_github_status_selects_only_open_prs_for_requested_task() {
    let (db, _temp_dir) = make_test_db("refresh_task_github_status_selects_task_prs");
    let task = db
        .create_task("Selected task", "doing", None, None, None)
        .expect("create selected task");
    let other_task = db
        .create_task("Other task", "doing", None, None, None)
        .expect("create other task");
    db.insert_pull_request_with_number(
        101,
        1,
        &task.id,
        "owner",
        "repo",
        "Selected open PR",
        "https://github.com/owner/repo/pull/1",
        "open",
        1000,
        3000,
        false,
    )
    .expect("insert selected open PR");
    db.insert_pull_request_with_number(
        102,
        2,
        &task.id,
        "owner",
        "repo",
        "Closed selected PR",
        "https://github.com/owner/repo/pull/2",
        "closed",
        1000,
        2000,
        false,
    )
    .expect("insert selected closed PR");
    db.insert_pull_request_with_number(
        103,
        3,
        &other_task.id,
        "owner",
        "repo",
        "Other task PR",
        "https://github.com/owner/repo/pull/3",
        "open",
        1000,
        4000,
        false,
    )
    .expect("insert other task PR");
    let db = Mutex::new(db);

    let prs = get_open_prs_for_task(&db, &task.id).expect("select task prs");

    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].id, 101);
    assert_eq!(prs[0].ticket_id, task.id);
}

#[test]
fn refresh_task_github_status_rejects_unknown_task_before_polling() {
    let (db, _temp_dir) = make_test_db("refresh_task_github_status_unknown_task");
    let db = Mutex::new(db);

    let error = get_open_prs_for_task(&db, "T-missing").expect_err("missing task");

    assert!(error.contains("Task not found: T-missing"));
}

#[test]
fn test_poller_uses_managed_github_client() {
    let managed_client = GitHubClient::new();
    let app = AppHandle::new();
    app.manage(managed_client.clone());

    let state_client = app.state::<GitHubClient>();
    let poller_client = state_client.inner();

    assert!(poller_client.shares_cache_with(&managed_client));
}

#[test]
fn test_poll_result_rate_limited_true_with_reset_timestamp() {
    let result = PollResult {
        new_comments: 5,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: true,
        rate_limit_reset_at: Some(1704067200),
        outcome: PollOutcome::RateLimited,
    };

    assert!(result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, Some(1704067200));
}

#[test]
fn test_poll_result_rate_limited_with_changes_can_coexist() {
    // This test verifies that rate_limited=true and new_comments>0 can both be true
    // (the confusing case where a cycle detects rate limit but still has changes)
    let result = PollResult {
        new_comments: 3,
        ci_changes: 1,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: true,
        rate_limit_reset_at: Some(1704067200),
        outcome: PollOutcome::RateLimited,
    };

    // Verify both conditions are true simultaneously
    assert!(result.rate_limited);
    assert!(result.new_comments > 0);
    assert!(result.ci_changes > 0);
    assert_eq!(result.rate_limit_reset_at, Some(1704067200));
}

#[test]
fn test_poll_result_rate_limited_false_when_no_reset_detected() {
    let result = PollResult {
        new_comments: 2,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: None,
        outcome: PollOutcome::Completed,
    };

    assert!(!result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, None);
}
