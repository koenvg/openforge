use super::callbacks::required_param_string;
use super::PluginHost;
use serde_json::Value;

impl PluginHost {
    pub(super) fn list_projects_for_host(&self) -> Result<Value, String> {
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        serde_json::to_value(
            db.get_all_projects()
                .map_err(|error| format!("failed to list projects: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize projects: {error}"))
    }

    pub(super) fn get_project_for_host(&self, params: &Value) -> Result<Value, String> {
        let project_id = required_param_string(params, "projectId")?;
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        serde_json::to_value(
            db.get_project(&project_id)
                .map_err(|error| format!("failed to get project: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project: {error}"))
    }

    pub(super) fn list_project_attention_for_host(&self) -> Result<Value, String> {
        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        serde_json::to_value(
            db.get_project_attention_summaries()
                .map_err(|error| format!("failed to get project attention: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize project attention: {error}"))
    }
}
