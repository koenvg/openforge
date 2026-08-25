use super::fixtures::{PrCommentFixture, PullRequestFixture};

use crate::db::test_helpers::*;
use crate::db::PrMergeReadinessFacts;

#[test]
fn test_pull_request_crud() {
    let (db, _temp_dir) = make_test_db("pr_crud");
    insert_test_task(&db);

    PullRequestFixture::new(42)
        .title("Fix auth")
        .url("https://github.com/acme/repo/pull/42")
        .updated_at(2000)
        .insert(&db)
        .expect("insert pr failed");

    let open_prs = db.get_open_prs().expect("get open prs failed");
    assert_eq!(open_prs.len(), 1);
    assert_eq!(open_prs[0].id, 42);
    assert_eq!(open_prs[0].ticket_id, "T-100");
    assert_eq!(open_prs[0].state, "open");

    PullRequestFixture::new(42)
        .title("Fix auth")
        .url("https://github.com/acme/repo/pull/42")
        .state("merged")
        .updated_at(3000)
        .insert(&db)
        .expect("update pr failed");

    let open_prs = db.get_open_prs().expect("get open prs failed");
    assert_eq!(open_prs.len(), 0);

    drop(db);
}

#[test]
fn test_pull_request_terminal_state_updates_merged_and_closed() {
    let (db, _temp_dir) = make_test_db("pr_terminal_state_updates");
    insert_test_task(&db);

    PullRequestFixture::new(42)
        .title("Fix auth")
        .url("https://github.com/acme/repo/pull/42")
        .updated_at(2000)
        .insert(&db)
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

    PullRequestFixture::new(42)
        .title("Legacy title")
        .url("https://github.com/acme/repo/pull/42")
        .insert(&db)
        .expect("insert legacy pr failed");
    PrCommentFixture::new(9001, 42, "Still needs work")
        .file_path("src/main.rs")
        .line_number(12)
        .created_at(1500)
        .insert(&db)
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

    PullRequestFixture::new(10)
        .title("PR title")
        .insert(&db)
        .expect("insert pr failed");

    let missing_comment = db
        .get_pr_comments_by_ids(&[501])
        .expect("check missing comment failed");
    assert!(missing_comment.is_empty());

    PrCommentFixture::new(501, 10, "Fix this")
        .file_path("src/main.rs")
        .line_number(42)
        .created_at(2000)
        .insert(&db)
        .expect("insert comment failed");
    PrCommentFixture::new(502, 10, "Nit: rename")
        .created_at(2001)
        .insert(&db)
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
fn test_mark_comments_addressed_batch() {
    let (db, _temp_dir) = make_test_db("mark_batch_addressed");
    insert_test_task(&db);

    PullRequestFixture::new(30)
        .insert(&db)
        .expect("insert pr failed");

    PrCommentFixture::new(701, 30, "c1")
        .author("a")
        .created_at(4000)
        .insert(&db)
        .expect("insert failed");
    PrCommentFixture::new(702, 30, "c2")
        .author("b")
        .created_at(4001)
        .insert(&db)
        .expect("insert failed");
    PrCommentFixture::new(703, 30, "c3")
        .author("c")
        .created_at(4002)
        .insert(&db)
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
    insert_test_task(&db);

    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Test PR")
        .url("https://github.com/pr/42")
        .insert(&db)
        .expect("insert PR through migrated schema failed");

    let prs = db
        .get_open_prs()
        .expect("query PR through migrated schema failed");
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].head_sha, "");
    assert_eq!(prs[0].ci_status, None);
    assert_eq!(prs[0].ci_check_runs, None);

    drop(db);
}

#[test]
fn test_update_pr_ci_status() {
    let (db, _temp_dir) = make_test_db("ci_status_update");
    insert_test_task(&db);

    let now = 1000i64;
    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Test PR")
        .url("https://github.com/pr/42")
        .created_at(now)
        .updated_at(now)
        .insert(&db)
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
    let _ = PullRequestFixture::new(1)
        .repo_owner("owner")
        .title("Test PR")
        .url("https://url")
        .insert(&db);
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
    let _ = PullRequestFixture::new(1)
        .repo_owner("owner")
        .title("Test PR")
        .url("https://url")
        .insert(&db);

    db.update_pr_mergeability(1, Some(false), Some("dirty"))
        .unwrap();

    let prs = db.get_open_prs().unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].mergeable, Some(false));
    assert_eq!(prs[0].mergeable_state.as_deref(), Some("dirty"));
}

#[test]
fn test_pr_upsert_preserves_terminal_state_against_stale_open_data() {
    let (db, _temp_dir) = make_test_db("pr_upsert_preserve_terminal_state");
    insert_test_task(&db);

    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Merged PR")
        .url("https://github.com/pr/42")
        .insert(&db)
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

    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Stale open poll")
        .url("https://github.com/pr/42")
        .updated_at(2000)
        .insert(&db)
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

    PullRequestFixture::new(43)
        .repo_owner("owner")
        .title("Closed PR")
        .url("https://github.com/pr/43")
        .insert(&db)
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
    PullRequestFixture::new(43)
        .repo_owner("owner")
        .title("Stale reopened poll")
        .url("https://github.com/pr/43")
        .updated_at(2000)
        .insert(&db)
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
    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Test PR")
        .url("https://github.com/pr/42")
        .created_at(now)
        .updated_at(now)
        .insert(&db)
        .unwrap();

    db.update_pr_ci_status(42, "sha123", "success", r#"[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]"#).unwrap();

    PullRequestFixture::new(42)
        .repo_owner("owner")
        .title("Test PR Updated")
        .url("https://github.com/pr/42")
        .created_at(now + 30)
        .updated_at(now + 30)
        .insert(&db)
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
fn test_pr_last_polled_lifecycle() {
    let (db, _temp_dir) = make_test_db("pr_last_polled");
    insert_test_task(&db);

    PullRequestFixture::new(60)
        .insert(&db)
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

    PullRequestFixture::new(100)
        .title("PR title")
        .insert(&db)
        .expect("insert pr failed");

    PrCommentFixture::new(701, 100, "Automated check passed")
        .author("bot-user")
        .addressed(true)
        .created_at(2000)
        .insert(&db)
        .expect("insert addressed comment failed");

    PrCommentFixture::new(702, 100, "Please fix this")
        .author("human-reviewer")
        .created_at(2001)
        .insert(&db)
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

    PullRequestFixture::new(110)
        .title("PR title")
        .insert(&db)
        .expect("insert pr failed");

    // A comment the user has already addressed locally.
    PrCommentFixture::new(801, 110, "Please fix")
        .file_path("src/lib.rs")
        .line_number(10)
        .addressed(true)
        .created_at(2000)
        .insert(&db)
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
