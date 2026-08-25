use super::fixtures::{PrCommentFixture, PullRequestFixture};

use crate::db::test_helpers::*;

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
