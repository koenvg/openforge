use super::fixtures::{PrCommentFixture, PullRequestFixture};

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

    PullRequestFixture::new(42)
        .ticket_id(&requested_task.id)
        .title("Requested task PR")
        .url("https://github.com/acme/repo/pull/42")
        .updated_at(2000)
        .insert(&db)
        .expect("insert requested task PR failed");
    PullRequestFixture::new(43)
        .ticket_id(&other_task.id)
        .title("Other task PR")
        .url("https://github.com/acme/repo/pull/43")
        .updated_at(3000)
        .insert(&db)
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
fn repository_number_lookup_uses_the_case_sensitive_index() {
    let (db, _temp_dir) = make_test_db("pr_repository_number_query_plan");
    let task = db
        .create_task("Linked task", "doing", None, None, None)
        .expect("create task");
    for (id, owner, repo, number, updated_at) in [
        (101_i64, "owner", "repo", 77_i64, 100_i64),
        (102_i64, "Owner", "repo", 77_i64, 200_i64),
        (103_i64, "other", "repo", 77_i64, 300_i64),
        (104_i64, "owner", "other", 77_i64, 400_i64),
        (105_i64, "owner", "repo", 78_i64, 500_i64),
    ] {
        db.insert_pull_request_with_number(
            id,
            number,
            &task.id,
            owner,
            repo,
            "Pull request",
            "https://github.com/owner/repo/pull/77",
            "open",
            1,
            updated_at,
            false,
        )
        .expect("insert pull request");
    }

    let pull_request = db
        .get_pull_request_by_repository_number("owner", "repo", 77)
        .expect("query pull request")
        .expect("find exact repository identity");
    assert_eq!(pull_request.id, 101);

    let connection = db.connection();
    let conn = connection.lock().expect("lock connection");
    let query = format!(
        "EXPLAIN QUERY PLAN SELECT id FROM pull_requests {}",
        crate::db::pull_requests::queries::PULL_REQUEST_BY_REPOSITORY_NUMBER_CLAUSE
    );
    let details = conn
        .prepare(&query)
        .expect("prepare repository/number query plan")
        .query_map(rusqlite::params!["owner", "repo", 77_i64], |row| {
            row.get::<_, String>(3)
        })
        .expect("query repository/number plan")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("read repository/number plan");
    let plan = details.join("\n");
    assert!(
        plan.contains("idx_pull_requests_repository_number"),
        "query plan should use the repository/number index:\n{plan}"
    );
    assert!(
        !plan.contains("USE TEMP B-TREE FOR ORDER BY"),
        "query plan should use index order for duplicate rows:\n{plan}"
    );
}

#[test]
fn test_get_pr_comments_by_ids() {
    let (db, _temp_dir) = make_test_db("pr_comments_by_ids");
    insert_test_task(&db);

    PullRequestFixture::new(20)
        .insert(&db)
        .expect("insert pr failed");

    PrCommentFixture::new(601, 20, "Comment 1")
        .author("alice")
        .created_at(3000)
        .insert(&db)
        .expect("insert 1 failed");
    PrCommentFixture::new(602, 20, "Comment 2")
        .author("bob")
        .created_at(3001)
        .insert(&db)
        .expect("insert 2 failed");
    PrCommentFixture::new(603, 20, "Comment 3")
        .author("carol")
        .comment_type("issue_comment")
        .created_at(3002)
        .insert(&db)
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

    PullRequestFixture::new(50)
        .insert(&db)
        .expect("insert pr failed");

    PrCommentFixture::new(801, 50, "c1")
        .author("alice")
        .created_at(5000)
        .insert(&db)
        .expect("insert c1 failed");
    PrCommentFixture::new(802, 50, "c2")
        .author("bob")
        .created_at(5001)
        .insert(&db)
        .expect("insert c2 failed");
    PrCommentFixture::new(803, 50, "c3")
        .author("carol")
        .created_at(5002)
        .insert(&db)
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
fn unaddressed_comment_count_agrees_across_pull_request_and_project_queries() {
    let (db, _temp_dir) = make_test_db("unaddressed_count_agreement");
    let project = db
        .create_project("Project", "/tmp/project")
        .expect("create project failed");
    let task = db
        .create_task("Task", "doing", Some(&project.id), Some("Task"), None)
        .expect("create task failed");
    let other_project = db
        .create_project("Other project", "/tmp/other-project")
        .expect("create other project failed");
    let other_task = db
        .create_task(
            "Other task",
            "doing",
            Some(&other_project.id),
            Some("Other task"),
            None,
        )
        .expect("create other task failed");

    PullRequestFixture::new(101)
        .ticket_id(&task.id)
        .title("PR 1")
        .url("https://example.com/1")
        .insert(&db)
        .expect("insert pr 1 failed");

    db.set_config("github_username", "author")
        .expect("set GitHub username failed");

    PrCommentFixture::new(711, 101, "Reviewer root")
        .author("reviewer")
        .created_at(2000)
        .insert(&db)
        .expect("insert comment 1 failed");
    PrCommentFixture::new(712, 101, "Reviewer reply")
        .author("second-reviewer")
        .in_reply_to_id(711)
        .created_at(2001)
        .insert(&db)
        .expect("insert comment 2 failed");
    PrCommentFixture::new(713, 101, "Author root")
        .author("AUTHOR")
        .created_at(2002)
        .insert(&db)
        .expect("insert comment 3 failed");
    PrCommentFixture::new(715, 101, "Addressed reviewer root")
        .addressed(true)
        .created_at(2003)
        .insert(&db)
        .expect("insert addressed comment failed");
    PullRequestFixture::new(102)
        .ticket_id(&other_task.id)
        .title("Other PR")
        .url("https://example.com/2")
        .insert(&db)
        .expect("insert other PR failed");
    PrCommentFixture::new(714, 102, "Unrelated comment")
        .created_at(2003)
        .insert(&db)
        .expect("insert unrelated comment failed");

    let open_pull_request_count = db
        .get_open_prs()
        .expect("get open PRs failed")
        .into_iter()
        .find(|pull_request| pull_request.id == 101)
        .expect("open PR not found")
        .unaddressed_comment_count;
    let task_pull_request_count = db
        .get_pull_requests_for_task(&task.id)
        .expect("get task PRs failed")
        .into_iter()
        .find(|pull_request| pull_request.id == 101)
        .expect("task PR not found")
        .unaddressed_comment_count;
    let project_attention_count = db
        .get_project_attention_for_project(&project.id)
        .expect("get project attention failed")
        .expect("project attention not found")
        .unaddressed_comments;

    assert_eq!(
        [
            open_pull_request_count,
            task_pull_request_count,
            project_attention_count,
        ],
        [1, 1, 1]
    );

    drop(db);
}

#[test]
fn unknown_github_identity_counts_every_unaddressed_thread_root() {
    let (db, _temp_dir) = make_test_db("unaddressed_count_unknown_identity");
    insert_test_task(&db);

    PullRequestFixture::new(101)
        .insert(&db)
        .expect("insert pr failed");
    PrCommentFixture::new(711, 101, "First root")
        .author("reviewer")
        .insert(&db)
        .expect("insert first root failed");
    PrCommentFixture::new(712, 101, "Reply")
        .author("author")
        .in_reply_to_id(711)
        .insert(&db)
        .expect("insert reply failed");
    PrCommentFixture::new(713, 101, "Second root")
        .author("author")
        .insert(&db)
        .expect("insert second root failed");

    let count = db
        .get_pull_requests_for_task("T-100")
        .expect("get task PRs failed")[0]
        .unaddressed_comment_count;

    assert_eq!(count, 2);
}

#[test]
fn task_pull_request_query_uses_ticket_and_comment_indexes() {
    let (db, _temp_dir) = make_test_db("pr_task_query_plan");

    let connection = db.connection();
    let conn = connection.lock().expect("lock connection");
    let query = format!(
        "EXPLAIN QUERY PLAN {}",
        crate::db::pull_requests::queries::pull_requests_sql(
            crate::db::pull_requests::queries::PULL_REQUESTS_FOR_TASK_CLAUSE
        )
    );
    let plan = conn
        .prepare(&query)
        .expect("prepare task pull request query plan")
        .query_map(["T-1"], |row| row.get::<_, String>(3))
        .expect("query task pull request plan")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("read task pull request plan")
        .join("\n");

    assert!(
        plan.contains("idx_pull_requests_ticket"),
        "task lookup should use the ticket index:\n{plan}"
    );
    assert!(
        plan.contains("idx_pr_comments_pr_created"),
        "unaddressed comment count should use the comment index:\n{plan}"
    );
}
