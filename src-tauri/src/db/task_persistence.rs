use super::{
    task_dependencies::{load_task_dependency_ids, load_task_dependency_ids_for_tasks},
    task_labels::{load_task_labels, load_task_labels_for_tasks},
    tasks::{
        resolved_projection_title, CompactTaskRow, TaskDetail, TaskDetailRelationshipRow,
        TaskDetailRelationships, TaskRelationshipReferenceRow, TaskRow,
    },
    Database,
};
use rusqlite::{params_from_iter, OptionalExtension, Result};

pub(super) const TASK_ROW_COLUMNS: &str = "id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, title, title_source, title_generated_at, worktree_source, worktree_branch, source_ticket_url";

macro_rules! task_row_query {
    ($suffix:literal) => {
        concat!(
            "SELECT id, initial_prompt, status, project_id, created_at, updated_at, ",
            "prompt, agent, permission_mode, title, title_source, title_generated_at, ",
            "worktree_source, worktree_branch, source_ticket_url FROM tasks ",
            $suffix
        )
    };
}

macro_rules! compact_task_row_query {
    ($suffix:literal) => {
        concat!(
            "SELECT id, status, project_id, created_at, updated_at, agent, permission_mode, ",
            "worktree_source, worktree_branch, ",
            "title, prompt_preview, title_source, title_generated_at, source_ticket_url FROM tasks ",
            $suffix
        )
    };
}

const TASKS_FOR_PROJECT_SQL: &str =
    task_row_query!("WHERE project_id = ?1 ORDER BY updated_at DESC");
const TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL: &str =
    task_row_query!("WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
const TASKS_FOR_PROJECT_BY_STATE_SQL: &str =
    task_row_query!("WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
const COMPACT_TASKS_FOR_PROJECT_SQL: &str =
    compact_task_row_query!("WHERE project_id = ?1 ORDER BY updated_at DESC");
const COMPACT_TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL: &str =
    compact_task_row_query!("WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
const COMPACT_TASKS_FOR_PROJECT_BY_STATE_SQL: &str =
    compact_task_row_query!("WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
const ALL_TASKS_SQL: &str = task_row_query!("ORDER BY updated_at DESC");
const TASK_BY_ID_SQL: &str = task_row_query!("WHERE id = ?1");

const TASK_RELATIONSHIP_REFERENCES_FOR_PROJECT_SQL: &str = r#"
WITH active_tasks AS (
    SELECT id
    FROM tasks
    WHERE project_id = ?1 AND status != 'done'
),
relationship_ids AS (
    SELECT dependencies.depends_on_task_id AS id
    FROM task_dependencies dependencies
    INNER JOIN active_tasks active ON active.id = dependencies.task_id
    UNION
    SELECT dependencies.task_id AS id
    FROM task_dependencies dependencies
    INNER JOIN active_tasks active ON active.id = dependencies.depends_on_task_id
    INNER JOIN tasks dependent ON dependent.id = dependencies.task_id
    WHERE dependent.status != 'done'
),
relationship_tasks AS (
    SELECT
        tasks.id,
        tasks.status,
        tasks.project_id,
        tasks.title,
        tasks.prompt_preview,
        tasks.updated_at
    FROM tasks
    INNER JOIN relationship_ids ON relationship_ids.id = tasks.id
    WHERE NOT EXISTS (SELECT 1 FROM active_tasks WHERE active_tasks.id = tasks.id)
)
SELECT id, status, project_id, title, prompt_preview
FROM relationship_tasks
ORDER BY updated_at DESC
"#;

pub(super) fn task_from_row(row: &rusqlite::Row<'_>) -> Result<TaskRow> {
    Ok(TaskRow {
        id: row.get(0)?,
        initial_prompt: row.get(1)?,
        status: row.get(2)?,
        project_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        prompt: row.get(6)?,
        agent: row.get(7)?,
        permission_mode: row.get(8)?,
        title: row.get(9)?,
        title_source: row.get(10)?,
        title_generated_at: row.get(11)?,
        worktree_source: row.get(12)?,
        worktree_branch: row.get(13)?,
        source_ticket_url: row.get(14)?,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn compact_task_from_row(row: &rusqlite::Row<'_>) -> Result<CompactTaskRow> {
    let id: String = row.get(0)?;
    let explicit_title: Option<String> = row.get(9)?;
    let prompt_preview: String = row.get(10)?;
    Ok(CompactTaskRow {
        title: resolved_projection_title(&id, explicit_title.as_deref(), &prompt_preview),
        id,
        status: row.get(1)?,
        project_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        agent: row.get(5)?,
        permission_mode: row.get(6)?,
        worktree_source: row.get(7)?,
        worktree_branch: row.get(8)?,
        title_source: row.get(11)?,
        title_generated_at: row.get(12)?,
        source_ticket_url: row.get(13)?,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

pub(super) fn task_relationship_reference_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<TaskRelationshipReferenceRow> {
    let id: String = row.get(0)?;
    let explicit_title: Option<String> = row.get(3)?;
    let prompt_preview: String = row.get(4)?;
    Ok(TaskRelationshipReferenceRow {
        title: resolved_projection_title(&id, explicit_title.as_deref(), &prompt_preview),
        id,
        status: row.get(1)?,
        project_id: row.get(2)?,
        depends_on: Vec::new(),
    })
}

fn task_detail_relationship_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<(bool, TaskDetailRelationshipRow)> {
    let id = row.get::<_, String>(1)?;
    let explicit_title = row.get::<_, Option<String>>(5)?;
    // Borrow the prompt only while deriving its display title; relationship rows never own it.
    let initial_prompt = row.get_ref(6)?;
    let initial_prompt = initial_prompt.as_str().map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, initial_prompt.data_type(), Box::new(error))
    })?;
    Ok((
        row.get::<_, i64>(0)? == 1,
        TaskDetailRelationshipRow {
            title: crate::task_prompt::task_display_title(
                &id,
                explicit_title.as_deref(),
                initial_prompt,
            ),
            id,
            status: row.get(2)?,
            project_id: row.get(3)?,
            project_name: row.get(4)?,
            remaining_dependency_count: usize::try_from(row.get::<_, i64>(7)?).map_err(
                |error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        7,
                        rusqlite::types::Type::Integer,
                        Box::new(error),
                    )
                },
            )?,
        },
    ))
}

fn hydrate_task_row(conn: &rusqlite::Connection, mut task: TaskRow) -> Result<TaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

pub(super) fn hydrate_task_rows(
    conn: &rusqlite::Connection,
    mut tasks: Vec<TaskRow>,
) -> Result<Vec<TaskRow>> {
    let task_ids = tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>();
    let mut dependencies = load_task_dependency_ids_for_tasks(conn, &task_ids)?;
    let mut labels = load_task_labels_for_tasks(conn, &task_ids)?;
    for task in &mut tasks {
        task.depends_on = dependencies.remove(&task.id).unwrap_or_default();
        task.labels = labels.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

fn hydrate_compact_task_rows(
    conn: &rusqlite::Connection,
    mut tasks: Vec<CompactTaskRow>,
) -> Result<Vec<CompactTaskRow>> {
    let task_ids = tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>();
    let mut dependencies = load_task_dependency_ids_for_tasks(conn, &task_ids)?;
    let mut labels = load_task_labels_for_tasks(conn, &task_ids)?;
    for task in &mut tasks {
        task.depends_on = dependencies.remove(&task.id).unwrap_or_default();
        task.labels = labels.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

pub(super) fn hydrate_task_relationship_references(
    conn: &rusqlite::Connection,
    mut tasks: Vec<TaskRelationshipReferenceRow>,
) -> Result<Vec<TaskRelationshipReferenceRow>> {
    let task_ids = tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>();
    let mut dependencies = load_task_dependency_ids_for_tasks(conn, &task_ids)?;
    for task in &mut tasks {
        task.depends_on = dependencies.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

fn query_task_rows<const N: usize>(
    conn: &rusqlite::Connection,
    query: &str,
    params: [&str; N],
) -> Result<Vec<TaskRow>> {
    let mut statement = conn.prepare(query)?;
    let rows = statement.query_map(params_from_iter(params), task_from_row)?;
    let tasks = rows.collect::<Result<Vec<_>>>()?;
    hydrate_task_rows(conn, tasks)
}

fn query_compact_task_rows<const N: usize>(
    conn: &rusqlite::Connection,
    query: &str,
    params: [&str; N],
) -> Result<Vec<CompactTaskRow>> {
    let mut statement = conn.prepare(query)?;
    let rows = statement.query_map(params_from_iter(params), compact_task_from_row)?;
    let tasks = rows.collect::<Result<Vec<_>>>()?;
    hydrate_compact_task_rows(conn, tasks)
}

impl Database {
    /// Get all tasks for a project.
    pub fn get_tasks_for_project(&self, project_id: &str) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        query_task_rows(&conn, TASKS_FOR_PROJECT_SQL, [project_id])
    }

    pub fn get_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        query_task_rows(
            &conn,
            TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL,
            [project_id, state],
        )
    }

    pub fn get_compact_tasks_for_project(&self, project_id: &str) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        query_compact_task_rows(&conn, COMPACT_TASKS_FOR_PROJECT_SQL, [project_id])
    }

    pub fn get_compact_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        query_compact_task_rows(
            &conn,
            COMPACT_TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL,
            [project_id, state],
        )
    }

    pub fn get_compact_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        query_compact_task_rows(
            &conn,
            COMPACT_TASKS_FOR_PROJECT_BY_STATE_SQL,
            [project_id, state],
        )
    }

    pub fn get_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        query_task_rows(&conn, TASKS_FOR_PROJECT_BY_STATE_SQL, [project_id, state])
    }

    pub fn get_active_task_details(&self, project_id: Option<&str>) -> Result<Vec<TaskDetail>> {
        let conn = self.lock_conn()?;
        let tasks = if let Some(project_id) = project_id {
            let query = format!(
                "SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != 'done' ORDER BY updated_at DESC, id DESC"
            );
            query_task_rows(&conn, &query, [project_id])?
        } else {
            let query = format!(
                "SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE status != 'done' ORDER BY updated_at DESC, id DESC"
            );
            query_task_rows(&conn, &query, [])?
        };
        Ok(tasks.iter().map(TaskDetail::from).collect())
    }

    pub fn get_task_relationship_references_for_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<TaskRelationshipReferenceRow>> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(TASK_RELATIONSHIP_REFERENCES_FOR_PROJECT_SQL)?;
        let rows = statement.query_map([project_id], task_relationship_reference_from_row)?;
        let tasks = rows.collect::<Result<Vec<_>>>()?;
        hydrate_task_relationship_references(&conn, tasks)
    }

    pub fn get_active_task_relationship_references(
        &self,
    ) -> Result<Vec<TaskRelationshipReferenceRow>> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(
            r#"
WITH active_tasks AS (
    SELECT id
    FROM tasks
    WHERE status != 'done'
),
relationship_ids AS (
    SELECT dependencies.depends_on_task_id AS id
    FROM task_dependencies dependencies
    INNER JOIN active_tasks active ON active.id = dependencies.task_id
    UNION
    SELECT dependencies.task_id AS id
    FROM task_dependencies dependencies
    INNER JOIN active_tasks active ON active.id = dependencies.depends_on_task_id
    INNER JOIN tasks dependent ON dependent.id = dependencies.task_id
    WHERE dependent.status != 'done'
),
relationship_tasks AS (
    SELECT
        tasks.id,
        tasks.status,
        tasks.project_id,
        tasks.title,
        tasks.prompt_preview,
        tasks.updated_at
    FROM tasks
    INNER JOIN relationship_ids ON relationship_ids.id = tasks.id
    WHERE NOT EXISTS (SELECT 1 FROM active_tasks WHERE active_tasks.id = tasks.id)
)
SELECT id, status, project_id, title, prompt_preview
FROM relationship_tasks
ORDER BY updated_at DESC, id DESC
            "#,
        )?;
        let rows = statement.query_map([], task_relationship_reference_from_row)?;
        let tasks = rows.collect::<Result<Vec<_>>>()?;
        drop(statement);
        hydrate_task_relationship_references(&conn, tasks)
    }

    pub(crate) fn get_task_detail_relationships(
        &self,
        task_id: &str,
    ) -> Result<TaskDetailRelationships> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(
            r#"
WITH relationships AS (
    SELECT
        0 AS relationship_kind,
        related.id,
        related.status,
        related.project_id,
        projects.name AS project_name,
        related.title AS explicit_title,
        related.initial_prompt,
        0 AS remaining_dependency_count,
        links.created_at AS relationship_created_at,
        related.updated_at
    FROM task_dependencies links
    INNER JOIN tasks related ON related.id = links.depends_on_task_id
    LEFT JOIN projects ON projects.id = related.project_id
    WHERE links.task_id = ?1

    UNION ALL

    SELECT
        1 AS relationship_kind,
        related.id,
        related.status,
        related.project_id,
        projects.name AS project_name,
        related.title AS explicit_title,
        related.initial_prompt,
        (
            SELECT COUNT(*)
            FROM task_dependencies remaining
            INNER JOIN tasks prerequisite ON prerequisite.id = remaining.depends_on_task_id
            WHERE remaining.task_id = related.id
              AND remaining.depends_on_task_id != ?1
              AND prerequisite.status != 'done'
        ) AS remaining_dependency_count,
        links.created_at AS relationship_created_at,
        related.updated_at
    FROM task_dependencies links
    INNER JOIN tasks related ON related.id = links.task_id
    LEFT JOIN projects ON projects.id = related.project_id
    WHERE links.depends_on_task_id = ?1
)
SELECT
    relationship_kind,
    id,
    status,
    project_id,
    project_name,
    explicit_title,
    initial_prompt,
    remaining_dependency_count
FROM relationships
ORDER BY
    relationship_kind ASC,
    CASE WHEN relationship_kind = 0 THEN relationship_created_at END ASC,
    CASE WHEN relationship_kind = 0 THEN id END ASC,
    CASE WHEN relationship_kind = 1 THEN updated_at END DESC,
    id ASC
            "#,
        )?;
        let rows = statement.query_map([task_id], task_detail_relationship_from_row)?;
        let mut relationships = TaskDetailRelationships {
            dependencies: Vec::new(),
            dependents: Vec::new(),
        };
        for row in rows {
            let (is_dependent, relationship) = row?;
            if is_dependent {
                relationships.dependents.push(relationship);
            } else {
                relationships.dependencies.push(relationship);
            }
        }
        Ok(relationships)
    }

    pub fn get_all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        query_task_rows(&conn, ALL_TASKS_SQL, [])
    }

    pub fn get_task(&self, id: &str) -> Result<Option<TaskRow>> {
        let conn = self.lock_conn()?;
        let task = conn
            .query_row(TASK_BY_ID_SQL, [id], task_from_row)
            .optional()?;
        task.map(|task| hydrate_task_row(&conn, task)).transpose()
    }

    pub fn get_all_task_ids(&self) -> Result<Vec<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT id FROM tasks")?;
        let ids = stmt.query_map([], |row| row.get(0))?;
        let mut result = Vec::new();
        for id in ids {
            result.push(id?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        task_persistence_test_support::{
            seed_project_task_history, ACTIVE_TASK_COUNT, COMPLETED_TASK_HISTORY_SIZE,
        },
        test_helpers::*,
    };
    use rusqlite::trace::{TraceEvent, TraceEventCodes};
    use std::cell::Cell;

    thread_local! {
        static TRACED_STATEMENT_COUNT: Cell<usize> = const { Cell::new(0) };
    }

    fn count_traced_statement(event: TraceEvent<'_>) {
        if matches!(event, TraceEvent::Stmt(_, _)) {
            TRACED_STATEMENT_COUNT.set(TRACED_STATEMENT_COUNT.get() + 1);
        }
    }

    fn trace_statement_count<T>(db: &Database, operation: impl FnOnce() -> T) -> (T, usize) {
        TRACED_STATEMENT_COUNT.set(0);
        let connection = db.connection();
        connection.lock().expect("lock connection").trace_v2(
            TraceEventCodes::SQLITE_TRACE_STMT,
            Some(count_traced_statement),
        );

        let result = operation();

        connection
            .lock()
            .expect("lock connection")
            .trace_v2(TraceEventCodes::empty(), None);
        let statement_count = TRACED_STATEMENT_COUNT.get();
        (result, statement_count)
    }

    fn task_ids(tasks: &[TaskRow]) -> Vec<&str> {
        tasks.iter().map(|task| task.id.as_str()).collect()
    }

    fn compact_task_ids(tasks: &[CompactTaskRow]) -> Vec<&str> {
        tasks.iter().map(|task| task.id.as_str()).collect()
    }

    fn set_updated_at(db: &Database, updates: &[(&str, i64)]) {
        let connection = db.connection();
        let conn = connection.lock().expect("lock connection");
        for (task_id, updated_at) in updates {
            conn.execute(
                "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![updated_at, task_id],
            )
            .expect("set updated_at");
        }
    }

    fn query_plan<const N: usize>(
        conn: &rusqlite::Connection,
        query: &str,
        params: [&str; N],
    ) -> Vec<String> {
        let mut statement = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
            .expect("prepare query plan");
        statement
            .query_map(params_from_iter(params), |row| row.get(3))
            .expect("query plan")
            .collect::<Result<Vec<_>>>()
            .expect("collect query plan")
    }

    fn assert_plan_uses_index_without_temp_sort(plan: &[String], index: &str) {
        let details = plan.join("\n");
        assert!(
            details.contains(index),
            "query plan should use {index}:\n{details}"
        );
        assert!(
            !details.contains("USE TEMP B-TREE FOR ORDER BY"),
            "query plan should use index order instead of a temporary sort:\n{details}"
        );
    }

    #[test]
    fn task_collection_queries_order_by_most_recent_update() {
        let (db, _temp_dir) = make_test_db("task_persistence_ordering");
        let project = db
            .create_project("Project", "/tmp/task-persistence-ordering")
            .expect("create project");
        let other_project = db
            .create_project("Other", "/tmp/task-persistence-ordering-other")
            .expect("create other project");
        let oldest = db
            .create_task("Oldest", "backlog", Some(&project.id), None, None)
            .expect("create oldest task");
        let newest = db
            .create_task("Newest", "doing", Some(&project.id), None, None)
            .expect("create newest task");
        let middle = db
            .create_task("Middle", "backlog", Some(&project.id), None, None)
            .expect("create middle task");
        let other = db
            .create_task(
                "Other project",
                "backlog",
                Some(&other_project.id),
                None,
                None,
            )
            .expect("create other-project task");
        set_updated_at(
            &db,
            &[
                (&oldest.id, 10),
                (&middle.id, 20),
                (&newest.id, 30),
                (&other.id, 40),
            ],
        );

        let project_tasks = db
            .get_tasks_for_project(&project.id)
            .expect("get project tasks");
        assert_eq!(
            task_ids(&project_tasks),
            vec![newest.id.as_str(), middle.id.as_str(), oldest.id.as_str()]
        );
        let backlog_tasks = db
            .get_tasks_for_project_by_state(&project.id, "backlog")
            .expect("get backlog tasks");
        assert_eq!(
            task_ids(&backlog_tasks),
            vec![middle.id.as_str(), oldest.id.as_str()]
        );
        let non_doing_tasks = db
            .get_tasks_for_project_excluding_state(&project.id, "doing")
            .expect("get non-doing tasks");
        assert_eq!(
            task_ids(&non_doing_tasks),
            vec![middle.id.as_str(), oldest.id.as_str()]
        );
        let compact_tasks = db
            .get_compact_tasks_for_project(&project.id)
            .expect("get compact project tasks");
        assert_eq!(
            compact_task_ids(&compact_tasks),
            vec![newest.id.as_str(), middle.id.as_str(), oldest.id.as_str()]
        );
        let compact_backlog_tasks = db
            .get_compact_tasks_for_project_by_state(&project.id, "backlog")
            .expect("get compact backlog tasks");
        assert_eq!(
            compact_task_ids(&compact_backlog_tasks),
            vec![middle.id.as_str(), oldest.id.as_str()]
        );
        let compact_non_doing_tasks = db
            .get_compact_tasks_for_project_excluding_state(&project.id, "doing")
            .expect("get compact non-doing tasks");
        assert_eq!(
            compact_task_ids(&compact_non_doing_tasks),
            vec![middle.id.as_str(), oldest.id.as_str()]
        );
        let all_tasks = db.get_all_tasks().expect("get all tasks");
        assert_eq!(
            task_ids(&all_tasks),
            vec![
                other.id.as_str(),
                newest.id.as_str(),
                middle.id.as_str(),
                oldest.id.as_str(),
            ]
        );

        drop(db);
    }

    #[test]
    fn production_project_queries_use_task_indexes_with_completed_history() {
        let (db, _temp_dir) = make_test_db("task_query_plans");
        let project = db
            .create_project("Indexed project", "/tmp/indexed-project")
            .expect("create project");
        seed_project_task_history(&db, &project.id);

        let connection = db.connection();
        let conn = connection.lock().expect("lock connection");

        for query in [TASKS_FOR_PROJECT_SQL, COMPACT_TASKS_FOR_PROJECT_SQL] {
            assert_plan_uses_index_without_temp_sort(
                &query_plan(&conn, query, [&project.id]),
                "idx_tasks_project_updated_at",
            );
        }
        for query in [
            TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL,
            COMPACT_TASKS_FOR_PROJECT_EXCLUDING_STATE_SQL,
        ] {
            assert_plan_uses_index_without_temp_sort(
                &query_plan(&conn, query, [&project.id, "done"]),
                "idx_tasks_project_active_updated_at",
            );
        }
        for query in [
            TASKS_FOR_PROJECT_BY_STATE_SQL,
            COMPACT_TASKS_FOR_PROJECT_BY_STATE_SQL,
        ] {
            assert_plan_uses_index_without_temp_sort(
                &query_plan(&conn, query, [&project.id, "done"]),
                "idx_tasks_project_completed_updated_at",
            );
        }

        let relationship_plan = query_plan(
            &conn,
            TASK_RELATIONSHIP_REFERENCES_FOR_PROJECT_SQL,
            [&project.id],
        )
        .join("\n");
        assert!(
            relationship_plan.contains("idx_tasks_project_active_updated_at"),
            "relationship query should find active tasks through the partial index:\n{relationship_plan}"
        );
        assert!(
            relationship_plan.contains("idx_task_dependencies_depends_on"),
            "relationship query should use the reverse dependency index:\n{relationship_plan}"
        );
        drop(conn);

        assert_eq!(
            db.get_compact_tasks_for_project_excluding_state(&project.id, "done")
                .expect("refresh active tasks")
                .len() as i64,
            ACTIVE_TASK_COUNT
        );
        assert_eq!(
            db.get_compact_tasks_for_project_by_state(&project.id, "done")
                .expect("refresh completed tasks")
                .len() as i64,
            COMPLETED_TASK_HISTORY_SIZE
        );
        assert_eq!(
            db.get_task_relationship_references_for_project(&project.id)
                .expect("refresh relationship references")
                .len(),
            10
        );
    }

    #[test]
    fn compact_rows_use_explicit_titles_and_prompt_fallbacks() {
        let (db, _temp_dir) = make_test_db("task_persistence_compact_titles");
        let project = db
            .create_project("Project", "/tmp/task-persistence-compact-titles")
            .expect("create project");
        let long_prompt = "x".repeat(130);
        let null_title = db
            .create_task(&long_prompt, "backlog", Some(&project.id), None, None)
            .expect("create null-title task");
        let empty_title = db
            .create_task(
                "Empty title fallback",
                "backlog",
                Some(&project.id),
                None,
                None,
            )
            .expect("create empty-title task");
        let explicit_title = db
            .create_task(
                "Prompt is not the title",
                "backlog",
                Some(&project.id),
                None,
                None,
            )
            .expect("create explicit-title task");
        {
            let connection = db.connection();
            let conn = connection.lock().expect("lock connection");
            conn.execute(
                "UPDATE tasks SET title = '' WHERE id = ?1",
                [&empty_title.id],
            )
            .expect("store empty title");
            conn.execute(
                "UPDATE tasks SET title = 'Explicit title' WHERE id = ?1",
                [&explicit_title.id],
            )
            .expect("store explicit title");
        }

        let tasks = db
            .get_compact_tasks_for_project(&project.id)
            .expect("get compact tasks");
        let title_for = |id: &str| {
            tasks
                .iter()
                .find(|task| task.id == id)
                .expect("find compact task")
                .title
                .as_str()
        };
        assert_eq!(title_for(&null_title.id), "x".repeat(120));
        assert_eq!(title_for(&empty_title.id), "Empty title fallback");
        assert_eq!(title_for(&explicit_title.id), "Explicit title");

        drop(db);
    }

    #[test]
    fn relationship_references_stay_compact_with_large_task_history() {
        let (db, _temp_dir) = make_test_db("task_relationship_references_compact");
        let active_project = db
            .create_project("Active", "/tmp/task-relationship-active")
            .expect("create active project");
        let other_project = db
            .create_project("Other", "/tmp/task-relationship-other")
            .expect("create other project");
        let active_task = db
            .create_task("Active task", "doing", Some(&active_project.id), None, None)
            .expect("create active task");
        let large_prompt = format!("relationship title {}", "x".repeat(32 * 1024));
        let dependency = db
            .create_task(&large_prompt, "done", Some(&other_project.id), None, None)
            .expect("create dependency");
        let dependent = db
            .create_task(
                &large_prompt,
                "backlog",
                Some(&other_project.id),
                None,
                None,
            )
            .expect("create dependent");
        db.add_task_dependency(&active_task.id, &dependency.id)
            .expect("link dependency");
        db.add_task_dependency(&dependent.id, &active_task.id)
            .expect("link dependent");

        for index in 0..128 {
            db.create_task(
                &format!("unrelated {index} {}", "y".repeat(32 * 1024)),
                "done",
                Some(&other_project.id),
                None,
                None,
            )
            .expect("create unrelated historical task");
        }

        let oversized_batch = (0..40_000)
            .map(|index| format!("T-missing-{index}"))
            .collect::<Vec<_>>();
        let connection = db.connection();
        let conn = connection.lock().expect("lock connection");
        assert!(load_task_dependency_ids_for_tasks(&conn, &oversized_batch)
            .expect("load oversized dependency batch")
            .is_empty());
        assert!(load_task_labels_for_tasks(&conn, &oversized_batch)
            .expect("load oversized label batch")
            .is_empty());
        drop(conn);

        let ((active_tasks, references), statement_count) = trace_statement_count(&db, || {
            let active_tasks = db
                .get_tasks_for_project_excluding_state(&active_project.id, "done")
                .expect("get active project tasks");
            let references = db
                .get_task_relationship_references_for_project(&active_project.id)
                .expect("get relationship references");
            (active_tasks, references)
        });
        assert_eq!(active_tasks.len(), 1);
        assert_eq!(
            statement_count, 5,
            "one Task refresh must use a constant number of database statements"
        );
        let reference_ids: std::collections::HashSet<_> =
            references.iter().map(|task| task.id.as_str()).collect();
        assert_eq!(
            reference_ids,
            std::collections::HashSet::from([dependency.id.as_str(), dependent.id.as_str()])
        );
        assert!(references
            .iter()
            .all(|task| task.title.chars().count() <= 120));

        let serialized = serde_json::to_value(&references).expect("serialize references");
        let rows = serialized.as_array().expect("reference array");
        assert!(rows.iter().all(|row| row.get("initial_prompt").is_none()));
        assert!(rows.iter().all(|row| row.get("prompt").is_none()));
        assert!(
            serde_json::to_vec(&references)
                .expect("serialize reference bytes")
                .len()
                < 2_048,
            "relationship response must not retain full task prompts"
        );
    }
    #[test]
    fn task_detail_relationships_stay_compact_and_scoped_with_large_task_history() {
        let (db, _temp_dir) = make_test_db("task_detail_relationships_compact");
        let task_project = db
            .create_project("Task project", "/tmp/task-detail-relationships-task")
            .expect("create task project");
        let relationship_project = db
            .create_project(
                "Relationship project",
                "/tmp/task-detail-relationships-related",
            )
            .expect("create relationship project");
        let task = db
            .create_task(
                "Requested task",
                "doing",
                Some(&task_project.id),
                None,
                None,
            )
            .expect("create requested task");
        let large_prompt = format!(
            "[image#1]: data:image/png;base64,{}\nRelated title",
            "eA".repeat(16 * 1024)
        );
        let dependency = db
            .create_task(
                &large_prompt,
                "done",
                Some(&relationship_project.id),
                None,
                None,
            )
            .expect("create dependency");
        let open_dependency = db
            .create_task(
                "Open prerequisite",
                "doing",
                Some(&relationship_project.id),
                None,
                None,
            )
            .expect("create open dependency");
        let completed_dependency = db
            .create_task(
                "Completed prerequisite",
                "done",
                Some(&relationship_project.id),
                None,
                None,
            )
            .expect("create completed dependency");
        let dependent = db
            .create_task(
                &large_prompt,
                "backlog",
                Some(&relationship_project.id),
                None,
                None,
            )
            .expect("create dependent");
        db.add_task_dependency(&task.id, &dependency.id)
            .expect("link dependency");
        for dependency_id in [&task.id, &open_dependency.id, &completed_dependency.id] {
            db.add_task_dependency(&dependent.id, dependency_id)
                .expect("link dependent prerequisite");
        }
        for index in 0..128 {
            db.create_task(
                &format!("Unrelated {index} {}", "y".repeat(32 * 1024)),
                "done",
                Some(&relationship_project.id),
                None,
                None,
            )
            .expect("create unrelated historical task");
        }

        let (relationships, statement_count) = trace_statement_count(&db, || {
            db.get_task_detail_relationships(&task.id)
                .expect("get task detail relationships")
        });

        assert_eq!(
            statement_count, 1,
            "Task detail relationships must use one scoped database statement"
        );
        assert_eq!(relationships.dependencies.len(), 1);
        assert_eq!(relationships.dependencies[0].id, dependency.id);
        assert_eq!(
            relationships.dependencies[0].project_id,
            Some(relationship_project.id.clone())
        );
        assert_eq!(
            relationships.dependencies[0].project_name.as_deref(),
            Some("Relationship project")
        );
        assert_eq!(relationships.dependents.len(), 1);
        assert_eq!(relationships.dependents[0].id, dependent.id);
        assert_eq!(relationships.dependents[0].remaining_dependency_count, 1);
        assert!(relationships
            .dependencies
            .iter()
            .chain(&relationships.dependents)
            .all(|relationship| relationship.title.chars().count() <= 120));
    }

    #[test]
    fn every_task_row_query_hydrates_dependencies_and_labels() {
        let (db, _temp_dir) = make_test_db("task_persistence_hydration");
        let project = db
            .create_project("Project", "/tmp/task-persistence-hydration")
            .expect("create project");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project.id), None, None)
            .expect("create dependency");
        let task = db
            .create_task("Hydrated", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.add_task_dependency(&task.id, &dependency.id)
            .expect("add dependency");
        let label = db
            .add_task_label(&task.id, "persistence")
            .expect("add label");

        let assert_hydrated = |row: &TaskRow| {
            assert_eq!(row.depends_on, vec![dependency.id.clone()]);
            assert_eq!(row.labels, vec![label.clone()]);
        };
        assert_hydrated(
            &db.get_task(&task.id)
                .expect("get task")
                .expect("task exists"),
        );
        assert!(db
            .get_task("T-missing")
            .expect("query missing task")
            .is_none());
        for rows in [
            db.get_tasks_for_project(&project.id)
                .expect("get project tasks"),
            db.get_tasks_for_project_excluding_state(&project.id, "doing")
                .expect("get non-doing tasks"),
            db.get_tasks_for_project_by_state(&project.id, "backlog")
                .expect("get backlog tasks"),
            db.get_all_tasks().expect("get all tasks"),
        ] {
            assert_hydrated(
                rows.iter()
                    .find(|row| row.id == task.id)
                    .expect("find hydrated task"),
            );
        }

        for rows in [
            db.get_compact_tasks_for_project(&project.id)
                .expect("get compact project tasks"),
            db.get_compact_tasks_for_project_excluding_state(&project.id, "doing")
                .expect("get compact non-doing tasks"),
            db.get_compact_tasks_for_project_by_state(&project.id, "backlog")
                .expect("get compact backlog tasks"),
        ] {
            let row = rows
                .iter()
                .find(|row| row.id == task.id)
                .expect("find hydrated compact task");
            assert_eq!(row.depends_on, vec![dependency.id.clone()]);
            assert_eq!(row.labels, vec![label.clone()]);
        }

        drop(db);
    }
}
