use super::startup_resume_eligibility::{query_startup_resumable_rows, StartupResumeRow};
use rusqlite::{params, Result};
use serde::Serialize;

/// Worktree row from database
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeRow {
    pub id: i64,
    pub task_id: String,
    pub project_id: String,
    pub repo_path: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl StartupResumeRow for WorktreeRow {
    const TABLE: &'static str = "worktrees";
    const SELECT_COLUMNS: &'static str =
        "workspace.id, workspace.task_id, workspace.project_id, workspace.repo_path, workspace.worktree_path, workspace.branch_name, workspace.status, workspace.created_at, workspace.updated_at";

    fn from_startup_resume_row(row: &rusqlite::Row<'_>) -> Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            task_id: row.get(1)?,
            project_id: row.get(2)?,
            repo_path: row.get(3)?,
            worktree_path: row.get(4)?,
            branch_name: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}

impl super::Database {
    /// Create a worktree record
    pub fn create_worktree_record(
        &self,
        task_id: &str,
        project_id: &str,
        repo_path: &str,
        worktree_path: &str,
        branch_name: &str,
    ) -> Result<i64> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;

        // Upsert keyed on the UNIQUE task_id. A blind INSERT would fail with a
        // "UNIQUE constraint failed: worktrees.task_id" error whenever a record
        // already exists for the task (e.g. a prior start that aborted before
        // cleanup), masking the real start error on every retry. Reconciling the
        // existing record in place keeps a re-start idempotent.
        conn.execute(
            "INSERT INTO worktrees (task_id, project_id, repo_path, worktree_path, branch_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)
             ON CONFLICT(task_id) DO UPDATE SET
                 project_id = excluded.project_id,
                 repo_path = excluded.repo_path,
                 worktree_path = excluded.worktree_path,
                 branch_name = excluded.branch_name,
                 status = 'active',
                 updated_at = excluded.updated_at",
            rusqlite::params![task_id, project_id, repo_path, worktree_path, branch_name, now, now],
        )?;

        // last_insert_rowid() is unreliable after an ON CONFLICT update, so read
        // the row id back explicitly to keep the returned id correct in both the
        // insert and reconcile paths.
        conn.query_row(
            "SELECT id FROM worktrees WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
    }

    /// Restore a worktree record replaced during a failed Task Start attempt.
    pub fn restore_worktree_record(&self, record: &WorktreeRow) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE worktrees
             SET project_id = ?1, repo_path = ?2, worktree_path = ?3,
                 branch_name = ?4, status = ?5, created_at = ?6, updated_at = ?7
             WHERE task_id = ?8",
            params![
                record.project_id,
                record.repo_path,
                record.worktree_path,
                record.branch_name,
                record.status,
                record.created_at,
                record.updated_at,
                record.task_id,
            ],
        )?;
        Ok(())
    }

    /// Get worktree for a task
    pub fn get_worktree_for_task(&self, task_id: &str) -> Result<Option<WorktreeRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, project_id, repo_path, worktree_path, branch_name, status, created_at, updated_at
             FROM worktrees WHERE task_id = ?1",
        )?;
        let mut rows = stmt.query([task_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(WorktreeRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                repo_path: row.get(3)?,
                worktree_path: row.get(4)?,
                branch_name: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update worktree status
    pub fn update_worktree_status(&self, task_id: &str, status: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE worktrees SET status = ?1, updated_at = ?2 WHERE task_id = ?3",
            rusqlite::params![status, now, task_id],
        )?;
        Ok(())
    }

    /// Delete a worktree record
    pub fn delete_worktree_record(&self, task_id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM worktrees WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        Ok(())
    }

    /// Get all active worktrees
    pub fn get_active_worktrees(&self) -> Result<Vec<WorktreeRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, project_id, repo_path, worktree_path, branch_name, status, created_at, updated_at
             FROM worktrees WHERE status = 'active' ORDER BY updated_at DESC",
        )?;

        let worktrees = stmt.query_map([], |row| {
            Ok(WorktreeRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                repo_path: row.get(3)?,
                worktree_path: row.get(4)?,
                branch_name: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for worktree in worktrees {
            result.push(worktree?);
        }
        Ok(result)
    }

    /// Returns active legacy worktrees whose latest Agent Session needs startup reattachment.
    /// Completed Agent Sessions remain eligible while their Task is still doing so desktop and
    /// Companion Terminal surfaces can reattach to a live provider process after restart.
    pub fn get_resumable_worktrees(&self) -> Result<Vec<WorktreeRow>> {
        let conn = self.lock_conn()?;
        query_startup_resumable_rows(&conn)
    }

    /// Get project_id for a given worktree path.
    /// Used by create_task to deduce the project when an agent creates a subtask.
    pub fn get_project_for_worktree(&self, worktree_path: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT project_id FROM worktrees WHERE worktree_path = ?1 LIMIT 1")?;
        let mut rows = stmt.query([worktree_path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn create_worktree_record_reconciles_existing_record_for_same_task() {
        let (db, _temp_dir) = make_test_db("worktree_record_idempotent");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project failed");
        let task = db
            .create_task("Idempotent task", "doing", Some(&project.id), None, None)
            .expect("create task failed");

        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/repo",
            "/tmp/wt-old",
            "branch-old",
        )
        .expect("first create should succeed");

        // A second create for the same task must not fail on the UNIQUE(task_id)
        // constraint; it should reconcile the existing record in place so a
        // retried start cannot be blocked (and the real error masked).
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/repo",
            "/tmp/wt-new",
            "branch-new",
        )
        .expect("second create should reconcile, not violate UNIQUE(task_id)");

        let worktree = db
            .get_worktree_for_task(&task.id)
            .expect("query worktree")
            .expect("worktree should exist");
        assert_eq!(worktree.worktree_path, "/tmp/wt-new");
        assert_eq!(worktree.branch_name, "branch-new");
        assert_eq!(worktree.status, "active");

        drop(db);
    }
}
