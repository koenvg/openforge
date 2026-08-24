use super::PluginPlatform;
use crate::db;
use serde_json::Value;

impl PluginPlatform<'_> {
    pub(crate) fn plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<Option<Value>, String> {
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
        value: &Value,
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
