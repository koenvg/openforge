use rusqlite::{Connection, OptionalExtension, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompleteTaskWriteOutcome {
    Completed,
    NotFound,
    StaleState { current_status: String },
}

impl super::Database {
    pub fn update_task_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE tasks
             SET status = ?1,
                 updated_at = ?2,
                 execution_started_at = CASE
                     WHEN ?1 != 'backlog' THEN COALESCE(execution_started_at, ?2)
                     ELSE execution_started_at
                 END
             WHERE id = ?3",
            rusqlite::params![status, now, id],
        )?;
        Ok(())
    }

    /// Permanently delete a task and every associated row.
    ///
    /// Callers performing a user-visible lifecycle action must stop the Task runtime
    /// before this write. Rollback callers may use this before a Task is user-visible.
    pub fn hard_delete_task(&self, id: &str) -> Result<()> {
        self.delete_task_internal(id, None).map(|_| ())
    }

    /// Atomically delete a task only when it still has the state validated by the
    /// terminal Task completion service.
    pub fn delete_task_if_status(
        &self,
        id: &str,
        expected_status: &str,
    ) -> Result<CompleteTaskWriteOutcome> {
        self.delete_task_internal(id, Some(expected_status))
    }

    fn delete_task_internal(
        &self,
        id: &str,
        expected_status: Option<&str>,
    ) -> Result<CompleteTaskWriteOutcome> {
        let conn = self.lock_conn()?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<CompleteTaskWriteOutcome> {
            let Some(current_status) = task_status(&conn, id)? else {
                return Ok(CompleteTaskWriteOutcome::NotFound);
            };
            if expected_status.is_some_and(|expected| expected != current_status) {
                return Ok(CompleteTaskWriteOutcome::StaleState { current_status });
            }

            delete_runtime_children(&conn, id)?;
            conn.execute(
                "DELETE FROM task_dependencies WHERE task_id = ?1 OR depends_on_task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM task_label_assignments WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
            Ok(CompleteTaskWriteOutcome::Completed)
        })();
        finish_transaction(&conn, result)
    }

    /// Complete a task by hiding it from active board flows while preserving its Task-owned reference data.
    ///
    /// Runtime data that depends on a live workspace is removed, but the task row, labels,
    /// and dependency links remain available for CLI/agent lookup.
    #[cfg(test)]
    pub fn complete_task(&self, id: &str) -> Result<()> {
        self.complete_task_internal(id, None).map(|_| ())
    }

    /// Atomically complete a task only when it still has the state validated by
    /// the terminal Task completion service.
    pub fn complete_task_if_status(
        &self,
        id: &str,
        expected_status: &str,
    ) -> Result<CompleteTaskWriteOutcome> {
        self.complete_task_internal(id, Some(expected_status))
    }

    fn complete_task_internal(
        &self,
        id: &str,
        expected_status: Option<&str>,
    ) -> Result<CompleteTaskWriteOutcome> {
        let conn = self.lock_conn()?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<CompleteTaskWriteOutcome> {
            let Some(current_status) = task_status(&conn, id)? else {
                return Ok(CompleteTaskWriteOutcome::NotFound);
            };
            if expected_status.is_some_and(|expected| expected != current_status) {
                return Ok(CompleteTaskWriteOutcome::StaleState { current_status });
            }

            delete_runtime_children(&conn, id)?;
            let now = super::current_unix_timestamp()?;
            conn.execute(
                "UPDATE tasks
                 SET status = 'done',
                     updated_at = ?1,
                     execution_started_at = COALESCE(execution_started_at, ?1)
                 WHERE id = ?2",
                rusqlite::params![now, id],
            )?;
            Ok(CompleteTaskWriteOutcome::Completed)
        })();
        finish_transaction(&conn, result)
    }
}

fn task_status(conn: &Connection, id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT status FROM tasks WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .optional()
}

fn delete_runtime_children(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM agent_sessions WHERE ticket_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM pr_comments
         WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id = ?1)",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM pull_requests WHERE ticket_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM worktrees WHERE task_id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

fn finish_transaction<T>(conn: &Connection, result: Result<T>) -> Result<T> {
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CompleteTaskWriteOutcome;
    use crate::db::{test_helpers::make_test_db, Database};

    #[test]
    fn update_task_status_records_the_first_non_backlog_transition() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_status_transition");
        let task = db
            .create_task("Transition me", "backlog", None, None, None)
            .expect("create task");

        db.update_task_status(&task.id, "doing")
            .expect("move task to doing");
        let first_started_at = task_status_and_execution_start(&db, &task.id);
        assert_eq!(first_started_at.0, "doing");
        assert!(first_started_at.1.is_some());

        db.update_task_status(&task.id, "backlog")
            .expect("move task back to backlog");
        let returned_to_backlog = task_status_and_execution_start(&db, &task.id);
        assert_eq!(returned_to_backlog.0, "backlog");
        assert_eq!(returned_to_backlog.1, first_started_at.1);

        drop(db);
    }

    #[test]
    fn guarded_delete_rejects_stale_state_and_reports_missing_tasks() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_guarded_delete");
        let task = db
            .create_task("Delete me", "doing", None, None, None)
            .expect("create task");

        assert_eq!(
            db.delete_task_if_status(&task.id, "backlog")
                .expect("guarded delete"),
            CompleteTaskWriteOutcome::StaleState {
                current_status: "doing".to_string(),
            }
        );
        assert!(db.get_task(&task.id).expect("load task").is_some());

        assert_eq!(
            db.delete_task_if_status(&task.id, "doing")
                .expect("guarded delete"),
            CompleteTaskWriteOutcome::Completed
        );
        assert!(db.get_task(&task.id).expect("load task").is_none());
        assert_eq!(
            db.delete_task_if_status(&task.id, "doing")
                .expect("guarded delete"),
            CompleteTaskWriteOutcome::NotFound
        );

        drop(db);
    }

    #[test]
    fn guarded_completion_rejects_stale_state_and_retains_the_task() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_guarded_completion");
        let task = db
            .create_task("Complete me", "doing", None, None, None)
            .expect("create task");

        assert_eq!(
            db.complete_task_if_status(&task.id, "backlog")
                .expect("guarded completion"),
            CompleteTaskWriteOutcome::StaleState {
                current_status: "doing".to_string(),
            }
        );
        assert_eq!(
            db.get_task(&task.id)
                .expect("load task")
                .expect("task should remain")
                .status,
            "doing"
        );

        assert_eq!(
            db.complete_task_if_status(&task.id, "doing")
                .expect("guarded completion"),
            CompleteTaskWriteOutcome::Completed
        );
        assert_eq!(
            db.get_task(&task.id)
                .expect("load task")
                .expect("completed task should remain")
                .status,
            "done"
        );
        assert_eq!(
            db.complete_task_if_status("missing-task", "doing")
                .expect("guarded completion"),
            CompleteTaskWriteOutcome::NotFound
        );

        drop(db);
    }

    #[test]
    fn completion_removes_runtime_children_and_preserves_task_references() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_completion_children");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let prerequisite = db
            .create_task("Prerequisite", "done", Some(&project.id), None, None)
            .expect("create prerequisite");
        let task = db
            .create_task("Complete me", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.add_task_dependency(&task.id, &prerequisite.id)
            .expect("add dependency");
        let label = db
            .add_task_label(&task.id, "lifecycle")
            .expect("add task label");
        insert_runtime_children(&db, &task.id, &project.id);

        db.complete_task(&task.id).expect("complete task");

        let completed = db
            .get_task(&task.id)
            .expect("load task")
            .expect("completed task should remain");
        assert_eq!(completed.status, "done");
        assert_eq!(completed.depends_on, vec![prerequisite.id]);
        assert_eq!(completed.labels.len(), 1);
        assert_eq!(completed.labels[0].id, label.id);
        assert_runtime_children_absent(&db, &task.id);

        drop(db);
    }

    #[test]
    fn hard_delete_removes_runtime_children_and_task_owned_references() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_delete_children");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Delete me", "doing", Some(&project.id), None, None)
            .expect("create task");
        let dependent = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.add_task_dependency(&dependent.id, &task.id)
            .expect("add dependency");
        db.add_task_label(&task.id, "lifecycle")
            .expect("add task label");
        insert_runtime_children(&db, &task.id, &project.id);

        db.hard_delete_task(&task.id).expect("hard delete task");

        assert!(db.get_task(&task.id).expect("load task").is_none());
        assert!(db
            .get_task(&dependent.id)
            .expect("load dependent")
            .expect("dependent should remain")
            .depends_on
            .is_empty());
        assert_runtime_children_absent(&db, &task.id);

        drop(db);
    }

    #[test]
    fn hard_delete_rolls_back_all_writes_when_child_cleanup_fails() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_delete_rollback");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Delete me", "doing", Some(&project.id), None, None)
            .expect("create task");
        insert_runtime_children(&db, &task.id, &project.id);
        install_delete_failure_trigger(&db, &task.id);

        assert!(db.delete_task_if_status(&task.id, "doing").is_err());

        assert!(db.get_task(&task.id).expect("load task").is_some());
        assert_runtime_children_present(&db, &task.id);

        drop(db);
    }

    #[test]
    fn completion_rolls_back_child_cleanup_when_status_update_fails() {
        let (db, _temp_dir) = make_test_db("task_lifecycle_completion_rollback");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Complete me", "doing", Some(&project.id), None, None)
            .expect("create task");
        insert_runtime_children(&db, &task.id, &project.id);
        install_completion_failure_trigger(&db, &task.id);

        assert!(db.complete_task_if_status(&task.id, "doing").is_err());

        assert_eq!(
            db.get_task(&task.id)
                .expect("load task")
                .expect("task should remain")
                .status,
            "doing"
        );
        assert_runtime_children_present(&db, &task.id);

        drop(db);
    }

    fn task_status_and_execution_start(db: &Database, task_id: &str) -> (String, Option<i64>) {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.query_row(
            "SELECT status, execution_started_at FROM tasks WHERE id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("load lifecycle columns")
    }

    fn insert_runtime_children(db: &Database, task_id: &str, project_id: &str) {
        db.create_agent_session(
            "session-lifecycle",
            task_id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("create agent session");
        db.insert_pull_request(
            99,
            task_id,
            "acme",
            "repo",
            "PR title",
            "https://example.com",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pull request");
        db.insert_pr_comment(
            501,
            99,
            "reviewer",
            "Fix this",
            "review",
            Some("main.rs"),
            Some(10),
            false,
            1000,
        )
        .expect("insert pull request comment");
        db.create_worktree_record(
            task_id,
            project_id,
            "/tmp/project",
            "/tmp/project/.worktrees/task",
            "openforge/task",
        )
        .expect("create worktree record");
    }

    fn assert_runtime_children_absent(db: &Database, task_id: &str) {
        assert!(db
            .get_latest_session_for_ticket(task_id)
            .expect("load agent session")
            .is_none());
        assert!(db
            .get_pull_requests_for_task(task_id)
            .expect("load pull requests")
            .is_empty());
        assert!(db
            .get_pr_comments_by_ids(&[501])
            .expect("load pull request comments")
            .is_empty());
        assert!(db
            .get_worktree_for_task(task_id)
            .expect("load worktree")
            .is_none());
    }

    fn assert_runtime_children_present(db: &Database, task_id: &str) {
        assert!(db
            .get_latest_session_for_ticket(task_id)
            .expect("load agent session")
            .is_some());
        assert_eq!(
            db.get_pull_requests_for_task(task_id)
                .expect("load pull requests")
                .len(),
            1
        );
        assert_eq!(
            db.get_pr_comments_by_ids(&[501])
                .expect("load pull request comments")
                .len(),
            1
        );
        assert!(db
            .get_worktree_for_task(task_id)
            .expect("load worktree")
            .is_some());
    }

    fn install_delete_failure_trigger(db: &Database, task_id: &str) {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.execute_batch(&format!(
            "CREATE TRIGGER fail_lifecycle_delete
             BEFORE DELETE ON pull_requests
             WHEN OLD.ticket_id = '{}'
             BEGIN
                 SELECT RAISE(ABORT, 'forced lifecycle delete failure');
             END;",
            task_id.replace('\'', "''")
        ))
        .expect("install delete failure trigger");
    }

    fn install_completion_failure_trigger(db: &Database, task_id: &str) {
        let conn = db.connection();
        let conn = conn.lock().expect("lock database");
        conn.execute_batch(&format!(
            "CREATE TRIGGER fail_lifecycle_completion
             BEFORE UPDATE OF status ON tasks
             WHEN NEW.id = '{}' AND NEW.status = 'done'
             BEGIN
                 SELECT RAISE(ABORT, 'forced lifecycle completion failure');
             END;",
            task_id.replace('\'', "''")
        ))
        .expect("install completion failure trigger");
    }
}
