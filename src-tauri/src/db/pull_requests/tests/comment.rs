use super::fixtures::{PrCommentFixture, PullRequestFixture};

use crate::db::test_helpers::*;

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
