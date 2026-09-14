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
        for optional in ["runId", "idempotencyKey"] {
            if let Some(value) = params.get(optional) {
                payload.insert(optional.to_string(), value.clone());
            }
        }

        self.invoke_review_thread_command("create_review_thread", Value::Object(payload))
            .await
    }

    pub(super) async fn reply_to_review_thread_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let mut payload = Map::new();
        payload.insert(
            "threadId".to_string(),
            Value::String(required_param_string_allow_empty(params, "threadId")?),
        );
        payload.insert(
            "role".to_string(),
            Value::String(required_param_string_allow_empty(params, "role")?),
        );
        payload.insert(
            "body".to_string(),
            Value::String(required_param_string_allow_empty(params, "body")?),
        );
        if let Some(awaiting) = params.get("awaiting") {
            payload.insert("awaiting".to_string(), awaiting.clone());
        }

        self.invoke_review_thread_command("reply_to_review_thread", Value::Object(payload))
            .await
    }

    pub(super) async fn set_review_thread_status_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let payload = serde_json::json!({
            "threadId": required_param_string_allow_empty(params, "threadId")?,
            "status": required_param_string_allow_empty(params, "status")?,
        });

        self.invoke_review_thread_command("set_review_thread_status", payload)
            .await
    }

    pub(super) async fn set_review_thread_awaiting_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let payload = serde_json::json!({
            "threadId": required_param_string_allow_empty(params, "threadId")?,
            "awaiting": required_param_string_allow_empty(params, "awaiting")?,
        });

        self.invoke_review_thread_command("set_review_thread_awaiting", payload)
            .await
    }

    pub(super) async fn mark_review_thread_seen_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let payload = serde_json::json!({
            "threadId": required_param_string_allow_empty(params, "threadId")?,
        });

        self.invoke_review_thread_command("mark_review_thread_seen", payload)
            .await
    }

    async fn invoke_review_thread_command(
        &self,
        command: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let state = self.app_state_for_host_callback()?;
        crate::app_invoke::invoke_review_threads_command(&state, command, payload)
            .await
            .map_err(|(status, message)| {
                format!("plugin host Review Thread callback {command} failed ({status}): {message}")
            })
    }
}
