//! Versioned local Session Daemon protocol. Contains no Task or plugin behavior.
use serde::{Deserialize, Serialize};

mod agent;
mod frame;
pub use frame::{read_frame, write_frame, Envelope};
mod agent_routes;
pub use agent::*;
pub use agent_routes::{agent_route_allowed, scoped_agent_route_allowed};
mod host_error;
mod notification;
pub use notification::*;
mod messages;
pub use messages::*;
mod replacement;
pub use replacement::*;

pub const VERSION: u32 = 6;
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum Error {
    #[error("unsupported session protocol version")]
    Version,
    #[error("session capacity exhausted; request not executed")]
    Capacity,
    #[error("{0} capacity exhausted; request not executed")]
    CapacityExceeded(openforge_session_host::CapacityKind),
    #[error("foreign installation")]
    ForeignInstallation,
    #[error("stale controller")]
    StaleController,
    #[error("authentication failed")]
    Unauthorized,
    #[error("daemon already running")]
    AlreadyRunning,
    #[error("stale PTY identity")]
    StalePty,
    #[error("stale output position")]
    StaleOutput,
    #[error("live executable replacement is unsupported")]
    UnsupportedReplacement,
    #[error("operation identity reused with a different request")]
    OperationConflict,
    #[error("operation retry window expired; request not executed")]
    OperationExpired,
    #[error("input sequence is out of order")]
    OutOfOrder,
    #[error("operation outcome unknown; reconcile before another operation")]
    OutcomeUnknown,
    #[error("terminal recovery unavailable")]
    RecoveryUnavailable,
    #[error("session host: {0}")]
    Host(String),
    #[error("invalid session request")]
    InvalidRequest,
    #[error("session transport: {0}")]
    Transport(String),
}

pub(crate) fn transport(error: std::io::Error) -> Error {
    Error::Transport(error.to_string())
}
