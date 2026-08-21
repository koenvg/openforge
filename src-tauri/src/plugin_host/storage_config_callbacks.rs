use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use serde_json::Value;
use std::sync::{Arc, Mutex};

impl PluginHost {
    pub(super) fn get_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        let raw = db
            .get_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key)
            .map_err(|error| format!("failed to get plugin storage: {error}"))?;
        Ok(raw
            .map(|value| serde_json::from_str(&value).unwrap_or(Value::String(value)))
            .unwrap_or(Value::Null))
    }

    pub(super) fn set_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        let value = params.get("value").cloned().unwrap_or(Value::Null);
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;
        let serialized = serde_json::to_string(&value)
            .map_err(|error| format!("failed to serialize plugin storage value: {error}"))?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.set_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key, &serialized)
            .map_err(|error| format!("failed to set plugin storage: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) fn delete_plugin_storage_for_host(&self, params: &Value) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = required_param_string(params, "scope")?;
        let scope_id = optional_param_string(params, "scopeId")?;
        let key = required_param_string(params, "key")?;
        crate::plugin_platform::validate_plugin_storage_scope(&scope, scope_id.as_deref())?;

        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin storage database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.delete_plugin_storage(&plugin_id, &scope, scope_id.as_deref(), &key)
            .map_err(|error| format!("failed to delete plugin storage: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn get_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let value = if crate::secure_store::is_secret(&key) {
            crate::secure_config::get(db_state.inner(), &key)
                .await
                .map_err(|error| format!("failed to get secret config: {error}"))?
        } else {
            let db = crate::db::acquire_db(db_state.inner().as_ref());
            db.get_config(&key)
                .map_err(|error| format!("failed to get config: {error}"))?
        };
        serde_json::to_value(value).map_err(|error| format!("failed to serialize config: {error}"))
    }

    pub(super) async fn set_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let key = required_param_string(params, "key")?;
        let value = host_config_value(params);
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        if crate::secure_store::is_secret(&key) {
            crate::secure_config::set(db_state.inner(), &key, &value)
                .await
                .map_err(|error| format!("failed to set secret config: {error}"))?;
        } else {
            let db = crate::db::acquire_db(db_state.inner().as_ref());
            db.set_config(&key, &value)
                .map_err(|error| format!("failed to set config: {error}"))?;
        }
        Ok(Value::Null)
    }

    pub(super) fn get_project_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let key = required_param_string(params, "key")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project_config(&project_id, &key)
                .map_err(|error| format!("failed to get project config: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project config: {error}"))
    }

    pub(super) fn set_project_config_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let key = required_param_string(params, "key")?;
        let value = host_config_value(params);
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.set_project_config(&project_id, &key, &value)
            .map_err(|error| format!("failed to set project config: {error}"))?;
        Ok(Value::Null)
    }
}

fn host_config_value(params: &Value) -> String {
    match params.get("value") {
        Some(Value::String(value)) => value.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}
