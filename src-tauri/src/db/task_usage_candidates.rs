use rusqlite::{params, params_from_iter, types::Value, Result};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUsageCandidateSessionRow {
    pub id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaskUsageCandidateWorkspaceRow {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUsageCandidateRow {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sessions: Vec<TaskUsageCandidateSessionRow>,
    pub workspace: Option<TaskUsageCandidateWorkspaceRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUsageCandidatePageRow {
    pub items: Vec<TaskUsageCandidateRow>,
    pub next_cursor: Option<String>,
}

impl super::Database {
    pub fn list_task_usage_candidates(
        &self,
        provider: &str,
        period_start: i64,
        task_id: Option<&str>,
        cursor: Option<&str>,
        page_size: usize,
    ) -> Result<TaskUsageCandidatePageRow> {
        let conn = self.lock_conn()?;
        let fetch_limit = i64::try_from(page_size.saturating_add(1))
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let mut statement = conn.prepare(
            "SELECT t.id,
                    COALESCE(NULLIF(TRIM(t.title), ''), t.id),
                    t.status,
                    t.created_at,
                    t.updated_at,
                    COALESCE(workspace.workspace_path, legacy_workspace.worktree_path),
                    CASE
                      WHEN workspace.kind = 'project_dir' THEN 'project'
                      WHEN workspace.kind = 'git_worktree' THEN 'worktree'
                      WHEN workspace.workspace_path IS NULL
                       AND legacy_workspace.worktree_path IS NOT NULL THEN 'worktree'
                      ELSE NULL
                    END
               FROM tasks t
               LEFT JOIN task_workspaces workspace ON workspace.task_id = t.id
               LEFT JOIN worktrees legacy_workspace ON legacy_workspace.task_id = t.id
              WHERE t.status IN ('doing', 'done')
                AND (?1 IS NULL OR t.id = ?1)
                AND (?2 IS NULL OR t.id > ?2)
                AND (
                  t.status = 'doing'
                  OR t.created_at >= ?3
                  OR t.updated_at >= ?3
                  OR EXISTS (
                    SELECT 1
                      FROM agent_sessions overlap_session
                     WHERE overlap_session.ticket_id = t.id
                       AND overlap_session.provider = ?4
                       AND (
                         overlap_session.created_at >= ?3
                         OR overlap_session.updated_at >= ?3
                       )
                  )
                )
              ORDER BY t.id ASC
              LIMIT ?5",
        )?;
        let rows = statement.query_map(
            params![task_id, cursor, period_start, provider, fetch_limit],
            |row| {
                let workspace_path: Option<String> = row.get(5)?;
                let workspace_kind: Option<String> = row.get(6)?;
                Ok(TaskUsageCandidateRow {
                    task_id: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    sessions: Vec::new(),
                    workspace: workspace_path
                        .zip(workspace_kind)
                        .map(|(path, kind)| TaskUsageCandidateWorkspaceRow { path, kind }),
                })
            },
        )?;
        let mut items = rows.collect::<Result<Vec<_>>>()?;
        let has_more = items.len() > page_size;
        items.truncate(page_size);

        if !items.is_empty() {
            let item_indexes = items
                .iter()
                .enumerate()
                .map(|(index, item)| (item.task_id.clone(), index))
                .collect::<HashMap<_, _>>();
            let mut query_params = Vec::with_capacity(items.len() + 1);
            query_params.push(Value::Text(provider.to_string()));
            query_params.extend(items.iter().map(|item| Value::Text(item.task_id.clone())));
            let placeholders = (2..=query_params.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "SELECT ticket_id, provider_session_id, created_at, updated_at
                   FROM (
                     SELECT ticket_id,
                            id AS agent_session_id,
                            created_at,
                            updated_at,
                            CASE provider
                              WHEN 'pi' THEN pi_session_id
                              WHEN 'claude-code' THEN claude_session_id
                              WHEN 'opencode' THEN opencode_session_id
                              WHEN 'grok' THEN grok_session_id
                              ELSE NULL
                            END AS provider_session_id
                       FROM agent_sessions
                      WHERE provider = ?1
                        AND ticket_id IN ({placeholders})
                   )
                  WHERE provider_session_id IS NOT NULL
                    AND provider_session_id != ''
                  ORDER BY ticket_id ASC, created_at ASC, agent_session_id ASC"
            );
            let mut session_statement = conn.prepare(&query)?;
            let sessions =
                session_statement.query_map(params_from_iter(query_params.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        TaskUsageCandidateSessionRow {
                            id: row.get(1)?,
                            created_at: row.get(2)?,
                            updated_at: row.get(3)?,
                        },
                    ))
                })?;
            for session in sessions {
                let (task_id, session) = session?;
                if let Some(index) = item_indexes.get(&task_id) {
                    items[*index].sessions.push(session);
                }
            }
        }

        let next_cursor = has_more
            .then(|| items.last().map(|item| item.task_id.clone()))
            .flatten();
        Ok(TaskUsageCandidatePageRow { items, next_cursor })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn lists_active_tasks_regardless_of_period_overlap() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_active");
        let task = db
            .create_task("Active usage task", "doing", None, None, None)
            .expect("create Task fixture");
        db.create_agent_session("pi-session", &task.id, None, "implement", "running", "pi")
            .expect("create Agent Session fixture");
        db.set_agent_session_pi_id("pi-session", "pi-root-session")
            .expect("set provider Agent Session id");
        db.connection()
            .lock()
            .expect("lock connection")
            .execute_batch(
                "UPDATE tasks SET created_at = 100, updated_at = 200;
                 UPDATE agent_sessions SET created_at = 100, updated_at = 200;",
            )
            .expect("adjust fixture timestamps");

        let page = db
            .list_task_usage_candidates("pi", 300, None, None, 100)
            .expect("list Task usage candidates");

        assert_eq!(page.next_cursor, None);
        assert_eq!(page.items.len(), 1);
        let candidate = &page.items[0];
        assert_eq!(candidate.task_id, task.id);
        assert_eq!(candidate.title, task.id);
        assert_eq!(candidate.status, "doing");
        assert_eq!(candidate.created_at, 100);
        assert_eq!(candidate.updated_at, 200);
        assert_eq!(candidate.sessions.len(), 1);
        assert_eq!(candidate.sessions[0].id, "pi-root-session");
        assert_eq!(candidate.sessions[0].created_at, 100);
        assert_eq!(candidate.sessions[0].updated_at, 200);
        assert!(!serde_json::to_string(candidate)
            .expect("serialize candidate")
            .contains("Active usage task"));
        assert_eq!(candidate.workspace, None);
    }

    #[test]
    fn includes_completed_tasks_with_task_or_provider_session_overlap_and_excludes_old_tasks() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_overlap");
        let task_overlap = db
            .create_task("Task interval overlap", "done", None, None, None)
            .expect("create task-overlap fixture");
        let session_overlap = db
            .create_task("Session interval overlap", "done", None, None, None)
            .expect("create session-overlap fixture");
        let old = db
            .create_task("Old completed task", "done", None, None, None)
            .expect("create old fixture");
        db.create_agent_session(
            "pi-overlap",
            &session_overlap.id,
            None,
            "implement",
            "completed",
            "pi",
        )
        .expect("create overlapping Agent Session fixture");
        db.set_agent_session_pi_id("pi-overlap", "pi-overlap-root")
            .expect("set overlapping provider Agent Session id");
        db.create_agent_session(
            "other-provider-overlap",
            &old.id,
            None,
            "implement",
            "completed",
            "claude-code",
        )
        .expect("create other-provider Agent Session fixture");
        let conn = db.connection();
        let conn = conn.lock().expect("lock connection");
        conn.execute(
            "UPDATE tasks SET created_at = 100, updated_at = 350 WHERE id = ?1",
            [&task_overlap.id],
        )
        .expect("adjust task-overlap timestamps");
        conn.execute(
            "UPDATE tasks SET created_at = 100, updated_at = 200 WHERE id IN (?1, ?2)",
            rusqlite::params![session_overlap.id, old.id],
        )
        .expect("adjust old Task timestamps");
        conn.execute(
            "UPDATE agent_sessions SET created_at = 250, updated_at = 350 WHERE id = 'pi-overlap'",
            [],
        )
        .expect("adjust provider Agent Session timestamps");
        conn.execute(
            "UPDATE agent_sessions SET created_at = 250, updated_at = 350 WHERE id = 'other-provider-overlap'",
            [],
        )
        .expect("adjust other-provider Agent Session timestamps");
        drop(conn);

        let page = db
            .list_task_usage_candidates("pi", 300, None, None, 100)
            .expect("list Task usage candidates");

        assert_eq!(
            page.items
                .iter()
                .map(|candidate| candidate.task_id.as_str())
                .collect::<Vec<_>>(),
            vec![task_overlap.id.as_str(), session_overlap.id.as_str()]
        );
        assert_eq!(page.items[1].sessions[0].id, "pi-overlap-root");
    }

    #[test]
    fn keeps_shared_project_workspaces_on_each_candidate() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_shared_workspace");
        let project = db
            .create_project("Shared workspace", "/repo")
            .expect("create Project fixture");
        let first = db
            .create_task("First task", "doing", Some(&project.id), None, None)
            .expect("create first Task fixture");
        let second = db
            .create_task("Second task", "doing", Some(&project.id), None, None)
            .expect("create second Task fixture");
        for task in [&first, &second] {
            db.create_task_workspace_record(
                &task.id,
                &project.id,
                "/repo",
                "/repo",
                "project_dir",
                None,
                "pi",
            )
            .expect("create shared workspace fixture");
        }

        let page = db
            .list_task_usage_candidates("pi", 0, None, None, 100)
            .expect("list Task usage candidates");

        assert_eq!(page.items.len(), 2);
        for candidate in page.items {
            let workspace = candidate.workspace.expect("candidate workspace");
            assert_eq!(workspace.path, "/repo");
            assert_eq!(workspace.kind, "project");
        }
    }

    #[test]
    fn paginates_candidates_with_a_stable_task_id_cursor() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_pages");
        let tasks = ["First", "Second", "Third"]
            .into_iter()
            .map(|title| {
                db.create_task(title, "doing", None, None, None)
                    .expect("create Task fixture")
            })
            .collect::<Vec<_>>();

        let first_page = db
            .list_task_usage_candidates("pi", 0, None, None, 2)
            .expect("list first page");
        assert_eq!(
            first_page
                .items
                .iter()
                .map(|candidate| candidate.task_id.as_str())
                .collect::<Vec<_>>(),
            vec![tasks[0].id.as_str(), tasks[1].id.as_str()]
        );
        assert_eq!(
            first_page.next_cursor.as_deref(),
            Some(tasks[1].id.as_str())
        );

        let second_page = db
            .list_task_usage_candidates("pi", 0, None, first_page.next_cursor.as_deref(), 2)
            .expect("list second page");
        assert_eq!(
            second_page
                .items
                .iter()
                .map(|candidate| candidate.task_id.as_str())
                .collect::<Vec<_>>(),
            vec![tasks[2].id.as_str()]
        );
        assert_eq!(second_page.next_cursor, None);
    }

    #[test]
    fn targeted_query_returns_only_the_requested_task() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_targeted");
        let unrelated = db
            .create_task("Unrelated task", "doing", None, None, None)
            .expect("create unrelated Task fixture");
        let target = db
            .create_task("Target task", "doing", None, None, None)
            .expect("create target Task fixture");

        let page = db
            .list_task_usage_candidates("pi", 0, Some(&target.id), None, 100)
            .expect("list targeted Task usage candidates");

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].task_id, target.id);
        assert_ne!(page.items[0].task_id, unrelated.id);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn uses_legacy_worktree_location_when_no_task_workspace_exists() {
        let (db, _temp_dir) = make_test_db("task_usage_candidates_legacy_workspace");
        let project = db
            .create_project("Legacy workspace", "/repo")
            .expect("create Project fixture");
        let task = db
            .create_task(
                "Legacy worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create Task fixture");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/repo",
            "/repo/.openforge/T-1",
            "task/T-1",
        )
        .expect("create legacy worktree fixture");

        let page = db
            .list_task_usage_candidates("pi", 0, Some(&task.id), None, 100)
            .expect("list targeted Task usage candidate");

        assert_eq!(
            page.items[0].workspace,
            Some(super::TaskUsageCandidateWorkspaceRow {
                path: "/repo/.openforge/T-1".to_string(),
                kind: "worktree".to_string(),
            })
        );
    }
}
