use super::callbacks::required_param_string;
use super::PluginHost;
use serde_json::Value;
use std::sync::{Arc, Mutex};

impl PluginHost {
    pub(super) fn list_projects_for_host(&self) -> Result<Value, String> {
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_all_projects()
                .map_err(|error| format!("failed to list projects: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize projects: {error}"))
    }

    pub(super) fn get_project_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project(&project_id)
                .map_err(|error| format!("failed to get project: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project: {error}"))
    }

    pub(super) fn list_project_attention_for_host(&self) -> Result<Value, String> {
        let db_state = self
            .app_handle
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .ok_or_else(|| "plugin host database state is not available".to_string())?;
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        serde_json::to_value(
            db.get_project_attention_summaries()
                .map_err(|error| format!("failed to get project attention: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project attention: {error}"))
    }
}
