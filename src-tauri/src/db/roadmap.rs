use rusqlite::{OptionalExtension, Result};
use std::collections::HashMap;

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs() as i64
}

impl super::Database {
    /// Get all per-issue roadmap values for a project, keyed by issue number.
    ///
    /// Rows whose `value` is NULL are skipped: a cleared value is equivalent to
    /// having no entry, so the map only contains issues with an active value.
    pub fn get_roadmap_values(&self, project_id: &str) -> Result<HashMap<i64, i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT issue_number, value FROM roadmap_item_value
             WHERE project_id = ?1 AND value IS NOT NULL",
        )?;
        let rows = stmt.query_map([project_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut result = HashMap::new();
        for row in rows {
            let (issue_number, value) = row?;
            result.insert(issue_number, value);
        }
        Ok(result)
    }

    /// Set (or clear) the roadmap value for a single issue.
    ///
    /// `value` of `Some(n)` upserts the value (the DB CHECK enforces 1..=10);
    /// `None` clears it by deleting the row, so it no longer appears in
    /// [`get_roadmap_values`].
    pub fn set_roadmap_value(
        &self,
        project_id: &str,
        issue_number: i64,
        value: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        match value {
            Some(value) => {
                conn.execute(
                    "INSERT INTO roadmap_item_value (project_id, issue_number, value, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(project_id, issue_number)
                     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    rusqlite::params![project_id, issue_number, value, now_unix()],
                )?;
            }
            None => {
                conn.execute(
                    "DELETE FROM roadmap_item_value WHERE project_id = ?1 AND issue_number = ?2",
                    rusqlite::params![project_id, issue_number],
                )?;
            }
        }
        Ok(())
    }

    /// Get the curated column labels for a project, in display order.
    ///
    /// Stored as a JSON array of label-name strings. Returns an empty vector when
    /// the project has no config row yet.
    pub fn get_roadmap_column_labels(&self, project_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row(
                "SELECT column_labels FROM roadmap_repo_config WHERE project_id = ?1",
                [project_id],
                |row| row.get(0),
            )
            .optional()?;

        let Some(raw) = raw else {
            return Ok(Vec::new());
        };

        serde_json::from_str::<Vec<String>>(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })
    }

    /// Like [`Database::get_roadmap_column_labels`] but distinguishes a missing
    /// config row (`Ok(None)` — the board has never been opened for this
    /// project) from an explicitly-empty curated set (`Ok(Some(vec![]))` — the
    /// user cleared all columns). Used to seed initial columns only on first open.
    pub fn get_roadmap_column_labels_opt(&self, project_id: &str) -> Result<Option<Vec<String>>> {
        let conn = self.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row(
                "SELECT column_labels FROM roadmap_repo_config WHERE project_id = ?1",
                [project_id],
                |row| row.get(0),
            )
            .optional()?;

        let Some(raw) = raw else {
            return Ok(None);
        };

        serde_json::from_str::<Vec<String>>(&raw)
            .map(Some)
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })
    }

    /// Persist the curated column labels for a project, in display order.
    ///
    /// Encodes the labels as a JSON array of strings and upserts the config row,
    /// preserving any existing `last_opened_at`.
    pub fn set_roadmap_column_labels(&self, project_id: &str, labels: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let encoded = serde_json::to_string(labels)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "INSERT INTO roadmap_repo_config (project_id, column_labels)
             VALUES (?1, ?2)
             ON CONFLICT(project_id)
             DO UPDATE SET column_labels = excluded.column_labels",
            rusqlite::params![project_id, encoded],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    fn project_id(db: &crate::db::Database) -> String {
        db.create_project("Roadmap Project", "/tmp/roadmap")
            .expect("create project")
            .id
    }

    #[test]
    fn test_set_get_and_clear_roadmap_value_round_trip() {
        let (db, path) = make_test_db("roadmap_value_round_trip");
        let project = project_id(&db);

        // No values initially.
        let values = db.get_roadmap_values(&project).expect("get values");
        assert!(values.is_empty());

        // Set values for two issues.
        db.set_roadmap_value(&project, 7, Some(5)).expect("set 7");
        db.set_roadmap_value(&project, 9, Some(10)).expect("set 9");

        let values = db.get_roadmap_values(&project).expect("get values");
        assert_eq!(values.get(&7), Some(&5));
        assert_eq!(values.get(&9), Some(&10));
        assert_eq!(values.len(), 2);

        // Update an existing value.
        db.set_roadmap_value(&project, 7, Some(3))
            .expect("update 7");
        let values = db.get_roadmap_values(&project).expect("get values");
        assert_eq!(values.get(&7), Some(&3));

        // Clearing removes the entry from the map.
        db.set_roadmap_value(&project, 7, None).expect("clear 7");
        let values = db.get_roadmap_values(&project).expect("get values");
        assert_eq!(values.get(&7), None);
        assert_eq!(values.get(&9), Some(&10));
        assert_eq!(values.len(), 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_roadmap_values_are_project_scoped() {
        let (db, path) = make_test_db("roadmap_value_project_scoped");
        let project_a = db
            .create_project("A", "/tmp/roadmap-a")
            .expect("create a")
            .id;
        let project_b = db
            .create_project("B", "/tmp/roadmap-b")
            .expect("create b")
            .id;

        db.set_roadmap_value(&project_a, 1, Some(4)).expect("set a");
        db.set_roadmap_value(&project_b, 1, Some(8)).expect("set b");

        let values_a = db.get_roadmap_values(&project_a).expect("get a");
        let values_b = db.get_roadmap_values(&project_b).expect("get b");
        assert_eq!(values_a.get(&1), Some(&4));
        assert_eq!(values_b.get(&1), Some(&8));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_roadmap_value_check_constraint_rejects_out_of_range() {
        let (db, path) = make_test_db("roadmap_value_check");
        let project = project_id(&db);

        // Boundaries are accepted.
        db.set_roadmap_value(&project, 1, Some(1)).expect("min ok");
        db.set_roadmap_value(&project, 2, Some(10)).expect("max ok");

        // Out-of-range values are rejected by the CHECK constraint.
        assert!(db.set_roadmap_value(&project, 3, Some(0)).is_err());
        assert!(db.set_roadmap_value(&project, 4, Some(11)).is_err());
        assert!(db.set_roadmap_value(&project, 5, Some(-1)).is_err());

        // The rejected rows must not have been persisted.
        let values = db.get_roadmap_values(&project).expect("get values");
        assert_eq!(values.len(), 2);
        assert_eq!(values.get(&1), Some(&1));
        assert_eq!(values.get(&2), Some(&10));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_column_labels_persist_and_encode_as_json() {
        let (db, path) = make_test_db("roadmap_column_labels");
        let project = project_id(&db);

        // Defaults to empty before any config row exists.
        let labels = db.get_roadmap_column_labels(&project).expect("get empty");
        assert!(labels.is_empty());

        let desired = vec!["Now".to_string(), "Next".to_string(), "Later".to_string()];
        db.set_roadmap_column_labels(&project, &desired)
            .expect("set labels");

        let labels = db.get_roadmap_column_labels(&project).expect("get labels");
        assert_eq!(labels, desired);

        // Verify on-disk encoding is a JSON array (not a comma-joined blob).
        let conn = db.connection();
        let raw: String = conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT column_labels FROM roadmap_repo_config WHERE project_id = ?1",
                [&project],
                |row| row.get(0),
            )
            .expect("read raw column_labels");
        let decoded: Vec<String> =
            serde_json::from_str(&raw).expect("stored column_labels must be a JSON array");
        assert_eq!(decoded, desired);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_set_column_labels_replaces_previous_order() {
        let (db, path) = make_test_db("roadmap_column_labels_replace");
        let project = project_id(&db);

        db.set_roadmap_column_labels(&project, &["A".to_string(), "B".to_string()])
            .expect("set first");
        db.set_roadmap_column_labels(&project, &["B".to_string(), "C".to_string()])
            .expect("set second");

        let labels = db.get_roadmap_column_labels(&project).expect("get labels");
        assert_eq!(labels, vec!["B".to_string(), "C".to_string()]);

        // Clearing to an empty list is supported.
        db.set_roadmap_column_labels(&project, &[]).expect("clear");
        let labels = db.get_roadmap_column_labels(&project).expect("get cleared");
        assert!(labels.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_column_labels_opt_distinguishes_missing_row_from_cleared() {
        let (db, path) = make_test_db("roadmap_column_labels_opt");
        let project = project_id(&db);

        // No config row yet -> None (first open, eligible for seeding).
        assert_eq!(
            db.get_roadmap_column_labels_opt(&project).expect("opt none"),
            None
        );

        // Seeding writes a row -> Some(...), so subsequent opens are not re-seeded.
        db.set_roadmap_column_labels(&project, &["bug".to_string()])
            .expect("seed");
        assert_eq!(
            db.get_roadmap_column_labels_opt(&project).expect("opt some"),
            Some(vec!["bug".to_string()])
        );

        // A user clearing all columns keeps the row -> Some(vec![]), never re-seeded.
        db.set_roadmap_column_labels(&project, &[]).expect("clear");
        assert_eq!(
            db.get_roadmap_column_labels_opt(&project).expect("opt empty"),
            Some(Vec::new())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
