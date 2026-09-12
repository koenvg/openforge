use super::{
    agents::{agent_session_from_row, update_session_on_connection, AGENT_SESSION_SELECT_COLUMNS},
    AgentSessionRow, Database,
};
use crate::agent_lifecycle::{
    lifecycle_status_transition, provider_requires_pty_instance, AgentLifecycleEventKind,
    AgentLifecycleNotification, AgentLifecycleStatusChange, CompletionPlan, LifecycleApplication,
};
use openforge_session_protocol::NotificationDelivery;
use rusqlite::{params, Connection, OptionalExtension};

impl Database {
    pub(crate) fn apply_lifecycle_notification(
        &self,
        notification: &AgentLifecycleNotification,
    ) -> Result<Option<AgentLifecycleStatusChange>, String> {
        Ok(self
            .apply_lifecycle_with_completion(notification, None)?
            .change)
    }

    pub(crate) fn apply_lifecycle_with_completion(
        &self,
        notification: &AgentLifecycleNotification,
        completion: Option<&CompletionPlan>,
    ) -> Result<LifecycleApplication, String> {
        let mut conn = self.lock_conn().map_err(storage)?;
        let tx = conn.transaction().map_err(storage)?;
        let application = apply(&tx, notification, false, completion)?;
        tx.commit().map_err(storage)?;
        Ok(application)
    }

    /// Deduplication and the domain write commit together. Ordered journal positions
    /// let us retain one bounded receipt per journal rather than every event forever.
    #[cfg(test)]
    pub(crate) fn apply_notification_delivery(
        &self,
        delivery: &NotificationDelivery,
    ) -> Result<Option<AgentLifecycleStatusChange>, String> {
        Ok(self.apply_delivery_with_completion(delivery, None)?.change)
    }

    pub(crate) fn apply_delivery_with_completion(
        &self,
        delivery: &NotificationDelivery,
        completion: Option<&CompletionPlan>,
    ) -> Result<LifecycleApplication, String> {
        delivery
            .envelope
            .validate()
            .map_err(|_| "invalid notification envelope")?;
        if delivery.journal_id.is_empty()
            || delivery.journal_id.len() > 128
            || delivery.position == 0
            || delivery.pty.instance.value() != delivery.envelope.payload.pty_instance_id
            || delivery.session_key != delivery.envelope.payload.task_id
        {
            return Err("invalid notification delivery identity".into());
        }
        let position =
            i64::try_from(delivery.position).map_err(|_| "invalid notification position")?;
        let notification: AgentLifecycleNotification = serde_json::from_value(
            serde_json::to_value(&delivery.envelope.payload).map_err(|_| "invalid notification")?,
        )
        .map_err(|_| "invalid notification")?;
        let mut conn = self.lock_conn().map_err(storage)?;
        let tx = conn.transaction().map_err(storage)?;
        let previous: Option<i64> = tx
            .query_row(
                "SELECT position FROM agent_notification_receipts WHERE journal_id=?1",
                [&delivery.journal_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(storage)?;
        if previous.is_some_and(|previous| position <= previous) {
            return Ok(LifecycleApplication::default());
        }
        if position != previous.unwrap_or(0) + 1 {
            return Err("notification delivery out of order".into());
        }
        if previous.is_none() {
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM agent_notification_receipts",
                    [],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            if count >= 256 {
                return Err("notification receipt capacity exhausted".into());
            }
        }
        let application = apply(&tx, &notification, true, completion)?;
        tx.execute("INSERT INTO agent_notification_receipts(journal_id, position) VALUES (?1,?2) ON CONFLICT(journal_id) DO UPDATE SET position=excluded.position", params![delivery.journal_id, position]).map_err(storage)?;
        tx.commit().map_err(storage)?;
        Ok(application)
    }
}

pub(super) fn apply(
    conn: &Connection,
    notification: &AgentLifecycleNotification,
    durable: bool,
    completion: Option<&CompletionPlan>,
) -> Result<LifecycleApplication, String> {
    let session = conn.query_row(&format!("SELECT {AGENT_SESSION_SELECT_COLUMNS} FROM agent_sessions WHERE ticket_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT 1"), [&notification.task_id], agent_session_from_row).optional().map_err(storage)?;
    let Some(session) = session else {
        return Ok(LifecycleApplication::default());
    };
    if session.provider != notification.provider
        || (provider_requires_pty_instance(&notification.provider)
            && (notification.pty_instance_id.is_none()
                || session.pty_instance_id != notification.pty_instance_id))
    {
        return Ok(LifecycleApplication::default());
    }
    persist_provider_identity(conn, &session, notification)?;
    let restart_interruption = durable
        && session.status == "interrupted"
        && session.error_message.as_deref() == Some("Session interrupted by app restart");
    // Stop eligibility belongs to the matched session in this transaction, not either HTTP adapter.
    let completion = completion.filter(|_| {
        notification.provider == "claude-code"
            && notification.kind == AgentLifecycleEventKind::Ended
            && notification.raw_event_type.as_deref() == Some("stop")
            && (session.status == "running" || restart_interruption)
    });
    let kind = if completion.is_some() {
        AgentLifecycleEventKind::BecameBusy
    } else {
        notification.kind
    };
    let (target, eligible) = lifecycle_status_transition(kind);
    if !restart_interruption && !eligible.is_empty() && !eligible.contains(&session.status.as_str())
    {
        return Ok(LifecycleApplication::default());
    }
    if session.status != target {
        update_session_on_connection(
            conn,
            &session.id,
            &session.stage,
            target,
            session.checkpoint_data.as_deref(),
            None,
        )
        .map_err(storage)?;
    }
    super::agent_completions::clear(conn, &session.id)?;
    let completion = completion
        .map(|plan| super::agent_completions::store(conn, &session, plan))
        .transpose()?;
    Ok(LifecycleApplication {
        change: Some(AgentLifecycleStatusChange {
            task_id: notification.task_id.clone(),
            status: target.into(),
            provider: notification.provider.clone(),
            kind,
            pty_instance_id: notification.pty_instance_id,
            raw_event_type: notification.raw_event_type.clone(),
            raw_status_type: notification.raw_status_type.clone(),
        }),
        completion,
    })
}

fn persist_provider_identity(
    conn: &Connection,
    session: &AgentSessionRow,
    notification: &AgentLifecycleNotification,
) -> Result<(), String> {
    let Some(id) = notification
        .provider_session_id
        .as_deref()
        .filter(|id| !id.is_empty())
    else {
        return Ok(());
    };
    let column = match notification.provider.as_str() {
        "opencode" if id.starts_with("ses") => "opencode_session_id",
        "claude-code" => "claude_session_id",
        "pi" if session.pi_session_id.is_none() => "pi_session_id",
        "grok" => "grok_session_id",
        _ => return Ok(()),
    };
    let conflict = match notification.provider.as_str() {
        "claude-code" => Some("status IN ('running','paused')"),
        "pi" => Some("ticket_id <> ?4"),
        _ => None,
    };
    if let Some(conflict) = conflict {
        // All interpolated identifiers and predicates are fixed above, never supplied by hooks.
        let sql = format!("SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE id<>?1 AND provider=?2 AND {column}=?3 AND {conflict})");
        let claimed: bool = if notification.provider == "pi" {
            conn.query_row(
                &sql,
                params![session.id, notification.provider, id, session.ticket_id],
                |r| r.get(0),
            )
        } else {
            conn.query_row(&sql, params![session.id, notification.provider, id], |r| {
                r.get(0)
            })
        }
        .map_err(storage)?;
        if claimed {
            return Ok(());
        }
    }
    conn.execute(
        &format!("UPDATE agent_sessions SET {column}=?1 WHERE id=?2"),
        [id, &session.id],
    )
    .map_err(storage)?;
    Ok(())
}

fn storage(_: rusqlite::Error) -> String {
    "notification database update failed".into()
}
