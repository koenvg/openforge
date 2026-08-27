use rusqlite::Result;

/// project_config keys that participate in the unified settings hierarchy and are
/// therefore cleared by "Default to global settings".
pub const HIERARCHY_PROJECT_CONFIG_KEYS: &[&str] = &[
    "task_display_title_metadata_updates_enabled",
    "ai_provider",
    "use_worktrees",
    "task_id_prefix",
    "github_poll_interval",
    "pr_walkthrough_prompt",
];

impl super::Database {
    /// Clear this project's overrides for the unified settings so it re-inherits global.
    pub fn reset_project_settings_to_global(&self, project_id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        for key in HIERARCHY_PROJECT_CONFIG_KEYS {
            conn.execute(
                "DELETE FROM project_config WHERE project_id = ?1 AND key = ?2",
                [project_id, key],
            )?;
        }
        conn.execute(
            "DELETE FROM project_plugins WHERE project_id = ?1",
            [project_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;

    #[test]
    fn test_reset_clears_project_overrides_only() {
        let (db, _temp_dir) = make_test_db("reset_settings");
        let project = db.create_project("P", "/tmp/p").unwrap();
        db.set_project_config(
            &project.id,
            "task_display_title_metadata_updates_enabled",
            "true",
        )
        .unwrap();
        db.set_project_config(&project.id, "additional_instructions", "keep me")
            .unwrap();

        db.reset_project_settings_to_global(&project.id).unwrap();

        // Hierarchy key cleared -> inherits (None).
        assert_eq!(
            db.get_project_config(&project.id, "task_display_title_metadata_updates_enabled")
                .unwrap(),
            None
        );
        // Non-hierarchy project config is untouched.
        assert_eq!(
            db.get_project_config(&project.id, "additional_instructions")
                .unwrap(),
            Some("keep me".to_string())
        );

        drop(db);
    }
}
