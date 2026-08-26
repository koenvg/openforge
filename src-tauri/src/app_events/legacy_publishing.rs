use super::bus::{bus_for_sender, AppEventSender};
use super::event_model::{AppEvent, AppEventEnvelope, DeliveryClass};

pub(super) fn legacy_delivery_class(event_name: &str) -> DeliveryClass {
    if event_name.starts_with("pty-output-") {
        DeliveryClass::RealtimeLossy
    } else if event_name.starts_with("pty-exit-")
        || event_name.starts_with("plugin:")
        || matches!(event_name, "session-resumed" | "startup-resume-complete")
    {
        DeliveryClass::Lifecycle
    } else if matches!(
        event_name,
        "new-pr-comment" | "implementation-failed" | "github-rate-limited"
    ) {
        DeliveryClass::UserNotification
    } else {
        DeliveryClass::StateInvalidation
    }
}

pub(super) fn legacy_ordering_key(event_name: &str, payload: &serde_json::Value) -> Option<String> {
    if let Some(session_key) = event_name
        .strip_prefix("pty-output-")
        .or_else(|| event_name.strip_prefix("pty-exit-"))
    {
        return Some(format!("pty:{session_key}"));
    }
    if matches!(event_name, "session-resumed" | "startup-resume-complete") {
        return Some(format!("lifecycle:{event_name}"));
    }
    payload
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(|task_id| format!("task:{task_id}"))
        .or_else(|| {
            payload
                .get("ticket_id")
                .and_then(|value| value.as_str())
                .map(|task_id| format!("task:{task_id}"))
        })
}

pub fn publish_app_event(
    sender: &Option<AppEventSender>,
    event_name: &str,
    payload: &serde_json::Value,
) {
    if let Some(sender) = sender {
        if let Some(bus) = bus_for_sender(sender) {
            if bus
                .try_emit(AppEvent::new(
                    event_name,
                    payload.clone(),
                    legacy_delivery_class(event_name),
                    legacy_ordering_key(event_name, payload),
                ))
                .is_ok()
            {
                return;
            }
        }

        let _ = sender.send(AppEventEnvelope {
            id: None,
            event_name: event_name.to_string(),
            payload: payload.clone(),
            meta: None,
        });
    }
}

pub fn publish_app_event_to_runtime(
    app: Option<&crate::backend_runtime::AppHandle>,
    sender: &Option<AppEventSender>,
    event_name: &str,
    payload: &serde_json::Value,
) {
    if let Some(app) = app {
        if app.has_app_event_adapter() && app.emit(event_name, payload.clone()).is_ok() {
            return;
        }
    }
    publish_app_event(sender, event_name, payload);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_events::{AppEventBus, AppEventFrame};

    #[test]
    fn test_publish_app_event_fans_out_to_app_event_stream_sender() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(16);
        let payload = serde_json::json!({ "instance_id": 42 });

        publish_app_event(&Some(sender), "pty-exit-T-1-shell-2", &payload);

        let received = receiver.try_recv().expect("event should be published");
        assert_eq!(received.event_name, "pty-exit-T-1-shell-2");
        assert_eq!(received.payload["instance_id"], 42);
    }

    #[tokio::test]
    async fn test_publish_app_event_uses_bus_metadata_when_sender_belongs_to_bus() {
        let bus = AppEventBus::new(16, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        let sender = bus.sender();

        publish_app_event(
            &Some(sender),
            "agent-status-changed",
            &serde_json::json!({ "task_id": "T-1", "status": "running" }),
        );

        let AppEventFrame::Event(received) =
            subscription.recv().await.expect("event should arrive")
        else {
            panic!("expected event frame");
        };
        assert_eq!(received.event_name, "agent-status-changed");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 1);
        assert_eq!(
            received
                .meta
                .as_ref()
                .expect("meta should be present")
                .ordering_key
                .as_deref(),
            Some("task:T-1")
        );
    }
}
