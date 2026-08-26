use rusqlite::Result;
use std::collections::HashMap;

impl super::Database {
    fn project_config_value(
        conn: &rusqlite::Connection,
        project_id: &str,
        key: &str,
    ) -> Result<Option<String>> {
        let mut stmt =
            conn.prepare("SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([project_id, key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    fn write_project_config_value(
        conn: &rusqlite::Connection,
        project_id: &str,
        key: &str,
        value: &str,
    ) -> Result<()> {
        conn.execute(
            "INSERT OR REPLACE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            [project_id, key, value],
        )?;
        Ok(())
    }

    /// Get a project config value
    pub fn get_project_config(&self, project_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        Self::project_config_value(&conn, project_id, key)
    }

    /// Set a project config value
    pub fn set_project_config(&self, project_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        Self::write_project_config_value(&conn, project_id, key, value)
    }

    /// Atomically read and update a project config value under one connection lock.
    ///
    /// The callback runs while the connection is locked and must not call other database methods.
    ///
    /// # Errors
    ///
    /// Returns an error if locking, reading, or writing the database fails, or if the callback
    /// rejects the update.
    pub fn update_project_config<T>(
        &self,
        project_id: &str,
        key: &str,
        update: impl FnOnce(Option<&str>) -> Result<(String, T)>,
    ) -> Result<T> {
        let conn = self.lock_conn()?;
        let stored = Self::project_config_value(&conn, project_id, key)?;
        let (value, result) = update(stored.as_deref())?;
        Self::write_project_config_value(&conn, project_id, key, &value)?;
        Ok(result)
    }

    /// Clear an explicit project config value so callers inherit its global default.
    pub fn clear_project_config(&self, project_id: &str, key: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM project_config WHERE project_id = ?1 AND key = ?2",
            [project_id, key],
        )?;
        Ok(())
    }

    /// Get all config values for a project
    pub fn get_all_project_config(&self, project_id: &str) -> Result<HashMap<String, String>> {
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT key, value FROM project_config WHERE project_id = ?1")?;
        let rows = stmt.query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?;

        let mut result = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            result.insert(key, value);
        }
        Ok(result)
    }

    /// Resolve the AI provider for a project.
    /// Checks project_config first, falls back to global config, then defaults to "claude-code".
    ///
    /// # Errors
    /// Returns an error when a project or global configuration lookup fails.
    pub fn try_resolve_ai_provider(&self, project_id: &str) -> Result<String> {
        if !project_id.is_empty() {
            if let Some(provider) = self.get_project_config(project_id, "ai_provider")? {
                if !provider.is_empty() {
                    return Ok(provider);
                }
            }
        }
        Ok(self
            .get_config("ai_provider")?
            .unwrap_or_else(|| "claude-code".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_project_config_operations() {
        let (db, _temp_dir) = make_test_db("project_config");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "custom_repo_hint", "owner/repo")
            .expect("Failed to set custom_repo_hint");
        db.set_project_config(&project.id, "custom_setting", "value123")
            .expect("Failed to set custom_setting");

        let repo_hint = db
            .get_project_config(&project.id, "custom_repo_hint")
            .expect("Failed to get custom_repo_hint");
        assert_eq!(repo_hint, Some("owner/repo".to_string()));

        let setting = db
            .get_project_config(&project.id, "custom_setting")
            .expect("Failed to get custom_setting");
        assert_eq!(setting, Some("value123".to_string()));

        let nonexistent = db
            .get_project_config(&project.id, "nonexistent")
            .expect("Failed to query nonexistent");
        assert_eq!(nonexistent, None);

        drop(db);
    }

    #[test]
    fn concurrent_project_config_updates_preserve_each_change() {
        let (db, _temp_dir) = make_test_db("concurrent_project_config_updates");
        let project_id = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project")
            .id;
        let db = std::sync::Arc::new(db);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));

        let handles = (0..8)
            .map(|index| {
                let db = std::sync::Arc::clone(&db);
                let barrier = std::sync::Arc::clone(&barrier);
                let project_id = project_id.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    db.update_project_config(&project_id, "workers", |stored| {
                        let mut workers = stored
                            .unwrap_or_default()
                            .split(',')
                            .filter(|worker| !worker.is_empty())
                            .map(str::to_owned)
                            .collect::<Vec<_>>();
                        std::thread::sleep(std::time::Duration::from_millis(5));
                        workers.push(index.to_string());
                        Ok((workers.join(","), ()))
                    })
                    .expect("update project config");
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("join config update");
        }

        let mut workers = db
            .get_project_config(&project_id, "workers")
            .expect("read project config")
            .expect("stored project config")
            .split(',')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        workers.sort();

        assert_eq!(workers, ["0", "1", "2", "3", "4", "5", "6", "7"]);
    }

    #[test]
    fn test_clear_project_config_restores_inheritance() {
        let (db, _temp_dir) = make_test_db("clear_project_config");
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project");

        db.set_project_config(&project.id, "ai_provider", "codex")
            .expect("set project override");
        db.clear_project_config(&project.id, "ai_provider")
            .expect("clear project override");

        assert_eq!(
            db.get_project_config(&project.id, "ai_provider")
                .expect("read project override"),
            None
        );

        drop(db);
    }

    #[test]
    fn test_global_and_project_config_are_independent() {
        let (db, _temp_dir) = make_test_db("independent_configs");

        db.set_config("github_token", "global-token-456")
            .expect("Failed to set global github_token");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "custom_repo_hint", "owner/repo")
            .expect("Failed to set project custom_repo_hint");

        let global_token = db
            .get_config("github_token")
            .expect("Failed to get global github_token");
        assert_eq!(global_token, Some("global-token-456".to_string()));

        let project_repo_hint = db
            .get_project_config(&project.id, "custom_repo_hint")
            .expect("Failed to get project custom_repo_hint");
        assert_eq!(project_repo_hint, Some("owner/repo".to_string()));

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_uses_project_config() {
        let (db, _temp_dir) = make_test_db("resolve_provider_project");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // Set project-level ai_provider to opencode
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set config failed");

        // Global default is claude-code, but project override should win
        let provider = db
            .try_resolve_ai_provider(&project.id)
            .expect("resolve provider");
        assert_eq!(provider, "opencode");

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_falls_back_to_global() {
        let (db, _temp_dir) = make_test_db("resolve_provider_global");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // No project-level ai_provider set, should fall back to global
        let provider = db
            .try_resolve_ai_provider(&project.id)
            .expect("resolve provider");
        assert_eq!(provider, "claude-code");

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_empty_project_id() {
        let (db, _temp_dir) = make_test_db("resolve_provider_empty");

        // Empty project ID should fall back to global
        let provider = db.try_resolve_ai_provider("").expect("resolve provider");
        assert_eq!(provider, "claude-code");

        drop(db);
    }
}
