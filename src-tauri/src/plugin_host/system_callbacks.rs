use super::PluginHost;
use crate::app_events::publish_app_event;
use serde_json::Value;
use std::sync::{Arc, Mutex};

impl PluginHost {
    pub(super) fn notify_for_host(&self, params: &Value) -> Result<Value, String> {
        self.emit_host_app_event("openforge.notification", params)
    }

    pub(super) fn open_url_for_host(&self, params: &Value) -> Result<Value, String> {
        self.emit_host_app_event("openforge.open-url", params)
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

    fn emit_host_app_event(&self, event_name: &str, params: &Value) -> Result<Value, String> {
        let payload = params.clone();
        publish_app_event(&self.app_event_tx, event_name, &payload);
        self.app_handle.emit(event_name, payload)?;
        Ok(Value::Null)
    }
}
