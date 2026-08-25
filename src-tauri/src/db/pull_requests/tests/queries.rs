use crate::db::test_helpers::*;

#[test]
fn pull_requests_can_be_queried_for_one_task() {
    let (db, _temp_dir) = make_test_db("pr_for_task");
    let requested_task = db
        .create_task("Requested task", "backlog", None, None, None)
        .expect("create requested task failed");
    let other_task = db
        .create_task("Other task", "backlog", None, None, None)
        .expect("create other task failed");

    db.insert_pull_request(
        42,
        &requested_task.id,
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
        &other_task.id,
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
        .get_pull_requests_for_task(&requested_task.id)
        .expect("get task PRs failed");
    assert_eq!(pull_requests.len(), 1);
    assert_eq!(pull_requests[0].ticket_id, requested_task.id);
    assert_eq!(pull_requests[0].title, "Requested task PR");

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
