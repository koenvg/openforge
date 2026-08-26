use serde::{Deserialize, Serialize};

pub(super) const APP_EVENT_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventId {
    pub epoch: String,
    pub seq: u64,
}

impl AppEventId {
    pub fn as_sse_id(&self) -> String {
        format!("{}:{}", self.epoch, self.seq)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventCursor {
    pub epoch: String,
    pub seq: u64,
}

impl AppEventCursor {
    #[allow(dead_code)]
    pub fn after(id: AppEventId) -> Self {
        Self {
            epoch: id.epoch,
            seq: id.seq,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let (epoch, seq) = value.rsplit_once(':')?;
        let seq = seq.parse::<u64>().ok()?;
        if epoch.is_empty() {
            return None;
        }
        Some(Self {
            epoch: epoch.to_string(),
            seq,
        })
    }

    pub fn as_sse_id(&self) -> String {
        format!("{}:{}", self.epoch, self.seq)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeliveryClass {
    RealtimeLossy,
    StateInvalidation,
    UserNotification,
    Lifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventMeta {
    pub sequence: u64,
    #[serde(rename = "emittedAtMs")]
    pub emitted_at_ms: u64,
    #[serde(rename = "orderingKey", skip_serializing_if = "Option::is_none")]
    pub ordering_key: Option<String>,
    pub delivery: DeliveryClass,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppEventEnvelope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<AppEventId>,
    #[serde(rename = "eventName")]
    pub event_name: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<AppEventMeta>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppEventGap {
    pub requested_after: AppEventCursor,
    pub oldest_available: AppEventCursor,
    pub newest_available: AppEventCursor,
}

impl AppEventGap {
    pub fn event_name() -> &'static str {
        "openforge-app-events-gap"
    }

    pub fn into_envelope(self) -> AppEventEnvelope {
        AppEventEnvelope {
            id: Some(AppEventId {
                epoch: self.newest_available.epoch.clone(),
                seq: self.newest_available.seq,
            }),
            event_name: Self::event_name().to_string(),
            payload: serde_json::json!({
                "requestedAfter": self.requested_after.as_sse_id(),
                "oldestAvailable": self.oldest_available.as_sse_id(),
                "newestAvailable": self.newest_available.as_sse_id(),
            }),
            meta: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AppEventFrame {
    Event(AppEventEnvelope),
    Gap(AppEventGap),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmitReceipt {
    pub id: AppEventId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEventError {
    BusClosed,
    Clock,
}

#[derive(Debug, Clone)]
pub struct AppEvent {
    pub(super) event_name: String,
    pub(super) payload: serde_json::Value,
    pub(super) delivery: DeliveryClass,
    pub(super) ordering_key: Option<String>,
}

impl AppEvent {
    pub fn new(
        event_name: impl Into<String>,
        payload: serde_json::Value,
        delivery: DeliveryClass,
        ordering_key: Option<String>,
    ) -> Self {
        Self {
            event_name: event_name.into(),
            payload,
            delivery,
            ordering_key,
        }
    }
}
