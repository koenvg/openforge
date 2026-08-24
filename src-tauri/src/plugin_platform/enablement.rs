use super::PluginPlatform;
use crate::{db, plugin_enablement::PluginEnablement};

impl PluginPlatform<'_> {
    pub(crate) fn set_plugin_enabled(
        &self,
        project_id: &str,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let db = db::acquire_db(self.db);
        require_plugin_enablement(&db, plugin_id, PluginEnablement::Project)?;
        db.set_plugin_enabled(project_id, plugin_id, enabled)
            .map_err(|error| format!("Failed to set plugin enabled: {error}"))
    }

    pub(crate) fn enabled_plugins(&self, project_id: &str) -> Result<Vec<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.get_enabled_plugins(project_id)
            .map_err(|error| format!("Failed to get enabled plugins: {error}"))
    }

    pub(crate) fn set_app_plugin_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let db = db::acquire_db(self.db);
        require_plugin_enablement(&db, plugin_id, PluginEnablement::App)?;
        db.set_app_plugin_enabled(plugin_id, enabled)
            .map_err(|error| format!("Failed to set app plugin enabled: {error}"))
    }

    pub(crate) fn enabled_app_plugins(&self) -> Result<Vec<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.get_enabled_app_plugins()
            .map_err(|error| format!("Failed to get enabled app plugins: {error}"))
    }
}

fn require_plugin_enablement(
    database: &db::Database,
    plugin_id: &str,
    expected: PluginEnablement,
) -> Result<(), String> {
    let plugin = database
        .get_plugin(plugin_id)
        .map_err(|error| format!("Failed to get plugin: {error}"))?
        .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
    let actual = PluginEnablement::from_package_metadata(&plugin.package_metadata)
        .map_err(|error| format!("Failed to parse plugin metadata for {plugin_id}: {error}"))?;
    if actual != expected {
        return Err(format!(
            "Plugin {plugin_id} uses {} enablement; {} enablement is required",
            actual.as_str(),
            expected.as_str()
        ));
    }
    Ok(())
}
