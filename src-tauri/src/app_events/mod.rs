mod bus;
mod event_model;
mod legacy_publishing;
mod runtime_adapter;

#[allow(
    unused_imports,
    reason = "crate-facing event API remains available through app_events after the module split"
)]
pub use bus::{AppEventBus, AppEventSender, AppEventSubscription, TaskEvents};
#[allow(
    unused_imports,
    reason = "crate-facing event API remains available through app_events after the module split"
)]
pub use event_model::{
    AppEvent, AppEventCursor, AppEventEnvelope, AppEventError, AppEventFrame, AppEventGap,
    AppEventId, AppEventMeta, DeliveryClass, EmitReceipt,
};
pub use legacy_publishing::{publish_app_event, publish_app_event_to_runtime};
pub use runtime_adapter::{InMemoryAppEventAdapter, RustAppEventAdapter};
