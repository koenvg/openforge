use super::{
    task_dependencies::load_task_dependency_ids,
    task_labels::load_task_labels,
    tasks::{CompactTaskRow, TaskRow},
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

fn hydrate_task_row(conn: &rusqlite::Connection, mut task: TaskRow) -> Result<TaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

fn hydrate_compact_task_row(
    conn: &rusqlite::Connection,
    mut task: CompactTaskRow,
) -> Result<CompactTaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

fn query_task_rows<const N: usize>(
    conn: &rusqlite::Connection,
    query: &str,
    params: [&str; N],
) -> Result<Vec<TaskRow>> {
    let mut statement = conn.prepare(query)?;
    let rows = statement.query_map(params_from_iter(params), task_from_row)?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(hydrate_task_row(conn, row?)?);
    }
    Ok(tasks)
}

fn query_compact_task_rows<const N: usize>(
    conn: &rusqlite::Connection,
    query: &str,
    params: [&str; N],
) -> Result<Vec<CompactTaskRow>> {
    let mut statement = conn.prepare(query)?;
    let rows = statement.query_map(params_from_iter(params), compact_task_from_row)?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(hydrate_compact_task_row(conn, row?)?);
    }
    Ok(tasks)
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
    use std::fs;

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
        let (db, path) = make_test_db("task_persistence_ordering");
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
        let _ = fs::remove_file(path);
    }

    #[test]
    fn compact_rows_use_explicit_titles_and_prompt_fallbacks() {
        let (db, path) = make_test_db("task_persistence_compact_titles");
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
        let _ = fs::remove_file(path);
    }

    #[test]
    fn every_task_row_query_hydrates_dependencies_and_labels() {
        let (db, path) = make_test_db("task_persistence_hydration");
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
        let _ = fs::remove_file(path);
    }
}
