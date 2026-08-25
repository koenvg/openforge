use crate::db::test_helpers::*;
use crate::db::PrMergeReadinessFacts;

#[test]
fn test_pull_request_crud() {
    let (db, _temp_dir) = make_test_db("pr_crud");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Fix auth",
        "https://github.com/acme/repo/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("insert pr failed");

    let open_prs = db.get_open_prs().expect("get open prs failed");
    assert_eq!(open_prs.len(), 1);
    assert_eq!(open_prs[0].id, 42);
    assert_eq!(open_prs[0].ticket_id, "T-100");
    assert_eq!(open_prs[0].state, "open");

    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Fix auth",
        "https://github.com/acme/repo/pull/42",
        "merged",
        1000,
        3000,
        false,
    )
    .expect("update pr failed");

    let open_prs = db.get_open_prs().expect("get open prs failed");
    assert_eq!(open_prs.len(), 0);

    drop(db);
}

#[test]
fn pull_requests_can_be_queried_for_one_task() {
    let (db, _temp_dir) = make_test_db("pr_for_task");
    insert_test_task(&db);
    {
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
                "INSERT INTO tasks (id, initial_prompt, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["T-200", "Other task", "backlog", 1000, 1000],
            )
            .expect("insert second task failed");
    }

    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Requested task PR",
        "https://github.com/acme/repo/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("insert requested task PR failed");
    db.insert_pull_request(
        43,
        "T-200",
        "acme",
        "repo",
        "Other task PR",
        "https://github.com/acme/repo/pull/43",
        "open",
        1000,
        3000,
        false,
    )
    .expect("insert other task PR failed");

    let pull_requests = db
        .get_pull_requests_for_task("T-100")
        .expect("get task PRs failed");
    assert_eq!(pull_requests.len(), 1);
    assert_eq!(pull_requests[0].ticket_id, "T-100");
    assert_eq!(pull_requests[0].title, "Requested task PR");

    drop(db);
}

#[test]
fn test_pull_request_terminal_state_updates_merged_and_closed() {
    let (db, _temp_dir) = make_test_db("pr_terminal_state_updates");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Fix auth",
        "https://github.com/acme/repo/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("insert pr failed");

    db.update_pr_merged_state(42, Some(1704067200))
        .expect("mark merged failed");
    let merged = db.get_all_pull_requests().expect("get prs failed");
    assert_eq!(merged[0].state, "merged");
    assert_eq!(merged[0].merged_at, Some(1704067200));

    db.update_pr_closed(42).expect("mark closed failed");
    let closed = db.get_all_pull_requests().expect("get prs failed");
    assert_eq!(closed[0].state, "closed");
    assert_eq!(closed[0].merged_at, None);

    drop(db);
}

#[test]
fn test_pull_requests_with_same_number_in_different_repositories_do_not_collide() {
    let (db, _temp_dir) = make_test_db("pr_same_number_different_repos");
    insert_test_task(&db);

    db.insert_pull_request_with_number(
        1001,
        42,
        "T-100",
        "acme",
        "web",
        "Web changes",
        "https://github.com/acme/web/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("insert web pr failed");
    db.insert_pull_request_with_number(
        2001,
        42,
        "T-100",
        "acme",
        "api",
        "API changes",
        "https://github.com/acme/api/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("insert api pr failed");

    let open_prs = db.get_open_prs().expect("get open prs failed");
    assert_eq!(open_prs.len(), 2);
    assert!(open_prs
        .iter()
        .any(|pr| pr.id == 1001 && pr.pr_number == 42 && pr.repo_name == "web"));
    assert!(open_prs
        .iter()
        .any(|pr| pr.id == 2001 && pr.pr_number == 42 && pr.repo_name == "api"));

    drop(db);
}

#[test]
fn test_global_pr_upsert_migrates_legacy_repo_number_row_and_comments() {
    let (db, _temp_dir) = make_test_db("pr_global_upsert_migrates_legacy_row");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Legacy title",
        "https://github.com/acme/repo/pull/42",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert legacy pr failed");
    db.insert_pr_comment(
        9001,
        42,
        "reviewer",
        "Still needs work",
        "review_comment",
        Some("src/main.rs"),
        Some(12),
        false,
        1500,
    )
    .expect("insert legacy comment failed");

    db.insert_pull_request_with_number(
        1001,
        42,
        "T-100",
        "acme",
        "repo",
        "Global title",
        "https://github.com/acme/repo/pull/42",
        "open",
        1000,
        2000,
        false,
    )
    .expect("upsert global pr failed");

    let all_prs = db.get_all_pull_requests().expect("get prs failed");
    assert_eq!(all_prs.len(), 1);
    assert_eq!(all_prs[0].id, 1001);
    assert_eq!(all_prs[0].pr_number, 42);
    assert_eq!(all_prs[0].title, "Global title");
    assert_eq!(all_prs[0].unaddressed_comment_count, 1);

    let comments = db.get_comments_for_pr(1001).expect("get comments failed");
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, 9001);
    assert_eq!(comments[0].pr_id, 1001);

    let legacy_comments = db
        .get_comments_for_pr(42)
        .expect("get legacy comments failed");
    assert!(legacy_comments.is_empty());

    drop(db);
}

#[test]
fn test_pr_comment_lifecycle() {
    let (db, _temp_dir) = make_test_db("pr_comment_lifecycle");
    insert_test_task(&db);

    db.insert_pull_request(
        10,
        "T-100",
        "acme",
        "repo",
        "PR title",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let missing_comment = db
        .get_pr_comments_by_ids(&[501])
        .expect("check missing comment failed");
    assert!(missing_comment.is_empty());

    db.insert_pr_comment(
        501,
        10,
        "reviewer",
        "Fix this",
        "review_comment",
        Some("src/main.rs"),
        Some(42),
        false,
        2000,
    )
    .expect("insert comment failed");
    db.insert_pr_comment(
        502,
        10,
        "reviewer",
        "Nit: rename",
        "review_comment",
        None,
        None,
        false,
        2001,
    )
    .expect("insert comment 2 failed");

    let inserted_comment = db
        .get_pr_comments_by_ids(&[501])
        .expect("check inserted comment failed");
    assert_eq!(inserted_comment.len(), 1);

    let comments = db.get_comments_for_pr(10).expect("get comments failed");
    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0].id, 501);
    assert_eq!(comments[0].author, "reviewer");
    assert_eq!(comments[0].file_path, Some("src/main.rs".to_string()));
    assert_eq!(comments[0].addressed, 0);

    db.mark_comment_addressed(501).expect("mark failed");

    let comments = db.get_comments_for_pr(10).expect("get comments failed");
    assert_eq!(comments[0].addressed, 1);
    assert_eq!(comments[1].addressed, 0);

    drop(db);
}

#[test]
fn test_get_pr_comments_by_ids() {
    let (db, _temp_dir) = make_test_db("pr_comments_by_ids");
    insert_test_task(&db);

    db.insert_pull_request(
        20,
        "T-100",
        "acme",
        "repo",
        "PR",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    db.insert_pr_comment(
        601,
        20,
        "alice",
        "Comment 1",
        "review_comment",
        None,
        None,
        false,
        3000,
    )
    .expect("insert 1 failed");
    db.insert_pr_comment(
        602,
        20,
        "bob",
        "Comment 2",
        "review_comment",
        None,
        None,
        false,
        3001,
    )
    .expect("insert 2 failed");
    db.insert_pr_comment(
        603,
        20,
        "carol",
        "Comment 3",
        "issue_comment",
        None,
        None,
        false,
        3002,
    )
    .expect("insert 3 failed");

    let result = db
        .get_pr_comments_by_ids(&[601, 603])
        .expect("get by ids failed");
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].author, "alice");
    assert_eq!(result[1].author, "carol");

    let empty = db.get_pr_comments_by_ids(&[]).expect("empty query failed");
    assert_eq!(empty.len(), 0);

    drop(db);
}

#[test]
fn test_mark_comments_addressed_batch() {
    let (db, _temp_dir) = make_test_db("mark_batch_addressed");
    insert_test_task(&db);

    db.insert_pull_request(
        30,
        "T-100",
        "acme",
        "repo",
        "PR",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    db.insert_pr_comment(
        701,
        30,
        "a",
        "c1",
        "review_comment",
        None,
        None,
        false,
        4000,
    )
    .expect("insert failed");
    db.insert_pr_comment(
        702,
        30,
        "b",
        "c2",
        "review_comment",
        None,
        None,
        false,
        4001,
    )
    .expect("insert failed");
    db.insert_pr_comment(
        703,
        30,
        "c",
        "c3",
        "review_comment",
        None,
        None,
        false,
        4002,
    )
    .expect("insert failed");

    db.mark_comments_addressed(&[701, 703])
        .expect("batch mark failed");

    let comments = db.get_comments_for_pr(30).expect("get failed");
    assert_eq!(comments[0].addressed, 1);
    assert_eq!(comments[1].addressed, 0);
    assert_eq!(comments[2].addressed, 1);

    drop(db);
}

#[test]
fn test_ci_status_migration() {
    let (db, _temp_dir) = make_test_db("ci_migration");

    let conn = db.connection();
    let conn = conn.lock().unwrap();

    let has_head_sha: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='head_sha'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let has_ci_status: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='ci_status'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let has_ci_check_runs: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='ci_check_runs'",
            [], |row| row.get(0)
        ).unwrap();

    assert!(has_head_sha, "head_sha column missing");
    assert!(has_ci_status, "ci_status column missing");
    assert!(has_ci_check_runs, "ci_check_runs column missing");

    drop(conn);
    drop(db);
}

#[test]
fn test_update_pr_ci_status() {
    let (db, _temp_dir) = make_test_db("ci_status_update");
    insert_test_task(&db);

    let now = 1000i64;
    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://github.com/pr/42",
        "open",
        now,
        now,
        false,
    )
    .unwrap();

    db.update_pr_ci_status(42, "sha123", "success", r#"[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]"#).unwrap();

    let prs = db.get_open_prs().unwrap();
    let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");

    assert_eq!(pr.head_sha, "sha123");
    assert_eq!(pr.ci_status, Some("success".to_string()));
    assert!(pr.ci_check_runs.is_some());
    assert!(pr.ci_check_runs.as_ref().unwrap().contains("build"));

    drop(db);
}

#[test]
fn test_update_pr_is_queued() {
    let (db, _temp_dir) = make_test_db("update_pr_is_queued");
    insert_test_task(&db);
    let _ = db.insert_pull_request(
        1,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://url",
        "open",
        1000,
        1000,
        false,
    );
    db.update_pr_is_queued(1, true).unwrap();
    let prs = db.get_open_prs().unwrap();
    assert_eq!(prs.len(), 1);
    assert!(prs[0].is_queued);
    db.update_pr_is_queued(1, false).unwrap();
    let prs = db.get_open_prs().unwrap();
    assert!(!prs[0].is_queued);
}

#[test]
fn test_update_pr_mergeability() {
    let (db, _temp_dir) = make_test_db("update_pr_mergeability");
    insert_test_task(&db);
    let _ = db.insert_pull_request(
        1,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://url",
        "open",
        1000,
        1000,
        false,
    );

    db.update_pr_mergeability(1, Some(false), Some("dirty"))
        .unwrap();

    let prs = db.get_open_prs().unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].mergeable, Some(false));
    assert_eq!(prs[0].mergeable_state.as_deref(), Some("dirty"));
}

#[test]
fn test_pr_merge_readiness_round_trip() {
    let (db, _temp_dir) = make_test_db("pr_merge_readiness_round_trip");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://github.com/pr/42",
        "open",
        1000,
        1000,
        false,
    )
    .unwrap();

    let facts = PrMergeReadinessFacts {
        status: Some("ready_to_enqueue".to_string()),
        action: Some("enqueue".to_string()),
        blockers_json: Some("[]".to_string()),
        warnings_json: Some(r#"[{"code":"branch_behind"}]"#.to_string()),
        source_head_sha: Some("head-sha".to_string()),
        merge_group_sha: Some("merge-group-sha".to_string()),
        required_checks_policy_known: Some(true),
        required_reviews_policy_known: Some(false),
        merge_queue_required: Some(true),
        merge_queue_state: Some("not_queued".to_string()),
        updated_at: 1704067200,
    };

    db.update_pr_merge_readiness(42, &facts).unwrap();
    db.update_pr_merge_method_policy(42, true, r#"["squash","rebase"]"#, Some("squash"))
        .unwrap();

    let prs = db.get_open_prs().unwrap();
    let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");
    assert_eq!(
        pr.merge_readiness_status.as_deref(),
        Some("ready_to_enqueue")
    );
    assert_eq!(pr.merge_readiness_action.as_deref(), Some("enqueue"));
    assert_eq!(pr.merge_readiness_blockers.as_deref(), Some("[]"));
    assert_eq!(
        pr.merge_readiness_warnings.as_deref(),
        Some(r#"[{"code":"branch_behind"}]"#)
    );
    assert_eq!(pr.readiness_source_head_sha.as_deref(), Some("head-sha"));
    assert_eq!(pr.merge_group_sha.as_deref(), Some("merge-group-sha"));
    assert_eq!(pr.required_checks_policy_known, Some(true));
    assert_eq!(pr.required_reviews_policy_known, Some(false));
    assert_eq!(pr.merge_queue_required, Some(true));
    assert_eq!(pr.merge_queue_state.as_deref(), Some("not_queued"));
    assert_eq!(pr.readiness_updated_at, Some(1704067200));
    assert_eq!(pr.merge_methods_policy_known, Some(true));
    assert_eq!(
        pr.allowed_merge_methods.as_deref(),
        Some(r#"["squash","rebase"]"#)
    );
    assert_eq!(pr.default_merge_method.as_deref(), Some("squash"));
    let policy = pr
        .merge_method_policy()
        .expect("persisted merge method policy should decode");
    assert_eq!(
        policy.allowed,
        vec![
            crate::github_client::PullRequestMergeMethod::Squash,
            crate::github_client::PullRequestMergeMethod::Rebase,
        ]
    );
    assert_eq!(
        policy.default,
        Some(crate::github_client::PullRequestMergeMethod::Squash)
    );

    let mut unavailable_policy = pr.clone();
    unavailable_policy.merge_methods_policy_known = Some(false);
    assert_eq!(unavailable_policy.merge_method_policy(), None);

    let mut malformed_policy = pr.clone();
    malformed_policy.allowed_merge_methods = Some("not-json".to_string());
    assert_eq!(malformed_policy.merge_method_policy(), None);

    let mut unsupported_default = pr.clone();
    unsupported_default.default_merge_method = Some("merge".to_string());
    assert_eq!(
        unsupported_default
            .merge_method_policy()
            .expect("allowed methods should still decode")
            .default,
        None
    );

    drop(db);
}

#[test]
fn test_pr_upsert_preserves_terminal_state_against_stale_open_data() {
    let (db, _temp_dir) = make_test_db("pr_upsert_preserve_terminal_state");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Merged PR",
        "https://github.com/pr/42",
        "open",
        1000,
        1000,
        false,
    )
    .unwrap();
    db.update_pr_merge_readiness(
        42,
        &PrMergeReadinessFacts {
            status: Some("ready_to_merge".to_string()),
            action: Some("merge".to_string()),
            blockers_json: Some("[]".to_string()),
            warnings_json: Some("[]".to_string()),
            source_head_sha: Some("sha-before-merge".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: Some(true),
            required_reviews_policy_known: Some(true),
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 1001,
        },
    )
    .unwrap();
    db.update_pr_merged_state(42, Some(1704067200)).unwrap();

    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Stale open poll",
        "https://github.com/pr/42",
        "open",
        1000,
        2000,
        false,
    )
    .unwrap();

    let prs = db.get_all_pull_requests().unwrap();
    let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");
    assert_eq!(pr.state, "merged");
    assert_eq!(pr.merged_at, Some(1704067200));
    assert_eq!(pr.title, "Stale open poll");
    assert_eq!(pr.merge_readiness_status.as_deref(), Some("blocked"));
    assert_eq!(
        pr.merge_readiness_action.as_deref(),
        Some("resolve_blockers")
    );
    assert!(pr
        .merge_readiness_blockers
        .as_deref()
        .unwrap_or_default()
        .contains("already_merged"));

    db.insert_pull_request(
        43,
        "T-100",
        "owner",
        "repo",
        "Closed PR",
        "https://github.com/pr/43",
        "open",
        1000,
        1000,
        false,
    )
    .unwrap();
    db.update_pr_merge_readiness(
        43,
        &PrMergeReadinessFacts {
            status: Some("ready_to_merge".to_string()),
            action: Some("merge".to_string()),
            blockers_json: Some("[]".to_string()),
            warnings_json: Some("[]".to_string()),
            source_head_sha: Some("sha-before-close".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: Some(true),
            required_reviews_policy_known: Some(true),
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 1001,
        },
    )
    .unwrap();
    db.update_pr_closed(43).unwrap();
    db.insert_pull_request(
        43,
        "T-100",
        "owner",
        "repo",
        "Stale reopened poll",
        "https://github.com/pr/43",
        "open",
        1000,
        2000,
        false,
    )
    .unwrap();

    let prs = db.get_all_pull_requests().unwrap();
    let closed = prs
        .iter()
        .find(|p| p.id == 43)
        .expect("closed PR not found");
    assert_eq!(closed.state, "closed");
    assert_eq!(closed.merged_at, None);
    assert_eq!(closed.merge_readiness_status.as_deref(), Some("blocked"));
    assert!(closed
        .merge_readiness_blockers
        .as_deref()
        .unwrap_or_default()
        .contains("pull_request_closed"));

    drop(db);
}

#[test]
fn test_pr_upsert_preserves_ci_status() {
    let (db, _temp_dir) = make_test_db("ci_upsert_preserve");
    insert_test_task(&db);

    let now = 1000i64;
    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://github.com/pr/42",
        "open",
        now,
        now,
        false,
    )
    .unwrap();

    db.update_pr_ci_status(42, "sha123", "success", r#"[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]"#).unwrap();

    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Test PR Updated",
        "https://github.com/pr/42",
        "open",
        now + 30,
        now + 30,
        false,
    )
    .unwrap();

    let prs = db.get_open_prs().unwrap();
    let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");

    assert_eq!(
        pr.ci_status,
        Some("success".to_string()),
        "CI status was wiped by upsert!"
    );
    assert!(
        pr.ci_check_runs.is_some(),
        "CI check runs were wiped by upsert!"
    );
    assert_eq!(pr.head_sha, "sha123", "Head SHA was wiped by upsert!");
    assert_eq!(pr.title, "Test PR Updated");

    drop(db);
}

#[test]
fn test_get_existing_comment_ids() {
    let (db, _temp_dir) = make_test_db("existing_comment_ids");
    insert_test_task(&db);

    db.insert_pull_request(
        50,
        "T-100",
        "acme",
        "repo",
        "PR",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    db.insert_pr_comment(
        801,
        50,
        "alice",
        "c1",
        "review_comment",
        None,
        None,
        false,
        5000,
    )
    .expect("insert c1 failed");
    db.insert_pr_comment(
        802,
        50,
        "bob",
        "c2",
        "review_comment",
        None,
        None,
        false,
        5001,
    )
    .expect("insert c2 failed");
    db.insert_pr_comment(
        803,
        50,
        "carol",
        "c3",
        "review_comment",
        None,
        None,
        false,
        5002,
    )
    .expect("insert c3 failed");

    let existing = db
        .get_existing_comment_ids(50)
        .expect("get existing comment ids failed");

    assert_eq!(existing.len(), 3);
    assert!(existing.contains(&801));
    assert!(existing.contains(&802));
    assert!(existing.contains(&803));

    let empty = db
        .get_existing_comment_ids(999)
        .expect("get for nonexistent pr failed");
    assert_eq!(empty.len(), 0);

    drop(db);
}

#[test]
fn test_pr_last_polled_lifecycle() {
    let (db, _temp_dir) = make_test_db("pr_last_polled");
    insert_test_task(&db);

    db.insert_pull_request(
        60,
        "T-100",
        "acme",
        "repo",
        "PR",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let initial = db.get_pr_last_polled(60).expect("get initial failed");
    assert_eq!(initial, Some(0));

    db.set_pr_last_polled(60, 1700000000)
        .expect("set last polled failed");

    let updated = db.get_pr_last_polled(60).expect("get updated failed");
    assert_eq!(updated, Some(1700000000));

    let nonexistent = db.get_pr_last_polled(999).expect("get nonexistent failed");
    assert_eq!(nonexistent, None);

    drop(db);
}

#[test]
fn test_insert_pr_comment_with_addressed() {
    let (db, _temp_dir) = make_test_db("pr_comment_addressed");
    insert_test_task(&db);

    db.insert_pull_request(
        100,
        "T-100",
        "acme",
        "repo",
        "PR title",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    db.insert_pr_comment(
        701,
        100,
        "bot-user",
        "Automated check passed",
        "review_comment",
        None,
        None,
        true,
        2000,
    )
    .expect("insert addressed comment failed");

    db.insert_pr_comment(
        702,
        100,
        "human-reviewer",
        "Please fix this",
        "review_comment",
        None,
        None,
        false,
        2001,
    )
    .expect("insert unaddressed comment failed");

    let comments = db.get_comments_for_pr(100).expect("get comments failed");
    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0].id, 701);
    assert_eq!(comments[0].addressed, 1);
    assert_eq!(comments[1].id, 702);
    assert_eq!(comments[1].addressed, 0);

    drop(db);
}

#[test]
fn test_update_comment_outdated_preserves_addressed() {
    let (db, _temp_dir) = make_test_db("comment_outdated_preserves_addressed");
    insert_test_task(&db);

    db.insert_pull_request(
        110,
        "T-100",
        "acme",
        "repo",
        "PR title",
        "https://example.com",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    // A comment the user has already addressed locally.
    db.insert_pr_comment(
        801,
        110,
        "reviewer",
        "Please fix",
        "review_comment",
        Some("src/lib.rs"),
        Some(10),
        true,
        2000,
    )
    .expect("insert comment failed");

    // Newly inserted comments default to not-outdated.
    let comments = db.get_comments_for_pr(110).expect("get comments failed");
    assert_eq!(
        comments[0].outdated, 0,
        "new comments default to not outdated"
    );
    assert_eq!(comments[0].addressed, 1);

    // The poller re-reads and finds it outdated — the local addressed flag must survive.
    db.update_comment_outdated(801, true)
        .expect("update outdated failed");
    let comments = db.get_comments_for_pr(110).expect("get comments failed");
    assert_eq!(comments[0].outdated, 1, "outdated flag updated");
    assert_eq!(
        comments[0].addressed, 1,
        "addressed flag preserved through outdated update"
    );

    // And it can flip back without disturbing addressed.
    db.update_comment_outdated(801, false)
        .expect("clear outdated failed");
    let comments = db.get_comments_for_pr(110).expect("get comments failed");
    assert_eq!(comments[0].outdated, 0);
    assert_eq!(comments[0].addressed, 1);

    drop(db);
}

#[test]
fn test_unaddressed_comment_count_subquery() {
    let (db, _temp_dir) = make_test_db("unaddressed_count");
    insert_test_task(&db);

    db.insert_pull_request(
        101,
        "T-100",
        "acme",
        "repo",
        "PR 1",
        "https://example.com/1",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr 1 failed");

    db.insert_pr_comment(
        711,
        101,
        "bot",
        "Check passed",
        "review_comment",
        None,
        None,
        false,
        2000,
    )
    .expect("insert comment 1 failed");
    db.insert_pr_comment(
        712,
        101,
        "reviewer",
        "Fix this",
        "review_comment",
        None,
        None,
        false,
        2001,
    )
    .expect("insert comment 2 failed");
    db.insert_pr_comment(
        713,
        101,
        "reviewer",
        "Also fix that",
        "review_comment",
        None,
        None,
        false,
        2002,
    )
    .expect("insert comment 3 failed");

    db.insert_pull_request(
        102,
        "T-100",
        "acme",
        "repo",
        "PR 2",
        "https://example.com/2",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr 2 failed");

    let prs = db.get_all_pull_requests().expect("get prs failed");
    let pr1 = prs.iter().find(|p| p.id == 101).expect("pr 1 not found");
    let pr2 = prs.iter().find(|p| p.id == 102).expect("pr 2 not found");

    assert_eq!(pr1.unaddressed_comment_count, 3);
    assert_eq!(pr2.unaddressed_comment_count, 0);

    drop(db);
}
