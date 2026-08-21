use super::super::*;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn host_app_event_callbacks_emit_once_with_production_adapter_and_sender() {
    for (method, event_name, payload) in [
        (
            "openforge.notifications.notify",
            "openforge.notification",
            json!({ "title": "Done" }),
        ),
        (
            "openforge.system.openUrl",
            "openforge.open-url",
            json!({ "url": "https://example.com" }),
        ),
        (
            "openforge.system.writeClipboardText",
            "openforge.write-clipboard-text",
            json!({ "text": "Reviewer brief" }),
        ),
    ] {
        let app = AppHandle::new();
        let bus = crate::app_events::AppEventBus::new(16, 8);
        let sender = bus.sender();
        let mut events = bus.subscribe(None).expect("subscribe to app events");
        app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
            bus,
        )));
        let host = PluginHost::with_app_event_sender(app, Some(sender));

        host.handle_host_callback(method, &payload)
            .await
            .expect("host app event callback");

        let crate::app_events::AppEventFrame::Event(event) =
            events.recv().await.expect("host app event")
        else {
            panic!("expected host app event");
        };
        assert_eq!(event.event_name, event_name);
        assert_eq!(event.payload, payload);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), events.recv())
                .await
                .is_err(),
            "{method} must emit exactly one app event"
        );
    }
}
