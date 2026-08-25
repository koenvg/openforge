use super::bus::AppEventBus;
use super::event_model::{AppEvent, AppEventError, EmitReceipt};
use super::legacy_publishing::{legacy_delivery_class, legacy_ordering_key};

/// Adapter Interface at the Seam where Rust runtime lifecycle notifications become AppEventBus envelopes.
///
/// This Module keeps launch lifecycle producers from needing to know the AppEventBus
/// Implementation while still giving Electron/Svelte durable, replayable envelopes.
pub trait RustAppEventAdapter: Send + Sync {
    fn emit(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> Result<EmitReceipt, AppEventError>;
}

#[derive(Clone)]
pub struct InMemoryAppEventAdapter {
    bus: AppEventBus,
}

impl InMemoryAppEventAdapter {
    pub fn new(bus: AppEventBus) -> Self {
        Self { bus }
    }
}

impl RustAppEventAdapter for InMemoryAppEventAdapter {
    fn emit(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> Result<EmitReceipt, AppEventError> {
        let delivery = legacy_delivery_class(event_name);
        let ordering_key = legacy_ordering_key(event_name, &payload);
        self.bus
            .try_emit(AppEvent::new(event_name, payload, delivery, ordering_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_events::{AppEventFrame, DeliveryClass};

    #[tokio::test]
    async fn test_app_handle_emit_through_in_memory_adapter_is_replayed_to_late_subscribers() {
        let bus = AppEventBus::new(16, 8);
        let app = crate::backend_runtime::AppHandle::new();
        app.set_app_event_adapter(std::sync::Arc::new(InMemoryAppEventAdapter::new(
            bus.clone(),
        )));

        app.emit(
            "pty-output-T-boot-shell-0",
            serde_json::json!({ "data": "stale boot output" }),
        )
        .expect("non-lifecycle event should publish through adapter");

        app.emit(
            "session-resumed",
            serde_json::json!({
                "task_id": "T-boot",
                "workspace_path": "/tmp/openforge/T-boot"
            }),
        )
        .expect("app handle emit should publish through adapter");

        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("boot-time event should replay to late subscribers")
        else {
            panic!("expected replayed lifecycle event");
        };

        assert_eq!(received.event_name, "session-resumed");
        assert_eq!(received.payload["task_id"], "T-boot");
        assert_eq!(received.id.as_ref().expect("id should be assigned").seq, 2);
        let meta = received.meta.as_ref().expect("meta should be assigned");
        assert_eq!(meta.delivery, DeliveryClass::Lifecycle);
        assert_eq!(
            meta.ordering_key.as_deref(),
            Some("lifecycle:session-resumed")
        );
    }
}
