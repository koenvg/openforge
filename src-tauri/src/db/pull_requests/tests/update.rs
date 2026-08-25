use super::fixtures::PullRequestFixture;

use crate::db::test_helpers::*;
use crate::db::PrMergeReadinessFacts;

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
