use crate::agent_lifecycle::TERMINAL_AGENT_SESSION_STATUSES;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params, Result};
use serde::{Deserialize, Serialize};

const AGENT_SESSION_CURSOR_VERSION: u8 = 1;
const AGENT_SESSION_LIST_SQL: &str = "SELECT s.id,
            s.provider,
            NULLIF(
              CASE s.provider
                WHEN 'pi' THEN s.pi_session_id
                WHEN 'claude-code' THEN s.claude_session_id
                WHEN 'opencode' THEN s.opencode_session_id
                WHEN 'grok' THEN s.grok_session_id
                ELSE NULL
              END,
              ''
            ),
            s.created_at,
            s.updated_at,
            t.id,
            COALESCE(NULLIF(TRIM(t.title), ''), t.id),
            t.status,
            t.created_at,
            t.updated_at,
            COALESCE(workspace.workspace_path, legacy_workspace.worktree_path),
            CASE
              WHEN workspace.workspace_path IS NOT NULL
               AND workspace.kind = 'project_dir' THEN 'project'
              WHEN workspace.workspace_path IS NOT NULL
               AND workspace.kind = 'git_worktree' THEN 'worktree'
              WHEN workspace.workspace_path IS NULL
               AND legacy_workspace.worktree_path IS NOT NULL THEN 'worktree'
              ELSE NULL
            END
       FROM agent_sessions s
       JOIN tasks t ON t.id = s.ticket_id
       LEFT JOIN task_workspaces workspace ON workspace.task_id = t.id
       LEFT JOIN worktrees legacy_workspace ON legacy_workspace.task_id = t.id
      WHERE s.provider = ?1
        AND (?2 IS NULL OR s.ticket_id = ?2)
        AND s.created_at < ?3
        AND (s.status NOT IN (?4, ?5, ?6) OR s.updated_at > ?7)
        AND (
          ?8 IS NULL
          OR s.created_at > ?8
          OR (s.created_at = ?8 AND s.id > ?9)
        )
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT ?10";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionCursorFilters {
    provider: String,
    start_inclusive: i64,
    end_exclusive: i64,
    task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionCursorPayload {
    version: u8,
    created_at: i64,
    id: String,
    filters: AgentSessionCursorFilters,
}

fn invalid_parameter(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.to_string())
}

fn encode_cursor(payload: &AgentSessionCursorPayload) -> Result<String> {
    let json = serde_json::to_vec(payload)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    Ok(URL_SAFE_NO_PAD.encode(json))
}

fn parse_cursor(cursor: &str) -> Result<AgentSessionCursorPayload> {
    let json = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| invalid_parameter("cursor is malformed"))?;
    let payload = serde_json::from_slice::<AgentSessionCursorPayload>(&json)
        .map_err(|_| invalid_parameter("cursor is malformed"))?;
    if payload.version != AGENT_SESSION_CURSOR_VERSION
        || payload.created_at < 0
        || payload.id.is_empty()
        || payload.filters.provider.is_empty()
        || payload.filters.start_inclusive < 0
        || payload.filters.end_exclusive <= payload.filters.start_inclusive
        || payload
            .filters
            .task_id
            .as_ref()
            .is_some_and(String::is_empty)
    {
        return Err(invalid_parameter("cursor is malformed"));
    }
    Ok(payload)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionTaskSummaryRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionWorkspaceRow {
    pub root_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummaryRow {
    pub id: String,
    pub provider: String,
    pub provider_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub task: AgentSessionTaskSummaryRow,
    pub workspace: Option<AgentSessionWorkspaceRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummaryPageRow {
    pub items: Vec<AgentSessionSummaryRow>,
    pub next_cursor: Option<String>,
}

impl super::Database {
    #[allow(clippy::too_many_arguments)]
    pub fn list_agent_sessions(
        &self,
        provider: &str,
        start_inclusive: i64,
        end_exclusive: i64,
        task_id: Option<&str>,
        cursor: Option<&str>,
        page_size: usize,
    ) -> Result<AgentSessionSummaryPageRow> {
        if provider.trim().is_empty() {
            return Err(invalid_parameter("provider must be a non-empty string"));
        }
        if task_id.is_some_and(str::is_empty) {
            return Err(invalid_parameter("taskId must be a non-empty string"));
        }
        if start_inclusive < 0 || end_exclusive <= start_inclusive {
            return Err(invalid_parameter(
                "overlaps must satisfy 0 <= startInclusive < endExclusive",
            ));
        }
        if !(1..=super::MAX_AGENT_SESSION_PAGE_SIZE).contains(&page_size) {
            return Err(invalid_parameter("pageSize must be between 1 and 250"));
        }

        let filters = AgentSessionCursorFilters {
            provider: provider.to_string(),
            start_inclusive,
            end_exclusive,
            task_id: task_id.map(str::to_string),
        };
        let cursor = cursor.map(parse_cursor).transpose()?;
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor.filters != filters)
        {
            return Err(invalid_parameter("cursor does not match request filters"));
        }
        let cursor_created_at = cursor.as_ref().map(|cursor| cursor.created_at);
        let cursor_id = cursor.as_ref().map(|cursor| cursor.id.as_str());
        let fetch_limit = i64::try_from(page_size + 1)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(AGENT_SESSION_LIST_SQL)?;
        let rows = statement.query_map(
            params![
                provider,
                task_id,
                end_exclusive,
                TERMINAL_AGENT_SESSION_STATUSES[0],
                TERMINAL_AGENT_SESSION_STATUSES[1],
                TERMINAL_AGENT_SESSION_STATUSES[2],
                start_inclusive,
                cursor_created_at,
                cursor_id,
                fetch_limit,
            ],
            |row| {
                let workspace_root: Option<String> = row.get(10)?;
                let workspace_kind: Option<String> = row.get(11)?;
                Ok(AgentSessionSummaryRow {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    provider_session_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    task: AgentSessionTaskSummaryRow {
                        id: row.get(5)?,
                        title: row.get(6)?,
                        status: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    },
                    workspace: workspace_root
                        .zip(workspace_kind)
                        .map(|(root_path, kind)| AgentSessionWorkspaceRow { root_path, kind }),
                })
            },
        )?;
        let mut items = rows.collect::<Result<Vec<_>>>()?;
        let has_more = items.len() > page_size;
        items.truncate(page_size);
        let next_cursor = if has_more {
            items
                .last()
                .map(|item| {
                    encode_cursor(&AgentSessionCursorPayload {
                        version: AGENT_SESSION_CURSOR_VERSION,
                        created_at: item.created_at,
                        id: item.id.clone(),
                        filters: filters.clone(),
                    })
                })
                .transpose()?
        } else {
            None
        };

        Ok(AgentSessionSummaryPageRow { items, next_cursor })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::*;

    struct SessionFixture<'a> {
        id: &'a str,
        task_id: &'a str,
        provider: &'a str,
        status: &'a str,
        created_at: i64,
        updated_at: i64,
        provider_session_id: Option<&'a str>,
    }

    fn insert_session(db: &super::super::Database, fixture: SessionFixture<'_>) {
        db.create_agent_session(
            fixture.id,
            fixture.task_id,
            None,
            "implementing",
            fixture.status,
            fixture.provider,
        )
        .expect("create Agent Session fixture");
        if let Some(provider_session_id) = fixture.provider_session_id {
            db.set_agent_session_provider_id(fixture.id, fixture.provider, provider_session_id)
                .expect("set provider Agent Session ID");
        }
        db.connection()
            .lock()
            .expect("lock connection")
            .execute(
                "UPDATE agent_sessions
                    SET created_at = ?1,
                        updated_at = ?2,
                        checkpoint_data = 'private checkpoint',
                        error_message = 'private error'
                  WHERE id = ?3",
                rusqlite::params![fixture.created_at, fixture.updated_at, fixture.id],
            )
            .expect("set Agent Session fixture timestamps");
    }

    fn set_task_timestamps(
        db: &super::super::Database,
        task_id: &str,
        created_at: i64,
        updated_at: i64,
    ) {
        db.connection()
            .lock()
            .expect("lock connection")
            .execute(
                "UPDATE tasks SET created_at = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![created_at, updated_at, task_id],
            )
            .expect("set Task fixture timestamps");
    }

    #[test]
    fn filters_globally_by_provider_and_optionally_by_task() {
        let (db, _temp_dir) = make_test_db("agent_session_list_filters");
        let first = db
            .create_task(
                "First private prompt",
                "doing",
                None,
                Some("First task"),
                None,
            )
            .expect("create first Task");
        let second = db
            .create_task(
                "Second private prompt",
                "doing",
                None,
                Some("Second task"),
                None,
            )
            .expect("create second Task");
        insert_session(
            &db,
            SessionFixture {
                id: "pi-first",
                task_id: &first.id,
                provider: "pi",
                status: "completed",
                created_at: 110,
                updated_at: 120,
                provider_session_id: Some("provider-first"),
            },
        );
        insert_session(
            &db,
            SessionFixture {
                id: "claude-first",
                task_id: &first.id,
                provider: "claude-code",
                status: "completed",
                created_at: 120,
                updated_at: 130,
                provider_session_id: Some("claude-provider-first"),
            },
        );
        insert_session(
            &db,
            SessionFixture {
                id: "pi-second",
                task_id: &second.id,
                provider: "pi",
                status: "completed",
                created_at: 130,
                updated_at: 140,
                provider_session_id: Some("provider-second"),
            },
        );

        let global = db
            .list_agent_sessions("pi", 100, 200, None, None, 250)
            .expect("list global Agent Sessions");
        assert_eq!(
            global
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["pi-first", "pi-second"]
        );

        let targeted = db
            .list_agent_sessions("pi", 100, 200, Some(&first.id), None, 250)
            .expect("list targeted Agent Sessions");
        assert_eq!(targeted.items.len(), 1);
        assert_eq!(targeted.items[0].id, "pi-first");
    }

    #[test]
    fn applies_closed_open_boundaries_to_terminal_and_open_ended_statuses() {
        let (db, _temp_dir) = make_test_db("agent_session_list_overlap");
        let task = db
            .create_task(
                "Boundary prompt",
                "doing",
                None,
                Some("Boundary task"),
                None,
            )
            .expect("create Task");
        for fixture in [
            SessionFixture {
                id: "completed-before",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 50,
                updated_at: 100,
                provider_session_id: Some("completed-before"),
            },
            SessionFixture {
                id: "failed-overlap",
                task_id: &task.id,
                provider: "pi",
                status: "failed",
                created_at: 50,
                updated_at: 101,
                provider_session_id: Some("failed-overlap"),
            },
            SessionFixture {
                id: "interrupted-before",
                task_id: &task.id,
                provider: "pi",
                status: "interrupted",
                created_at: 60,
                updated_at: 100,
                provider_session_id: Some("interrupted-before"),
            },
            SessionFixture {
                id: "running-across-start",
                task_id: &task.id,
                provider: "pi",
                status: "running",
                created_at: 70,
                updated_at: 80,
                provider_session_id: Some("running-across-start"),
            },
            SessionFixture {
                id: "paused-across-start",
                task_id: &task.id,
                provider: "pi",
                status: "paused",
                created_at: 80,
                updated_at: 90,
                provider_session_id: Some("paused-across-start"),
            },
            SessionFixture {
                id: "completed-inside",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 150,
                updated_at: 175,
                provider_session_id: Some("completed-inside"),
            },
            SessionFixture {
                id: "starts-at-end",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 200,
                updated_at: 250,
                provider_session_id: Some("starts-at-end"),
            },
        ] {
            insert_session(&db, fixture);
        }

        let page = db
            .list_agent_sessions("pi", 100, 200, None, None, 250)
            .expect("list overlapping Agent Sessions");
        assert_eq!(
            page.items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "failed-overlap",
                "running-across-start",
                "paused-across-start",
                "completed-inside",
            ]
        );
    }

    #[test]
    fn returns_null_provider_identity_and_only_compact_task_fields() {
        let (db, _temp_dir) = make_test_db("agent_session_list_compact");
        let task = db
            .create_task("Private prompt text", "doing", None, None, None)
            .expect("create Task");
        set_task_timestamps(&db, &task.id, 10, 20);
        insert_session(
            &db,
            SessionFixture {
                id: "missing-provider-id",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 110,
                updated_at: 120,
                provider_session_id: None,
            },
        );

        let page = db
            .list_agent_sessions("pi", 100, 200, None, None, 250)
            .expect("list compact Agent Sessions");
        let item = &page.items[0];
        assert_eq!(item.provider_session_id, None);
        assert_eq!(item.task.title, task.id);
        assert_eq!(item.task.created_at, 10);
        assert_eq!(item.task.updated_at, 20);
        let json = serde_json::to_string(item).expect("serialize summary");
        for excluded in [
            "Private prompt text",
            "private checkpoint",
            "private error",
            "checkpointData",
            "errorMessage",
            "ptyInstanceId",
        ] {
            assert!(!json.contains(excluded), "payload contained {excluded}");
        }
    }

    #[test]
    fn prefers_task_workspace_then_falls_back_to_legacy_worktree_and_keeps_shared_roots() {
        let (db, _temp_dir) = make_test_db("agent_session_list_workspaces");
        let project = db
            .create_project("Workspace project", "/repo")
            .expect("create Project");
        let current = db
            .create_task(
                "Current workspace",
                "doing",
                Some(&project.id),
                Some("Current"),
                None,
            )
            .expect("create current Task");
        let legacy = db
            .create_task(
                "Legacy workspace",
                "doing",
                Some(&project.id),
                Some("Legacy"),
                None,
            )
            .expect("create legacy Task");
        let shared = db
            .create_task(
                "Shared workspace",
                "doing",
                Some(&project.id),
                Some("Shared"),
                None,
            )
            .expect("create shared Task");

        db.create_worktree_record(
            &current.id,
            &project.id,
            "/repo",
            "/legacy/current",
            "task/current",
        )
        .expect("create current legacy worktree");
        db.create_task_workspace_record(
            &current.id,
            &project.id,
            "/repo",
            "/repo",
            "project_dir",
            None,
            "pi",
        )
        .expect("create current Task workspace");
        db.create_worktree_record(
            &legacy.id,
            &project.id,
            "/repo",
            "/legacy/task",
            "task/legacy",
        )
        .expect("create legacy worktree");
        db.create_task_workspace_record(
            &shared.id,
            &project.id,
            "/repo",
            "/repo",
            "project_dir",
            None,
            "pi",
        )
        .expect("create shared Task workspace");

        for (index, task) in [&current, &legacy, &shared].into_iter().enumerate() {
            insert_session(
                &db,
                SessionFixture {
                    id: match index {
                        0 => "current-session",
                        1 => "legacy-session",
                        _ => "shared-session",
                    },
                    task_id: &task.id,
                    provider: "pi",
                    status: "completed",
                    created_at: 110 + i64::try_from(index).expect("small fixture index"),
                    updated_at: 150,
                    provider_session_id: Some("provider-session"),
                },
            );
        }

        let page = db
            .list_agent_sessions("pi", 100, 200, None, None, 250)
            .expect("list workspace contexts");
        let current = page
            .items
            .iter()
            .find(|item| item.id == "current-session")
            .expect("current summary");
        let legacy = page
            .items
            .iter()
            .find(|item| item.id == "legacy-session")
            .expect("legacy summary");
        let shared = page
            .items
            .iter()
            .find(|item| item.id == "shared-session")
            .expect("shared summary");
        assert_eq!(
            current.workspace,
            Some(AgentSessionWorkspaceRow {
                root_path: "/repo".to_string(),
                kind: "project".to_string()
            })
        );
        assert_eq!(
            legacy.workspace,
            Some(AgentSessionWorkspaceRow {
                root_path: "/legacy/task".to_string(),
                kind: "worktree".to_string()
            })
        );
        assert_eq!(shared.workspace, current.workspace);
    }

    #[test]
    fn paginates_in_created_at_and_id_order_with_a_null_final_cursor() {
        let (db, _temp_dir) = make_test_db("agent_session_list_pages");
        let task = db
            .create_task("Page prompt", "doing", None, Some("Page task"), None)
            .expect("create Task");
        for fixture in [
            SessionFixture {
                id: "c",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 150,
                updated_at: 160,
                provider_session_id: Some("provider-c"),
            },
            SessionFixture {
                id: "b",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 100,
                updated_at: 120,
                provider_session_id: Some("provider-b"),
            },
            SessionFixture {
                id: "a",
                task_id: &task.id,
                provider: "pi",
                status: "completed",
                created_at: 100,
                updated_at: 110,
                provider_session_id: Some("provider-a"),
            },
        ] {
            insert_session(&db, fixture);
        }

        let first = db
            .list_agent_sessions("pi", 0, 200, None, None, 2)
            .expect("list first page");
        assert_eq!(
            first
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(first.items.len(), 2);
        let cursor = first.next_cursor.as_deref().expect("first page cursor");

        let final_page = db
            .list_agent_sessions("pi", 0, 200, None, Some(cursor), 2)
            .expect("list final page");
        assert_eq!(
            final_page
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["c"]
        );
        assert_eq!(final_page.next_cursor, None);
    }

    #[test]
    fn rejects_malformed_and_filter_mismatched_cursors() {
        let (db, _temp_dir) = make_test_db("agent_session_list_cursor_filters");
        let first_task = db
            .create_task("First prompt", "doing", None, Some("First"), None)
            .expect("create first Task");
        let second_task = db
            .create_task("Second prompt", "doing", None, Some("Second"), None)
            .expect("create second Task");
        for fixture in [
            SessionFixture {
                id: "a",
                task_id: &first_task.id,
                provider: "pi",
                status: "completed",
                created_at: 100,
                updated_at: 110,
                provider_session_id: Some("provider-a"),
            },
            SessionFixture {
                id: "b",
                task_id: &second_task.id,
                provider: "pi",
                status: "completed",
                created_at: 120,
                updated_at: 130,
                provider_session_id: Some("provider-b"),
            },
        ] {
            insert_session(&db, fixture);
        }

        let first = db
            .list_agent_sessions("pi", 0, 200, None, None, 1)
            .expect("list first page");
        let cursor = first.next_cursor.as_deref().expect("first page cursor");
        let malformed = db
            .list_agent_sessions("pi", 0, 200, None, Some("not-a-valid-cursor"), 1)
            .expect_err("malformed cursor must fail");
        assert!(malformed.to_string().contains("cursor is malformed"));

        for result in [
            db.list_agent_sessions("claude-code", 0, 200, None, Some(cursor), 1),
            db.list_agent_sessions("pi", 1, 200, None, Some(cursor), 1),
            db.list_agent_sessions("pi", 0, 201, None, Some(cursor), 1),
            db.list_agent_sessions("pi", 0, 200, Some(&first_task.id), Some(cursor), 1),
        ] {
            let error = result.expect_err("filter-mismatched cursor must fail");
            assert!(error
                .to_string()
                .contains("cursor does not match request filters"));
        }
    }

    #[test]
    fn query_plan_uses_the_bounded_agent_session_list_index() {
        let (db, _temp_dir) = make_test_db("agent_session_list_query_plan");
        let conn = db.connection();
        let conn = conn.lock().expect("lock connection");
        let mut statement = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {AGENT_SESSION_LIST_SQL}"))
            .expect("prepare query plan");
        let details = statement
            .query_map(
                params![
                    "pi",
                    None::<&str>,
                    200_i64,
                    TERMINAL_AGENT_SESSION_STATUSES[0],
                    TERMINAL_AGENT_SESSION_STATUSES[1],
                    TERMINAL_AGENT_SESSION_STATUSES[2],
                    100_i64,
                    None::<i64>,
                    None::<&str>,
                    251_i64,
                ],
                |row| row.get::<_, String>(3),
            )
            .expect("read query plan")
            .collect::<Result<Vec<_>>>()
            .expect("collect query plan");

        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_agent_sessions_list")),
            "query plan did not use idx_agent_sessions_list: {details:?}"
        );
    }
}
