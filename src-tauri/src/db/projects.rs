use rusqlite::{types::Type, Result};
use serde::Serialize;
use thiserror::Error;

/// Project row from database
#[derive(Debug, Clone, Serialize)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Error)]
#[error("invalid next_project_id config value '{0}': expected a 64-bit integer")]
struct InvalidProjectIdCounter(String);

fn parse_next_project_id(value: String) -> Result<i64> {
    value.parse::<i64>().map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            Box::new(InvalidProjectIdCounter(value)),
        )
    })
}

impl super::Database {
    /// Create a new project with auto-incremented ID
    pub fn create_project(&self, name: &str, path: &str) -> Result<ProjectRow> {
        let conn = self.lock_conn()?;

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_project_id'",
            [],
            |row| parse_next_project_id(row.get(0)?),
        )?;

        let project_id = format!("P-{}", next_id);

        conn.execute(
            "UPDATE config SET value = ?1 WHERE key = 'next_project_id'",
            [&(next_id + 1).to_string()],
        )?;

        let now = super::current_unix_timestamp()?;

        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&project_id, name, path, now, now],
        )?;

        Ok(ProjectRow {
            id: project_id,
            name: name.to_string(),
            path: path.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Returns true if any project is registered at the exact given path.
    pub fn project_with_path_exists(&self, path: &str) -> Result<bool> {
        let conn = self.lock_conn()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM projects WHERE path = ?1",
            [path],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get all projects
    pub fn get_all_projects(&self) -> Result<Vec<ProjectRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects ORDER BY updated_at DESC",
        )?;

        let projects = stmt.query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        let mut result = Vec::new();
        for project in projects {
            result.push(project?);
        }
        Ok(result)
    }

    /// Get a project by ID
    pub fn get_project(&self, id: &str) -> Result<Option<ProjectRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update a project
    pub fn update_project(&self, id: &str, name: &str, path: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE projects SET name = ?1, path = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![name, path, now, id],
        )?;
        Ok(())
    }

    /// Delete a project and all associated data
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM agent_sessions WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1)",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM pr_comments WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1))",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM pull_requests WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1)",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM worktrees WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM task_workspaces WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM shepherd_messages WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM action_items WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        tx.execute(
            "DELETE FROM tasks WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        // project_config cascades automatically via ON DELETE CASCADE
        tx.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn create_project_rejects_corrupted_next_project_id_before_duplicate_id_collision() {
        let (db, _temp_dir) = make_test_db("corrupted_project_counter");
        let existing = db
            .create_project("Existing project", "/tmp/existing")
            .expect("create existing project");
        db.set_config("next_project_id", "not-a-number")
            .expect("set corrupted project counter");

        let error = db
            .create_project("Must not collide", "/tmp/must-not-collide")
            .expect_err("corrupted project counter must fail project creation");

        assert!(
            error
                .to_string()
                .contains("invalid next_project_id config value"),
            "unexpected error: {error}"
        );
        let projects = db
            .get_all_projects()
            .expect("get projects after failed creation");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, existing.id);
        assert_eq!(
            db.get_config("next_project_id")
                .expect("get corrupted project counter")
                .as_deref(),
            Some("not-a-number")
        );
    }

    #[test]
    fn test_delete_project_with_tasks_succeeds() {
        let (db, _temp_dir) = make_test_db("delete_project_with_tasks");

        let project = db
            .create_project("My Project", "/tmp/proj")
            .expect("create project failed");

        let task = db
            .create_task("Do something", "backlog", Some(&project.id), None, None)
            .expect("create task failed");

        db.create_agent_session("ses-1", &task.id, None, "implement", "running", "opencode")
            .expect("create session failed");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/workspace",
            "/tmp/repo",
            "git_worktree",
            Some("feature/test"),
            "opencode",
        )
        .expect("create task workspace failed");

        let conn = db.connection();
        {
            let conn = conn.lock().unwrap();
            conn.execute(
                "INSERT INTO shepherd_messages (project_id, role, content, event_context, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![&project.id, "assistant", "message", Some("test"), 1_i64],
            )
            .expect("insert shepherd message failed");
            conn.execute(
                "INSERT INTO action_items (project_id, source, title, description, task_id, status, created_at, dismissed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![&project.id, "shepherd", "title", "description", Option::<String>::None, "active", 1_i64, Option::<i64>::None],
            )
            .expect("insert action item failed");
        }

        db.delete_project(&project.id)
            .expect("delete_project should succeed even with associated tasks and sessions");

        let projects = db.get_all_projects().expect("get projects failed");
        assert!(
            projects.iter().all(|p| p.id != project.id),
            "project should be gone"
        );

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let remaining_shepherd_messages: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shepherd_messages WHERE project_id = ?1",
                rusqlite::params![&project.id],
                |row| row.get(0),
            )
            .expect("count shepherd messages failed");
        let remaining_action_items: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM action_items WHERE project_id = ?1",
                rusqlite::params![&project.id],
                |row| row.get(0),
            )
            .expect("count action items failed");
        let remaining_task_workspaces: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_workspaces WHERE project_id = ?1",
                rusqlite::params![&project.id],
                |row| row.get(0),
            )
            .expect("count task workspaces failed");
        assert_eq!(
            remaining_shepherd_messages, 0,
            "shepherd messages should be removed"
        );
        assert_eq!(remaining_action_items, 0, "action items should be removed");
        assert_eq!(
            remaining_task_workspaces, 0,
            "task workspaces should be removed"
        );

        drop(db);
    }

    #[test]
    fn test_project_with_path_exists() {
        let (db, _temp_dir) = make_test_db("project_with_path_exists");

        assert!(
            !db.project_with_path_exists("/tmp/does-not-exist")
                .expect("query failed"),
            "no project registered yet"
        );

        db.create_project("Widgets", "/tmp/widgets")
            .expect("create failed");

        assert!(
            db.project_with_path_exists("/tmp/widgets")
                .expect("query failed"),
            "path should now be registered"
        );
        assert!(
            !db.project_with_path_exists("/tmp/other")
                .expect("query failed"),
            "unrelated path should not match"
        );

        drop(db);
    }
}
