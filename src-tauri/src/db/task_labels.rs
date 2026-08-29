use super::{task_project_id, Database};
use rusqlite::{OptionalExtension, Result};
use serde::Serialize;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskLabelRow {
    pub id: i64,
    pub project_id: String,
    pub name: String,
}

const MAX_TASK_LABEL_NAME_CHARS: usize = 40;

/// Errors returned by task label persistence operations.
#[derive(Debug, Error)]
pub enum TaskLabelPersistenceError {
    #[error("label name is required")]
    BlankName,
    #[error("label names must be {max_chars} characters or fewer")]
    NameTooLong {
        max_chars: usize,
        actual_chars: usize,
    },
    #[error("task {0} does not exist")]
    TaskNotFound(String),
    #[error("task {0} must belong to a project before labels can be assigned")]
    TaskProjectRequired(String),
    #[error("label {0} does not exist")]
    LabelNotFound(i64),
    #[error("label must belong to the same project as the task")]
    CrossProjectAssignment { task_id: String, label_id: i64 },
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
}

impl TaskLabelPersistenceError {
    pub(crate) fn into_database_error(self) -> rusqlite::Error {
        match self {
            Self::Storage(error) => error,
            domain_error => rusqlite::Error::ToSqlConversionFailure(Box::new(domain_error)),
        }
    }
}

type TaskLabelResult<T> = std::result::Result<T, TaskLabelPersistenceError>;

fn decode_task_label(row: &rusqlite::Row<'_>) -> Result<TaskLabelRow> {
    Ok(TaskLabelRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
    })
}

pub(super) fn load_task_labels(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> Result<Vec<TaskLabelRow>> {
    let mut stmt = conn.prepare(
        r#"
SELECT l.id, l.project_id, l.name
FROM task_labels l
INNER JOIN task_label_assignments tla ON tla.label_id = l.id
WHERE tla.task_id = ?1
ORDER BY l.name COLLATE NOCASE ASC, l.id ASC
        "#,
    )?;
    let rows = stmt.query_map([task_id], decode_task_label)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn load_task_labels_for_tasks(
    conn: &rusqlite::Connection,
    task_ids: &[String],
) -> Result<HashMap<String, Vec<TaskLabelRow>>> {
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let task_ids_json = serde_json::to_string(task_ids)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut stmt = conn.prepare(
        r#"
SELECT tla.task_id, l.id, l.project_id, l.name
FROM task_labels l
INNER JOIN task_label_assignments tla ON tla.label_id = l.id
WHERE tla.task_id IN (SELECT value FROM json_each(?1))
ORDER BY tla.task_id ASC, l.name COLLATE NOCASE ASC, l.id ASC
        "#,
    )?;
    let rows = stmt.query_map([task_ids_json], |row| {
        Ok((
            row.get::<_, String>(0)?,
            TaskLabelRow {
                id: row.get(1)?,
                project_id: row.get(2)?,
                name: row.get(3)?,
            },
        ))
    })?;
    let mut result: HashMap<String, Vec<TaskLabelRow>> = HashMap::new();
    for row in rows {
        let (task_id, label) = row?;
        result.entry(task_id).or_default().push(label);
    }
    Ok(result)
}

fn normalize_label_name(name: &str) -> TaskLabelResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(TaskLabelPersistenceError::BlankName);
    }
    let actual_chars = trimmed.chars().count();
    if actual_chars > MAX_TASK_LABEL_NAME_CHARS {
        return Err(TaskLabelPersistenceError::NameTooLong {
            max_chars: MAX_TASK_LABEL_NAME_CHARS,
            actual_chars,
        });
    }
    Ok(trimmed.to_string())
}

fn require_task_project(conn: &rusqlite::Connection, task_id: &str) -> TaskLabelResult<String> {
    match task_project_id(conn, task_id)? {
        Some(Some(project_id)) => Ok(project_id),
        Some(None) => Err(TaskLabelPersistenceError::TaskProjectRequired(
            task_id.to_string(),
        )),
        None => Err(TaskLabelPersistenceError::TaskNotFound(task_id.to_string())),
    }
}

fn create_or_load_task_labels<S: AsRef<str>>(
    conn: &rusqlite::Connection,
    project_id: &str,
    label_names: &[S],
) -> TaskLabelResult<Vec<TaskLabelRow>> {
    let mut labels = Vec::new();
    let mut seen = Vec::new();
    for label_name in label_names {
        let name = normalize_label_name(label_name.as_ref())?;
        let key = name.to_lowercase();
        if seen.iter().any(|existing| existing == &key) {
            continue;
        }

        let label_id = if let Some(existing) = conn
            .query_row(
                "SELECT id FROM task_labels WHERE project_id = ?1 AND name_normalized = ?2",
                rusqlite::params![project_id, &key],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
        {
            existing
        } else {
            let now = super::current_unix_timestamp()?;
            conn.execute(
                "INSERT INTO task_labels (project_id, name, name_normalized, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![project_id, &name, &key, now, now],
            )?;
            conn.last_insert_rowid()
        };

        labels.push(
            query_task_label_by_id(conn, label_id)?
                .ok_or(TaskLabelPersistenceError::LabelNotFound(label_id))?,
        );
        seen.push(key);
    }
    Ok(labels)
}

pub(super) fn persist_new_task_labels(
    conn: &rusqlite::Connection,
    task_id: &str,
    label_names: &[String],
    now: i64,
) -> TaskLabelResult<Vec<TaskLabelRow>> {
    let project_id = require_task_project(conn, task_id)?;

    let labels = create_or_load_task_labels(conn, &project_id, label_names)?;

    for label in &labels {
        conn.execute(
            "INSERT INTO task_label_assignments (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, label.id, now],
        )?;
    }
    if !labels.is_empty() {
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
    }
    Ok(labels)
}

fn query_task_label_by_id(
    conn: &rusqlite::Connection,
    label_id: i64,
) -> Result<Option<TaskLabelRow>> {
    conn.query_row(
        "SELECT id, project_id, name FROM task_labels WHERE id = ?1",
        [label_id],
        decode_task_label,
    )
    .optional()
}

impl Database {
    /// Lists the labels defined for a project.
    ///
    /// # Errors
    ///
    /// Returns a database error if the connection cannot be locked or the labels cannot be read.
    pub fn get_project_task_labels(&self, project_id: &str) -> Result<Vec<TaskLabelRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name FROM task_labels WHERE project_id = ?1 ORDER BY name COLLATE NOCASE ASC, id ASC",
        )?;
        let rows = stmt.query_map([project_id], decode_task_label)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Creates a project label or returns the existing case-insensitive match.
    ///
    /// # Errors
    ///
    /// Returns an error if `name` is blank or longer than the supported limit, or if the
    /// database operation fails.
    ///
    /// # Panics
    ///
    /// Panics if the internal label creation routine returns no label for the single requested
    /// name.
    pub fn create_task_label(&self, project_id: &str, name: &str) -> TaskLabelResult<TaskLabelRow> {
        let conn = self.lock_conn()?;
        Ok(create_or_load_task_labels(&conn, project_id, &[name])?
            .into_iter()
            .next()
            .expect("one label name yields one label"))
    }

    /// Creates or finds a label in the task's project and assigns it to the task.
    ///
    /// # Errors
    ///
    /// Returns an error if the task is missing or has no project, the label name is invalid,
    /// the task and label projects differ, or the database operation fails.
    ///
    /// # Panics
    ///
    /// Panics if the internal label creation routine returns no label for the single requested
    /// name.
    pub fn add_task_label(&self, task_id: &str, label_name: &str) -> TaskLabelResult<TaskLabelRow> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let project_id = require_task_project(&tx, task_id)?;
        let label = create_or_load_task_labels(&tx, &project_id, &[label_name])?
            .into_iter()
            .next()
            .expect("one label name yields one label");
        let task_project = require_task_project(&tx, task_id)?;
        if task_project != label.project_id {
            return Err(TaskLabelPersistenceError::CrossProjectAssignment {
                task_id: task_id.to_string(),
                label_id: label.id,
            });
        }
        let now = super::current_unix_timestamp()?;
        tx.execute(
            "INSERT OR IGNORE INTO task_label_assignments (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, label.id, now],
        )?;
        tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        tx.commit()?;
        Ok(label)
    }

    /// Removes a label assignment from a task.
    ///
    /// # Errors
    ///
    /// Returns an error if the task does not exist or the database operation fails.
    pub fn remove_task_label(&self, task_id: &str, label_id: i64) -> TaskLabelResult<()> {
        let conn = self.lock_conn()?;
        if task_project_id(&conn, task_id)?.is_none() {
            return Err(TaskLabelPersistenceError::TaskNotFound(task_id.to_string()));
        }
        conn.execute(
            "DELETE FROM task_label_assignments WHERE task_id = ?1 AND label_id = ?2",
            rusqlite::params![task_id, label_id],
        )?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        Ok(())
    }

    /// Deletes a project label and all of its task assignments.
    ///
    /// Returns the IDs of tasks whose assignments were removed.
    ///
    /// # Errors
    ///
    /// Returns an error if the label does not exist or the database operation fails.
    pub fn delete_task_label(&self, label_id: i64) -> TaskLabelResult<Vec<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT task_id FROM task_label_assignments WHERE label_id = ?1 ORDER BY task_id ASC",
        )?;
        let rows = stmt.query_map([label_id], |row| row.get(0))?;
        let mut affected_task_ids = Vec::new();
        for row in rows {
            affected_task_ids.push(row?);
        }
        drop(stmt);

        let now = super::current_unix_timestamp()?;
        for task_id in &affected_task_ids {
            conn.execute(
                "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, task_id],
            )?;
        }

        let deleted = conn.execute("DELETE FROM task_labels WHERE id = ?1", [label_id])?;
        if deleted == 0 {
            return Err(TaskLabelPersistenceError::LabelNotFound(label_id));
        }
        Ok(affected_task_ids)
    }

    /// Replaces all label assignments for a task.
    ///
    /// Label names are normalized and matched case-insensitively within the task's project.
    ///
    /// # Errors
    ///
    /// Returns an error if the task is missing or has no project, a label name is invalid, or
    /// the database operation fails.
    pub fn set_task_labels(
        &self,
        task_id: &str,
        label_names: &[String],
    ) -> TaskLabelResult<Vec<TaskLabelRow>> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let project_id = require_task_project(&tx, task_id)?;

        let labels = create_or_load_task_labels(&tx, &project_id, label_names)?;

        tx.execute(
            "DELETE FROM task_label_assignments WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        let now = super::current_unix_timestamp()?;
        for label in &labels {
            tx.execute(
                "INSERT INTO task_label_assignments (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, label.id, now],
            )?;
        }
        tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        tx.commit()?;
        Ok(labels)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{test_helpers::*, TaskLabelPersistenceError};

    #[test]
    fn test_task_labels_are_project_scoped_case_insensitive_and_return_with_tasks() {
        let (db, _temp_dir) = make_test_db("task_labels_round_trip");
        db.set_config("task_id_prefix", "T")
            .expect("set task id prefix");
        let project_a = db
            .create_project("A", "/tmp/labels-a")
            .expect("create project a");
        let project_b = db
            .create_project("B", "/tmp/labels-b")
            .expect("create project b");
        let task_a = db
            .create_task("A task", "backlog", Some(&project_a.id), None, None)
            .expect("create task a");
        let task_b = db
            .create_task("B task", "backlog", Some(&project_b.id), None, None)
            .expect("create task b");

        let first = db.add_task_label(&task_a.id, "  Bug  ").expect("add bug");
        let duplicate = db
            .add_task_label(&task_a.id, "bug")
            .expect("add duplicate bug");
        let other_project = db
            .add_task_label(&task_b.id, "bug")
            .expect("add project b bug");

        assert_eq!(first.id, duplicate.id);
        assert_eq!(first.name, "Bug");
        assert_ne!(first.id, other_project.id);

        let retrieved = db
            .get_task(&task_a.id)
            .expect("get task")
            .expect("task should exist");
        assert_eq!(retrieved.labels, vec![first.clone()]);

        let project_a_labels = db
            .get_project_task_labels(&project_a.id)
            .expect("get project labels");
        assert_eq!(project_a_labels, vec![first]);

        drop(db);
    }

    #[test]
    fn test_set_task_labels_replaces_assignments_but_keeps_unused_labels() {
        let (db, _temp_dir) = make_test_db("task_labels_replace");
        db.set_config("task_id_prefix", "T")
            .expect("set task id prefix");
        let project = db
            .create_project("A", "/tmp/labels-replace")
            .expect("create project");
        let task = db
            .create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");

        let bug = db.add_task_label(&task.id, "bug").expect("add bug");
        let ui = db.add_task_label(&task.id, "ui").expect("add ui");
        db.set_task_labels(&task.id, &["bug".to_string()])
            .expect("replace labels");

        let retrieved = db
            .get_task(&task.id)
            .expect("get task")
            .expect("task should exist");
        assert_eq!(retrieved.labels, vec![bug]);
        let all_labels = db.get_project_task_labels(&project.id).expect("all labels");
        assert!(all_labels.iter().any(|label| label.id == ui.id));

        drop(db);
    }

    #[test]
    fn test_set_task_labels_normalizes_and_deduplicates_label_names() {
        let (db, _temp_dir) = make_test_db("set_task_labels_normalized");
        db.set_config("task_id_prefix", "T")
            .expect("set task id prefix");
        let project = db
            .create_project("A", "/tmp/set-task-labels-normalized")
            .expect("create project");
        let existing = db
            .create_task_label(&project.id, "Bug")
            .expect("create existing label");
        let task = db
            .create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");
        let labels = [
            "  Bug  ".to_string(),
            "bug".to_string(),
            "BUG".to_string(),
            " UI ".to_string(),
            "ui".to_string(),
        ];

        let assigned = db
            .set_task_labels(&task.id, &labels)
            .expect("set task labels");

        assert_eq!(
            assigned
                .iter()
                .map(|label| label.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Bug", "UI"]
        );
        assert_eq!(assigned[0].id, existing.id);
        assert_eq!(
            db.get_task(&task.id)
                .expect("get task")
                .expect("task should exist")
                .labels,
            assigned
        );

        drop(db);
    }

    #[test]
    fn test_set_task_labels_rolls_back_new_labels_when_assignment_fails() {
        let (db, _temp_dir) = make_test_db("task_labels_assignment_failure");
        db.set_config("task_id_prefix", "T")
            .expect("set task id prefix");
        let project = db
            .create_project("A", "/tmp/labels-assignment-failure")
            .expect("create project");
        let task = db
            .create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");
        let existing = db
            .add_task_label(&task.id, "existing")
            .expect("add existing label");

        let conn = db.connection();
        conn.lock()
            .expect("lock database connection")
            .execute_batch(
                "CREATE TRIGGER fail_task_label_assignment
                 BEFORE INSERT ON task_label_assignments
                 BEGIN SELECT RAISE(ABORT, 'forced assignment failure'); END;",
            )
            .expect("create failure trigger");

        assert!(matches!(
            db.set_task_labels(&task.id, &["new".to_string()]),
            Err(TaskLabelPersistenceError::Storage(_))
        ));

        let task_after_failure = db
            .get_task(&task.id)
            .expect("get task")
            .expect("task should exist");
        assert_eq!(task_after_failure.labels, vec![existing.clone()]);
        assert_eq!(
            db.get_project_task_labels(&project.id)
                .expect("get project labels"),
            vec![existing]
        );

        drop(conn);
        drop(db);
    }

    #[test]
    fn test_delete_task_label_removes_project_label_and_all_assignments() {
        let (db, _temp_dir) = make_test_db("task_labels_delete");
        db.set_config("task_id_prefix", "T")
            .expect("set task id prefix");
        let project = db
            .create_project("A", "/tmp/labels-delete")
            .expect("create project");
        let first_task = db
            .create_task("First", "backlog", Some(&project.id), None, None)
            .expect("create first task");
        let second_task = db
            .create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second task");

        let bug = db.add_task_label(&first_task.id, "bug").expect("add bug");
        db.add_task_label(&second_task.id, "bug")
            .expect("add bug to second task");
        let ui = db.add_task_label(&second_task.id, "ui").expect("add ui");

        db.delete_task_label(bug.id).expect("delete bug label");

        let project_labels = db
            .get_project_task_labels(&project.id)
            .expect("project labels");
        assert_eq!(project_labels, vec![ui.clone()]);
        assert!(db
            .get_task(&first_task.id)
            .expect("get first task")
            .expect("first task should exist")
            .labels
            .is_empty());
        assert_eq!(
            db.get_task(&second_task.id)
                .expect("get second task")
                .expect("second task should exist")
                .labels,
            vec![ui]
        );
        assert!(matches!(
            db.delete_task_label(bug.id),
            Err(TaskLabelPersistenceError::LabelNotFound(label_id)) if label_id == bug.id
        ));

        drop(db);
    }

    #[test]
    fn test_task_label_validation_rejects_blank_long_projectless_and_missing_tasks() {
        let (db, _temp_dir) = make_test_db("task_label_validation");
        let projectless = db
            .create_task("Projectless", "backlog", None, None, None)
            .expect("create projectless task");
        let project = db
            .create_project("A", "/tmp/labels-validation")
            .expect("create project");

        assert!(matches!(
            db.create_task_label(&project.id, "   "),
            Err(TaskLabelPersistenceError::BlankName)
        ));
        assert!(matches!(
            db.create_task_label(&project.id, &"x".repeat(41)),
            Err(TaskLabelPersistenceError::NameTooLong {
                max_chars: 40,
                actual_chars: 41,
            })
        ));
        assert!(matches!(
            db.add_task_label(&projectless.id, "bug"),
            Err(TaskLabelPersistenceError::TaskProjectRequired(task_id))
                if task_id == projectless.id
        ));
        assert!(matches!(
            db.add_task_label("T-missing", "bug"),
            Err(TaskLabelPersistenceError::TaskNotFound(task_id))
                if task_id == "T-missing"
        ));
        drop(db);
    }

    #[test]
    fn test_add_task_label_rolls_back_new_label_when_assignment_fails() {
        let (db, _temp_dir) = make_test_db("add_task_label_assignment_failure");
        let project = db
            .create_project("A", "/tmp/add-label-assignment-failure")
            .expect("create project");
        let task = db
            .create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");
        let conn = db.connection();
        conn.lock()
            .expect("lock database connection")
            .execute_batch(
                "CREATE TRIGGER fail_add_task_label_assignment
                 BEFORE INSERT ON task_label_assignments
                 BEGIN SELECT RAISE(ABORT, 'forced assignment failure'); END;",
            )
            .expect("create failure trigger");

        assert!(matches!(
            db.add_task_label(&task.id, "new"),
            Err(TaskLabelPersistenceError::Storage(_))
        ));
        assert!(db
            .get_project_task_labels(&project.id)
            .expect("get project labels")
            .is_empty());

        drop(conn);
        drop(db);
    }

    #[test]
    fn test_remove_task_label_rejects_missing_task() {
        let (db, _temp_dir) = make_test_db("remove_task_label_missing_task");

        assert!(matches!(
            db.remove_task_label("T-missing", 1),
            Err(TaskLabelPersistenceError::TaskNotFound(task_id))
                if task_id == "T-missing"
        ));
        drop(db);
    }

    #[test]
    fn test_add_task_label_rejects_cross_project_assignment() {
        let (db, _temp_dir) = make_test_db("task_label_cross_project_assignment");
        let project_a = db
            .create_project("A", "/tmp/labels-cross-project-a")
            .expect("create project a");
        let project_b = db
            .create_project("B", "/tmp/labels-cross-project-b")
            .expect("create project b");
        let task = db
            .create_task("Task", "backlog", Some(&project_a.id), None, None)
            .expect("create task");
        let conn = db.connection();
        conn.lock()
            .expect("lock database connection")
            .execute_batch(&format!(
                "CREATE TRIGGER move_task_to_other_project
                 AFTER INSERT ON task_labels
                 BEGIN
                     UPDATE tasks SET project_id = '{}' WHERE id = '{}';
                 END;",
                project_b.id, task.id
            ))
            .expect("create project-change trigger");

        assert!(matches!(
            db.add_task_label(&task.id, "bug"),
            Err(TaskLabelPersistenceError::CrossProjectAssignment {
                task_id,
                label_id: _,
            }) if task_id == task.id
        ));

        drop(conn);
        drop(db);
    }
}
