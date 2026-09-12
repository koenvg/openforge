//! Bounded lifecycle-only transport. Request-response commands cannot enter this queue.
use crate::{Error, PtyIdentity};
use serde::{Deserialize, Serialize};

pub const NOTIFICATION_PATH: &str = "/notifications/agent-lifecycle";
pub const NOTIFICATION_DELIVERY_PATH: &str = "/internal/agent-notifications";
pub const MAX_NOTIFICATION_BYTES: usize = 16 * 1024;
pub const MAX_NOTIFICATION_RECORDS: usize = 4096;
pub const MAX_NOTIFICATION_JOURNAL_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationEnvelope {
    pub id: String,
    pub payload: NotificationPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationPayload {
    pub provider: String,
    pub task_id: String,
    pub pty_instance_id: u64,
    pub kind: String,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub raw_event_type: Option<String>,
    #[serde(default)]
    pub raw_status_type: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub activity_snapshot: Option<String>,
    #[serde(default)]
    pub background_tasks: Option<serde_json::Value>,
}

impl NotificationEnvelope {
    /// Validate before durable acceptance. Diagnostics never include supplied payloads.
    ///
    /// # Errors
    /// Rejects unknown lifecycle kinds/providers, invalid identities, and oversized fields.
    pub fn validate(&self) -> Result<(), Error> {
        let identifier = |s: &str| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
        };
        let p = &self.payload;
        if !identifier(&self.id)
            || !identifier(&p.task_id)
            || p.pty_instance_id == 0
            || !matches!(
                p.provider.as_str(),
                "pi" | "claude-code" | "codex" | "opencode" | "grok"
            )
            || !matches!(
                p.kind.as_str(),
                "started"
                    | "became_busy"
                    | "became_idle"
                    | "requested_permission"
                    | "failed"
                    | "ended"
            )
            || [
                &p.provider_session_id,
                &p.raw_event_type,
                &p.raw_status_type,
            ]
            .iter()
            .any(|s| s.as_ref().is_some_and(|s| s.len() > 256))
            || p.transcript_path.as_ref().is_some_and(|s| s.len() > 4096)
            || p.activity_snapshot.as_ref().is_some_and(|s| s.len() > 8192)
            || p.background_tasks
                .as_ref()
                .is_some_and(|v| !v.is_array() || v.to_string().len() > 8192)
            || serde_json::to_vec(self)
                .map_err(|_| Error::InvalidRequest)?
                .len()
                > MAX_NOTIFICATION_BYTES
        {
            return Err(Error::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationDelivery {
    pub journal_id: String,
    pub position: u64,
    pub pty: PtyIdentity,
    pub session_key: String,
    pub envelope: NotificationEnvelope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationReceipt {
    pub journal_id: String,
    pub position: u64,
}
