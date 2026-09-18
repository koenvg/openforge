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

    pub(super) fn publish_plugin_global_event(&self, params: &Value) -> Result<Value, String> {
        super::callbacks::required_param_string(params, "event")?;
        super::callbacks::required_param_string(params, "sourcePluginId")?;
        if params.get("payload").is_none() {
            return Err("plugin host callback missing param: payload".to_string());
        }
        self.emit_host_app_event("plugin-global-event", params)
    }
}
