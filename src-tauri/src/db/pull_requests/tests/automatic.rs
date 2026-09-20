use crate::db::pull_requests::{AutomaticAssociation, AutomaticPr};
use crate::db::test_helpers::make_test_db;

#[test]
fn automatic_discovery_preserves_concurrent_manual_ownership_by_either_identity() {
    for existing_id in [500, -77] {
        let (db, _dir) = make_test_db("automatic_ownership");
        let manual = db.create_task("manual", "doing", None, None, None).unwrap();
        let automatic = db
            .create_task("automatic", "doing", None, None, None)
            .unwrap();
        db.insert_pull_request_with_number(
            existing_id,
            7,
            &manual.id,
            "Acme",
            "Repo",
            "manual title",
            "url",
            "open",
            1,
            1,
            false,
        )
        .unwrap();
        let outcome = db
            .associate_pull_request_automatically(AutomaticPr {
                id: 500,
                number: 7,
                task_id: &automatic.id,
                owner: "acme",
                repo: "repo",
                title: "verified",
                url: "url",
                state: "open",
                now: 2,
                draft: true,
            })
            .unwrap();
        assert_eq!(outcome, AutomaticAssociation::OwnershipConflict);
        let rows = db.get_all_pull_requests().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ticket_id, manual.id);
        assert_eq!(rows[0].title, "manual title");
    }
}

#[test]
fn rediscovery_promotes_same_task_synthetic_identity_and_keeps_additional_prs() {
    let (db, _dir) = make_test_db("automatic_idempotency");
    let task = db.create_task("task", "doing", None, None, None).unwrap();
    db.insert_pull_request_with_number(
        -77, 7, &task.id, "acme", "repo", "manual", "url", "open", 1, 1, false,
    )
    .unwrap();
    for number in [7, 8, 8] {
        let outcome = db
            .associate_pull_request_automatically(AutomaticPr {
                id: 500 + number,
                number,
                task_id: &task.id,
                owner: "acme",
                repo: "repo",
                title: "verified",
                url: "url",
                state: "open",
                now: 2,
                draft: true,
            })
            .unwrap();
        if number == 7 {
            assert_eq!(outcome, AutomaticAssociation::Refreshed);
        }
    }
    let rows = db.get_pull_requests_for_task(&task.id).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|pr| pr.id > 0 && pr.draft));
}
