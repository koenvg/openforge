use rusqlite::{OptionalExtension, Result};

impl super::Database {
    pub fn save_completed_agent_terminal_replay(
        &self,
        task_id: &str,
        replay: &str,
    ) -> Result<bool> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                "SELECT id, status
                   FROM agent_sessions
                  WHERE ticket_id = ?1
                  ORDER BY created_at DESC, rowid DESC
                  LIMIT 1",
                [task_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((session_id, status)) = session else {
            return Ok(false);
        };
        if status != "completed" {
            return Ok(false);
        }

        let captured_at = super::current_unix_timestamp()?;
        tx.execute(
            "INSERT INTO agent_terminal_replays (session_id, task_id, replay, captured_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(session_id) DO UPDATE SET
               replay = excluded.replay,
               captured_at = excluded.captured_at",
            rusqlite::params![session_id, task_id, replay, captured_at],
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn get_latest_agent_terminal_replay(&self, task_id: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        conn.query_row(
            "SELECT replay
               FROM agent_terminal_replays
              WHERE session_id = (
                SELECT id
                  FROM agent_sessions
                 WHERE ticket_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT 1
              )",
            [task_id],
            |row| row.get(0),
        )
        .optional()
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn completed_agent_terminal_replay_survives_database_reopen() {
        let (db, path) = make_test_db("completed_agent_terminal_replay");
        let project = db
            .create_project("Replay Project", "/tmp/replay-project")
            .expect("create project");
        let task = db
            .create_task(
                "Inspect completed output",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_agent_session(
            "session-replay",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create Agent Session");

        assert!(db
            .save_completed_agent_terminal_replay(&task.id, "completed output\n")
            .expect("save replay"));
        drop(db);

        let reopened = crate::db::Database::new(path.clone()).expect("reopen database");
        assert_eq!(
            reopened
                .get_latest_agent_terminal_replay(&task.id)
                .expect("load replay")
                .as_deref(),
            Some("completed output\n")
        );

        drop(reopened);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn replay_persistence_rejects_a_session_that_became_active_again() {
        let (db, path) = make_test_db("active_agent_terminal_replay");
        let project = db
            .create_project("Active Replay Project", "/tmp/active-replay-project")
            .expect("create project");
        let task = db
            .create_task("Continue work", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "session-active",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create Agent Session");

        assert!(!db
            .save_completed_agent_terminal_replay(&task.id, "stale output")
            .expect("skip stale replay"));
        assert_eq!(
            db.get_latest_agent_terminal_replay(&task.id)
                .expect("load replay"),
            None
        );

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
