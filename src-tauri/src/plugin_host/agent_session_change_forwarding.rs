use super::PluginHost;
use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

impl PluginHost {
    pub(super) fn forward_scoped_agent_session_changes(&self, session_id: u64, process_token: u64) {
        let Some(sender) = self.app_event_tx.as_ref() else {
            return;
        };
        let mut events = sender.subscribe();
        let host = self.clone();
        tokio::spawn(async move {
            loop {
                let received = events.recv().await;
                if !host.is_current_transport(session_id, process_token) {
                    return;
                }
                let notification = match received {
                    Ok(event) if event.event_name == "scoped-agent-session-changed" => {
                        notification("plugin.agentSessions.changed", Some(event.payload))
                    }
                    Ok(_) => continue,
                    Err(RecvError::Lagged(_)) => notification("plugin.agentSessions.resync", None),
                    Err(RecvError::Closed) => return,
                };
                if !host
                    .write_notification(session_id, process_token, &notification)
                    .await
                {
                    return;
                }
            }
        });
    }
}

fn notification(method: &str, params: Option<Value>) -> String {
    let mut message = json!({ "jsonrpc": "2.0", "method": method });
    if let Some(params) = params {
        message["params"] = params;
    }
    message.to_string()
}
