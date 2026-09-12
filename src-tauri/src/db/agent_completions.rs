//! Session-keyed completion obligations, committed with lifecycle state and notification receipts.
use super::{AgentSessionRow, Database};
use crate::agent_lifecycle::{
    AgentLifecycleEventKind, AgentLifecycleNotification, AgentLifecycleStatusChange,
    CompletionPlan, PendingCompletion,
};
use rusqlite::{params, Connection};

const MAX_PENDING: i64 = 4096;
const MAX_PLAN_BYTES: usize = 16 * 1024;

/// Call inside the same transaction as the session write.
pub(super) fn clear_inactive(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM agent_deferred_completions WHERE session_id=?1 AND EXISTS(SELECT 1 FROM agent_sessions WHERE id=?1 AND status<>'running' AND NOT(status='interrupted' AND COALESCE(error_message,'')='Session interrupted by app restart'))", [session_id])?;
    Ok(())
}

/// Reattaching the same allocation retains its obligation; replacing it does not.
pub(super) fn clear_for_new_allocation(
    conn: &Connection,
    session_id: &str,
    instance: i64,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM agent_deferred_completions WHERE session_id=?1 AND ?2 IS NOT (SELECT pty_instance_id FROM agent_sessions WHERE id=?1)", params![session_id, instance])?;
    Ok(())
}

pub(super) fn clear(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM agent_deferred_completions WHERE session_id=?1",
        [session_id],
    )
    .map_err(storage)?;
    Ok(())
}

pub(super) fn store(
    conn: &Connection,
    session: &AgentSessionRow,
    plan: &CompletionPlan,
) -> Result<PendingCompletion, String> {
    let encoded = serde_json::to_string(plan).map_err(|_| "invalid completion obligation")?;
    if encoded.len() > MAX_PLAN_BYTES {
        return Err("completion obligation exceeds limit".into());
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_deferred_completions", [], |r| {
            r.get(0)
        })
        .map_err(storage)?;
    if count >= MAX_PENDING {
        return Err("completion obligation capacity exhausted".into());
    }
    let pending = PendingCompletion {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session.id.clone(),
        task_id: session.ticket_id.clone(),
        pty_instance_id: session.pty_instance_id,
        plan: plan.clone(),
    };
    conn.execute(
        "INSERT INTO agent_deferred_completions(session_id, obligation_id, plan) VALUES (?1,?2,?3)",
        params![pending.session_id, pending.id, encoded],
    )
    .map_err(storage)?;
    Ok(pending)
}

impl Database {
    pub(crate) fn pending_agent_completions(&self) -> Result<Vec<PendingCompletion>, String> {
        let conn = self.lock_conn().map_err(storage)?;
        let mut statement = conn.prepare("SELECT d.obligation_id, s.id, s.ticket_id, s.pty_instance_id, d.plan FROM agent_deferred_completions d JOIN agent_sessions s ON s.id=d.session_id LIMIT 4097").map_err(storage)?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(storage)?;
        let mut pending = Vec::new();
        for row in rows {
            let (id, session_id, task_id, pty_instance_id, encoded) = row.map_err(storage)?;
            let pty_instance_id = pty_instance_id
                .map(u64::try_from)
                .transpose()
                .map_err(|_| "invalid stored completion identity")?;
            if pending.len() >= MAX_PENDING as usize || encoded.len() > MAX_PLAN_BYTES {
                return Err("completion obligation storage exceeds limit".into());
            }
            pending.push(PendingCompletion {
                id,
                session_id,
                task_id,
                pty_instance_id,
                plan: serde_json::from_str(&encoded)
                    .map_err(|_| "invalid stored completion obligation")?,
            });
        }
        Ok(pending)
    }

    pub(crate) fn complete_agent_completion(
        &self,
        pending: &PendingCompletion,
    ) -> Result<Option<AgentLifecycleStatusChange>, String> {
        let mut conn = self.lock_conn().map_err(storage)?;
        let tx = conn.transaction().map_err(storage)?;
        let current: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_deferred_completions WHERE session_id=?1 AND obligation_id=?2)", params![pending.session_id, pending.id], |r| r.get(0)).map_err(storage)?;
        if !current {
            return Ok(None);
        }
        let latest: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE id=?1 AND id=(SELECT id FROM agent_sessions WHERE ticket_id=?2 ORDER BY created_at DESC, rowid DESC LIMIT 1))", params![pending.session_id, pending.task_id], |r| r.get(0)).map_err(storage)?;
        if !latest {
            clear(&tx, &pending.session_id)?;
            tx.commit().map_err(storage)?;
            return Ok(None);
        }
        let notification = AgentLifecycleNotification {
            provider: "claude-code".into(),
            task_id: pending.task_id.clone(),
            pty_instance_id: pending.pty_instance_id,
            provider_session_id: None,
            kind: AgentLifecycleEventKind::Ended,
            raw_event_type: Some("stop".into()),
            raw_status_type: None,
        };
        let application = super::agent_notifications::apply(&tx, &notification, true, None)?;
        clear(&tx, &pending.session_id)?;
        tx.commit().map_err(storage)?;
        Ok(application.change)
    }
}

fn storage(_: rusqlite::Error) -> String {
    "completion obligation database update failed".into()
}
