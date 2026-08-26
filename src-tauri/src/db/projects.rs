use rusqlite::Result;
use serde::Serialize;

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

impl super::Database {
    /// Create a new project with auto-incremented ID
    pub fn create_project(&self, name: &str, path: &str) -> Result<ProjectRow> {
        let conn = self.lock_conn()?;

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_project_id'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(1))
            },
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
