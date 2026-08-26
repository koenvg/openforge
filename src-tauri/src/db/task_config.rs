use rusqlite::Result;
use std::collections::HashMap;

impl super::Database {
    /// Get a task-scoped config value.
    pub fn get_task_config(&self, task_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT value FROM task_config WHERE task_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([task_id, key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a task-scoped config value (upsert).
    pub fn set_task_config(&self, task_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
            [task_id, key, value],
        )?;
        Ok(())
    }

    /// Get all task-scoped config values for a task.
    pub fn get_all_task_config(&self, task_id: &str) -> Result<HashMap<String, String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT key, value FROM task_config WHERE task_id = ?1")?;
        let rows = stmt.query_map([task_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut result = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            result.insert(k, v);
        }
        Ok(result)
    }

    /// Return the project_id for a task, if any.
    pub fn get_task_project_id(&self, task_id: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT project_id FROM tasks WHERE id = ?1")?;
        let mut rows = stmt.query([task_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Resolve a boolean setting for a task: task_config ?? project_config ?? config ?? default.
    ///
    /// # Errors
    /// Returns an error when a Task, Project, or global configuration lookup fails.
    pub fn resolve_task_bool(&self, task_id: &str, key: &str, default: bool) -> Result<bool> {
        if let Some(v) = self.get_task_config(task_id, key)? {
            return Ok(v == "true");
        }
        if let Some(project_id) = self.get_task_project_id(task_id)? {
            if !project_id.is_empty() {
                if let Some(v) = self.get_project_config(&project_id, key)? {
                    return Ok(v == "true");
                }
            }
        }
        if let Some(v) = self.get_config(key)? {
            return Ok(v == "true");
        }
        Ok(default)
    }

    /// Resolve the AI provider for a task: task_config ?? project ?? global ?? claude-code.
    ///
    /// # Errors
    /// Returns an error when a Task, Project, or global configuration lookup fails.
    pub fn resolve_ai_provider_for_task(&self, task_id: &str) -> Result<String> {
        if let Some(v) = self.get_task_config(task_id, "ai_provider")? {
            if !v.is_empty() {
                return Ok(v);
            }
        }
        let project_id = self.get_task_project_id(task_id)?.unwrap_or_default();
        self.try_resolve_ai_provider(&project_id)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_task_config_roundtrip() {
        let (db, _temp_dir) = make_test_db("task_config_rt");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .unwrap();

        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled")
                .unwrap(),
            None
        );
        db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "true")
            .unwrap();
        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled")
                .unwrap(),
            Some("true".to_string())
        );
        db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "false")
            .unwrap();
        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled")
                .unwrap(),
            Some("false".to_string())
        );

        drop(db);
    }

    #[test]
    fn test_resolve_task_bool_precedence() {
        let (db, _temp_dir) = make_test_db("resolve_task_bool");
        let project = db.create_project("P", "/tmp/p").unwrap();
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .unwrap();
        let key = "code_cleanup_tasks_enabled";

        // Nothing set -> default.
        assert!(!db.resolve_task_bool(&task.id, key, false).unwrap());
        // Global on.
        db.set_config(key, "true").unwrap();
        assert!(db.resolve_task_bool(&task.id, key, false).unwrap());
        // Project off beats global.
        db.set_project_config(&project.id, key, "false").unwrap();
        assert!(!db.resolve_task_bool(&task.id, key, false).unwrap());
        // Task on beats project.
        db.set_task_config(&task.id, key, "true").unwrap();
        assert!(db.resolve_task_bool(&task.id, key, false).unwrap());

        drop(db);
    }

    #[test]
    fn test_resolve_ai_provider_for_task_precedence() {
        let (db, _temp_dir) = make_test_db("resolve_provider_task");
        let project = db.create_project("P", "/tmp/p").unwrap();
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .unwrap();

        // Falls back to project resolution (which defaults to claude-code).
        assert_eq!(
            db.resolve_ai_provider_for_task(&task.id).unwrap(),
            "claude-code"
        );
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .unwrap();
        assert_eq!(
            db.resolve_ai_provider_for_task(&task.id).unwrap(),
            "opencode"
        );
        db.set_task_config(&task.id, "ai_provider", "codex")
            .unwrap();
        assert_eq!(db.resolve_ai_provider_for_task(&task.id).unwrap(), "codex");

        drop(db);
    }
}
