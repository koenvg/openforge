use super::{tasks::task_project_id, Database};
use rusqlite::{OptionalExtension, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskLabelRow {
    pub id: i64,
    pub project_id: String,
    pub name: String,
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
    let rows = stmt.query_map([task_id], |row| {
        Ok(TaskLabelRow {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn normalize_label_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "label name is required".to_string(),
        ));
    }
    if trimmed.chars().count() > 40 {
        return Err(rusqlite::Error::InvalidParameterName(
            "label names must be 40 characters or fewer".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn create_task_label_on_connection(
    conn: &rusqlite::Connection,
    project_id: &str,
    name: &str,
) -> Result<TaskLabelRow> {
    let name = normalize_label_name(name)?;
    let key = name.to_lowercase();

    if let Some(existing) = conn
        .query_row(
            "SELECT id FROM task_labels WHERE project_id = ?1 AND name_normalized = ?2",
            rusqlite::params![project_id, key],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
    {
        return query_task_label_by_id(conn, existing)?.ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!("label {existing} does not exist"))
        });
    }

    let now = super::current_unix_timestamp()?;
    conn.execute(
        "INSERT INTO task_labels (project_id, name, name_normalized, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![project_id, name, key, now, now],
    )?;
    let label_id = conn.last_insert_rowid();
    query_task_label_by_id(conn, label_id)?.ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!("label {label_id} does not exist"))
    })
}

pub(super) fn persist_new_task_labels(
    conn: &rusqlite::Connection,
    task_id: &str,
    label_names: &[String],
    now: i64,
) -> Result<Vec<TaskLabelRow>> {
    let project_id = task_project_id(conn, task_id)?.flatten().ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!(
            "task {task_id} must belong to a project before labels can be assigned"
        ))
    })?;

    let mut labels = Vec::new();
    let mut seen = Vec::new();
    for label_name in label_names {
        let key = normalized_label_key(label_name)?;
        if seen.iter().any(|existing| existing == &key) {
            continue;
        }
        seen.push(key);
        labels.push(create_task_label_on_connection(
            conn,
            &project_id,
            label_name,
        )?);
    }

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

fn normalized_label_key(name: &str) -> Result<String> {
    Ok(normalize_label_name(name)?.to_lowercase())
}

fn query_task_label_by_id(
    conn: &rusqlite::Connection,
    label_id: i64,
) -> Result<Option<TaskLabelRow>> {
    conn.query_row(
        "SELECT id, project_id, name FROM task_labels WHERE id = ?1",
        [label_id],
        |row| {
            Ok(TaskLabelRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
            })
        },
    )
    .optional()
}

impl Database {
    pub fn get_project_task_labels(&self, project_id: &str) -> Result<Vec<TaskLabelRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name FROM task_labels WHERE project_id = ?1 ORDER BY name COLLATE NOCASE ASC, id ASC",
        )?;
        let rows = stmt.query_map([project_id], |row| {
            Ok(TaskLabelRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn create_task_label(&self, project_id: &str, name: &str) -> Result<TaskLabelRow> {
        let conn = self.lock_conn()?;
        create_task_label_on_connection(&conn, project_id, name)
    }

    pub fn add_task_label(&self, task_id: &str, label_name: &str) -> Result<TaskLabelRow> {
        let conn = self.lock_conn()?;
        let project_id = task_project_id(&conn, task_id)?
            .ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(format!("task {task_id} does not exist"))
            })?
            .ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(format!(
                    "task {task_id} must belong to a project before labels can be assigned"
                ))
            })?;
        drop(conn);

        let label = self.create_task_label(&project_id, label_name)?;
        let conn = self.lock_conn()?;
        let task_project = task_project_id(&conn, task_id)?.flatten().ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!(
                "task {task_id} must belong to a project before labels can be assigned"
            ))
        })?;
        if task_project != label.project_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "label must belong to the same project as the task".to_string(),
            ));
        }
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "INSERT OR IGNORE INTO task_label_assignments (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, label.id, now],
        )?;
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        Ok(label)
    }

    pub fn remove_task_label(&self, task_id: &str, label_id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        task_project_id(&conn, task_id)?.ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!("task {task_id} does not exist"))
        })?;
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

    pub fn delete_task_label(&self, label_id: i64) -> Result<Vec<String>> {
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
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "label {label_id} does not exist"
            )));
        }
        Ok(affected_task_ids)
    }

    pub fn set_task_labels(
        &self,
        task_id: &str,
        label_names: &[String],
    ) -> Result<Vec<TaskLabelRow>> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;
        let project_id = task_project_id(&tx, task_id)?
            .ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(format!("task {task_id} does not exist"))
            })?
            .ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(format!(
                    "task {task_id} must belong to a project before labels can be assigned"
                ))
            })?;

        let mut labels = Vec::new();
        let mut seen = Vec::new();
        for label_name in label_names {
            let key = normalized_label_key(label_name)?;
            if seen.iter().any(|existing| existing == &key) {
                continue;
            }
            seen.push(key);
            labels.push(create_task_label_on_connection(
                &tx,
                &project_id,
                label_name,
            )?);
        }

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
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_task_labels_are_project_scoped_case_insensitive_and_return_with_tasks() {
        let (db, path) = make_test_db("task_labels_round_trip");
        db.set_config("task_id_prefix", "T").unwrap();
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

        let retrieved = db.get_task(&task_a.id).expect("get task").unwrap();
        assert_eq!(retrieved.labels, vec![first.clone()]);

        let project_a_labels = db
            .get_project_task_labels(&project_a.id)
            .expect("get project labels");
        assert_eq!(project_a_labels, vec![first]);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_set_task_labels_replaces_assignments_but_keeps_unused_labels() {
        let (db, path) = make_test_db("task_labels_replace");
        db.set_config("task_id_prefix", "T").unwrap();
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

        let retrieved = db.get_task(&task.id).expect("get task").unwrap();
        assert_eq!(retrieved.labels, vec![bug]);
        let all_labels = db.get_project_task_labels(&project.id).expect("all labels");
        assert!(all_labels.iter().any(|label| label.id == ui.id));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_set_task_labels_rolls_back_new_labels_when_assignment_fails() {
        let (db, path) = make_test_db("task_labels_assignment_failure");
        db.set_config("task_id_prefix", "T").unwrap();
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
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER fail_task_label_assignment
                 BEFORE INSERT ON task_label_assignments
                 BEGIN SELECT RAISE(ABORT, 'forced assignment failure'); END;",
            )
            .expect("create failure trigger");

        assert!(db.set_task_labels(&task.id, &["new".to_string()]).is_err());

        let task_after_failure = db.get_task(&task.id).expect("get task").unwrap();
        assert_eq!(task_after_failure.labels, vec![existing.clone()]);
        assert_eq!(
            db.get_project_task_labels(&project.id)
                .expect("get project labels"),
            vec![existing]
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_delete_task_label_removes_project_label_and_all_assignments() {
        let (db, path) = make_test_db("task_labels_delete");
        db.set_config("task_id_prefix", "T").unwrap();
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
            .unwrap()
            .labels
            .is_empty());
        assert_eq!(
            db.get_task(&second_task.id)
                .expect("get second task")
                .unwrap()
                .labels,
            vec![ui]
        );
        assert!(db.delete_task_label(bug.id).is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_label_validation_rejects_blank_long_projectless_and_missing_tasks() {
        let (db, path) = make_test_db("task_label_validation");
        let projectless = db
            .create_task("Projectless", "backlog", None, None, None)
            .expect("create projectless task");
        let project = db
            .create_project("A", "/tmp/labels-validation")
            .expect("create project");

        assert!(db.create_task_label(&project.id, "   ").is_err());
        assert!(db.create_task_label(&project.id, &"x".repeat(41)).is_err());
        assert!(db.add_task_label(&projectless.id, "bug").is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_remove_task_label_rejects_missing_task() {
        let (db, path) = make_test_db("remove_task_label_missing_task");

        assert!(db.remove_task_label("T-missing", 1).is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
