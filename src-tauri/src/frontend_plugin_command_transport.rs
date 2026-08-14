use crate::app_events::{AppEventEnvelope, AppEventSender};
use crate::plugin_command_broker::{
    AgentCommandDescriptor, FrontendAgentCommandCatalog, PluginCommandInvocationContext,
};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

pub const FRONTEND_PLUGIN_COMMAND_REQUEST_EVENT: &str = "plugin-frontend-command-request";
const DEFAULT_FRONTEND_PLUGIN_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum FrontendPluginCommandRequest {
    List {
        correlation_id: String,
        plugin_id: String,
        project_id: String,
    },
    Invoke {
        correlation_id: String,
        plugin_id: String,
        project_id: String,
        command_id: String,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FrontendPluginCommandOutcome {
    Success { output: Value },
    Error { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrontendPluginCommandAcknowledgement {
    pub correlation_id: String,
    pub outcome: FrontendPluginCommandOutcome,
}

type PendingSender = oneshot::Sender<FrontendPluginCommandOutcome>;

#[derive(Clone)]
pub struct FrontendPluginCommandTransport {
    event_sender: Option<AppEventSender>,
    timeout: Duration,
    pending: Arc<Mutex<HashMap<String, PendingSender>>>,
}

impl FrontendPluginCommandTransport {
    pub fn production(event_sender: Option<AppEventSender>) -> Self {
        Self::new(event_sender, DEFAULT_FRONTEND_PLUGIN_COMMAND_TIMEOUT)
    }
    pub fn new(event_sender: Option<AppEventSender>, timeout: Duration) -> Self {
        Self {
            event_sender,
            timeout,
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn acknowledge(&self, acknowledgement: FrontendPluginCommandAcknowledgement) -> bool {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&acknowledgement.correlation_id));
        sender.is_some_and(|sender| sender.send(acknowledgement.outcome).is_ok())
    }

    pub fn shutdown(&self, reason: &str) {
        let senders = self
            .pending
            .lock()
            .map(|mut pending| {
                pending
                    .drain()
                    .map(|(_, sender)| sender)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for sender in senders {
            let _ = sender.send(FrontendPluginCommandOutcome::Error {
                error: reason.to_string(),
            });
        }
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .map(|pending| pending.len())
            .unwrap_or(0)
    }

    async fn request(&self, request: FrontendPluginCommandRequest) -> Result<Value, String> {
        let correlation_id = match &request {
            FrontendPluginCommandRequest::List { correlation_id, .. }
            | FrontendPluginCommandRequest::Invoke { correlation_id, .. } => correlation_id.clone(),
        };
        let payload = serde_json::to_value(request).map_err(|error| {
            format!("failed to serialize frontend Plugin Command request: {error}")
        })?;
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "frontend Plugin Command pending request lock poisoned".to_string())?
            .insert(correlation_id.clone(), sender);

        let delivered = self.event_sender.as_ref().is_some_and(|event_sender| {
            event_sender
                .send(AppEventEnvelope {
                    id: None,
                    event_name: FRONTEND_PLUGIN_COMMAND_REQUEST_EVENT.to_string(),
                    payload,
                    meta: None,
                })
                .is_ok()
        });
        if !delivered {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&correlation_id);
            }
            return Err(
                "no active OpenForge desktop renderer is available for frontend Plugin Commands"
                    .to_string(),
            );
        }

        let outcome = match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&correlation_id);
                }
                return Err(
                    "frontend Plugin Command request ended before acknowledgement".to_string(),
                );
            }
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&correlation_id);
                }
                return Err(format!(
                    "frontend Plugin Command request timed out after {} ms",
                    self.timeout.as_millis()
                ));
            }
        };

        match outcome {
            FrontendPluginCommandOutcome::Success { output } => Ok(output),
            FrontendPluginCommandOutcome::Error { error } => Err(error),
        }
    }
}

impl FrontendAgentCommandCatalog for FrontendPluginCommandTransport {
    fn list_frontend_agent_commands<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>> {
        Box::pin(async move {
            let output = self
                .request(FrontendPluginCommandRequest::List {
                    correlation_id: uuid::Uuid::new_v4().to_string(),
                    plugin_id: plugin_id.to_string(),
                    project_id: project_id.to_string(),
                })
                .await?;
            serde_json::from_value(output).map_err(|error| {
                format!(
                    "active renderer returned invalid frontend Plugin Command descriptors: {error}"
                )
            })
        })
    }

    fn invoke_frontend_agent_command<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
        command_id: &'a str,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    ) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async move {
            self.request(FrontendPluginCommandRequest::Invoke {
                correlation_id: uuid::Uuid::new_v4().to_string(),
                plugin_id: plugin_id.to_string(),
                project_id: project_id.to_string(),
                command_id: command_id.to_string(),
                input,
                context,
            })
            .await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_command_broker::{
        FrontendAgentCommandCatalog, PluginCommandInvocationContext, PluginCommandInvocationSource,
    };
    use serde_json::json;
    use std::time::Duration;

    fn context(project_id: &str) -> PluginCommandInvocationContext {
        PluginCommandInvocationContext {
            task_id: Some("T-1".to_string()),
            project_id: project_id.to_string(),
            source: PluginCommandInvocationSource::AgentCli,
        }
    }

    #[tokio::test]
    async fn correlates_concurrent_frontend_invocations_and_serializes_host_context() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(8);
        let transport = FrontendPluginCommandTransport::new(Some(sender), Duration::from_secs(1));

        let first_transport = transport.clone();
        let first = tokio::spawn(async move {
            first_transport
                .invoke_frontend_agent_command(
                    "com.example.browser",
                    "P-1",
                    "com.example.browser.open",
                    Some(json!({ "url": "http://localhost:5173/first" })),
                    context("P-1"),
                )
                .await
        });
        let second_transport = transport.clone();
        let second = tokio::spawn(async move {
            second_transport
                .invoke_frontend_agent_command(
                    "com.example.browser",
                    "P-1",
                    "com.example.browser.open",
                    Some(json!({ "url": "http://localhost:5173/second" })),
                    context("P-1"),
                )
                .await
        });

        let first_request = receiver.recv().await.expect("first request");
        let second_request = receiver.recv().await.expect("second request");
        assert_eq!(
            first_request.event_name,
            FRONTEND_PLUGIN_COMMAND_REQUEST_EVENT
        );
        assert_eq!(
            first_request.id, None,
            "transient requests must not be replayable"
        );
        assert_eq!(first_request.payload["operation"], "invoke");
        assert_eq!(first_request.payload["context"]["taskId"], "T-1");
        let first_id = first_request.payload["correlationId"]
            .as_str()
            .expect("first correlation id");
        let second_id = second_request.payload["correlationId"]
            .as_str()
            .expect("second correlation id");
        assert_ne!(first_id, second_id);

        assert!(transport.acknowledge(FrontendPluginCommandAcknowledgement {
            correlation_id: second_id.to_string(),
            outcome: FrontendPluginCommandOutcome::Success {
                output: json!({ "request": "second" }),
            },
        }));
        assert!(transport.acknowledge(FrontendPluginCommandAcknowledgement {
            correlation_id: first_id.to_string(),
            outcome: FrontendPluginCommandOutcome::Success {
                output: json!({ "request": "first" }),
            },
        }));

        assert_eq!(
            first.await.expect("first join").expect("first result"),
            json!({ "request": "first" })
        );
        assert_eq!(
            second.await.expect("second join").expect("second result"),
            json!({ "request": "second" })
        );
        assert_eq!(transport.pending_count(), 0);
    }

    #[tokio::test]
    async fn times_out_cleans_pending_state_and_ignores_late_acknowledgements() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(4);
        let transport =
            FrontendPluginCommandTransport::new(Some(sender), Duration::from_millis(20));
        let request_transport = transport.clone();
        let request = tokio::spawn(async move {
            request_transport
                .list_frontend_agent_commands("com.example.browser", "P-1")
                .await
        });
        let envelope = receiver.recv().await.expect("request");
        let correlation_id = envelope.payload["correlationId"]
            .as_str()
            .expect("correlation id")
            .to_string();

        let error = request.await.expect("join").expect_err("timeout");
        assert!(error.contains("timed out"), "{error}");
        assert_eq!(transport.pending_count(), 0);
        assert!(
            !transport.acknowledge(FrontendPluginCommandAcknowledgement {
                correlation_id,
                outcome: FrontendPluginCommandOutcome::Success { output: json!([]) },
            })
        );
    }

    #[tokio::test]
    async fn fails_immediately_without_an_active_electron_event_subscriber() {
        let (sender, receiver) = tokio::sync::broadcast::channel(1);
        drop(receiver);
        let transport = FrontendPluginCommandTransport::new(Some(sender), Duration::from_secs(1));

        let error = transport
            .list_frontend_agent_commands("com.example.browser", "P-1")
            .await
            .expect_err("renderer unavailable");

        assert!(
            error.contains("active OpenForge desktop renderer"),
            "{error}"
        );
        assert_eq!(transport.pending_count(), 0);
    }
}
