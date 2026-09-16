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

    PrCommentFixture::new(711, 101, "Check passed")
        .author("bot")
        .created_at(2000)
        .insert(&db)
        .expect("insert comment 1 failed");
    PrCommentFixture::new(712, 101, "Fix this")
        .created_at(2001)
        .insert(&db)
        .expect("insert comment 2 failed");
    PrCommentFixture::new(713, 101, "Also fix that")
        .addressed(true)
        .created_at(2002)
        .insert(&db)
        .expect("insert comment 3 failed");
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
        [2, 2, 2]
    );

    drop(db);
}
