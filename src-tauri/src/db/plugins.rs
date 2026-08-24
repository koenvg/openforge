use rusqlite::{OptionalExtension, Result};
use serde::{Deserialize, Serialize};

/// Plugin row from the plugins table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: i64,
    pub description: String,
    pub permissions: String,
    pub contributes: String,
    pub frontend_entry: String,
    pub backend_entry: Option<String>,
    pub install_path: String,
    pub source_kind: String,
    pub source_spec: String,
    pub package_metadata: String,
    pub installed_at: i64,
    pub is_builtin: bool,
}

impl super::Database {
    /// Insert a plugin record. Updates metadata if id already exists.
    pub fn install_plugin(&self, plugin: &PluginRow) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO plugins
                (id, name, version, api_version, description, permissions, contributes,
                 frontend_entry, backend_entry, install_path, source_kind, source_spec,
                 package_metadata, installed_at, is_builtin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                version = excluded.version,
                api_version = excluded.api_version,
                description = excluded.description,
                permissions = excluded.permissions,
                contributes = excluded.contributes,
                frontend_entry = excluded.frontend_entry,
                backend_entry = excluded.backend_entry,
                install_path = excluded.install_path,
                source_kind = excluded.source_kind,
                source_spec = excluded.source_spec,
                package_metadata = excluded.package_metadata,
                installed_at = excluded.installed_at,
                is_builtin = excluded.is_builtin",
            rusqlite::params![
                plugin.id,
                plugin.name,
                plugin.version,
                plugin.api_version,
                plugin.description,
                plugin.permissions,
                plugin.contributes,
                plugin.frontend_entry,
                plugin.backend_entry,
                plugin.install_path,
                plugin.source_kind,
                plugin.source_spec,
                plugin.package_metadata,
                plugin.installed_at,
                plugin.is_builtin as i64,
            ],
        )?;
        Ok(())
    }

    /// Remove a plugin and transactionally enqueue its Task Browser Session purge.
    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<()> {
        let mut conn = self.lock_conn()?;
        let transaction = conn.transaction()?;
        super::browser_session_purges::enqueue_plugin_purge_if_present(&transaction, plugin_id)?;
        transaction.execute("DELETE FROM plugins WHERE id = ?1", [plugin_id])?;
        transaction.commit()?;
        Ok(())
    }

    /// Fetch a single plugin by id.
    pub fn get_plugin(&self, plugin_id: &str) -> Result<Option<PluginRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, version, api_version, description, permissions, contributes,
                    frontend_entry, backend_entry, install_path, source_kind, source_spec,
                    package_metadata, installed_at, is_builtin
             FROM plugins WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([plugin_id], row_to_plugin)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Return all installed plugins ordered by name.
    pub fn list_plugins(&self) -> Result<Vec<PluginRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, version, api_version, description, permissions, contributes,
                    frontend_entry, backend_entry, install_path, source_kind, source_spec,
                    package_metadata, installed_at, is_builtin
             FROM plugins ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], row_to_plugin)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Set the enabled flag for a plugin within a project.
    /// Creates the project_plugins row if it does not exist.
    pub fn set_plugin_enabled(
        &self,
        project_id: &str,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO project_plugins (project_id, plugin_id, enabled)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id, plugin_id) DO UPDATE SET enabled = excluded.enabled",
            rusqlite::params![project_id, plugin_id, enabled as i64],
        )?;
        Ok(())
    }

    /// Set the global default enabled flag for a plugin (upsert).
    pub fn set_global_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO global_plugins (plugin_id, enabled) VALUES (?1, ?2)
             ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled",
            rusqlite::params![plugin_id, enabled as i64],
        )?;
        Ok(())
    }

    /// Return (plugin_id, enabled) for every plugin with an explicit global default.
    pub fn get_global_plugin_defaults(&self) -> Result<Vec<(String, bool)>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT plugin_id, enabled FROM global_plugins")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Persist app-owned plugin enablement independently of project choices.
    pub fn set_app_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<()> {
        let conn = self.lock_conn()?;
        let changed = conn.execute(
            "INSERT INTO app_plugins (plugin_id, enabled)
             SELECT id, ?2 FROM plugins
             WHERE id = ?1 AND json_extract(package_metadata, '$.enablement') = 'app'
             ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled",
            rusqlite::params![plugin_id, enabled as i64],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    /// Return installed plugins whose app-owned lifecycle is enabled.
    pub fn get_enabled_app_plugins(&self) -> Result<Vec<PluginRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.version, p.api_version, p.description, p.permissions,
                    p.contributes, p.frontend_entry, p.backend_entry, p.install_path,
                    p.source_kind, p.source_spec, p.package_metadata, p.installed_at, p.is_builtin
             FROM plugins p
             INNER JOIN app_plugins ap ON ap.plugin_id = p.id
             WHERE ap.enabled = 1
               AND json_extract(p.package_metadata, '$.enablement') = 'app'
             ORDER BY p.name ASC",
        )?;
        let rows = stmt.query_map([], row_to_plugin)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Return all plugins that are enabled for the given project.
    ///
    /// Enablement layers `project_plugins.enabled ?? global_plugins.enabled ??
    /// is_builtin`, so a project inherits the global default when it has no
    /// explicit override, and falls back to the built-in default otherwise.
    pub fn get_enabled_plugins(&self, project_id: &str) -> Result<Vec<PluginRow>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.version, p.api_version, p.description, p.permissions,
                    p.contributes, p.frontend_entry, p.backend_entry, p.install_path,
                    p.source_kind, p.source_spec, p.package_metadata, p.installed_at, p.is_builtin
             FROM plugins p
             LEFT JOIN project_plugins pp ON pp.plugin_id = p.id AND pp.project_id = ?1
             LEFT JOIN global_plugins gp ON gp.plugin_id = p.id
             WHERE COALESCE(json_extract(p.package_metadata, '$.enablement'), 'project') <> 'app'
               AND COALESCE(pp.enabled, gp.enabled, CASE WHEN p.is_builtin = 1 THEN 1 ELSE 0 END) = 1
             ORDER BY p.name ASC",
        )?;
        let rows = stmt.query_map([project_id], row_to_plugin)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Return true if the plugin is enabled for the given project.
    ///
    /// Precedence: `project_plugins.enabled ?? global_plugins.enabled ??
    /// is_builtin`.
    pub fn is_plugin_enabled(&self, project_id: &str, plugin_id: &str) -> Result<bool> {
        let conn = self.lock_conn()?;
        let enabled = conn
            .query_row(
                "SELECT COALESCE(
                        pp.enabled,
                        gp.enabled,
                        CASE WHEN p.is_builtin = 1 THEN 1 ELSE 0 END)
                 FROM plugins p
                 LEFT JOIN project_plugins pp ON pp.plugin_id = p.id AND pp.project_id = ?1
                 LEFT JOIN global_plugins gp ON gp.plugin_id = p.id
                 WHERE p.id = ?2",
                rusqlite::params![project_id, plugin_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        Ok(enabled)
    }

    /// Resolve lifecycle ownership before checking whether a plugin is active in Project context.
    pub fn is_plugin_active_for_project(&self, project_id: &str, plugin_id: &str) -> Result<bool> {
        let conn = self.lock_conn()?;
        let enabled = conn
            .query_row(
                "SELECT CASE
                    WHEN json_extract(p.package_metadata, '$.enablement') = 'app'
                    THEN COALESCE(ap.enabled, 0)
                    ELSE COALESCE(pp.enabled, gp.enabled, CASE WHEN p.is_builtin = 1 THEN 1 ELSE 0 END)
                 END
                 FROM plugins p
                 LEFT JOIN app_plugins ap ON ap.plugin_id = p.id
                 LEFT JOIN project_plugins pp ON pp.plugin_id = p.id AND pp.project_id = ?1
                 LEFT JOIN global_plugins gp ON gp.plugin_id = p.id
                 WHERE p.id = ?2",
                rusqlite::params![project_id, plugin_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        Ok(enabled)
    }

    pub fn get_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        let mut stmt = conn.prepare(
            "SELECT value FROM plugin_storage
             WHERE plugin_id = ?1 AND scope = ?2 AND scope_id = ?3 AND key = ?4",
        )?;
        let mut rows = stmt.query(rusqlite::params![plugin_id, scope, scope_id, key])?;

        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
        value: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        conn.execute(
            "INSERT INTO plugin_storage (plugin_id, scope, scope_id, key, value)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(plugin_id, scope, scope_id, key) DO UPDATE SET value = excluded.value",
            rusqlite::params![plugin_id, scope, scope_id, key, value],
        )?;
        Ok(())
    }

    pub fn delete_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        conn.execute(
            "DELETE FROM plugin_storage
             WHERE plugin_id = ?1 AND scope = ?2 AND scope_id = ?3 AND key = ?4",
            rusqlite::params![plugin_id, scope, scope_id, key],
        )?;
        Ok(())
    }
}

fn normalized_plugin_storage_scope_id<'a>(scope: &str, scope_id: Option<&'a str>) -> &'a str {
    if scope == "global" {
        ""
    } else {
        scope_id.unwrap_or("")
    }
}

fn row_to_plugin(row: &rusqlite::Row<'_>) -> rusqlite::Result<PluginRow> {
    Ok(PluginRow {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        api_version: row.get(3)?,
        description: row.get(4)?,
        permissions: row.get(5)?,
        contributes: row.get(6)?,
        frontend_entry: row.get(7)?,
        backend_entry: row.get(8)?,
        install_path: row.get(9)?,
        source_kind: row.get(10)?,
        source_spec: row.get(11)?,
        package_metadata: row.get(12)?,
        installed_at: row.get(13)?,
        is_builtin: row.get::<_, i64>(14)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;

    fn sample_plugin(id: &str) -> PluginRow {
        PluginRow {
            id: id.to_string(),
            name: format!("Plugin {}", id),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "A test plugin".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "index.js".to_string(),
            backend_entry: None,
            install_path: "/tmp/plugin".to_string(),
            source_kind: "legacy".to_string(),
            source_spec: "".to_string(),
            package_metadata: "{}".to_string(),
            installed_at: 0,
            is_builtin: false,
        }
    }

    fn insert_test_plugin(db: &super::super::Database, id: &str, is_builtin: bool) {
        let mut plugin = sample_plugin(id);
        plugin.is_builtin = is_builtin;
        if is_builtin {
            plugin.source_kind = "builtin".to_string();
        }
        db.install_plugin(&plugin).unwrap();
    }

    #[test]
    fn test_global_plugin_default_layers_under_project() {
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("global_plugin_defaults");
        let project = db.create_project("P", "/tmp/p").unwrap();
        // Insert a NON-builtin plugin (is_builtin = 0) via the existing test insert helper.
        insert_test_plugin(&db, "acme.tool", /* is_builtin */ false);

        // No project row, no global default, not builtin -> disabled.
        assert!(!db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

        // Global default ON -> project with no override inherits enabled.
        db.set_global_plugin_enabled("acme.tool", true).unwrap();
        assert!(db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

        // Project override OFF beats global default ON.
        db.set_plugin_enabled(&project.id, "acme.tool", false)
            .unwrap();
        assert!(!db.is_plugin_enabled(&project.id, "acme.tool").unwrap());

        drop(db);
    }

    #[test]
    fn app_plugin_enablement_is_independent_of_projects() {
        let (db, _temp_dir) = make_test_db("app_plugin_enablement");
        let mut plugin = sample_plugin("account-usage");
        plugin.package_metadata = r#"{"id":"account-usage","enablement":"app"}"#.to_string();
        db.install_plugin(&plugin).unwrap();

        assert!(db.get_enabled_app_plugins().unwrap().is_empty());

        db.set_app_plugin_enabled("account-usage", true).unwrap();
        let enabled = db.get_enabled_app_plugins().unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "account-usage");
        assert!(!db.is_plugin_enabled("project-1", "account-usage").unwrap());
        assert!(db
            .is_plugin_active_for_project("project-1", "account-usage")
            .unwrap());
        assert!(db.get_enabled_plugins("project-1").unwrap().is_empty());

        db.set_app_plugin_enabled("account-usage", false).unwrap();
        assert!(db.get_enabled_app_plugins().unwrap().is_empty());
    }

    #[test]
    fn install_and_get_plugin() {
        let (db, _temp_dir) = make_test_db("plugins_install_get");
        let p = sample_plugin("p1");
        db.install_plugin(&p).unwrap();
        let got = db.get_plugin("p1").unwrap().expect("plugin should exist");
        assert_eq!(got.id, "p1");
        assert_eq!(got.name, "Plugin p1");
    }

    #[test]
    fn install_and_get_plugin_persists_package_source_metadata() {
        let (db, _temp_dir) = make_test_db("plugins_install_metadata");
        let mut plugin = sample_plugin("pkg");
        plugin.source_kind = "npm".to_string();
        plugin.source_spec = "npm:@acme/openforge-plugin@1.2.3".to_string();
        plugin.package_metadata =
            r#"{"id":"pkg","apiVersion":1,"displayName":"Pkg","description":"Plugin"}"#.to_string();

        db.install_plugin(&plugin).unwrap();

        let got = db.get_plugin("pkg").unwrap().expect("plugin should exist");
        assert_eq!(got.source_kind, "npm");
        assert_eq!(got.source_spec, "npm:@acme/openforge-plugin@1.2.3");
        assert_eq!(got.package_metadata, plugin.package_metadata);
    }

    #[test]
    fn list_plugins_empty_then_populated() {
        let (db, _temp_dir) = make_test_db("plugins_list");
        assert!(db.list_plugins().unwrap().is_empty());
        db.install_plugin(&sample_plugin("a")).unwrap();
        db.install_plugin(&sample_plugin("b")).unwrap();
        let list = db.list_plugins().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn uninstall_plugin() {
        let (db, _temp_dir) = make_test_db("plugins_uninstall");
        db.install_plugin(&sample_plugin("x")).unwrap();
        db.uninstall_plugin("x").unwrap();
        assert!(db.get_plugin("x").unwrap().is_none());
    }

    #[test]
    fn set_and_get_enabled_plugins() {
        let (db, _temp_dir) = make_test_db("plugins_enabled");
        db.install_plugin(&sample_plugin("pa")).unwrap();
        db.install_plugin(&sample_plugin("pb")).unwrap();

        db.set_plugin_enabled("proj1", "pa", true).unwrap();
        db.set_plugin_enabled("proj1", "pb", false).unwrap();

        let enabled = db.get_enabled_plugins("proj1").unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "pa");

        assert!(db.is_plugin_enabled("proj1", "pa").unwrap());
        assert!(!db.is_plugin_enabled("proj1", "pb").unwrap());
    }

    #[test]
    fn builtin_plugins_are_enabled_by_default_for_projects() {
        let (db, _temp_dir) = make_test_db("plugins_builtin_default_enabled");
        let mut builtin = sample_plugin("builtin-pr-skills");
        builtin.is_builtin = true;
        builtin.source_kind = "builtin".to_string();
        db.install_plugin(&builtin).unwrap();
        db.install_plugin(&sample_plugin("custom-plugin")).unwrap();

        let enabled = db.get_enabled_plugins("proj1").unwrap();

        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "builtin-pr-skills");
    }

    #[test]
    fn explicit_project_disable_hides_builtin_plugins() {
        let (db, _temp_dir) = make_test_db("plugins_builtin_explicit_disable");
        let mut builtin = sample_plugin("builtin-pr-skills");
        builtin.is_builtin = true;
        builtin.source_kind = "builtin".to_string();
        db.install_plugin(&builtin).unwrap();

        db.set_plugin_enabled("proj1", "builtin-pr-skills", false)
            .unwrap();

        let enabled = db.get_enabled_plugins("proj1").unwrap();

        assert!(enabled.is_empty());
        assert!(!db.is_plugin_enabled("proj1", "builtin-pr-skills").unwrap());
    }

    #[test]
    fn set_enabled_idempotent() {
        let (db, _temp_dir) = make_test_db("plugins_idempotent");
        db.install_plugin(&sample_plugin("q")).unwrap();
        db.set_plugin_enabled("proj1", "q", true).unwrap();
        db.set_plugin_enabled("proj1", "q", false).unwrap();
        assert!(!db.is_plugin_enabled("proj1", "q").unwrap());
    }

    #[test]
    fn is_plugin_enabled_propagates_query_errors() {
        let (db, _temp_dir) = make_test_db("plugins_enabled_query_error");
        {
            let conn = db.connection();
            let conn = conn.lock().unwrap();
            conn.execute("DROP TABLE project_plugins", []).unwrap();
        }

        assert!(db.is_plugin_enabled("proj1", "missing").is_err());
    }

    #[test]
    fn reinstall_plugin_preserves_project_enabled_state() {
        let (db, _temp_dir) = make_test_db("plugins_reinstall_preserves_enabled");
        let mut plugin = sample_plugin("upgraded");
        db.install_plugin(&plugin).unwrap();
        db.set_plugin_enabled("proj1", "upgraded", true).unwrap();

        plugin.version = "2.0.0".to_string();
        plugin.installed_at = 2000;
        db.install_plugin(&plugin).unwrap();

        assert!(db.is_plugin_enabled("proj1", "upgraded").unwrap());
        assert_eq!(db.get_plugin("upgraded").unwrap().unwrap().version, "2.0.0");
    }

    #[test]
    fn plugin_storage_round_trip() {
        let (db, _temp_dir) = make_test_db("plugins_storage_round_trip");
        db.install_plugin(&sample_plugin("plugin-a")).unwrap();
        db.install_plugin(&sample_plugin("plugin-b")).unwrap();

        assert!(db
            .get_plugin_storage("plugin-a", "global", None, "settings")
            .unwrap()
            .is_none());

        db.set_plugin_storage(
            "plugin-a",
            "global",
            None,
            "settings",
            "{\"theme\":\"dark\"}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-a",
            "project",
            Some("project-1"),
            "repo",
            "{\"name\":\"app\"}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-a",
            "task",
            Some("task-1"),
            "reviewState",
            "{\"viewedFiles\":[]}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-b",
            "global",
            None,
            "settings",
            "{\"theme\":\"light\"}",
        )
        .unwrap();

        assert_eq!(
            db.get_plugin_storage("plugin-a", "global", None, "settings")
                .unwrap(),
            Some("{\"theme\":\"dark\"}".to_string())
        );
        assert_eq!(
            db.get_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
                .unwrap(),
            Some("{\"name\":\"app\"}".to_string())
        );
        assert!(db
            .get_plugin_storage("plugin-a", "project", Some("project-2"), "repo")
            .unwrap()
            .is_none());
        assert!(db
            .get_plugin_storage("plugin-b", "global", None, "repo")
            .unwrap()
            .is_none());

        db.delete_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
            .unwrap();
        assert!(db
            .get_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
            .unwrap()
            .is_none());
    }
}
