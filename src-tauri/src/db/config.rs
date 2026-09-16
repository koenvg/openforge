use rusqlite::Result;
use thiserror::Error;

const RESERVED_SCOPED_AGENT_TASK_PREFIX: &str = "scoped-agent-v1";

#[derive(Debug, Error)]
#[error("Task ID prefix '{0}' is reserved for scoped agent sessions")]
struct ReservedTaskIdPrefix(String);

pub(super) fn validate_config_value(key: &str, value: &str) -> Result<()> {
    if key == "task_id_prefix" && value.eq_ignore_ascii_case(RESERVED_SCOPED_AGENT_TASK_PREFIX) {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            ReservedTaskIdPrefix(value.to_string()),
        )));
    }
    Ok(())
}

impl super::Database {
    /// Get a config value by key
    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a config value
    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        validate_config_value(key, value)?;
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_config_operations() {
        let (db, _temp_dir) = make_test_db("config_ops");

        // Legacy OpenCode server port config is no longer seeded for new databases.
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, None);

        // Test setting config
        db.set_config("custom_port", "8080")
            .expect("Failed to set config");
        let port = db.get_config("custom_port").expect("Failed to get config");
        assert_eq!(port, Some("8080".to_string()));

        // Test non-existent key
        let result = db.get_config("nonexistent").expect("Failed to query");
        assert_eq!(result, None);

        // Clean up
        drop(db);
    }

    #[test]
    fn test_config_set_new_key() {
        let (db, _temp_dir) = make_test_db("config_new_key");

        db.set_config("custom_key", "custom_value")
            .expect("set failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("custom_value".to_string()));

        db.set_config("custom_key", "overwritten")
            .expect("overwrite failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("overwritten".to_string()));

        drop(db);
    }

    #[test]
    fn task_prefix_cannot_enter_the_scoped_agent_key_namespace() {
        let (db, _temp_dir) = make_test_db("config_scoped_agent_prefix");

        let error = db
            .set_config("task_id_prefix", "scoped-agent-v1")
            .expect_err("reserved scoped agent prefix should be rejected");

        assert!(error
            .to_string()
            .contains("reserved for scoped agent sessions"));
        assert_ne!(
            db.get_config("task_id_prefix").expect("read Task prefix"),
            Some("scoped-agent-v1".to_string())
        );
    }
}
