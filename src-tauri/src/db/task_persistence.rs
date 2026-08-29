use super::{
    task_dependencies::{load_task_dependency_ids, load_task_dependency_ids_for_tasks},
    task_labels::{load_task_labels, load_task_labels_for_tasks},
    tasks::{CompactTaskRow, TaskRelationshipReferenceRow, TaskRow},
    Database,
};
use rusqlite::{params_from_iter, OptionalExtension, Result};

const TASK_ROW_COLUMNS: &str = "id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, title, title_source, title_generated_at, worktree_source, worktree_branch, source_ticket_url";
const COMPACT_TASK_ROW_COLUMNS: &str = "id, status, project_id, created_at, updated_at, agent, permission_mode, worktree_source, worktree_branch, COALESCE(NULLIF(title, ''), substr(initial_prompt, 1, 120)) AS title, title_source, title_generated_at, source_ticket_url";

fn task_from_row(row: &rusqlite::Row<'_>) -> Result<TaskRow> {
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
    Ok(CompactTaskRow {
        id: row.get(0)?,
        status: row.get(1)?,
        project_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        agent: row.get(5)?,
        permission_mode: row.get(6)?,
        worktree_source: row.get(7)?,
        worktree_branch: row.get(8)?,
        title: row.get(9)?,
        title_source: row.get(10)?,
        title_generated_at: row.get(11)?,
        source_ticket_url: row.get(12)?,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn task_relationship_reference_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<TaskRelationshipReferenceRow> {
    Ok(TaskRelationshipReferenceRow {
        id: row.get(0)?,
        status: row.get(1)?,
        project_id: row.get(2)?,
        title: row.get(3)?,
        depends_on: Vec::new(),
    })
}

fn hydrate_task_row(conn: &rusqlite::Connection, mut task: TaskRow) -> Result<TaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

fn hydrate_task_rows(conn: &rusqlite::Connection, mut tasks: Vec<TaskRow>) -> Result<Vec<TaskRow>> {
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

fn hydrate_task_relationship_references(
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
        let query = format!(
            "SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC"
        );
        query_task_rows(&conn, &query, [project_id])
    }

    pub fn get_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
        query_task_rows(&conn, &query, [project_id, state])
    }

    pub fn get_compact_tasks_for_project(&self, project_id: &str) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC");
        query_compact_task_rows(&conn, &query, [project_id])
    }

    pub fn get_compact_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
        query_compact_task_rows(&conn, &query, [project_id, state])
    }

    pub fn get_compact_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
        query_compact_task_rows(&conn, &query, [project_id, state])
    }

    pub fn get_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
        query_task_rows(&conn, &query, [project_id, state])
    }

    pub fn get_task_relationship_references_for_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<TaskRelationshipReferenceRow>> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare(
            r#"
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
        COALESCE(NULLIF(tasks.title, ''), substr(tasks.initial_prompt, 1, 120)) AS title,
        tasks.updated_at
    FROM tasks
    INNER JOIN relationship_ids ON relationship_ids.id = tasks.id
    WHERE NOT EXISTS (SELECT 1 FROM active_tasks WHERE active_tasks.id = tasks.id)
)
SELECT id, status, project_id, title
FROM relationship_tasks
ORDER BY updated_at DESC
            "#,
        )?;
        let rows = statement.query_map([project_id], task_relationship_reference_from_row)?;
        let tasks = rows.collect::<Result<Vec<_>>>()?;
        hydrate_task_relationship_references(&conn, tasks)
    }

    pub fn get_all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks ORDER BY updated_at DESC");
        query_task_rows(&conn, &query, [])
    }

    pub fn get_task(&self, id: &str) -> Result<Option<TaskRow>> {
        let conn = self.lock_conn()?;
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE id = ?1");
        let task = conn.query_row(&query, [id], task_from_row).optional()?;
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
    use crate::db::test_helpers::*;
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
