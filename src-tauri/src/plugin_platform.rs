use crate::db;
use crate::plugin_host::PluginHost;
use serde::Serialize;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PluginAssetRoot {
    pub(crate) plugin_id: String,
    pub(crate) asset_root: String,
    pub(crate) is_builtin: bool,
}

pub(crate) struct PluginPlatform<'a> {
    db: &'a Mutex<db::Database>,
    app_data_dir: Option<PathBuf>,
    plugin_host: Option<&'a PluginHost>,
}

impl<'a> PluginPlatform<'a> {
    pub(crate) fn new(
        db: &'a Mutex<db::Database>,
        app_data_dir: Option<PathBuf>,
        plugin_host: Option<&'a PluginHost>,
    ) -> Self {
        Self {
            db,
            app_data_dir,
            plugin_host,
        }
    }

    pub(crate) fn register_builtin_plugin(&self, plugin: &db::PluginRow) -> Result<(), String> {
        if !plugin.is_builtin
            || plugin.source_kind != "builtin"
            || !crate::builtin_plugins::has_sentinel_install_path(&plugin.id, &plugin.install_path)
        {
            return Err(
                "trusted built-in plugin registration requires a known built-in plugin row"
                    .to_string(),
            );
        }

        let db = db::acquire_db(self.db);
        db.install_plugin(plugin)
            .map_err(|error| format!("Failed to register built-in plugin: {error}"))
    }

    pub(crate) fn install_local_plugin_bundle(
        &self,
        source_path: &Path,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?;
        let plugin =
            crate::plugin_installation::install_local_plugin_bundle(source_path, app_data_dir)?;
        let db = db::acquire_db(self.db);
        db.install_plugin(&plugin)
            .map_err(|error| format!("Failed to install local plugin: {error}"))?;
        Ok(plugin)
    }

    pub(crate) async fn install_npm_plugin_bundle(
        &self,
        package_name: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let plugin =
            crate::plugin_installation::install_npm_plugin_bundle(package_name, &app_data_dir)
                .await?;
        let db = db::acquire_db(self.db);
        db.install_plugin(&plugin)
            .map_err(|error| format!("Failed to install npm plugin: {error}"))?;
        Ok(plugin)
    }

    pub(crate) async fn install_git_plugin_bundle(
        &self,
        git_spec: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let plugin =
            crate::plugin_installation::install_git_plugin_bundle(git_spec, &app_data_dir).await?;
        let db = db::acquire_db(self.db);
        db.install_plugin(&plugin)
            .map_err(|error| format!("Failed to install git plugin: {error}"))?;
        Ok(plugin)
    }

    pub(crate) async fn install_plugin_package_source(
        &self,
        source_spec: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let plugin = crate::plugin_installation::install_plugin_package_from_source_spec_async(
            source_spec,
            &app_data_dir,
        )
        .await?;
        let db = db::acquire_db(self.db);
        db.install_plugin(&plugin)
            .map_err(|error| format!("Failed to install plugin package source: {error}"))?;
        Ok(plugin)
    }

    pub(crate) fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        // Keep the outer database guard through filesystem finalization so concurrent
        // requests cannot act on the same staged package state.
        let db = db::acquire_db(self.db);
        let plugin = db
            .get_plugin(plugin_id)
            .map_err(|error| format!("Failed to read plugin before uninstall: {error}"))?;

        let staged_uninstall = if let Some(plugin) = plugin.as_ref() {
            if plugin.is_builtin || plugin.source_kind == "builtin" {
                return Err("built-in plugins cannot be uninstalled".to_string());
            }

            Some(crate::plugin_installation::stage_managed_plugin_uninstall(
                plugin,
                self.app_data_dir()?,
            )?)
        } else {
            None
        };

        let database_result = db
            .uninstall_plugin(plugin_id)
            .map_err(|error| format!("Failed to uninstall plugin: {error}"));

        let result = match database_result {
            Ok(()) => match staged_uninstall {
                Some(staged_uninstall) => staged_uninstall.commit(),
                None => match self.app_data_dir.as_deref() {
                    Some(app_data_dir) =>
                        crate::plugin_installation::cleanup_staged_managed_plugin_uninstall(
                            plugin_id,
                            app_data_dir,
                        ),
                    None => Ok(()),
                },
            },
            Err(database_error) => match staged_uninstall {
                Some(staged_uninstall) => match staged_uninstall.rollback() {
                    Ok(()) => Err(database_error),
                    Err(rollback_error) => Err(format!(
                        "{database_error}; managed plugin package recovery also failed: {rollback_error}"
                    )),
                },
                None => Err(database_error),
            }
        };

        drop(db);
        result
    }

    pub(crate) fn plugin(&self, plugin_id: &str) -> Result<Option<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.get_plugin(plugin_id)
            .map_err(|error| format!("Failed to get plugin: {error}"))
    }

    pub(crate) fn plugins(&self) -> Result<Vec<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.list_plugins()
            .map_err(|error| format!("Failed to list plugins: {error}"))
    }

    pub(crate) fn set_plugin_enabled(
        &self,
        project_id: &str,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let db = db::acquire_db(self.db);
        db.set_plugin_enabled(project_id, plugin_id, enabled)
            .map_err(|error| format!("Failed to set plugin enabled: {error}"))
    }

    pub(crate) fn enabled_plugins(&self, project_id: &str) -> Result<Vec<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.get_enabled_plugins(project_id)
            .map_err(|error| format!("Failed to get enabled plugins: {error}"))
    }

    pub(crate) fn plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        validate_plugin_storage_scope(scope, scope_id)?;
        let db = db::acquire_db(self.db);
        let raw = db
            .get_plugin_storage(plugin_id, scope, scope_id, key)
            .map_err(|error| format!("Failed to get plugin storage: {error}"))?;
        Ok(raw.map(|value| serde_json::from_str(&value).unwrap_or(Value::String(value))))
    }

    pub(crate) fn set_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
        value: &serde_json::Value,
    ) -> Result<(), String> {
        validate_plugin_storage_scope(scope, scope_id)?;
        let serialized = serde_json::to_string(value)
            .map_err(|error| format!("Failed to serialize plugin storage value: {error}"))?;
        let db = db::acquire_db(self.db);
        db.set_plugin_storage(plugin_id, scope, scope_id, key, &serialized)
            .map_err(|error| format!("Failed to set plugin storage: {error}"))
    }

    pub(crate) fn delete_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<(), String> {
        validate_plugin_storage_scope(scope, scope_id)?;
        let db = db::acquire_db(self.db);
        db.delete_plugin_storage(plugin_id, scope, scope_id, key)
            .map_err(|error| format!("Failed to delete plugin storage: {error}"))
    }

    pub(crate) fn resolve_plugin_asset_root(
        &self,
        plugin_id: &str,
    ) -> Result<PluginAssetRoot, String> {
        let plugin = self
            .plugin(plugin_id)?
            .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
        let asset_root = resolve_plugin_install_root(&plugin)?;

        Ok(PluginAssetRoot {
            plugin_id: plugin.id,
            asset_root: asset_root.to_string_lossy().into_owned(),
            is_builtin: plugin.is_builtin,
        })
    }

    pub(crate) async fn invoke_backend(
        &self,
        plugin_id: &str,
        command: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let backend_path = self.resolve_installed_backend_path(plugin_id)?;
        let plugin_host = self
            .plugin_host
            .ok_or_else(|| "plugin host state is not available".to_string())?;

        plugin_host
            .invoke_backend(plugin_id, command, &backend_path, payload)
            .await
    }

    pub(crate) async fn backend_when_ready(&self, plugin_id: &str) -> Result<Value, String> {
        let backend_path = self.resolve_installed_backend_path(plugin_id)?;
        let plugin_host = self
            .plugin_host
            .ok_or_else(|| "plugin host state is not available".to_string())?;

        plugin_host
            .when_backend_ready(plugin_id, &backend_path)
            .await
    }

    pub(crate) async fn deactivate_backend(&self, plugin_id: &str) -> Result<Value, String> {
        let plugin_host = self
            .plugin_host
            .ok_or_else(|| "plugin host state is not available".to_string())?;

        plugin_host.deactivate_backend(plugin_id).await
    }

    fn resolve_installed_backend_path(&self, plugin_id: &str) -> Result<PathBuf, String> {
        let plugin = self
            .plugin(plugin_id)?
            .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
        let backend_entry = plugin
            .backend_entry
            .clone()
            .ok_or_else(|| format!("Plugin backend not configured for {plugin_id}"))?;
        let install_root = resolve_plugin_install_root(&plugin)?;
        resolve_backend_entry_path(&install_root, &backend_entry)
    }

    pub(crate) async fn stop_sidecar(&self) -> Result<(), String> {
        let plugin_host = self
            .plugin_host
            .ok_or_else(|| "plugin host state is not available".to_string())?;
        plugin_host.stop_sidecar().await
    }

    fn app_data_dir(&self) -> Result<&Path, String> {
        self.app_data_dir
            .as_deref()
            .ok_or_else(|| "app data directory is required for this plugin operation".to_string())
    }
}

pub(crate) fn validate_plugin_storage_scope(
    scope: &str,
    scope_id: Option<&str>,
) -> Result<(), String> {
    match scope {
        "global" => Ok(()),
        "project" | "task" if scope_id.is_some_and(|value| !value.is_empty()) => Ok(()),
        "project" | "task" => Err(format!("Plugin storage scope '{scope}' requires scopeId")),
        _ => Err(format!("Unsupported plugin storage scope: {scope}")),
    }
}

fn resolve_plugin_install_root(plugin: &db::PluginRow) -> Result<PathBuf, String> {
    if plugin.is_builtin
        && plugin.install_path == crate::builtin_plugins::sentinel_install_path(&plugin.id)
    {
        return crate::builtin_plugins::install_path(&plugin.id);
    }

    Ok(PathBuf::from(&plugin.install_path))
}

fn resolve_backend_entry_path(install_root: &Path, backend_entry: &str) -> Result<PathBuf, String> {
    let backend_entry_path = Path::new(backend_entry);
    if backend_entry_path.is_absolute()
        || backend_entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    let backend_path = install_root.join(backend_entry_path);
    if !backend_path.is_file() {
        return Err(format!(
            "Plugin backend entry does not exist: {}",
            backend_path.display()
        ));
    }

    let canonical_install_root = install_root.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin install root {}: {error}",
            install_root.display()
        )
    })?;
    let canonical_backend_path = backend_path.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin backend entry {}: {error}",
            backend_path.display()
        )
    })?;

    if !canonical_backend_path.starts_with(&canonical_install_root) {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    Ok(canonical_backend_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    const MANAGED_PLUGIN_ID: &str = "acme.managed";

    fn managed_plugin(install_path: &Path) -> db::PluginRow {
        db::PluginRow {
            id: MANAGED_PLUGIN_ID.to_string(),
            name: "Managed plugin".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "Managed plugin for uninstall tests".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "dist/frontend.js".to_string(),
            backend_entry: None,
            install_path: install_path.to_string_lossy().into_owned(),
            source_kind: "npm".to_string(),
            source_spec: "npm:@acme/managed@1.0.0".to_string(),
            package_metadata: "{}".to_string(),
            installed_at: 0,
            is_builtin: false,
        }
    }

    fn write_managed_plugin_package(app_data_dir: &Path) -> PathBuf {
        let install_path =
            crate::plugin_installation::managed_plugin_dir(app_data_dir, MANAGED_PLUGIN_ID);
        fs::create_dir_all(install_path.join("dist"))
            .expect("managed plugin directory should create");
        fs::write(install_path.join("dist/frontend.js"), "export default {};")
            .expect("managed plugin artifact should write");
        install_path
    }

    fn database_with_managed_plugin(app_data_dir: &Path, install_path: &Path) -> db::Database {
        let database = db::Database::new(app_data_dir.join("openforge.db"))
            .expect("test database should create");
        database
            .install_plugin(&managed_plugin(install_path))
            .expect("managed plugin row should install");
        database
    }

    #[test]
    fn uninstall_keeps_managed_package_when_database_delete_fails() {
        let app_data_dir = tempdir().expect("app data tempdir should create");
        let install_path = write_managed_plugin_package(app_data_dir.path());
        let database = database_with_managed_plugin(app_data_dir.path(), &install_path);
        {
            let connection = database.connection();
            let connection = connection.lock().expect("database connection should lock");
            connection
                .execute_batch(
                    "CREATE TRIGGER fail_managed_plugin_uninstall
                     BEFORE DELETE ON plugins
                     WHEN OLD.id = 'acme.managed'
                     BEGIN
                       SELECT RAISE(ABORT, 'forced plugin uninstall failure');
                     END;",
                )
                .expect("failure trigger should create");
        }

        let database = Mutex::new(database);
        let platform =
            PluginPlatform::new(&database, Some(app_data_dir.path().to_path_buf()), None);

        let error = platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect_err("database failure should abort uninstall");

        assert!(error.contains("Failed to uninstall plugin"));
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin row should remain readable")
            .is_some());
        assert!(install_path.join("dist/frontend.js").is_file());
    }

    #[test]
    fn uninstall_removes_staged_package_when_plugin_row_is_already_gone() {
        let app_data_dir = tempdir().expect("app data tempdir should create");
        let install_path = write_managed_plugin_package(app_data_dir.path());
        let plugin = managed_plugin(&install_path);
        let _staged_uninstall = crate::plugin_installation::stage_managed_plugin_uninstall(
            &plugin,
            app_data_dir.path(),
        )
        .expect("managed plugin package should stage");
        assert!(!install_path.exists());

        let database = Mutex::new(
            db::Database::new(app_data_dir.path().join("openforge.db"))
                .expect("test database should create"),
        );
        let platform =
            PluginPlatform::new(&database, Some(app_data_dir.path().to_path_buf()), None);
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin lookup should succeed")
            .is_none());

        platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect("retry should remove the staged package");

        let managed_plugins_dir =
            crate::plugin_installation::managed_plugins_dir(app_data_dir.path());
        assert!(fs::read_dir(managed_plugins_dir)
            .expect("managed plugins directory should remain readable")
            .next()
            .is_none());
    }

    #[test]
    fn uninstall_preserves_traversal_install_path_target() {
        let temp_dir = tempdir().expect("test tempdir should create");
        let app_data_dir = temp_dir.path().join("app-data");
        let declared_install_path =
            crate::plugin_installation::managed_plugin_dir(&app_data_dir, MANAGED_PLUGIN_ID);
        fs::create_dir_all(&declared_install_path).expect("declared install path should create");

        let external_path = temp_dir.path().join("external");
        fs::create_dir_all(&external_path).expect("external directory should create");
        fs::write(external_path.join("keep.txt"), "keep").expect("external marker should write");

        let traversal_install_path = declared_install_path.join("../../..").join("external");
        assert!(traversal_install_path.join("keep.txt").is_file());
        let database = db::Database::new(app_data_dir.join("openforge.db"))
            .expect("test database should create");
        database
            .install_plugin(&managed_plugin(&traversal_install_path))
            .expect("malformed plugin row should install");
        let database = Mutex::new(database);
        let platform = PluginPlatform::new(&database, Some(app_data_dir), None);

        platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect("plugin row should uninstall without deleting external files");

        assert!(external_path.join("keep.txt").is_file());
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin lookup should succeed")
            .is_none());
    }
}
