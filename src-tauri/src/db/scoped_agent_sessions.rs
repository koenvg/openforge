use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use thiserror::Error;

const SELECT_COLUMNS: &str = "id, owner_plugin_id, namespace, target_key, revision, project_id, checkout_revision, resolved_commit, provider, provider_session_id, terminal_key, pty_instance_id, turn_id, status, queue_sequence, error_code, error_message, created_at, updated_at, last_used_at";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScopedTurnTransition {
    Applied,
    Duplicate,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScopedTurnEvent {
    Begin,
    Pause,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ScopedAgentSessionStatus {
    Queued,
    Starting,
    Running,
    Paused,
    Completed,
    Failed,
    Aborted,
    Interrupted,
}

impl ScopedAgentSessionStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "queued" => Ok(Self::Queued),
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "aborted" => Ok(Self::Aborted),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                13,
                rusqlite::types::Type::Text,
                format!("invalid Scoped Agent Session status {other:?}").into(),
            )),
        }
    }

    pub(crate) fn is_live(self) -> bool {
        matches!(
            self,
            Self::Queued | Self::Starting | Self::Running | Self::Paused
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ScopedAgentSessionRow {
    pub id: String,
    pub owner_plugin_id: String,
    pub namespace: String,
    pub target_key: String,
    pub revision: String,
    pub project_id: String,
    pub checkout_revision: String,
    pub resolved_commit: Option<String>,
    pub provider: String,
    pub provider_session_id: Option<String>,
    pub terminal_key: String,
    pub pty_instance_id: Option<u64>,
    pub turn_id: Option<String>,
    pub status: ScopedAgentSessionStatus,
    pub queue_sequence: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScopedAgentSessionEventRow {
    pub sequence: u64,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub status: ScopedAgentSessionStatus,
    pub workspace_available: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct NewScopedAgentSession<'a> {
    pub id: &'a str,
    pub owner_plugin_id: &'a str,
    pub namespace: &'a str,
    pub target_key: &'a str,
    pub revision: &'a str,
    pub project_id: &'a str,
    pub checkout_revision: &'a str,
    pub provider: &'a str,
    pub terminal_key: &'a str,
    pub status: ScopedAgentSessionStatus,
    pub queue_sequence: Option<u64>,
}

#[derive(Debug, Error)]
pub(crate) enum ScopedAgentSessionStoreError {
    #[error("Session Scope is owned by plugin {owner_plugin_id}")]
    OwnershipConflict { owner_plugin_id: String },
    #[error("Session Scope already has live session {session_id} in status {status}")]
    LiveSessionExists { session_id: String, status: String },
    #[error("Session Scope already has session {session_id}; release it before starting again")]
    SessionExists { session_id: String },
    #[error("Scoped Agent Session terminal key collides with another Session Scope")]
    TerminalKeyCollision,
    #[error("Scoped Agent Session cannot transition to {status}")]
    InvalidStatusTransition { status: String },
    #[error("Scoped Agent Session queue is full at {queue_limit} waiting sessions")]
    QueueFull { queue_limit: usize },
    #[error("Scoped Agent Session {session_id} does not exist")]
    NotFound { session_id: String },
    #[error("Scoped Agent Session storage failed: {0}")]
    Database(#[from] rusqlite::Error),
}

fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScopedAgentSessionRow> {
    let pty_instance_id = row
        .get::<_, Option<i64>>(11)?
        .map(u64::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?;
    let queue_sequence = row
        .get::<_, Option<i64>>(14)?
        .map(u64::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                14,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?;
    Ok(ScopedAgentSessionRow {
        id: row.get(0)?,
        owner_plugin_id: row.get(1)?,
        namespace: row.get(2)?,
        target_key: row.get(3)?,
        revision: row.get(4)?,
        project_id: row.get(5)?,
        checkout_revision: row.get(6)?,
        resolved_commit: row.get(7)?,
        provider: row.get(8)?,
        provider_session_id: row.get(9)?,
        terminal_key: row.get(10)?,
        pty_instance_id,
        turn_id: row.get(12)?,
        status: ScopedAgentSessionStatus::parse(&row.get::<_, String>(13)?)?,
        queue_sequence,
        error_code: row.get(15)?,
        error_message: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        last_used_at: row.get(19)?,
    })
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScopedAgentSessionEventRow> {
    let sequence = u64::try_from(row.get::<_, i64>(0)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })?;
    Ok(ScopedAgentSessionEventRow {
        sequence,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        status: ScopedAgentSessionStatus::parse(&row.get::<_, String>(3)?)?,
        workspace_available: row.get(4)?,
        error_code: row.get(5)?,
        error_message: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn record_scoped_agent_session_event(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<(), ScopedAgentSessionStoreError> {
    conn.execute(
        "INSERT INTO scoped_agent_session_events (
            session_id, owner_plugin_id, namespace, target_key, revision, turn_id,
            status, workspace_available, error_code, error_message, created_at, updated_at
         )
         SELECT id, owner_plugin_id, namespace, target_key, revision, turn_id,
                status, CASE WHEN resolved_commit IS NULL THEN 0 ELSE 1 END,
                error_code, error_message, created_at, updated_at
           FROM scoped_agent_sessions WHERE id = ?1",
        [session_id],
    )?;
    Ok(())
}

fn create_on_connection(
    conn: &rusqlite::Connection,
    session: &NewScopedAgentSession<'_>,
) -> Result<ScopedAgentSessionRow, ScopedAgentSessionStoreError> {
    let logical_owner = conn
        .query_row(
            "SELECT owner_plugin_id FROM scoped_agent_sessions
             WHERE namespace = ?1 AND target_key = ?2
             ORDER BY created_at, id LIMIT 1",
            params![session.namespace, session.target_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(owner_plugin_id) = logical_owner {
        if owner_plugin_id != session.owner_plugin_id {
            return Err(ScopedAgentSessionStoreError::OwnershipConflict { owner_plugin_id });
        }
    }

    let exact = conn
        .query_row(
            &format!(
                "SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions
                 WHERE namespace = ?1 AND target_key = ?2 AND revision = ?3"
            ),
            params![session.namespace, session.target_key, session.revision],
            from_row,
        )
        .optional()?;
    if let Some(existing) = exact {
        return if existing.status.is_live() {
            Err(ScopedAgentSessionStoreError::LiveSessionExists {
                session_id: existing.id,
                status: existing.status.as_str().to_string(),
            })
        } else {
            Err(ScopedAgentSessionStoreError::SessionExists {
                session_id: existing.id,
            })
        };
    }

    let colliding_scope = conn
        .query_row(
            "SELECT namespace, target_key, revision FROM scoped_agent_sessions
             WHERE terminal_key = ?1",
            [session.terminal_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    if colliding_scope.is_some_and(|scope| {
        scope
            != (
                session.namespace.to_string(),
                session.target_key.to_string(),
                session.revision.to_string(),
            )
    }) {
        return Err(ScopedAgentSessionStoreError::TerminalKeyCollision);
    }

    let now = super::current_unix_timestamp()?;
    let queue_sequence = session
        .queue_sequence
        .map(i64::try_from)
        .transpose()
        .map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
    conn.execute(
        "INSERT INTO scoped_agent_sessions (
            id, owner_plugin_id, namespace, target_key, revision, project_id,
            checkout_revision, provider, terminal_key, status,
            queue_sequence, created_at, updated_at, last_used_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12)",
        params![
            session.id,
            session.owner_plugin_id,
            session.namespace,
            session.target_key,
            session.revision,
            session.project_id,
            session.checkout_revision,
            session.provider,
            session.terminal_key,
            session.status.as_str(),
            queue_sequence,
            now,
        ],
    )?;
    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions WHERE id = ?1"),
        [session.id],
        from_row,
    )?)
}

impl super::Database {
    pub(crate) fn create_scoped_agent_session(
        &self,
        session: &NewScopedAgentSession<'_>,
    ) -> Result<ScopedAgentSessionRow, ScopedAgentSessionStoreError> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let created = create_on_connection(&tx, session)?;
        tx.commit()?;
        Ok(created)
    }

    pub(crate) fn admit_scoped_agent_session(
        &self,
        session: &NewScopedAgentSession<'_>,
        execution_limit: usize,
        queue_limit: usize,
    ) -> Result<ScopedAgentSessionRow, ScopedAgentSessionStoreError> {
        let execution_limit = i64::try_from(execution_limit).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let queue_limit_i64 = i64::try_from(queue_limit).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let executing: i64 = tx.query_row(
            "SELECT COUNT(*) FROM scoped_agent_sessions
             WHERE status IN ('starting', 'running', 'paused')",
            [],
            |row| row.get(0),
        )?;
        let queued: i64 = tx.query_row(
            "SELECT COUNT(*) FROM scoped_agent_sessions WHERE status = 'queued'",
            [],
            |row| row.get(0),
        )?;
        let (status, queue_sequence) = if executing < execution_limit {
            (ScopedAgentSessionStatus::Starting, None)
        } else {
            if queued >= queue_limit_i64 {
                return Err(ScopedAgentSessionStoreError::QueueFull { queue_limit });
            }
            let next: i64 = tx.query_row(
                "SELECT COALESCE(MAX(queue_sequence), 0) + 1 FROM scoped_agent_sessions",
                [],
                |row| row.get(0),
            )?;
            let next = u64::try_from(next).map_err(|error| {
                ScopedAgentSessionStoreError::Database(rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                ))
            })?;
            (ScopedAgentSessionStatus::Queued, Some(next))
        };
        let admitted = NewScopedAgentSession {
            status,
            queue_sequence,
            ..*session
        };
        let created = create_on_connection(&tx, &admitted)?;
        tx.commit()?;
        Ok(created)
    }

    pub(crate) fn scoped_agent_session(
        &self,
        namespace: &str,
        target_key: &str,
        revision: &str,
    ) -> Result<Option<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions
                     WHERE namespace = ?1 AND target_key = ?2 AND revision = ?3"
                ),
                params![namespace, target_key, revision],
                from_row,
            )
            .optional()?)
    }

    pub(crate) fn scoped_agent_session_by_id(
        &self,
        id: &str,
    ) -> Result<Option<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        Ok(conn
            .query_row(
                &format!("SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions WHERE id = ?1"),
                [id],
                from_row,
            )
            .optional()?)
    }

    pub(crate) fn latest_scoped_agent_session_event_sequence(
        &self,
        owner_plugin_id: &str,
        namespace: &str,
        target_key: &str,
        revision: &str,
    ) -> Result<u64, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let sequence: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sequence), 0) FROM scoped_agent_session_events
             WHERE owner_plugin_id = ?1 AND namespace = ?2 AND target_key = ?3 AND revision = ?4",
            params![owner_plugin_id, namespace, target_key, revision],
            |row| row.get(0),
        )?;
        u64::try_from(sequence).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Integer,
                Box::new(error),
            ))
        })
    }

    pub(crate) fn scoped_agent_session_events_after(
        &self,
        owner_plugin_id: &str,
        namespace: &str,
        target_key: &str,
        revision: &str,
        after_sequence: u64,
        limit: usize,
    ) -> Result<Vec<ScopedAgentSessionEventRow>, ScopedAgentSessionStoreError> {
        let after_sequence = i64::try_from(after_sequence).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let limit = i64::try_from(limit).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(
            "SELECT sequence, session_id, turn_id, status, workspace_available,
                    error_code, error_message, created_at, updated_at
               FROM scoped_agent_session_events
              WHERE owner_plugin_id = ?1 AND namespace = ?2 AND target_key = ?3
                AND revision = ?4 AND sequence > ?5
              ORDER BY sequence LIMIT ?6",
        )?;
        let rows = statement
            .query_map(
                params![
                    owner_plugin_id,
                    namespace,
                    target_key,
                    revision,
                    after_sequence,
                    limit,
                ],
                event_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(crate) fn scoped_agent_sessions_for_logical_scope(
        &self,
        namespace: &str,
        target_key: &str,
    ) -> Result<Vec<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions
             WHERE namespace = ?1 AND target_key = ?2 ORDER BY created_at, id"
        ))?;
        let rows = statement
            .query_map(params![namespace, target_key], from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(crate) fn scoped_agent_sessions_for_owner(
        &self,
        owner_plugin_id: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let sql = format!(
            "SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions
             WHERE owner_plugin_id = ?1 AND (?2 IS NULL OR project_id = ?2)
             ORDER BY created_at, id"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement
            .query_map(params![owner_plugin_id, project_id], from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(crate) fn scoped_agent_queue_position(
        &self,
        id: &str,
    ) -> Result<Option<usize>, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let sequence = conn
            .query_row(
                "SELECT queue_sequence FROM scoped_agent_sessions
                 WHERE id = ?1 AND status = 'queued'",
                [id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(sequence) = sequence else {
            return Ok(None);
        };
        let ahead: i64 = conn.query_row(
            "SELECT COUNT(*) FROM scoped_agent_sessions
             WHERE status = 'queued' AND queue_sequence < ?1",
            [sequence],
            |row| row.get(0),
        )?;
        Ok(Some(usize::try_from(ahead + 1).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Integer,
                Box::new(error),
            ))
        })?))
    }

    pub(crate) fn set_scoped_agent_resolved_commit(
        &self,
        id: &str,
        resolved_commit: &str,
    ) -> Result<(), ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let changed = conn.execute(
            "UPDATE scoped_agent_sessions SET resolved_commit = ?2, updated_at = ?3,
                    last_used_at = ?3
              WHERE id = ?1 AND status = 'starting'",
            params![id, resolved_commit, now],
        )?;
        if changed == 0 {
            return Err(ScopedAgentSessionStoreError::InvalidStatusTransition {
                status: "resolve_workspace".to_string(),
            });
        }
        Ok(())
    }

    pub(crate) fn mark_scoped_agent_session_running(
        &self,
        id: &str,
        provider_session_id: Option<&str>,
        pty_instance_id: u64,
    ) -> Result<(), ScopedAgentSessionStoreError> {
        let pty_instance_id = i64::try_from(pty_instance_id).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let changed = conn.execute(
            "UPDATE scoped_agent_sessions
                SET status = 'running', provider_session_id = ?2, pty_instance_id = ?3,
                    error_code = NULL, error_message = NULL,
                    updated_at = ?4, last_used_at = ?4
              WHERE id = ?1 AND status = 'starting'",
            params![id, provider_session_id, pty_instance_id, now],
        )?;
        if changed == 0 {
            return Err(ScopedAgentSessionStoreError::InvalidStatusTransition {
                status: ScopedAgentSessionStatus::Running.as_str().to_string(),
            });
        }
        Ok(())
    }

    pub(crate) fn set_scoped_agent_provider_session_id(
        &self,
        id: &str,
        provider: &str,
        pty_instance_id: u64,
        provider_session_id: &str,
    ) -> Result<bool, ScopedAgentSessionStoreError> {
        if provider_session_id.is_empty() {
            return Ok(false);
        }
        let pty_instance_id = i64::try_from(pty_instance_id).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let changed = conn.execute(
            "UPDATE scoped_agent_sessions
                SET provider_session_id = ?4, updated_at = ?5, last_used_at = ?5
              WHERE id = ?1 AND provider = ?2 AND pty_instance_id = ?3
                AND status IN ('running', 'paused')
                AND (provider_session_id IS NULL OR provider_session_id = ?4)",
            params![id, provider, pty_instance_id, provider_session_id, now],
        )?;
        Ok(changed == 1)
    }

    pub(crate) fn begin_scoped_agent_turn(
        &self,
        id: &str,
        pty_instance_id: u64,
        turn_id: &str,
    ) -> Result<ScopedTurnTransition, ScopedAgentSessionStoreError> {
        self.transition_scoped_agent_turn(id, pty_instance_id, turn_id, ScopedTurnEvent::Begin)
    }

    pub(crate) fn pause_scoped_agent_turn(
        &self,
        id: &str,
        pty_instance_id: u64,
        turn_id: &str,
    ) -> Result<ScopedTurnTransition, ScopedAgentSessionStoreError> {
        self.transition_scoped_agent_turn(id, pty_instance_id, turn_id, ScopedTurnEvent::Pause)
    }

    fn transition_scoped_agent_turn(
        &self,
        id: &str,
        pty_instance_id: u64,
        turn_id: &str,
        event: ScopedTurnEvent,
    ) -> Result<ScopedTurnTransition, ScopedAgentSessionStoreError> {
        let pty_instance_id = i64::try_from(pty_instance_id).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let current = tx
            .query_row(
                "SELECT pty_instance_id, turn_id, status FROM scoped_agent_sessions WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((current_instance, current_turn, current_status)) = current else {
            return Ok(ScopedTurnTransition::Rejected);
        };
        if current_instance != Some(pty_instance_id)
            || !matches!(current_status.as_str(), "running" | "paused")
        {
            return Ok(ScopedTurnTransition::Rejected);
        }
        let target_status = match event {
            ScopedTurnEvent::Begin => {
                if current_turn.as_deref() == Some(turn_id) {
                    return Ok(ScopedTurnTransition::Duplicate);
                }
                match (current_status.as_str(), current_turn.is_none()) {
                    ("running", true) | ("paused", _) => "running",
                    _ => return Ok(ScopedTurnTransition::Rejected),
                }
            }
            ScopedTurnEvent::Pause => {
                if current_turn.as_deref() != Some(turn_id) {
                    return Ok(ScopedTurnTransition::Rejected);
                }
                if current_status == "paused" {
                    return Ok(ScopedTurnTransition::Duplicate);
                }
                "paused"
            }
        };
        let now = super::current_unix_timestamp()?;
        tx.execute(
            "UPDATE scoped_agent_sessions SET status = ?2, turn_id = ?3,
                    updated_at = ?4, last_used_at = ?4 WHERE id = ?1",
            params![id, target_status, turn_id, now],
        )?;
        record_scoped_agent_session_event(&tx, id)?;
        tx.commit()?;
        Ok(ScopedTurnTransition::Applied)
    }

    pub(crate) fn schedule_scoped_agent_continuation(
        &self,
        id: &str,
        execution_limit: usize,
        queue_limit: usize,
    ) -> Result<ScopedAgentSessionRow, ScopedAgentSessionStoreError> {
        let execution_limit = i64::try_from(execution_limit).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let queue_limit_i64 = i64::try_from(queue_limit).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let current = tx
            .query_row(
                &format!("SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions WHERE id = ?1"),
                [id],
                from_row,
            )
            .optional()?
            .ok_or_else(|| ScopedAgentSessionStoreError::NotFound {
                session_id: id.to_string(),
            })?;
        if !matches!(
            current.status,
            ScopedAgentSessionStatus::Completed
                | ScopedAgentSessionStatus::Failed
                | ScopedAgentSessionStatus::Aborted
                | ScopedAgentSessionStatus::Interrupted
        ) {
            return Err(ScopedAgentSessionStoreError::InvalidStatusTransition {
                status: "continue".to_string(),
            });
        }
        let executing: i64 = tx.query_row(
            "SELECT COUNT(*) FROM scoped_agent_sessions
             WHERE status IN ('starting', 'running', 'paused')",
            [],
            |row| row.get(0),
        )?;
        let queued: i64 = tx.query_row(
            "SELECT COUNT(*) FROM scoped_agent_sessions WHERE status = 'queued'",
            [],
            |row| row.get(0),
        )?;
        let (status, queue_sequence) = if executing < execution_limit {
            (ScopedAgentSessionStatus::Starting, current.queue_sequence)
        } else {
            if queued >= queue_limit_i64 {
                return Err(ScopedAgentSessionStoreError::QueueFull { queue_limit });
            }
            let next: i64 = tx.query_row(
                "SELECT COALESCE(MAX(queue_sequence), 0) + 1 FROM scoped_agent_sessions",
                [],
                |row| row.get(0),
            )?;
            (
                ScopedAgentSessionStatus::Queued,
                Some(u64::try_from(next).map_err(|error| {
                    ScopedAgentSessionStoreError::Database(
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        ),
                    )
                })?),
            )
        };
        let now = super::current_unix_timestamp()?;
        tx.execute(
            "UPDATE scoped_agent_sessions SET status = ?2, queue_sequence = ?3,
                    pty_instance_id = NULL, turn_id = NULL, error_code = NULL, error_message = NULL,
                    updated_at = ?4, last_used_at = ?4
              WHERE id = ?1 AND status IN ('completed', 'failed', 'aborted', 'interrupted')",
            params![
                id,
                status.as_str(),
                queue_sequence
                    .map(i64::try_from)
                    .transpose()
                    .map_err(|error| {
                        ScopedAgentSessionStoreError::Database(
                            rusqlite::Error::ToSqlConversionFailure(Box::new(error)),
                        )
                    })?,
                now
            ],
        )?;
        let updated = tx.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions WHERE id = ?1"),
            [id],
            from_row,
        )?;
        tx.commit()?;
        Ok(updated)
    }

    pub(crate) fn finish_scoped_agent_session(
        &self,
        id: &str,
        pty_instance_id: u64,
        status: ScopedAgentSessionStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
        execution_limit: usize,
    ) -> Result<(bool, Option<ScopedAgentSessionRow>), ScopedAgentSessionStoreError> {
        if !matches!(
            status,
            ScopedAgentSessionStatus::Completed
                | ScopedAgentSessionStatus::Failed
                | ScopedAgentSessionStatus::Aborted
                | ScopedAgentSessionStatus::Interrupted
        ) {
            return Err(ScopedAgentSessionStoreError::InvalidStatusTransition {
                status: status.as_str().to_string(),
            });
        }
        let pty_instance_id = i64::try_from(pty_instance_id).map_err(|error| {
            ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                Box::new(error),
            ))
        })?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let now = super::current_unix_timestamp()?;
        let changed = tx.execute(
            "UPDATE scoped_agent_sessions
                SET status = ?3, error_code = ?4, error_message = ?5,
                    updated_at = ?6, last_used_at = ?6
              WHERE id = ?1 AND pty_instance_id = ?2
                AND status IN ('starting', 'running', 'paused')",
            params![
                id,
                pty_instance_id,
                status.as_str(),
                error_code,
                error_message,
                now
            ],
        )?;
        let promoted = if changed > 0 {
            record_scoped_agent_session_event(&tx, id)?;
            promote_next_on_connection(&tx, execution_limit)?
        } else {
            None
        };
        tx.commit()?;
        Ok((changed > 0, promoted))
    }

    pub(crate) fn fail_starting_scoped_agent_session(
        &self,
        id: &str,
        error_code: &str,
        error_message: &str,
        execution_limit: usize,
    ) -> Result<(bool, Option<ScopedAgentSessionRow>), ScopedAgentSessionStoreError> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let now = super::current_unix_timestamp()?;
        let changed = tx.execute(
            "UPDATE scoped_agent_sessions
                SET status = 'failed', error_code = ?2, error_message = ?3,
                    updated_at = ?4, last_used_at = ?4
              WHERE id = ?1 AND status = 'starting'",
            params![id, error_code, error_message, now],
        )?;
        let promoted = if changed > 0 {
            record_scoped_agent_session_event(&tx, id)?;
            promote_next_on_connection(&tx, execution_limit)?
        } else {
            None
        };
        tx.commit()?;
        Ok((changed > 0, promoted))
    }

    pub(crate) fn promote_next_scoped_agent_session(
        &self,
        execution_limit: usize,
    ) -> Result<Option<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let promoted = promote_next_on_connection(&tx, execution_limit)?;
        tx.commit()?;
        Ok(promoted)
    }

    pub(crate) fn abort_scoped_agent_session(
        &self,
        id: &str,
        execution_limit: usize,
    ) -> Result<Option<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                &format!("SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions WHERE id = ?1"),
                [id],
                from_row,
            )
            .optional()?
            .ok_or_else(|| ScopedAgentSessionStoreError::NotFound {
                session_id: id.to_string(),
            })?;
        let released_slot = matches!(
            session.status,
            ScopedAgentSessionStatus::Starting
                | ScopedAgentSessionStatus::Running
                | ScopedAgentSessionStatus::Paused
        );
        if session.status.is_live() {
            let now = super::current_unix_timestamp()?;
            tx.execute(
                "UPDATE scoped_agent_sessions
                    SET status = 'aborted', error_code = 'ABORTED',
                        error_message = 'Session aborted by caller', updated_at = ?2,
                        last_used_at = ?2
                  WHERE id = ?1",
                params![id, now],
            )?;
            record_scoped_agent_session_event(&tx, id)?;
        }

        let promoted = if released_slot {
            promote_next_on_connection(&tx, execution_limit)?
        } else {
            None
        };
        tx.commit()?;
        Ok(promoted)
    }

    pub(crate) fn interrupt_live_scoped_agent_sessions(
        &self,
    ) -> Result<usize, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        Ok(conn.execute(
            "UPDATE scoped_agent_sessions
                SET status = 'interrupted', error_code = 'HOST_RESTARTED',
                    error_message = 'Scoped session was interrupted by host restart',
                    updated_at = ?1, last_used_at = ?1
              WHERE status IN ('queued', 'starting', 'running', 'paused')",
            [now],
        )?)
    }

    pub(crate) fn delete_scoped_agent_session(
        &self,
        id: &str,
        owner_plugin_id: &str,
    ) -> Result<bool, ScopedAgentSessionStoreError> {
        let conn = self.lock_conn()?;
        Ok(conn.execute(
            "DELETE FROM scoped_agent_sessions WHERE id = ?1 AND owner_plugin_id = ?2",
            params![id, owner_plugin_id],
        )? > 0)
    }
}

fn promote_next_on_connection(
    conn: &rusqlite::Connection,
    execution_limit: usize,
) -> Result<Option<ScopedAgentSessionRow>, ScopedAgentSessionStoreError> {
    let execution_limit = i64::try_from(execution_limit).map_err(|error| {
        ScopedAgentSessionStoreError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(
            error,
        )))
    })?;
    let executing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scoped_agent_sessions
         WHERE status IN ('starting', 'running', 'paused')",
        [],
        |row| row.get(0),
    )?;
    if executing >= execution_limit {
        return Ok(None);
    }
    let queued = conn
        .query_row(
            &format!(
                "SELECT {SELECT_COLUMNS} FROM scoped_agent_sessions
                 WHERE status = 'queued'
                 ORDER BY queue_sequence, created_at, id LIMIT 1"
            ),
            [],
            from_row,
        )
        .optional()?;
    let Some(mut queued) = queued else {
        return Ok(None);
    };
    let now = super::current_unix_timestamp()?;
    let changed = conn.execute(
        "UPDATE scoped_agent_sessions SET status = 'starting', updated_at = ?2,
            last_used_at = ?2 WHERE id = ?1 AND status = 'queued'",
        params![queued.id, now],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    queued.status = ScopedAgentSessionStatus::Starting;
    queued.updated_at = now;
    queued.last_used_at = now;
    Ok(Some(queued))
}

#[cfg(test)]
#[path = "scoped_agent_sessions_tests.rs"]
mod tests;
