use super::{task_project_id, Database};
use rusqlite::Result;
use std::collections::HashMap;
use thiserror::Error;

pub const MAX_DIRECT_TASK_RELATIONSHIPS: usize = 100;

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
    #[error("task {task_id} already has the maximum of {max} direct relationships")]
    RelationshipLimit { task_id: String, max: usize },
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

fn dependency_exists(
    conn: &rusqlite::Connection,
    task_id: &str,
    dependency_id: &str,
) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM task_dependencies WHERE task_id = ?1 AND depends_on_task_id = ?2)",
        rusqlite::params![task_id, dependency_id],
        |row| row.get(0),
    )
}

fn direct_relationship_count(conn: &rusqlite::Connection, task_id: &str) -> Result<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM task_dependencies WHERE task_id = ?1 OR depends_on_task_id = ?1",
        [task_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count as usize)
}

fn enforce_relationship_capacity(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> TaskDependencyResult<()> {
    if direct_relationship_count(conn, task_id)? >= MAX_DIRECT_TASK_RELATIONSHIPS {
        return Err(TaskDependencyPersistenceError::RelationshipLimit {
            task_id: task_id.to_string(),
            max: MAX_DIRECT_TASK_RELATIONSHIPS,
        });
    }
    Ok(())
}

fn enforce_new_dependency_capacity(
    conn: &rusqlite::Connection,
    task_id: &str,
    dependency_id: &str,
) -> TaskDependencyResult<()> {
    if dependency_exists(conn, task_id, dependency_id)? {
        return Ok(());
    }
    enforce_relationship_capacity(conn, task_id)?;
    enforce_relationship_capacity(conn, dependency_id)
}

pub(super) fn persist_new_task_dependencies(
    conn: &rusqlite::Connection,
    task_id: &str,
    dependency_ids: &[String],
    now: i64,
) -> TaskDependencyResult<Vec<String>> {
    let dependency_ids = dedupe_dependency_ids(dependency_ids);
    let new_relationships = dependency_ids
        .iter()
        .try_fold(0usize, |count, dependency_id| {
            dependency_exists(conn, task_id, dependency_id)
                .map(|exists| count + usize::from(!exists))
        })?;
    if direct_relationship_count(conn, task_id)? + new_relationships > MAX_DIRECT_TASK_RELATIONSHIPS
    {
        return Err(TaskDependencyPersistenceError::RelationshipLimit {
            task_id: task_id.to_string(),
            max: MAX_DIRECT_TASK_RELATIONSHIPS,
        });
    }
    for dependency_id in &dependency_ids {
        validate_dependency(conn, task_id, dependency_id)?;
        enforce_new_dependency_capacity(conn, task_id, dependency_id)?;
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
        let mut connection = self.lock_conn()?;
        let transaction = connection.transaction()?;
        validate_dependency(&transaction, task_id, depends_on_task_id)?;
        if dependency_exists(&transaction, task_id, depends_on_task_id)? {
            transaction.commit()?;
            return Ok(());
        }
        enforce_new_dependency_capacity(&transaction, task_id, depends_on_task_id)?;
        let now = super::current_unix_timestamp()?;
        transaction.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, depends_on_task_id, now],
        )?;
        transaction.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_task_dependencies(
        &self,
        task_id: &str,
        dependency_ids: &[String],
    ) -> TaskDependencyResult<()> {
        let mut connection = self.lock_conn()?;
        let transaction = connection.transaction()?;
        task_project_id(&transaction, task_id)?
            .ok_or_else(|| TaskDependencyPersistenceError::TaskNotFound(task_id.to_string()))?;
        let dependency_ids = dedupe_dependency_ids(dependency_ids);
        for dependency_id in &dependency_ids {
            validate_dependency(&transaction, task_id, dependency_id)?;
        }
        let incoming_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM task_dependencies WHERE depends_on_task_id = ?1",
            [task_id],
            |row| row.get(0),
        )?;
        if incoming_count + dependency_ids.len() as i64 > MAX_DIRECT_TASK_RELATIONSHIPS as i64 {
            return Err(TaskDependencyPersistenceError::RelationshipLimit {
                task_id: task_id.to_string(),
                max: MAX_DIRECT_TASK_RELATIONSHIPS,
            });
        }
        for dependency_id in &dependency_ids {
            if !dependency_exists(&transaction, task_id, dependency_id)? {
                enforce_relationship_capacity(&transaction, dependency_id)?;
            }
        }
        let now = super::current_unix_timestamp()?;
        transaction.execute(
            "DELETE FROM task_dependencies WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        for dependency_id in dependency_ids {
            transaction.execute(
                "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, dependency_id, now],
            )?;
        }
        transaction.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        transaction.commit()?;
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
            if dependency_exists(&tx, task_id, depends_on_task_id)? {
                links.push((task_id.to_string(), depends_on_task_id.to_string()));
                continue;
            }
            enforce_new_dependency_capacity(&tx, task_id, depends_on_task_id)?;
            tx.execute(
                "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
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

    #[test]
    fn direct_relationship_limit_counts_both_directions_and_keeps_duplicates_idempotent() {
        let (db, _temp_dir) = make_test_db("direct_relationship_limit");
        let central = db
            .create_task("Central", "backlog", None, None, None)
            .expect("create central Task");
        let mut related = Vec::new();
        for index in 0..super::MAX_DIRECT_TASK_RELATIONSHIPS {
            related.push(
                db.create_task(&format!("Related {index}"), "done", None, None, None)
                    .expect("create related Task"),
            );
        }
        for task in &related[..50] {
            db.add_task_dependency(&central.id, &task.id)
                .expect("add outgoing relationship");
        }
        for task in &related[50..] {
            db.add_task_dependency(&task.id, &central.id)
                .expect("add incoming relationship");
        }

        db.add_task_dependency(&central.id, &related[0].id)
            .expect("duplicate relationship remains idempotent at the limit");
        let overflow = db
            .create_task("Overflow", "done", None, None, None)
            .expect("create overflow Task");
        let error = db
            .add_task_dependency(&central.id, &overflow.id)
            .expect_err("relationship beyond the limit must fail");
        assert!(matches!(
            error,
            TaskDependencyPersistenceError::RelationshipLimit { task_id, max }
                if task_id == central.id && max == super::MAX_DIRECT_TASK_RELATIONSHIPS
        ));
        assert!(!db
            .get_task(&central.id)
            .expect("load central Task")
            .expect("central Task exists")
            .depends_on
            .contains(&overflow.id));
    }

    #[test]
    fn oversized_dependency_replacement_rolls_back_without_changing_existing_edges() {
        let (db, _temp_dir) = make_test_db("relationship_replacement_limit");
        let central = db
            .create_task("Central", "backlog", None, None, None)
            .expect("create central Task");
        let mut related = Vec::new();
        for index in 0..=super::MAX_DIRECT_TASK_RELATIONSHIPS {
            related.push(
                db.create_task(&format!("Related {index}"), "done", None, None, None)
                    .expect("create related Task"),
            );
        }
        let original = related[..super::MAX_DIRECT_TASK_RELATIONSHIPS]
            .iter()
            .map(|task| task.id.clone())
            .collect::<Vec<_>>();
        db.set_task_dependencies(&central.id, &original)
            .expect("set maximum relationships");
        let oversized = related
            .iter()
            .map(|task| task.id.clone())
            .collect::<Vec<_>>();

        assert!(matches!(
            db.set_task_dependencies(&central.id, &oversized),
            Err(TaskDependencyPersistenceError::RelationshipLimit { .. })
        ));
        let persisted = db
            .get_task(&central.id)
            .expect("load central Task")
            .expect("central Task exists")
            .depends_on
            .into_iter()
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            persisted,
            original
                .into_iter()
                .collect::<std::collections::HashSet<_>>()
        );
    }

    #[test]
    fn concurrent_relationship_additions_cannot_exceed_the_limit() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let (db, _temp_dir) = make_test_db("concurrent_relationship_limit");
        let central = db
            .create_task("Central", "backlog", None, None, None)
            .expect("create central Task");
        let mut related = Vec::new();
        for index in 0..(super::MAX_DIRECT_TASK_RELATIONSHIPS + 1) {
            related.push(
                db.create_task(&format!("Related {index}"), "done", None, None, None)
                    .expect("create related Task"),
            );
        }
        for task in &related[..(super::MAX_DIRECT_TASK_RELATIONSHIPS - 1)] {
            db.add_task_dependency(&central.id, &task.id)
                .expect("seed relationship");
        }

        let db = Arc::new(db);
        let barrier = Arc::new(Barrier::new(3));
        let attempts = related[(super::MAX_DIRECT_TASK_RELATIONSHIPS - 1)..]
            .iter()
            .map(|task| {
                let db = Arc::clone(&db);
                let barrier = Arc::clone(&barrier);
                let task_id = central.id.clone();
                let dependency_id = task.id.clone();
                thread::spawn(move || {
                    barrier.wait();
                    db.add_task_dependency(&task_id, &dependency_id)
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = attempts
            .into_iter()
            .map(|attempt| attempt.join().expect("relationship thread"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(
                    result,
                    Err(TaskDependencyPersistenceError::RelationshipLimit { .. })
                ))
                .count(),
            1
        );
        let central = db
            .get_task(&central.id)
            .expect("load central Task")
            .expect("central Task exists");
        assert_eq!(
            central.depends_on.len(),
            super::MAX_DIRECT_TASK_RELATIONSHIPS
        );
    }
}
