use super::*;
use crate::agent_lifecycle::CompletionPlan;
use openforge_session_protocol::NotificationDelivery;

fn fixture() -> (
    tempfile::TempDir,
    Database,
    NotificationDelivery,
    CompletionPlan,
) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::new(dir.path().join("completion.db")).unwrap();
    let task = db
        .create_task("Deferred completion", "doing", None, None, None)
        .unwrap();
    db.create_agent_session(
        "session",
        &task.id,
        None,
        "implementing",
        "running",
        "claude-code",
    )
    .unwrap();
    db.set_agent_session_pty_instance_id("session", 42).unwrap();
    let delivery = serde_json::from_value(serde_json::json!({
        "journalId": "journal", "position": 1,
        "pty": {"installation":"installation", "lifetime":"lifetime", "instance":42},
        "sessionKey": task.id,
        "envelope": {"id":"stop", "payload": {"provider":"claude-code", "task_id":task.id,
            "pty_instance_id":42, "kind":"ended", "raw_event_type":"stop"}}
    }))
    .unwrap();
    let plan = CompletionPlan {
        grace_ms: 1,
        ceiling_ms: 100,
        wake_at_ms: 1,
        transcript_path: None,
        reported: Some("background shell".into()),
    };
    (dir, db, delivery, plan)
}

#[test]
fn completion_obligation_and_receipt_reopen_before_any_watcher_was_scheduled() {
    let (dir, db, delivery, plan) = fixture();
    let application = db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap();
    assert_eq!(application.change.unwrap().status, "running");
    let pending = application.completion.unwrap();
    drop(db);
    let db = Database::new(dir.path().join("completion.db")).unwrap();
    let recovered = db.pending_agent_completions().unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].id, pending.id);
    assert_eq!(recovered[0].plan, plan);
    let mut later_plan = plan;
    later_plan.wake_at_ms += 999;
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&later_plan))
        .unwrap()
        .completion
        .is_none());
    assert_eq!(
        db.pending_agent_completions().unwrap()[0].plan,
        recovered[0].plan
    );
    assert_eq!(
        db.complete_agent_completion(&recovered[0])
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
    assert!(db
        .complete_agent_completion(&recovered[0])
        .unwrap()
        .is_none());
    assert!(db.pending_agent_completions().unwrap().is_empty());
    assert_eq!(
        db.get_agent_session("session")
            .unwrap()
            .unwrap()
            .output_revision,
        1
    );
}

#[test]
fn failed_completion_obligation_write_rolls_back_receipt_and_identity() {
    let (dir, db, mut delivery, plan) = fixture();
    delivery.envelope.payload.provider_session_id = Some("claude-session".into());
    db.lock_conn().unwrap().execute_batch("CREATE TRIGGER reject_completion BEFORE INSERT ON agent_deferred_completions BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .is_err());
    let receipts: i64 = db
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM agent_notification_receipts",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(receipts, 0);
    assert!(db
        .get_agent_session("session")
        .unwrap()
        .unwrap()
        .claude_session_id
        .is_none());
    assert!(db.pending_agent_completions().unwrap().is_empty());
    drop(db);
    let db = Database::new(dir.path().join("completion.db")).unwrap();
    db.lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_completion;")
        .unwrap();
    let pending = db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap()
        .completion
        .unwrap();
    db.lock_conn().unwrap().execute_batch("CREATE TRIGGER reject_completion_clear BEFORE DELETE ON agent_deferred_completions BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(db.complete_agent_completion(&pending).is_err());
    assert_eq!(
        db.get_agent_session("session").unwrap().unwrap().status,
        "running"
    );
    assert_eq!(db.pending_agent_completions().unwrap().len(), 1);
    db.lock_conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_completion_clear;")
        .unwrap();
    assert!(db.complete_agent_completion(&pending).unwrap().is_some());
}

#[test]
fn completion_obligations_are_superseded_by_permission_stop_or_new_allocation() {
    for superseding in ["permission", "stop", "allocation"] {
        let (dir, db, mut delivery, plan) = fixture();
        let pending = db
            .apply_delivery_with_completion(&delivery, Some(&plan))
            .unwrap()
            .completion
            .unwrap();
        match superseding {
            "permission" => {
                delivery.position = 2;
                delivery.envelope.id = "permission".into();
                delivery.envelope.payload.kind = "requested_permission".into();
                db.apply_delivery_with_completion(&delivery, None).unwrap();
            }
            "stop" => db
                .update_agent_session(
                    "session",
                    "implementing",
                    "interrupted",
                    None,
                    Some("Stopped by user"),
                )
                .unwrap(),
            _ => db.set_agent_session_pty_instance_id("session", 43).unwrap(),
        }
        drop(db);
        let db = Database::new(dir.path().join("completion.db")).unwrap();
        assert!(
            db.pending_agent_completions().unwrap().is_empty(),
            "{superseding}"
        );
        assert!(
            db.complete_agent_completion(&pending).unwrap().is_none(),
            "{superseding}"
        );
    }
}

#[test]
fn restart_interruption_preserves_the_original_completion_deadline() {
    let (_dir, db, delivery, plan) = fixture();
    let pending = db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap()
        .completion
        .unwrap();
    db.update_agent_session(
        "session",
        "implementing",
        "interrupted",
        None,
        Some("Session interrupted by app restart"),
    )
    .unwrap();
    assert_eq!(db.pending_agent_completions().unwrap()[0].plan, plan);
    assert_eq!(
        db.complete_agent_completion(&pending)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
}

#[test]
fn oversized_completion_plan_is_rejected_without_accepting_receipt() {
    let (_dir, db, delivery, mut plan) = fixture();
    plan.reported = Some("x".repeat(16 * 1024));
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .is_err());
    assert!(db.pending_agent_completions().unwrap().is_empty());
    plan.reported = None;
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap()
        .completion
        .is_some());
}

#[test]
fn failed_completion_migration_preserves_version_and_can_reopen() {
    let (dir, db, _, _) = fixture();
    drop(db);
    let path = dir.path().join("completion.db");
    let mut conn = rusqlite::Connection::open(&path).unwrap();
    let previous = migrations::LATEST_USER_VERSION - 1;
    conn.pragma_update(None, "user_version", previous).unwrap();
    conn.execute_batch("DROP TABLE agent_deferred_completions; CREATE TABLE agent_deferred_completions (broken INTEGER);").unwrap();
    assert!(migrations::get_migrations().to_latest(&mut conn).is_err());
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, previous);
    conn.execute_batch("DROP TABLE agent_deferred_completions;")
        .unwrap();
    drop(conn);
    drop(Database::new(path.clone()).unwrap());
    drop(Database::new(path).unwrap());
}

#[test]
fn completion_obligation_cannot_complete_a_newer_session_even_with_the_same_pty() {
    let (_dir, db, delivery, plan) = fixture();
    let pending = db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap()
        .completion
        .unwrap();
    db.create_agent_session(
        "newer",
        &delivery.session_key,
        None,
        "implementing",
        "running",
        "claude-code",
    )
    .unwrap();
    db.set_agent_session_pty_instance_id("newer", 42).unwrap();
    assert!(db.complete_agent_completion(&pending).unwrap().is_none());
    assert_eq!(
        db.get_agent_session("newer").unwrap().unwrap().status,
        "running"
    );
    assert!(db.pending_agent_completions().unwrap().is_empty());
}

#[test]
fn completion_capacity_rejection_does_not_consume_the_delivery() {
    let (_dir, db, delivery, plan) = fixture();
    let other = db
        .create_task("Capacity fixtures", "doing", None, None, None)
        .unwrap();
    {
        let conn = db.lock_conn().unwrap();
        conn.execute("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<4096) INSERT INTO agent_sessions(id,ticket_id,stage,status,provider,created_at,updated_at) SELECT 'seed-'||n,?1,'implementing','running','claude-code',0,0 FROM seq", [&other.id]).unwrap();
        conn.execute("INSERT INTO agent_deferred_completions(session_id,obligation_id,plan) SELECT id,id,?1 FROM agent_sessions WHERE ticket_id=?2", rusqlite::params![serde_json::to_string(&plan).unwrap(), other.id]).unwrap();
    }
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .err()
        .unwrap()
        .contains("capacity"));
    db.lock_conn()
        .unwrap()
        .execute(
            "DELETE FROM agent_deferred_completions WHERE session_id='seed-1'",
            [],
        )
        .unwrap();
    assert!(db
        .apply_delivery_with_completion(&delivery, Some(&plan))
        .unwrap()
        .completion
        .is_some());
    assert_eq!(db.pending_agent_completions().unwrap().len(), 4096);
}
