use std::fmt;

pub(crate) struct TaskStartFinalization<'a> {
    pub task_id: &'a str,
    pub project_id: &'a str,
    pub workspace_path: &'a str,
    pub repo_path: &'a str,
    pub workspace_kind: &'a str,
    pub branch_name: Option<&'a str>,
    pub provider_name: &'a str,
    pub agent_session_id: &'a str,
    pub opencode_session_id: Option<&'a str>,
    pub pi_session_id: Option<&'a str>,
    pub pty_instance_id: Option<u64>,
}

#[derive(Debug)]
pub(crate) enum FinalizeTaskStartError {
    StaleState,
    InvalidPtyInstance(u64),
    Database(rusqlite::Error),
}

impl fmt::Display for FinalizeTaskStartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StaleState => write!(f, "Task is no longer in backlog"),
            Self::InvalidPtyInstance(instance_id) => {
                write!(f, "PTY instance ID {instance_id} exceeds SQLite range")
            }
            Self::Database(error) => write!(f, "Failed to finalize Task Start: {error}"),
        }
    }
}

impl std::error::Error for FinalizeTaskStartError {}

impl From<rusqlite::Error> for FinalizeTaskStartError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl super::Database {
    /// Atomically records the successful provider launch and transitions the
    /// authoritative Task snapshot from backlog to doing.
    pub(crate) fn finalize_task_start(
        &self,
        finalization: TaskStartFinalization<'_>,
    ) -> Result<(), FinalizeTaskStartError> {
        let pty_instance_id = finalization
            .pty_instance_id
            .map(|instance_id| {
                i64::try_from(instance_id)
                    .map_err(|_| FinalizeTaskStartError::InvalidPtyInstance(instance_id))
            })
            .transpose()?;
        let mut conn = self.lock_conn()?;
        let transaction = conn.transaction()?;
        let now = super::current_unix_timestamp()?;

        let transitioned = transaction.execute(
            "UPDATE tasks
             SET status = 'doing',
                 updated_at = ?1,
                 execution_started_at = COALESCE(execution_started_at, ?1)
             WHERE id = ?2 AND status = 'backlog'",
            rusqlite::params![now, finalization.task_id],
        )?;
        if transitioned != 1 {
            return Err(FinalizeTaskStartError::StaleState);
        }

        transaction.execute(
            "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9)
             ON CONFLICT(task_id) DO UPDATE SET
               project_id = excluded.project_id,
               workspace_path = excluded.workspace_path,
               repo_path = excluded.repo_path,
               kind = excluded.kind,
               branch_name = excluded.branch_name,
               provider_name = excluded.provider_name,
               status = excluded.status,
               updated_at = excluded.updated_at",
            rusqlite::params![
                finalization.task_id,
                finalization.project_id,
                finalization.workspace_path,
                finalization.repo_path,
                finalization.workspace_kind,
                finalization.branch_name,
                finalization.provider_name,
                now,
                now,
            ],
        )?;

        transaction.execute(
            "INSERT INTO agent_sessions (
                id, ticket_id, opencode_session_id, stage, status, provider,
                claude_session_id, pi_session_id, pty_instance_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'implementing', 'running', ?4, NULL, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                finalization.agent_session_id,
                finalization.task_id,
                finalization.opencode_session_id,
                finalization.provider_name,
                finalization.pi_session_id,
                pty_instance_id,
                now,
                now,
            ],
        )?;

        transaction.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{FinalizeTaskStartError, TaskStartFinalization};

    #[test]
    fn finalize_task_start_returns_database_error_when_connection_mutex_is_poisoned() {
        let (db, _temp_dir) =
            crate::db::test_helpers::make_test_db("finalize_task_start_connection_poisoned");
        let conn = db.connection();
        let poisoner = std::thread::spawn(move || {
            let _guard = conn.lock().expect("connection mutex should start healthy");
            panic!("poison database connection mutex");
        });
        assert!(poisoner.join().is_err());

        let result = db.finalize_task_start(TaskStartFinalization {
            task_id: "T-poisoned",
            project_id: "P-poisoned",
            workspace_path: "/tmp/workspace",
            repo_path: "/tmp/repo",
            workspace_kind: "worktree",
            branch_name: Some("feature/poisoned"),
            provider_name: "test-provider",
            agent_session_id: "session-poisoned",
            opencode_session_id: None,
            pi_session_id: None,
            pty_instance_id: None,
        });

        let error = match result {
            Err(FinalizeTaskStartError::Database(rusqlite::Error::ToSqlConversionFailure(
                error,
            ))) => error,
            Err(error) => panic!("unexpected finalization error: {error}"),
            Ok(()) => panic!("poisoned connection lock unexpectedly succeeded"),
        };
        assert!(error
            .downcast_ref::<super::super::ConnectionMutexPoisoned>()
            .is_some());

        drop(db);
    }
}
