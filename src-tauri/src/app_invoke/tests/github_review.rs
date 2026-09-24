use super::*;
use axum::{
    routing::{get, post},
    Json, Router,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

mod hydration;
async fn reply_test_github_client(
    status: StatusCode,
    request_count: Arc<AtomicUsize>,
) -> crate::github_client::GitHubClient {
    let router = Router::new().route(
        "/repos/acme/widgets/pulls/7/comments/503/replies",
        post(move || {
            let request_count = Arc::clone(&request_count);
            async move {
                request_count.fetch_add(1, Ordering::SeqCst);
                (
                    status,
                    Json(json!({
                        "id": 504,
                        "path": "src/lib.rs",
                        "line": 10,
                        "side": "RIGHT",
                        "body": "Applied, thanks",
                        "user": { "login": "author" },
                        "created_at": "2026-09-17T08:00:00Z",
                        "in_reply_to_id": 503
                    })),
                )
            }
        }),
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

    crate::github_client::GitHubClient::with_test_token(Ok(Some("token".to_string())))
        .with_test_api_base_url(format!("http://{address}"))
}

fn seed_reply_thread(state: &crate::http_server::AppState) {
    let db = state.db.lock().expect("db lock");
    let task = db
        .create_task("Reply task", "doing", None, None, None)
        .expect("create task");
    db.insert_pull_request_with_number(
        70,
        7,
        &task.id,
        "acme",
        "widgets",
        "Reply test",
        "https://github.com/acme/widgets/pull/7",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert PR");
    db.insert_pr_comment(
        501,
        70,
        "reviewer",
        "Root",
        "review_comment",
        Some("src/lib.rs"),
        Some(10),
        None,
        false,
        1000,
    )
    .expect("insert root");
    for (id, parent_id) in [(502, 501), (503, 502)] {
        db.insert_pr_comment(
            id,
            70,
            "reviewer",
            "Reply",
            "review_comment",
            Some("src/lib.rs"),
            Some(10),
            Some(parent_id),
            false,
            id,
        )
        .expect("insert reply");
    }
}

#[tokio::test]
async fn replying_to_a_deep_reply_addresses_its_thread_root() {
    let (mut state, _temp_dir) = test_state("app_invoke_reply_addresses_root");
    seed_reply_thread(&state);
    let request_count = Arc::new(AtomicUsize::new(0));
    state.github_client =
        reply_test_github_client(StatusCode::CREATED, Arc::clone(&request_count)).await;
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();

    let reply = invoke_ok(
        &state,
        "create_review_comment_reply",
        json!({
            "owner": "acme",
            "repo": "widgets",
            "prNumber": 7,
            "commentId": 503,
            "body": "Applied, thanks",
        }),
    )
    .await;

    assert_eq!(reply["id"], 504);
    assert_eq!(request_count.load(Ordering::SeqCst), 1);
    let comments = invoke_ok(&state, "get_pr_comments", json!({ "prId": 70 })).await;
    let root = comments
        .as_array()
        .expect("comments array")
        .iter()
        .find(|comment| comment["id"] == 501)
        .expect("thread root");
    assert_eq!(root["addressed"], 1);
    assert_eq!(
        invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await[0]
            ["unaddressed_comment_count"],
        0
    );
    assert_eq!(
        events
            .recv()
            .await
            .expect("comment addressed event")
            .event_name,
        "comment-addressed"
    );
}

#[tokio::test]
async fn an_addressed_write_failure_does_not_turn_an_accepted_reply_into_a_failed_post() {
    let (mut state, _temp_dir) = test_state("app_invoke_reply_address_write_failure");
    seed_reply_thread(&state);
    {
        let db = state.db.lock().expect("db lock");
        db.connection()
            .lock()
            .expect("connection lock")
            .execute_batch("PRAGMA query_only = ON")
            .expect("make database read-only");
    }
    let request_count = Arc::new(AtomicUsize::new(0));
    state.github_client =
        reply_test_github_client(StatusCode::CREATED, Arc::clone(&request_count)).await;
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();

    let reply = invoke_ok(
        &state,
        "create_review_comment_reply",
        json!({
            "owner": "acme",
            "repo": "widgets",
            "prNumber": 7,
            "commentId": 503,
            "body": "Applied, thanks",
        }),
    )
    .await;

    assert_eq!(reply["id"], 504);
    assert_eq!(request_count.load(Ordering::SeqCst), 1);
    let comments = invoke_ok(&state, "get_pr_comments", json!({ "prId": 70 })).await;
    let root = comments
        .as_array()
        .expect("comments array")
        .iter()
        .find(|comment| comment["id"] == 501)
        .expect("thread root");
    assert_eq!(root["addressed"], 0);
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn a_rejected_reply_leaves_the_thread_unaddressed() {
    let (mut state, _temp_dir) = test_state("app_invoke_reply_rejected");
    seed_reply_thread(&state);
    let request_count = Arc::new(AtomicUsize::new(0));
    state.github_client =
        reply_test_github_client(StatusCode::UNPROCESSABLE_ENTITY, Arc::clone(&request_count))
            .await;
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();

    let error = invoke(
        &state,
        "create_review_comment_reply",
        json!({
            "owner": "acme",
            "repo": "widgets",
            "prNumber": 7,
            "commentId": 503,
            "body": "Applied, thanks",
        }),
    )
    .await
    .expect_err("GitHub rejection must fail the reply");

    assert_eq!(error.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(request_count.load(Ordering::SeqCst), 1);
    let comments = invoke_ok(&state, "get_pr_comments", json!({ "prId": 70 })).await;
    let root = comments
        .as_array()
        .expect("comments array")
        .iter()
        .find(|comment| comment["id"] == 501)
        .expect("thread root");
    assert_eq!(root["addressed"], 0);
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn get_pr_head_sha_reads_only_the_requested_pull_request() {
    let (mut state, _temp_dir) = test_state("app_invoke_get_pr_head_sha");
    let router = Router::new().route(
        "/repos/acme/widgets/pulls/7",
        get(|| async {
            Json(json!({
                "number": 7,
                "title": "Head test",
                "state": "open",
                "html_url": "https://github.com/acme/widgets/pull/7",
                "user": { "login": "author" },
                "head": { "ref": "feature", "sha": "head-sha-7" },
                "draft": false
            }))
        }),
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
    state.github_client =
        crate::github_client::GitHubClient::with_test_token(Ok(Some("token".to_string())))
            .with_test_api_base_url(format!("http://{address}"));

    let head_sha = invoke_ok(
        &state,
        "get_pr_head_sha",
        json!({ "owner": "acme", "repo": "widgets", "prNumber": 7 }),
    )
    .await;

    assert_eq!(head_sha, json!("head-sha-7"));
}

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
async fn marking_a_stale_comment_addressed_is_idempotent() {
    let (state, _temp_dir) = test_state("app_invoke_mark_stale_comment_addressed");

    invoke_ok(
        &state,
        "mark_comment_addressed",
        json!({ "commentId": 999999 }),
    )
    .await;
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
            None,
            false,
            3000,
        )
        .expect("insert PR comment");
        db.insert_pr_comment(
            502,
            10,
            "author",
            "Updated",
            "review",
            Some("src/main.rs"),
            Some(12),
            Some(501),
            false,
            3001,
        )
        .expect("insert PR comment reply");
        db.upsert_review_pr(&crate::db::ReviewPrUpsert {
            id: 20,
            number: 7,
            title: "Review me".to_string(),
            body: Some("body".to_string()),
            state: "open".to_string(),
            draft: false,
            html_url: "https://github.com/owner/repo/pull/7".to_string(),
            user_login: "author".to_string(),
            user_avatar_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            head_ref: "feature".to_string(),
            base_ref: "main".to_string(),
            head_sha: "sha-1".to_string(),
            additions: 10,
            deletions: 2,
            changed_files: 3,
            ci_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            labels: vec![],
            created_at: 1000,
            updated_at: 2000,
        })
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
    let comments = invoke_ok(&state, "get_pr_comments", json!({ "prId": 10 })).await;
    assert_eq!(comments[0]["body"], "Please fix");
    assert_eq!(comments[0]["in_reply_to_id"], serde_json::Value::Null);
    assert_eq!(comments[1]["body"], "Updated");
    assert_eq!(comments[1]["in_reply_to_id"], 501);
    invoke_ok(
        &state,
        "mark_comment_addressed",
        json!({ "commentId": 501 }),
    )
    .await;
    let event = events.recv().await.expect("comment addressed event");
    assert_eq!(event.event_name, "comment-addressed");
    assert_eq!(
        invoke_ok(&state, "get_pr_comments", json!({ "prId": 10 })).await[0]["addressed"],
        1
    );
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
    invoke_ok(
        &state,
        "mark_review_pr_reviewed",
        json!({ "prId": 20, "headSha": "reviewed-sha" }),
    )
    .await;
    let reviewed = invoke_ok(&state, "get_review_prs", serde_json::Value::Null).await;
    assert_eq!(reviewed[0]["reviewed_head_sha"], "reviewed-sha");
    assert!(reviewed[0]["viewed_at"].is_number());
    assert_eq!(reviewed[0]["viewed_head_sha"], "sha-1");
    invoke_ok(&state, "mark_review_pr_needs_review", json!({ "prId": 20 })).await;
    let needs_review = invoke_ok(&state, "get_review_prs", serde_json::Value::Null).await;
    assert!(needs_review[0]["reviewed_head_sha"].is_null());
    assert!(needs_review[0]["viewed_at"].is_number());
    assert_eq!(needs_review[0]["viewed_head_sha"], "sha-1");
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
