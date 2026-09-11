use super::callbacks::required_param_string_allow_empty;
use super::PluginHost;
use serde_json::{Map, Value};

fn scope_payload(params: &Value) -> Result<Map<String, Value>, String> {
    let mut payload = Map::new();
    for key in ["namespace", "targetKey", "revision"] {
        payload.insert(
            key.to_string(),
            Value::String(required_param_string_allow_empty(params, key)?),
        );
    }
    Ok(payload)
}

impl PluginHost {
    pub(super) async fn list_review_threads_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        self.invoke_review_thread_command(
            "list_review_threads",
            Value::Object(scope_payload(params)?),
        )
        .await
    }

    pub(super) async fn create_review_thread_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let mut payload = scope_payload(params)?;
        payload.insert(
            "origin".to_string(),
            Value::String(required_param_string_allow_empty(params, "origin")?),
        );
        payload.insert(
            "body".to_string(),
            Value::String(required_param_string_allow_empty(params, "body")?),
        );
        payload.insert(
            "anchor".to_string(),
            params
                .get("anchor")
                .filter(|value| value.is_object())
                .cloned()
                .ok_or_else(|| "plugin host callback missing object param: anchor".to_string())?,
        );
        if let Some(run_id) = params.get("runId") {
            payload.insert("runId".to_string(), run_id.clone());
        }

        self.invoke_review_thread_command("create_review_thread", Value::Object(payload))
            .await
    }

    pub(super) async fn reply_to_review_thread_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let payload = serde_json::json!({
            "threadId": required_param_string_allow_empty(params, "threadId")?,
            "role": required_param_string_allow_empty(params, "role")?,
            "body": required_param_string_allow_empty(params, "body")?,
        });

        self.invoke_review_thread_command("reply_to_review_thread", payload)
            .await
    }

    async fn invoke_review_thread_command(
        &self,
        command: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let state = self.app_state_for_host_callback()?;
        let request = crate::http_server::AppInvokeRequest {
            command: command.to_string(),
            payload,
        };
        crate::app_invoke::handle_review_threads_command(&state, &request)
            .await
            .map_err(|(status, message)| {
                format!("plugin host Review Thread callback {command} failed ({status}): {message}")
            })?
            .ok_or_else(|| {
                format!("plugin host Review Thread callback returned no value: {command}")
            })
    }
}
