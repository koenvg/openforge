use super::{task_project_id, Database};
use rusqlite::Result;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskDependencyPersistenceError {
    #[error("task cannot depend on itself")]
    SelfDependency(String),
    #[error("task {0} does not exist")]
    TaskNotFound(String),
    #[error("dependency task {0} does not exist")]
    DependencyNotFound(String),
    #[error(
        "dependency task {dependency_id} and {task_id} must both belong to projects or both be unassigned"
    )]
    AssignmentMismatch {
        task_id: String,
        dependency_id: String,
    },
    #[error("dependency task {dependency_id} would create a cycle with {task_id}")]
    Cycle {
        task_id: String,
        dependency_id: String,
    },
    #[error("task chain must contain at least two task ids")]
    ChainTooShort,
    #[error("{0}")]
    Storage(#[from] rusqlite::Error),
}

impl TaskDependencyPersistenceError {
    pub(super) fn into_database_error(self) -> rusqlite::Error {
        match self {
            Self::Storage(error) => error,
            domain_error => rusqlite::Error::ToSqlConversionFailure(Box::new(domain_error)),
        }
    }
}

type TaskDependencyResult<T> = std::result::Result<T, TaskDependencyPersistenceError>;

pub(super) fn load_task_dependency_ids(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?1 ORDER BY created_at ASC, depends_on_task_id ASC",
    )?;
    let rows = stmt.query_map([task_id], |row| row.get(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn load_task_dependency_ids_for_tasks(
    conn: &rusqlite::Connection,
    task_ids: &[String],
) -> Result<HashMap<String, Vec<String>>> {
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let task_ids_json = serde_json::to_string(task_ids)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut stmt = conn.prepare(
        "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (SELECT value FROM json_each(?1)) ORDER BY task_id ASC, created_at ASC, depends_on_task_id ASC",
    )?;
    let rows = stmt.query_map([task_ids_json], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut result: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (task_id, dependency_id) = row?;
        result.entry(task_id).or_default().push(dependency_id);
    }
    Ok(result)
}

pub(super) fn persist_new_task_dependencies(
    conn: &rusqlite::Connection,
    task_id: &str,
    dependency_ids: &[String],
    now: i64,
) -> TaskDependencyResult<Vec<String>> {
    let dependency_ids = dedupe_dependency_ids(dependency_ids);
    for dependency_id in &dependency_ids {
        validate_dependency(conn, task_id, dependency_id)?;
    }

    for dependency_id in &dependency_ids {
        conn.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, dependency_id, now],
        )?;
    }
    if !dependency_ids.is_empty() {
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
    }
    Ok(dependency_ids)
}

fn dependency_path_exists(
    conn: &rusqlite::Connection,
    start_task_id: &str,
    target_task_id: &str,
) -> Result<bool> {
    conn.query_row(
        r#"
WITH RECURSIVE dependency_chain(id) AS (
    SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?1
    UNION
    SELECT task_dependencies.depends_on_task_id
    FROM task_dependencies
    INNER JOIN dependency_chain ON task_dependencies.task_id = dependency_chain.id
)
SELECT EXISTS(SELECT 1 FROM dependency_chain WHERE id = ?2)
        "#,
        rusqlite::params![start_task_id, target_task_id],
        |row| row.get(0),
    )
}

fn validate_dependency(
    conn: &rusqlite::Connection,
    task_id: &str,
    depends_on_task_id: &str,
) -> TaskDependencyResult<()> {
    if task_id == depends_on_task_id {
        return Err(TaskDependencyPersistenceError::SelfDependency(
            task_id.to_string(),
        ));
    }

    let task_project = task_project_id(conn, task_id)?
        .ok_or_else(|| TaskDependencyPersistenceError::TaskNotFound(task_id.to_string()))?;
    let dependency_project = task_project_id(conn, depends_on_task_id)?.ok_or_else(|| {
        TaskDependencyPersistenceError::DependencyNotFound(depends_on_task_id.to_string())
    })?;

    if task_project.is_some() != dependency_project.is_some() {
        return Err(TaskDependencyPersistenceError::AssignmentMismatch {
            task_id: task_id.to_string(),
            dependency_id: depends_on_task_id.to_string(),
        });
    }

    if dependency_path_exists(conn, depends_on_task_id, task_id)? {
        return Err(TaskDependencyPersistenceError::Cycle {
            task_id: task_id.to_string(),
            dependency_id: depends_on_task_id.to_string(),
        });
    }

    Ok(())
}

fn dedupe_dependency_ids(dependency_ids: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for dependency_id in dependency_ids {
        let trimmed = dependency_id.trim();
        if !trimmed.is_empty() && !result.iter().any(|id| id == trimmed) {
            result.push(trimmed.to_string());
        }
    }
    result
}

impl Database {
    pub fn add_task_dependency(
        &self,
        task_id: &str,
        depends_on_task_id: &str,
    ) -> TaskDependencyResult<()> {
        let conn = self.lock_conn()?;
        validate_dependency(&conn, task_id, depends_on_task_id)?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, depends_on_task_id, now],
        )?;
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        Ok(())
    }

    pub fn set_task_dependencies(
        &self,
        task_id: &str,
        dependency_ids: &[String],
    ) -> TaskDependencyResult<()> {
        let mut conn = self.lock_conn()?;
        task_project_id(&conn, task_id)?
            .ok_or_else(|| TaskDependencyPersistenceError::TaskNotFound(task_id.to_string()))?;
        let dependency_ids = dedupe_dependency_ids(dependency_ids);
        for dependency_id in &dependency_ids {
            validate_dependency(&conn, task_id, dependency_id)?;
        }
        let now = super::current_unix_timestamp()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM task_dependencies WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        for dependency_id in dependency_ids {
            tx.execute(
                "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, dependency_id, now],
            )?;
        }
        tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn link_task_chain(
        &self,
        task_ids: &[String],
    ) -> TaskDependencyResult<Vec<(String, String)>> {
        if task_ids.len() < 2 {
            return Err(TaskDependencyPersistenceError::ChainTooShort);
        }

        let mut conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let tx = conn.transaction()?;
        let mut links = Vec::new();
        for pair in task_ids.windows(2) {
            let depends_on_task_id = pair[0].trim();
            let task_id = pair[1].trim();
            validate_dependency(&tx, task_id, depends_on_task_id)?;
            tx.execute(
                "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, depends_on_task_id, now],
            )?;
            tx.execute(
                "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, task_id],
            )?;
            links.push((task_id.to_string(), depends_on_task_id.to_string()));
        }
        tx.commit()?;
        Ok(links)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{test_helpers::*, TaskDependencyPersistenceError};
    use std::error::Error as _;

    #[test]
    fn task_dependency_error_preserves_sources_and_from_conversion() {
        let error = TaskDependencyPersistenceError::from(rusqlite::Error::InvalidQuery);
        assert!(matches!(
            &error,
            TaskDependencyPersistenceError::Storage(rusqlite::Error::InvalidQuery)
        ));
        assert_eq!(error.to_string(), rusqlite::Error::InvalidQuery.to_string());
        assert!(error
            .source()
            .expect("storage error must be the source")
            .downcast_ref::<rusqlite::Error>()
            .is_some());

        let domain_error = TaskDependencyPersistenceError::TaskNotFound("T-404".to_string());
        assert!(domain_error.source().is_none());
    }

    #[test]
    fn test_task_dependencies_round_trip_and_deduplicate() {
        let (db, _temp_dir) = make_test_db("task_dependencies_round_trip");
        db.set_config("task_id_prefix", "T").unwrap();
        let prerequisite = db
            .create_task("Prerequisite", "done", None, None, None)
            .expect("create prerequisite");
        let dependent = db
            .create_task("Dependent", "backlog", None, None, None)
            .expect("create dependent");

        db.set_task_dependencies(
            &dependent.id,
            &[prerequisite.id.clone(), prerequisite.id.clone()],
        )
        .expect("set dependencies");

        let retrieved = db.get_task(&dependent.id).expect("get failed").unwrap();
        assert_eq!(retrieved.depends_on, vec![prerequisite.id]);

        let tasks = db.get_all_tasks().expect("get all");
        let listed = tasks
            .iter()
            .find(|task| task.id == dependent.id)
            .expect("dependent listed");
        assert_eq!(listed.depends_on, vec!["T-1".to_string()]);

        drop(db);
    }

    #[test]
    fn test_task_dependency_error_identifies_self_dependency() {
        let (db, _temp_dir) = make_test_db("task_dependency_self");
        db.set_config("task_id_prefix", "T").unwrap();
        let task = db
            .create_task("Task", "backlog", None, None, None)
            .expect("create task");

        let error = db
            .add_task_dependency(&task.id, &task.id)
            .expect_err("self-dependency should fail");
        assert_eq!(error.to_string(), "task cannot depend on itself");

        assert!(matches!(
            error,
            TaskDependencyPersistenceError::SelfDependency(task_id) if task_id == task.id
        ));

        drop(db);
    }

    #[test]
    fn test_task_dependency_error_identifies_missing_tasks() {
        let (db, _temp_dir) = make_test_db("task_dependency_missing_tasks");
        db.set_config("task_id_prefix", "T").unwrap();
        let task = db
            .create_task("Task", "backlog", None, None, None)
            .expect("create task");

        let missing_task = db
            .add_task_dependency("T-404", &task.id)
            .expect_err("missing task should fail");
        assert_eq!(missing_task.to_string(), "task T-404 does not exist");
        assert!(matches!(
            missing_task,
            TaskDependencyPersistenceError::TaskNotFound(task_id) if task_id == "T-404"
        ));

        let missing_dependency = db
            .add_task_dependency(&task.id, "T-404")
            .expect_err("missing dependency should fail");
        assert_eq!(
            missing_dependency.to_string(),
            "dependency task T-404 does not exist"
        );
        assert!(matches!(
            missing_dependency,
            TaskDependencyPersistenceError::DependencyNotFound(task_id) if task_id == "T-404"
        ));

        drop(db);
    }

    #[test]
    fn test_task_dependency_accepts_cross_project_dependency() {
        let (db, _temp_dir) = make_test_db("task_dependency_cross_project");
        db.set_config("task_id_prefix", "T").unwrap();
        let project_a = db.create_project("A", "/tmp/a").expect("create project a");
        let project_b = db.create_project("B", "/tmp/b").expect("create project b");
        let task = db
            .create_task("Task", "backlog", Some(&project_a.id), None, None)
            .expect("create task");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project_b.id), None, None)
            .expect("create dependency");

        db.add_task_dependency(&task.id, &dependency.id)
            .expect("cross-project dependency should succeed");
        let persisted = db.get_task(&task.id).expect("get task").expect("task");
        assert_eq!(persisted.depends_on, vec![dependency.id]);

        drop(db);
    }

    #[test]
    fn test_task_dependency_error_identifies_assignment_mismatch() {
        let (db, _temp_dir) = make_test_db("task_dependency_assignment_mismatch");
        db.set_config("task_id_prefix", "T").unwrap();
        let project = db.create_project("A", "/tmp/a").expect("create project");
        let assigned = db
            .create_task("Assigned", "backlog", Some(&project.id), None, None)
            .expect("create assigned task");
        let unassigned = db
            .create_task("Unassigned", "backlog", None, None, None)
            .expect("create unassigned task");

        let error = db
            .add_task_dependency(&assigned.id, &unassigned.id)
            .expect_err("mixed assignment should fail");
        assert_eq!(
            error.to_string(),
            format!(
                "dependency task {} and {} must both belong to projects or both be unassigned",
                unassigned.id, assigned.id
            )
        );
        assert!(matches!(
            error,
            TaskDependencyPersistenceError::AssignmentMismatch {
                task_id,
                dependency_id,
            } if task_id == assigned.id && dependency_id == unassigned.id
        ));

        let reverse_error = db
            .add_task_dependency(&unassigned.id, &assigned.id)
            .expect_err("reverse mixed assignment should fail");
        assert!(matches!(
            reverse_error,
            TaskDependencyPersistenceError::AssignmentMismatch {
                task_id,
                dependency_id,
            } if task_id == unassigned.id && dependency_id == assigned.id
        ));

        drop(db);
    }

    #[test]
    fn test_set_task_dependencies_rejects_unknown_task_even_when_empty() {
        let (db, _temp_dir) = make_test_db("task_dependency_unknown_empty");

        let error = db
            .set_task_dependencies("T-404", &[])
            .expect_err("missing task should fail");
        assert!(matches!(
            error,
            TaskDependencyPersistenceError::TaskNotFound(task_id) if task_id == "T-404"
        ));

        drop(db);
    }

    #[test]
    fn test_task_dependency_error_identifies_cycles() {
        let (db, _temp_dir) = make_test_db("task_dependency_cycles");
        db.set_config("task_id_prefix", "T").unwrap();
        let first = db
            .create_task("First", "backlog", None, None, None)
            .expect("create first");
        let second = db
            .create_task("Second", "backlog", None, None, None)
            .expect("create second");
        let third = db
            .create_task("Third", "backlog", None, None, None)
            .expect("create third");

        db.add_task_dependency(&second.id, &first.id)
            .expect("second depends on first");
        db.add_task_dependency(&third.id, &second.id)
            .expect("third depends on second");

        let add_error = db
            .add_task_dependency(&first.id, &third.id)
            .expect_err("cycle should fail");
        assert_eq!(
            add_error.to_string(),
            format!(
                "dependency task {} would create a cycle with {}",
                third.id, first.id
            )
        );
        assert!(matches!(
            add_error,
            TaskDependencyPersistenceError::Cycle {
                task_id,
                dependency_id,
            } if task_id == first.id && dependency_id == third.id
        ));

        let set_error = db
            .set_task_dependencies(&first.id, std::slice::from_ref(&third.id))
            .expect_err("cycle should fail");
        assert!(matches!(
            set_error,
            TaskDependencyPersistenceError::Cycle {
                task_id,
                dependency_id,
            } if task_id == first.id && dependency_id == third.id
        ));

        drop(db);
    }

    #[test]
    fn test_link_task_chain_rolls_back_on_invalid_edge() {
        let (db, _temp_dir) = make_test_db("task_dependency_chain_rollback");
        db.set_config("task_id_prefix", "T").unwrap();
        let project_a = db.create_project("A", "/tmp/a").expect("create project a");
        db.create_task("First", "backlog", Some(&project_a.id), None, None)
            .expect("create first");
        let second = db
            .create_task("Second", "backlog", Some(&project_a.id), None, None)
            .expect("create second");
        db.create_task("Third", "backlog", None, None, None)
            .expect("create third");

        assert!(db
            .link_task_chain(&["T-1".to_string(), "T-2".to_string(), "T-3".to_string()])
            .is_err());

        let second = db.get_task(&second.id).expect("get second").unwrap();
        assert!(second.depends_on.is_empty());

        drop(db);
    }
}
