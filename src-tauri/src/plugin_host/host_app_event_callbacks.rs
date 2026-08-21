use super::PluginHost;
use crate::app_events::publish_app_event_to_runtime;
use serde_json::Value;

impl PluginHost {
    pub(super) fn emit_host_app_event(
        &self,
        event_name: &str,
        params: &Value,
    ) -> Result<Value, String> {
        publish_app_event_to_runtime(
            Some(&self.app_handle),
            &self.app_event_tx,
            event_name,
            params,
        );
        Ok(Value::Null)
    }
}
