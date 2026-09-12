use crate::notification_journal::NotificationJournal;
use openforge_session_protocol::*;

fn agent() -> AgentConfig {
    serde_json::from_value(serde_json::json!({"version":1,"port":1234,"token":"private", "pty":{"installation":"install", "lifetime":"life", "instance":42}, "owner":{"Agent":{"task_id":"T-1"}}})).unwrap()
}
fn envelope(id: &str) -> NotificationEnvelope {
    serde_json::from_value(serde_json::json!({"id":id,"payload":{"provider":"pi","task_id":"T-1","pty_instance_id":42,"kind":"requested_permission"}})).unwrap()
}

#[test]
fn reopen_retains_sender_identity_order_and_acknowledgement() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("journal.sqlite");
    let mut journal = NotificationJournal::open(&path).unwrap();
    let first = journal.accept(&agent(), envelope("first")).unwrap();
    let second = journal.accept(&agent(), envelope("second")).unwrap();
    assert!(journal.acknowledge(&second).is_err());
    drop(journal);
    let mut journal = NotificationJournal::open(&path).unwrap();
    assert_eq!(journal.accept(&agent(), envelope("first")).unwrap(), first);
    assert_eq!(journal.next().unwrap().unwrap().position, first.position);
    journal.acknowledge(&first).unwrap();
    drop(journal);
    let mut journal = NotificationJournal::open(&path).unwrap();
    assert_eq!(journal.next().unwrap().unwrap().position, second.position);
    assert_eq!(journal.accept(&agent(), envelope("first")).unwrap(), first);
    let mut conflict = envelope("first");
    conflict.payload.kind = "ended".into();
    assert_eq!(
        journal.accept(&agent(), conflict),
        Err(Error::OperationConflict)
    );
}

#[test]
fn acknowledged_receipts_retire_only_after_their_sender_loses_authority() {
    let dir = tempfile::tempdir().unwrap();
    let mut journal = NotificationJournal::open(&dir.path().join("journal.sqlite")).unwrap();
    let first = journal.accept(&agent(), envelope("first")).unwrap();
    journal.acknowledge(&first).unwrap();
    let pending = journal.accept(&agent(), envelope("pending")).unwrap();
    journal.retire_acknowledged(&[agent().pty]).unwrap();
    assert_eq!(journal.accept(&agent(), envelope("first")).unwrap(), first);
    journal.retire_acknowledged(&[]).unwrap();
    assert_eq!(journal.next().unwrap().unwrap().position, pending.position);
    let next = journal.accept(&agent(), envelope("new")).unwrap();
    assert_eq!(next.position, 3);
}

#[test]
fn full_journal_rejects_new_records_but_can_return_existing_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut journal = NotificationJournal::open(&dir.path().join("journal.sqlite")).unwrap();
    let mut payload = envelope("first");
    payload.payload.activity_snapshot = Some("x".repeat(8192));
    let first = journal.accept(&agent(), payload.clone()).unwrap();
    let mut count = 1;
    loop {
        payload.id = format!("event-{count}");
        match journal.accept(&agent(), payload.clone()) {
            Ok(_) => count += 1,
            Err(Error::Capacity) => break,
            Err(error) => panic!("{error}"),
        }
        assert!(count <= MAX_NOTIFICATION_RECORDS);
    }
    assert!(count > 1);
    payload.id = "first".into();
    assert_eq!(journal.accept(&agent(), payload).unwrap(), first);
    assert_eq!(journal.next().unwrap().unwrap().position, first.position);
}

#[test]
fn failed_acceptance_does_not_consume_position_and_bad_paths_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("journal.sqlite");
    let mut journal = NotificationJournal::open(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(journal.accept(&agent(), envelope("first")).is_err());
    assert!(journal.next().unwrap().is_none());
    conn.execute_batch("DROP TRIGGER fail;").unwrap();
    assert_eq!(
        journal
            .accept(&agent(), envelope("first"))
            .unwrap()
            .position,
        1
    );
    let link = dir.path().join("link.sqlite");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert!(NotificationJournal::open(&link).is_err());
}

#[test]
fn unsupported_or_failed_journal_migration_preserves_existing_records() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("journal.sqlite");
    let mut journal = NotificationJournal::open(&path).unwrap();
    let receipt = journal.accept(&agent(), envelope("retained")).unwrap();
    drop(journal);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", 2).unwrap();
    assert!(matches!(
        NotificationJournal::open(&path),
        Err(Error::Version)
    ));
    conn.pragma_update(None, "user_version", 0).unwrap();
    // An existing schema conflicts with initialization. The transaction must roll back.
    assert!(NotificationJournal::open(&path).is_err());
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 0);
    conn.pragma_update(None, "user_version", 1).unwrap();
    let mut journal = NotificationJournal::open(&path).unwrap();
    assert_eq!(journal.next().unwrap().unwrap().position, receipt.position);
    assert_eq!(
        journal.accept(&agent(), envelope("retained")).unwrap(),
        receipt
    );
}
