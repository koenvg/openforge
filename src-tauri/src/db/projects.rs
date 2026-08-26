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

/// Attention summary for a project (cross-domain aggregation)
#[derive(Debug, Clone, Serialize)]
pub struct ProjectAttentionRow {
    pub project_id: String,
    /// Number of doing tasks where the agent is paused waiting for input
    pub needs_input: i64,
    /// Number of doing tasks where the agent is running
    pub running_agents: i64,
    /// Number of open PRs with CI failure
    pub ci_failures: i64,
    /// Total unaddressed PR comments across open PRs
    pub unaddressed_comments: i64,
    /// Number of doing tasks where the agent has completed (needs review/move)
    pub completed_agents: i64,
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

    fn project_config_value(
        conn: &rusqlite::Connection,
        project_id: &str,
        key: &str,
    ) -> Result<Option<String>> {
        let mut stmt =
            conn.prepare("SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([project_id, key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    fn write_project_config_value(
        conn: &rusqlite::Connection,
        project_id: &str,
        key: &str,
        value: &str,
    ) -> Result<()> {
        conn.execute(
            "INSERT OR REPLACE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            [project_id, key, value],
        )?;
        Ok(())
    }

    /// Get a project config value
    pub fn get_project_config(&self, project_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        Self::project_config_value(&conn, project_id, key)
    }

    /// Set a project config value
    pub fn set_project_config(&self, project_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        Self::write_project_config_value(&conn, project_id, key, value)
    }

    /// Atomically read and update a project config value under one connection lock.
    ///
    /// The callback runs while the connection is locked and must not call other database methods.
    ///
    /// # Errors
    ///
    /// Returns an error if locking, reading, or writing the database fails, or if the callback
    /// rejects the update.
    pub fn update_project_config<T>(
        &self,
        project_id: &str,
        key: &str,
        update: impl FnOnce(Option<&str>) -> Result<(String, T)>,
    ) -> Result<T> {
        let conn = self.lock_conn()?;
        let stored = Self::project_config_value(&conn, project_id, key)?;
        let (value, result) = update(stored.as_deref())?;
        Self::write_project_config_value(&conn, project_id, key, &value)?;
        Ok(result)
    }

    /// Clear an explicit project config value so callers inherit its global default.
    pub fn clear_project_config(&self, project_id: &str, key: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM project_config WHERE project_id = ?1 AND key = ?2",
            [project_id, key],
        )?;
        Ok(())
    }

    /// Get all config values for a project
    pub fn get_all_project_config(
        &self,
        project_id: &str,
    ) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT key, value FROM project_config WHERE project_id = ?1")?;
        let rows = stmt.query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?;

        let mut result = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            result.insert(key, value);
        }
        Ok(result)
    }

    /// Resolve the AI provider for a project.
    /// Checks project_config first, falls back to global config, then defaults to "claude-code".
    ///
    /// # Errors
    /// Returns an error when a project or global configuration lookup fails.
    pub fn try_resolve_ai_provider(&self, project_id: &str) -> Result<String> {
        if !project_id.is_empty() {
            if let Some(provider) = self.get_project_config(project_id, "ai_provider")? {
                if !provider.is_empty() {
                    return Ok(provider);
                }
            }
        }
        Ok(self
            .get_config("ai_provider")?
            .unwrap_or_else(|| "claude-code".to_string()))
    }

    /// Get attention summaries for all projects.
    ///
    /// Aggregates cross-domain signals (agent status, PR status) per project
    /// so the project switcher can show which projects need attention.
    pub fn get_project_attention_summaries(&self) -> Result<Vec<ProjectAttentionRow>> {
        let conn = self.lock_conn()?;
        let mut attention: std::collections::HashMap<String, ProjectAttentionRow> =
            std::collections::HashMap::new();

        // Query 1: Task/agent attention for "doing" tasks
        {
            let mut stmt = conn.prepare(
                "WITH doing_tasks AS (
                    SELECT id, project_id
                    FROM tasks
                    WHERE project_id IS NOT NULL AND status = 'doing'
                ),
                latest_sessions AS (
                    SELECT ticket_id, status, checkpoint_data
                    FROM (
                        SELECT
                            s.ticket_id,
                            s.status,
                            s.checkpoint_data,
                            ROW_NUMBER() OVER (
                                PARTITION BY s.ticket_id
                                ORDER BY s.created_at DESC, s.rowid DESC
                            ) AS rn
                        FROM agent_sessions s
                        JOIN doing_tasks dt ON dt.id = s.ticket_id
                    )
                    WHERE rn = 1
                )
                SELECT
                    dt.project_id,
                    COALESCE(SUM(CASE WHEN ls.status = 'paused' AND ls.checkpoint_data IS NOT NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ls.status = 'running' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ls.status = 'completed' THEN 1 ELSE 0 END), 0)
                FROM doing_tasks dt
                LEFT JOIN latest_sessions ls ON ls.ticket_id = dt.id
                GROUP BY dt.project_id"
            )?;

            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?;

            for row in rows {
                let (project_id, needs_input, running_agents, completed_agents) = row?;
                let entry =
                    attention
                        .entry(project_id.clone())
                        .or_insert_with(|| ProjectAttentionRow {
                            project_id,
                            needs_input: 0,
                            running_agents: 0,
                            ci_failures: 0,
                            unaddressed_comments: 0,
                            completed_agents: 0,
                        });
                entry.needs_input = needs_input;
                entry.running_agents = running_agents;
                entry.completed_agents = completed_agents;
            }
        }

        // Query 2: PR attention for open PRs
        {
            let mut stmt = conn.prepare(
                "SELECT
                    t.project_id,
                    COUNT(DISTINCT CASE WHEN pr.ci_status = 'failure' THEN pr.id END),
                    COALESCE(SUM(
                        (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pr.id AND addressed = 0)
                    ), 0)
                FROM pull_requests pr
                JOIN tasks t ON t.id = pr.ticket_id
                WHERE t.project_id IS NOT NULL AND pr.state = 'open'
                GROUP BY t.project_id",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?;

            for row in rows {
                let (project_id, ci_failures, unaddressed_comments) = row?;
                let entry =
                    attention
                        .entry(project_id.clone())
                        .or_insert_with(|| ProjectAttentionRow {
                            project_id,
                            needs_input: 0,
                            running_agents: 0,
                            ci_failures: 0,
                            unaddressed_comments: 0,
                            completed_agents: 0,
                        });
                entry.ci_failures = ci_failures;
                entry.unaddressed_comments = unaddressed_comments;
            }
        }

        Ok(attention.into_values().collect())
    }

    pub fn get_project_attention_for_project(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectAttentionRow>> {
        let summaries = self.get_project_attention_summaries()?;
        Ok(summaries
            .into_iter()
            .find(|row| row.project_id == project_id))
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
    fn test_project_config_operations() {
        let (db, _temp_dir) = make_test_db("project_config");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "custom_repo_hint", "owner/repo")
            .expect("Failed to set custom_repo_hint");
        db.set_project_config(&project.id, "custom_setting", "value123")
            .expect("Failed to set custom_setting");

        let repo_hint = db
            .get_project_config(&project.id, "custom_repo_hint")
            .expect("Failed to get custom_repo_hint");
        assert_eq!(repo_hint, Some("owner/repo".to_string()));

        let setting = db
            .get_project_config(&project.id, "custom_setting")
            .expect("Failed to get custom_setting");
        assert_eq!(setting, Some("value123".to_string()));

        let nonexistent = db
            .get_project_config(&project.id, "nonexistent")
            .expect("Failed to query nonexistent");
        assert_eq!(nonexistent, None);

        drop(db);
    }

    #[test]
    fn concurrent_project_config_updates_preserve_each_change() {
        let (db, _temp_dir) = make_test_db("concurrent_project_config_updates");
        let project_id = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project")
            .id;
        let db = std::sync::Arc::new(db);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));

        let handles = (0..8)
            .map(|index| {
                let db = std::sync::Arc::clone(&db);
                let barrier = std::sync::Arc::clone(&barrier);
                let project_id = project_id.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    db.update_project_config(&project_id, "workers", |stored| {
                        let mut workers = stored
                            .unwrap_or_default()
                            .split(',')
                            .filter(|worker| !worker.is_empty())
                            .map(str::to_owned)
                            .collect::<Vec<_>>();
                        std::thread::sleep(std::time::Duration::from_millis(5));
                        workers.push(index.to_string());
                        Ok((workers.join(","), ()))
                    })
                    .expect("update project config");
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("join config update");
        }

        let mut workers = db
            .get_project_config(&project_id, "workers")
            .expect("read project config")
            .expect("stored project config")
            .split(',')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        workers.sort();

        assert_eq!(workers, ["0", "1", "2", "3", "4", "5", "6", "7"]);
    }

    #[test]
    fn test_clear_project_config_restores_inheritance() {
        let (db, _temp_dir) = make_test_db("clear_project_config");
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project");

        db.set_project_config(&project.id, "ai_provider", "codex")
            .expect("set project override");
        db.clear_project_config(&project.id, "ai_provider")
            .expect("clear project override");

        assert_eq!(
            db.get_project_config(&project.id, "ai_provider")
                .expect("read project override"),
            None
        );

        drop(db);
    }

    #[test]
    fn test_global_and_project_config_are_independent() {
        let (db, _temp_dir) = make_test_db("independent_configs");

        db.set_config("github_token", "global-token-456")
            .expect("Failed to set global github_token");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "custom_repo_hint", "owner/repo")
            .expect("Failed to set project custom_repo_hint");

        let global_token = db
            .get_config("github_token")
            .expect("Failed to get global github_token");
        assert_eq!(global_token, Some("global-token-456".to_string()));

        let project_repo_hint = db
            .get_project_config(&project.id, "custom_repo_hint")
            .expect("Failed to get project custom_repo_hint");
        assert_eq!(project_repo_hint, Some("owner/repo".to_string()));

        drop(db);
    }

    #[test]
    fn test_project_attention_summaries_empty() {
        let (db, _temp_dir) = make_test_db("attention_empty");

        let project = db
            .create_project("Empty Project", "/tmp/empty")
            .expect("create failed");

        let summaries = db.get_project_attention_summaries().expect("query failed");
        // No doing tasks, no PRs — should return empty
        assert!(
            summaries.is_empty(),
            "Expected no attention rows for project with no doing tasks"
        );

        // Create a backlog task — still no attention since it's not 'doing'
        db.create_task("Backlog task", "backlog", Some(&project.id), None, None)
            .expect("create task failed");
        let summaries = db.get_project_attention_summaries().expect("query failed");
        assert!(summaries.is_empty());

        drop(db);
    }

    #[test]
    fn test_project_attention_summaries_with_signals() {
        let (db, _temp_dir) = make_test_db("attention_signals");

        let project = db
            .create_project("Active Project", "/tmp/active")
            .expect("create failed");

        // Create a doing task with a paused agent (needs input)
        let task1 = db
            .create_task("Doing task 1", "doing", Some(&project.id), None, None)
            .expect("create task failed");
        db.create_agent_session("ses-1", &task1.id, None, "implement", "paused", "opencode")
            .expect("create session failed");
        db.update_agent_session(
            "ses-1",
            "implement",
            "paused",
            Some("{\"q\":\"approve?\"}"),
            None,
        )
        .expect("update session failed");

        // Create a doing task with a running agent
        let task2 = db
            .create_task("Doing task 2", "doing", Some(&project.id), None, None)
            .expect("create task failed");
        db.create_agent_session("ses-2", &task2.id, None, "implement", "running", "opencode")
            .expect("create session failed");

        // Create a doing task with a completed agent (needs review/move)
        let task4 = db
            .create_task("Doing task 4", "doing", Some(&project.id), None, None)
            .expect("create task failed");
        db.create_agent_session(
            "ses-4",
            &task4.id,
            None,
            "implement",
            "completed",
            "opencode",
        )
        .expect("create session failed");

        // Create a doing task with an open PR that has CI failure + unaddressed comment
        let task3 = db
            .create_task("Doing task 3", "doing", Some(&project.id), None, None)
            .expect("create task failed");
        db.insert_pull_request(
            42,
            &task3.id,
            "acme",
            "repo",
            "Fix",
            "https://example.com",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");
        db.update_pr_ci_status(42, "sha1", "failure", "[]")
            .expect("update ci failed");
        db.insert_pr_comment(
            501,
            42,
            "reviewer",
            "Fix this",
            "review",
            Some("main.rs"),
            Some(10),
            false,
            2000,
        )
        .expect("insert comment failed");

        let summaries = db.get_project_attention_summaries().expect("query failed");
        let summary = summaries
            .iter()
            .find(|s| s.project_id == project.id)
            .expect("project not found");

        assert_eq!(summary.needs_input, 1);
        assert_eq!(summary.running_agents, 1);
        assert_eq!(summary.ci_failures, 1);
        assert_eq!(summary.unaddressed_comments, 1);
        assert_eq!(summary.completed_agents, 1);

        drop(db);
    }

    #[test]
    fn project_attention_uses_latest_session_rowid_when_created_at_ties() {
        let (db, _temp_dir) = make_test_db("attention_latest_session_rowid_tie");

        let project = db
            .create_project("Active Project", "/tmp/active")
            .expect("create failed");
        let task = db
            .create_task("Doing task", "doing", Some(&project.id), None, None)
            .expect("create task failed");

        db.create_agent_session(
            "ses-completed",
            &task.id,
            None,
            "implement",
            "completed",
            "opencode",
        )
        .expect("create completed session failed");
        db.create_agent_session(
            "ses-running",
            &task.id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("create running session failed");

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE agent_sessions SET created_at = 1234 WHERE id IN ('ses-completed', 'ses-running')",
                [],
            )
            .expect("force created_at tie failed");
        }

        let summaries = db.get_project_attention_summaries().expect("query failed");
        let summary = summaries
            .iter()
            .find(|s| s.project_id == project.id)
            .expect("project not found");

        assert_eq!(summary.running_agents, 1);
        assert_eq!(summary.completed_agents, 0);

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_uses_project_config() {
        let (db, _temp_dir) = make_test_db("resolve_provider_project");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // Set project-level ai_provider to opencode
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set config failed");

        // Global default is claude-code, but project override should win
        let provider = db
            .try_resolve_ai_provider(&project.id)
            .expect("resolve provider");
        assert_eq!(provider, "opencode");

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_falls_back_to_global() {
        let (db, _temp_dir) = make_test_db("resolve_provider_global");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // No project-level ai_provider set, should fall back to global
        let provider = db
            .try_resolve_ai_provider(&project.id)
            .expect("resolve provider");
        assert_eq!(provider, "claude-code");

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_empty_project_id() {
        let (db, _temp_dir) = make_test_db("resolve_provider_empty");

        // Empty project ID should fall back to global
        let provider = db.try_resolve_ai_provider("").expect("resolve provider");
        assert_eq!(provider, "claude-code");

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
