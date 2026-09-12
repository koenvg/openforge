use super::*;
use openforge_session_protocol::*;

fn delivery(task: &str, position: u64, kind: &str) -> NotificationDelivery {
    serde_json::from_value(serde_json::json!({
        "journalId": "journal-test", "position": position,
        "pty": {"installation": "installation-test", "lifetime": "lifetime-test", "instance": 42},
        "sessionKey": task,
        "envelope": {"id": format!("event-{position}"), "payload": {
            "provider": "pi", "task_id": task, "pty_instance_id": 42, "kind": kind
        }}
    }))
    .unwrap()
}

#[test]
fn delivery_deduplication_and_waiting_state_survive_database_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("task.db");
    let db = Database::new(path.clone()).unwrap();
    let task = db
        .create_task("Durable lifecycle", "doing", None, None, None)
        .unwrap();
    db.create_agent_session("session", &task.id, None, "implementing", "running", "pi")
        .unwrap();
    db.set_agent_session_pty_instance_id("session", 42).unwrap();
    let waiting = delivery(&task.id, 1, "requested_permission");
    assert_eq!(
        db.apply_notification_delivery(&waiting)
            .unwrap()
            .unwrap()
            .status,
        "paused"
    );
    drop(db);
    let db = Database::new(path).unwrap();
    assert!(db.apply_notification_delivery(&waiting).unwrap().is_none());
    let session = db.get_agent_session("session").unwrap().unwrap();
    assert_eq!(session.status, "paused");
    assert_eq!(session.output_revision, 1);
    assert_eq!(
        db.apply_notification_delivery(&delivery(&task.id, 2, "ended"))
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
    assert!(db.apply_notification_delivery(&waiting).unwrap().is_none());
    assert_eq!(
        db.get_agent_session("session").unwrap().unwrap().status,
        "completed"
    );
}

#[test]
fn durable_delivery_restores_only_restart_interruption_for_the_same_allocation() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::new(dir.path().join("restart.db")).unwrap();
    let task = db
        .create_task("Interrupted during restart", "doing", None, None, None)
        .unwrap();
    db.create_agent_session("session", &task.id, None, "implementing", "running", "pi")
        .unwrap();
    db.set_agent_session_pty_instance_id("session", 42).unwrap();
    db.update_agent_session(
        "session",
        "implementing",
        "interrupted",
        None,
        Some("Session interrupted by app restart"),
    )
    .unwrap();
    let restored = db
        .apply_notification_delivery(&delivery(&task.id, 1, "ended"))
        .unwrap();
    assert_eq!(restored.unwrap().status, "completed");
    db.update_agent_session(
        "session",
        "implementing",
        "interrupted",
        None,
        Some("Stopped by user"),
    )
    .unwrap();
    assert!(db
        .apply_notification_delivery(&delivery(&task.id, 2, "ended"))
        .unwrap()
        .is_none());
    assert_eq!(
        db.get_agent_session("session").unwrap().unwrap().status,
        "interrupted"
    );
}

#[test]
fn failed_receipt_write_rolls_back_domain_update_and_remains_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollback.db");
    let db = Database::new(path.clone()).unwrap();
    let task = db
        .create_task("Rollback lifecycle", "doing", None, None, None)
        .unwrap();
    db.create_agent_session("session", &task.id, None, "implementing", "running", "pi")
        .unwrap();
    db.set_agent_session_pty_instance_id("session", 42).unwrap();
    let fault = rusqlite::Connection::open(&path).unwrap();
    fault.execute_batch("CREATE TRIGGER reject_receipt BEFORE INSERT ON agent_notification_receipts BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;").unwrap();
    let waiting = delivery(&task.id, 1, "requested_permission");
    assert!(db.apply_notification_delivery(&waiting).is_err());
    assert_eq!(
        db.get_agent_session("session").unwrap().unwrap().status,
        "running"
    );
    drop(db);
    fault.execute_batch("DROP TRIGGER reject_receipt;").unwrap();
    let db = Database::new(path).unwrap();
    assert_eq!(
        db.apply_notification_delivery(&waiting)
            .unwrap()
            .unwrap()
            .status,
        "paused"
    );
    assert_eq!(
        db.get_agent_session("session")
            .unwrap()
            .unwrap()
            .output_revision,
        1
    );
}

#[test]
fn receipt_migration_failure_preserves_previous_version_and_can_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("migration.db");
    drop(Database::new(path.clone()).unwrap());
    let mut conn = rusqlite::Connection::open(&path).unwrap();
    let previous = migrations::LATEST_USER_VERSION - 1;
    conn.pragma_update(None, "user_version", previous).unwrap();
    conn.execute_batch("DROP TABLE agent_notification_receipts; CREATE TABLE agent_notification_receipts (broken INTEGER);").unwrap();
    // The new table conflicts with the migration. It must not advance the schema version.
    assert!(migrations::get_migrations().to_latest(&mut conn).is_err());
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, previous);
    conn.execute_batch("DROP TABLE agent_notification_receipts;")
        .unwrap();
    drop(conn);
    drop(Database::new(path.clone()).unwrap());
    drop(Database::new(path).unwrap());
}
