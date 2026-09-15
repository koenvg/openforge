pub use openforge_session_host::{
    Controller, InstallationId, IoAction, OperationId, PreparedCommand, PtyIdentity, SpawnRequest,
    TerminalOwner,
};
use serde::{Deserialize, Serialize};
pub type ShellCommand = SpawnRequest;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credentials {
    pub installation: InstallationId,
    pub token: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inventory {
    pub controller: Controller,
    pub cursor: u64,
    pub sessions: Vec<Session>,
    pub capacity: Capacity,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub pty: PtyIdentity,
    pub session_key: String,
    pub pid: u32,
    pub exit_code: Option<u32>,
    pub next_io_sequence: Option<u64>,
}
impl Session {
    pub fn hosted(&self) -> openforge_session_host::HostedSession {
        use openforge_session_host::{HostedSession, HostedSessionState};
        HostedSession {
            pty: self.pty.clone(),
            session_key: self.session_key.clone(),
            state: if self.exit_code.is_some() {
                HostedSessionState::Exited
            } else {
                HostedSessionState::Live
            },
            next_io_sequence: self.next_io_sequence,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub token: String,
    pub command: Command,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Capabilities,
    Replacement {
        controller: Controller,
        operation: OperationId,
        phase: crate::ReplacementPhase,
    },
    ReplacementStatus { operation: OperationId },
    RegisterSidecar {
        controller: Controller,
        endpoint: Option<crate::SidecarEndpoint>,
    },
    Connect {
        installation: InstallationId,
    },
    Inventory {
        controller: Controller,
    },
    ShutdownEmpty {
        controller: Controller,
    },
    Spawn {
        controller: Controller,
        operation: OperationId,
        command: SpawnRequest,
    },
    Io {
        controller: Controller,
        operation: OperationId,
        pty: PtyIdentity,
        sequence: u64,
        action: IoAction,
    },
    Terminate {
        controller: Controller,
        operation: OperationId,
        pty: PtyIdentity,
    },
    Recover {
        controller: Controller,
        pty: PtyIdentity,
    },
    Events {
        controller: Controller,
        after: u64,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Response {
    Capabilities(crate::Capabilities),
    Replacement(crate::ReplacementStatus),
    Inventory(Inventory),
    Spawned(Session),
    Recovery(Recovery),
    Events(EventBatch),
    Done,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub pty: PtyIdentity,
    pub watermark: u64,
    pub cursor: u64,
    pub portable_vt: Vec<u8>,
    pub compatibility_replay: Vec<u8>,
    pub continuation: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatch {
    pub cursor: u64,
    pub gap: bool,
    pub retained_bytes: usize,
    pub events: Vec<Event>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    Output {
        pty: PtyIdentity,
        sequence: u64,
        data: Vec<u8>,
    },
    Exited {
        pty: PtyIdentity,
        code: u32,
    },
    RecoveryRequired {
        pty: PtyIdentity,
    },
}
impl Event {
    pub fn is_exit(&self, identity: &PtyIdentity) -> bool {
        matches!(self, Self::Exited { pty, .. } if pty == identity)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    pub operation_receipts: usize,
    pub operation_limit: usize,
    pub cleanup_receipts: usize,
    pub cleanup_limit: usize,
    pub retained_request_bytes: usize,
    pub request_byte_limit: usize,
    pub live_sessions: usize,
    pub live_limit: usize,
    pub retained_sessions: usize,
    pub session_limit: usize,
}
