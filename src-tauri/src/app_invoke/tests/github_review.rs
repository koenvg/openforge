use super::*;

#[tokio::test]
async fn handler_uses_shared_boundary() {
    let (state, _temp_dir) = test_state("app_invoke_github_shared_boundary");
    {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("PR task", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            10,
            &task.id,
            "owner",
            "repo",
            "Fix bug",
            "https://github.com/owner/repo/pull/5",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert PR");
    }

    let value = invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await;
    assert_eq!(value[0]["title"], "Fix bug");
}

#[tokio::test]
async fn get_pull_requests_scopes_results_to_the_requested_task() {
    let (state, _temp_dir) = test_state("app_invoke_get_pull_requests_for_task");
    let (requested_task_id, other_task_id) = {
        let db = state.db.lock().expect("db lock");
        let requested_task = db
            .create_task("Requested PR task", "doing", None, None, None)
            .expect("create requested task");
        let other_task = db
            .create_task("Other PR task", "doing", None, None, None)
            .expect("create other task");
        db.insert_pull_request(
            10,
            &requested_task.id,
            "owner",
            "repo",
            "Requested PR",
            "https://github.com/owner/repo/pull/10",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert requested PR");
        db.insert_pull_request(
            11,
            &other_task.id,
            "owner",
            "repo",
            "Other PR",
            "https://github.com/owner/repo/pull/11",
            "open",
            1000,
            3000,
            false,
        )
        .expect("insert other PR");
        (requested_task.id, other_task.id)
    };

    let value = invoke_ok(
        &state,
        "get_pull_requests",
        json!({ "taskId": requested_task_id }),
    )
    .await;

    assert_eq!(value.as_array().map(Vec::len), Some(1));
    assert_eq!(value[0]["ticket_id"], requested_task_id);
    assert_ne!(value[0]["ticket_id"], other_task_id);
}

#[tokio::test]
async fn link_pull_request_persists_pr_for_task() {
    let (state, _temp_dir) = test_state("app_invoke_link_pull_request");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Link PR task", "doing", None, None, None)
            .expect("create task")
            .id
    };

    let value = invoke_ok(
        &state,
        "link_pull_request",
        json!({ "taskId": task_id, "prUrl": "https://github.com/owner/repo/pull/123" }),
    )
    .await;

    assert_eq!(value["ticket_id"], task_id);
    assert_eq!(value["repo_owner"], "owner");
    assert_eq!(value["repo_name"], "repo");
    assert_eq!(value["pr_number"], 123);
    assert_eq!(value["url"], "https://github.com/owner/repo/pull/123");

    let prs = invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await;
    assert_eq!(prs[0]["ticket_id"], task_id);
    assert_eq!(prs[0]["pr_number"], 123);
}

#[tokio::test]
async fn refresh_task_github_status_returns_empty_result_for_task_without_linked_prs() {
    let (state, _temp_dir) = test_state("app_invoke_refresh_task_github_status_empty");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Refresh PR status", "doing", None, None, None)
            .expect("create task")
            .id
    };

    let value = invoke_ok(
        &state,
        "refresh_task_github_status",
        json!({ "taskId": task_id }),
    )
    .await;

    assert_eq!(value["new_comments"], 0);
    assert_eq!(value["ci_changes"], 0);
    assert_eq!(value["review_changes"], 0);
    assert_eq!(value["pr_changes"], 0);
    assert_eq!(value["errors"], 0);
}

#[tokio::test]
async fn task_merge_rejects_changed_expected_head_without_pre_action_sync() {
    let (state, _temp_dir) = test_state("app_invoke_task_merge_expected_head");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("Merge PR", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            42, &task.id, "owner", "repo", "PR", "url", "open", 1, 1, false,
        )
        .expect("insert PR");
        db.update_pr_head_sha(42, "current-head").expect("set head");
        db.update_pr_merge_readiness(
            42,
            &crate::db::PrMergeReadinessFacts {
                status: Some("ready_to_merge".to_string()),
                action: Some("merge".to_string()),
                blockers_json: Some("[]".to_string()),
                warnings_json: Some("[]".to_string()),
                source_head_sha: Some("current-head".to_string()),
                merge_group_sha: None,
                required_checks_policy_known: Some(true),
                required_reviews_policy_known: Some(true),
                merge_queue_required: Some(false),
                merge_queue_state: None,
                updated_at: 1,
            },
        )
        .expect("set readiness");
        task.id
    };

    let error = invoke(
        &state,
        "merge_task_pull_request",
        json!({
            "taskId": task_id,
            "prId": 42,
            "owner": "owner",
            "repo": "repo",
            "prNumber": 42,
            "expectedHeadSha": "old-head",
            "mergeMethod": "squash",
        }),
    )
    .await
    .expect_err("changed head must reject before GitHub access");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert_eq!(error.1, "Pull request is no longer ready to merge");
}

#[tokio::test]
async fn task_merge_rejects_unknown_merge_method_before_github_access() {
    let (state, _temp_dir) = test_state("app_invoke_task_merge_unknown_method");

    let error = invoke(
        &state,
        "merge_task_pull_request",
        json!({
            "taskId": "T-missing",
            "prId": 42,
            "expectedHeadSha": "current-head",
            "mergeMethod": "octopus",
        }),
    )
    .await
    .expect_err("unknown merge method must reject before GitHub access");

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
    assert!(error.1.contains("mergeMethod"));
}

#[tokio::test]
async fn task_merge_rejects_method_not_allowed_for_pull_request() {
    let (state, _temp_dir) = test_state("app_invoke_task_merge_disallowed_method");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("Merge PR", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            42, &task.id, "owner", "repo", "PR", "url", "open", 1, 1, false,
        )
        .expect("insert PR");
        db.update_pr_head_sha(42, "current-head").expect("set head");
        db.update_pr_merge_readiness(
            42,
            &crate::db::PrMergeReadinessFacts {
                status: Some("ready_to_merge".to_string()),
                action: Some("merge".to_string()),
                blockers_json: Some("[]".to_string()),
                warnings_json: Some("[]".to_string()),
                source_head_sha: Some("current-head".to_string()),
                merge_group_sha: None,
                required_checks_policy_known: Some(true),
                required_reviews_policy_known: Some(true),
                merge_queue_required: Some(false),
                merge_queue_state: None,
                updated_at: 1,
            },
        )
        .expect("set readiness");
        db.update_pr_merge_method_policy(42, true, r#"["squash"]"#, Some("squash"))
            .expect("set merge methods");
        task.id
    };

    let error = invoke(
        &state,
        "merge_task_pull_request",
        json!({
            "taskId": task_id,
            "prId": 42,
            "expectedHeadSha": "current-head",
            "mergeMethod": "merge",
        }),
    )
    .await
    .expect_err("disallowed merge method must reject before GitHub access");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("not allowed"));
}

#[tokio::test]
async fn refresh_task_github_status_rejects_missing_task() {
    let (state, _temp_dir) = test_state("app_invoke_refresh_task_github_status_missing_task");

    let err = invoke(
        &state,
        "refresh_task_github_status",
        json!({ "taskId": "T-missing" }),
    )
    .await
    .expect_err("missing task should be rejected before GitHub calls");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));
}

#[tokio::test]
async fn link_pull_request_rejects_invalid_url() {
    let (state, _temp_dir) = test_state("app_invoke_link_pull_request_invalid_url");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Link PR task", "doing", None, None, None)
            .expect("create task")
            .id
    };

    let err = invoke(
        &state,
        "link_pull_request",
        json!({ "taskId": task_id, "prUrl": "https://example.com/owner/repo/pull/123" }),
    )
    .await
    .expect_err("non-GitHub PR URL should be rejected");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("Invalid pull request URL"));
}

#[tokio::test]
async fn submit_pr_review_rejects_null_comments_before_runtime() {
    let (state, _temp_dir) = test_state("app_invoke_submit_pr_review_null_comments");

    let err = invoke(
        &state,
        "submit_pr_review",
        json!({
            "owner": "owner",
            "repo": "repo",
            "prNumber": 7,
            "event": "COMMENT",
            "body": "looks risky",
            "commitId": "sha-1",
            "comments": null,
        }),
    )
    .await
    .expect_err("null comments should be rejected before GitHub runtime");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("payload.comments is invalid"));
}

#[tokio::test]
async fn handles_db_backed_commands_and_events() {
    let (state, _temp_dir) = test_state("app_invoke_github_review_db_backed");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("PR task", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            10,
            &task.id,
            "owner",
            "repo",
            "Fix bug",
            "https://github.com/owner/repo/pull/5",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert PR");
        db.insert_pr_comment(
            501,
            10,
            "reviewer",
            "Please fix",
            "review",
            Some("src/main.rs"),
            Some(12),
            false,
            3000,
        )
        .expect("insert PR comment");
        db.upsert_review_pr(
            20,
            7,
            "Review me",
            Some("body"),
            "open",
            false,
            "https://github.com/owner/repo/pull/7",
            "author",
            None,
            "owner",
            "repo",
            "feature",
            "main",
            "sha-1",
            10,
            2,
            3,
            &[],
            1000,
            2000,
        )
        .expect("upsert review PR");
        db.upsert_authored_pr(
            30,
            9,
            "Authored by me",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/9",
            "me",
            None,
            "owner",
            "repo",
            "feature-authored",
            "main",
            "sha-authored",
            1,
            1,
            1,
            Some("success"),
            None,
            Some("approved"),
            None,
            false,
            Some(&task.id),
            &[],
            1000,
            2000,
        )
        .expect("upsert authored PR");
    }

    assert_eq!(
        invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await[0]["title"],
        "Fix bug"
    );
    assert_eq!(
        invoke_ok(&state, "get_pr_comments", json!({ "prId": 10 })).await[0]["body"],
        "Please fix"
    );
    invoke_ok(
        &state,
        "mark_comment_addressed",
        json!({ "commentId": 501 }),
    )
    .await;
    let event = events.recv().await.expect("comment addressed event");
    assert_eq!(event.event_name, "comment-addressed");
    assert_eq!(
        invoke_ok(&state, "get_review_prs", serde_json::Value::Null).await[0]["title"],
        "Review me"
    );
    invoke_ok(
        &state,
        "mark_review_pr_viewed",
        json!({ "prId": 20, "headSha": "sha-1" }),
    )
    .await;
    // Marking a PR viewed changes the unopened count, so the renderer is notified to
    // refresh the sidebar/rail badges immediately.
    let viewed_event = events.recv().await.expect("review pr count changed event");
    assert_eq!(viewed_event.event_name, "review-pr-count-changed");
    invoke_ok(&state, "mark_review_pr_unviewed", json!({ "prId": 20 })).await;
    // Marking a PR unviewed resets it to unread, again changing the unopened count, so
    // the renderer is notified to refresh the sidebar/rail badges.
    let unviewed_event = events.recv().await.expect("review pr count changed event");
    assert_eq!(unviewed_event.event_name, "review-pr-count-changed");
    assert_eq!(
        invoke_ok(&state, "get_authored_prs", serde_json::Value::Null).await[0]["title"],
        "Authored by me"
    );
}

#[tokio::test]
#[ignore = "known bug KVG-4224"]
async fn linking_rejects_a_well_formed_url_for_a_nonexistent_pull_request() {
    let (state, _temp_dir) = test_state("app_invoke_link_nonexistent_pr");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Reject nonexistent PR", "doing", None, None, None)
            .expect("create task")
            .id
    };

    invoke(
        &state,
        "link_pull_request",
        json!({
            "taskId": task_id,
            "prUrl": "https://github.com/owner/repo/pull/999999999",
        }),
    )
    .await
    .expect_err("a nonexistent pull request must not be persisted");
}

#[tokio::test]
#[ignore = "known bug KVG-4224"]
async fn linking_a_pull_request_to_another_task_does_not_remove_the_original_link() {
    let (state, _temp_dir) = test_state("app_invoke_link_pr_to_two_tasks");
    let (original_task_id, other_task_id) = {
        let db = state.db.lock().expect("db lock");
        let original = db
            .create_task("Original PR task", "doing", None, None, None)
            .expect("create original task");
        let other = db
            .create_task("Other PR task", "doing", None, None, None)
            .expect("create other task");
        (original.id, other.id)
    };
    let pr_url = "https://github.com/owner/repo/pull/77";

    invoke_ok(
        &state,
        "link_pull_request",
        json!({ "taskId": original_task_id, "prUrl": pr_url }),
    )
    .await;
    let _second_link = invoke(
        &state,
        "link_pull_request",
        json!({ "taskId": other_task_id, "prUrl": pr_url }),
    )
    .await;

    let original_pull_requests = invoke_ok(
        &state,
        "get_pull_requests",
        json!({ "taskId": original_task_id }),
    )
    .await;
    assert_eq!(
        original_pull_requests.as_array().map(Vec::len),
        Some(1),
        "linking elsewhere must not silently remove the original Task association"
    );
}

#[tokio::test]
#[ignore = "known bug KVG-4224"]
async fn linking_accepts_a_case_insensitive_github_hostname() {
    let (state, _temp_dir) = test_state("app_invoke_link_mixed_case_host");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Mixed-case GitHub host", "doing", None, None, None)
            .expect("create task")
            .id
    };

    invoke(
        &state,
        "link_pull_request",
        json!({
            "taskId": task_id,
            "prUrl": "https://GitHub.com/owner/repo/pull/77",
        }),
    )
    .await
    .expect("DNS hostnames are case-insensitive");
}

#[tokio::test]
#[ignore = "known bug KVG-4224"]
async fn linking_repository_paths_with_different_case_does_not_duplicate_the_pull_request() {
    let (state, _temp_dir) = test_state("app_invoke_link_mixed_case_repo");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        db.create_task("Mixed-case repository", "doing", None, None, None)
            .expect("create task")
            .id
    };

    invoke_ok(
        &state,
        "link_pull_request",
        json!({
            "taskId": task_id,
            "prUrl": "https://github.com/owner/repo/pull/77",
        }),
    )
    .await;
    invoke_ok(
        &state,
        "link_pull_request",
        json!({
            "taskId": task_id,
            "prUrl": "https://github.com/Owner/Repo/pull/77",
        }),
    )
    .await;

    let pull_requests = invoke_ok(&state, "get_pull_requests", json!({ "taskId": task_id })).await;
    assert_eq!(
        pull_requests.as_array().map(Vec::len),
        Some(1),
        "GitHub owner and repository identity is case-insensitive"
    );
}

#[tokio::test]
#[ignore = "known bug KVG-4224"]
async fn marking_a_nonexistent_comment_addressed_returns_not_found() {
    let (state, _temp_dir) = test_state("app_invoke_mark_missing_comment_addressed");

    let error = invoke(
        &state,
        "mark_comment_addressed",
        json!({ "commentId": 999999 }),
    )
    .await
    .expect_err("a missing comment must not report a successful update");

    assert_eq!(error.0, StatusCode::NOT_FOUND);
}
