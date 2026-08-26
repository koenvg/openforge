use rusqlite::Result;
use serde::Serialize;

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

impl ProjectAttentionRow {
    fn new(project_id: String) -> Self {
        Self {
            project_id,
            needs_input: 0,
            running_agents: 0,
            ci_failures: 0,
            unaddressed_comments: 0,
            completed_agents: 0,
        }
    }
}

impl super::Database {
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
                GROUP BY dt.project_id",
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
                let entry = attention
                    .entry(project_id.clone())
                    .or_insert_with(|| ProjectAttentionRow::new(project_id));
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
                let entry = attention
                    .entry(project_id.clone())
                    .or_insert_with(|| ProjectAttentionRow::new(project_id));
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
}
