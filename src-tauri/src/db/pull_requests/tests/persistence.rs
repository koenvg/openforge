use super::fixtures::PullRequestFixture;

use crate::db::test_helpers::*;

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
