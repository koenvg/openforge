use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub const MAX_REQUEST_BYTES: usize = 64 * 1024;
pub const MAX_OPERATIONS: usize = 1024;
pub const MAX_RETAINED_REQUEST_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_SESSIONS: usize = 1024;
pub const MAX_EXIT_HISTORY: usize = 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostLimits {
    pub live_sessions: usize,
    pub retained_sessions: usize,
    pub exit_history: usize,
    pub operations: usize,
    pub cleanup_reserve: usize,
    pub retained_request_bytes: usize,
}
impl Default for HostLimits {
    fn default() -> Self {
        Self {
            live_sessions: MAX_SESSIONS,
            retained_sessions: usize::MAX,
            exit_history: MAX_EXIT_HISTORY,
            operations: MAX_OPERATIONS,
            cleanup_reserve: MAX_SESSIONS,
            retained_request_bytes: MAX_RETAINED_REQUEST_BYTES,
        }
    }
}
#[derive(Debug, Clone, Copy)]
pub struct HostCapacity {
    pub operation_window: Option<OperationWindow>,
    pub operations: usize,
    pub retained_request_bytes: usize,
    pub limits: HostLimits,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum CapacityKind {
    #[error("operation receipt window")]
    OperationReceipts,
    #[error("retained request bytes")]
    RequestBytes,
    #[error("live or retained terminal sessions")]
    Sessions,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("invalid host request: {0}")]
    InvalidRequest(&'static str),
    #[error(transparent)]
    InvalidIdentity(#[from] IdentityError),
    #[error("foreign installation")]
    ForeignInstallation,
    #[error("stale controller")]
    StaleController,
    #[error("stale PTY identity")]
    StalePty,
    #[error("stale output position")]
    StaleOutput,
    #[error("operation identity reused with a different request")]
    OperationConflict,
    #[error("operation retry window expired; request not executed")]
    OperationExpired,
    #[error("operation outcome unknown; reconcile before issuing another operation")]
    OutcomeUnknown,
    #[error("host retention capacity exhausted; request not executed")]
    Capacity,
    #[error("{0} capacity exhausted; request not executed")]
    CapacityExceeded(CapacityKind),
    #[error("input sequence is out of order")]
    OutOfOrder,
    #[error("live executable replacement is unsupported by this host")]
    UnsupportedReplacement,
    #[error("terminal recovery is unavailable")]
    RecoveryUnavailable,
    #[error("terminal host: {0}")]
    Backend(String),
}

// Owner labels are supplied by the caller. The host only derives their stable session key;
// it performs no Task lookup, provider preparation, or plugin operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerminalOwner {
    Agent { task_id: String },
    Shell { task_id: String, index: Option<u32> },
}
/// Reserved identity namespace for non-Task agents. These never receive Task credentials.
pub fn scoped_agent_digest(session_key: &str) -> Option<&str> {
    let digest = session_key.strip_prefix("scoped-agent-v1-")?;
    (digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    .then_some(digest)
}

impl TerminalOwner {
    pub fn task_id(&self) -> &str {
        match self {
            Self::Agent { task_id } | Self::Shell { task_id, .. } => task_id,
        }
    }
    pub fn session_key(&self) -> String {
        match self {
            Self::Agent { task_id } => task_id.clone(),
            Self::Shell { task_id, index } => {
                format!("{task_id}-shell-{}", index.unwrap_or_default())
            }
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: PathBuf,
}
impl std::fmt::Debug for PreparedCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedCommand").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnRequest {
    pub owner: TerminalOwner,
    pub command: PreparedCommand,
    pub columns: u16,
    pub rows: u16,
    pub image_protocol: Option<TerminalImageProtocol>,
}
impl SpawnRequest {
    pub fn validate(&self) -> Result<usize, HostError> {
        InstallationId::parse(self.owner.task_id())?;
        let command = &self.command;
        if command.program.is_empty() || command.program.contains('\0') {
            return Err(HostError::InvalidRequest("invalid program"));
        }
        if !command.cwd.is_absolute() || command.cwd.as_os_str().as_encoded_bytes().contains(&0) {
            return Err(HostError::InvalidRequest(
                "cwd must be an absolute path without NUL",
            ));
        }
        if command.args.iter().any(|arg| arg.contains('\0'))
            || command.env.iter().any(|(key, value)| {
                key.is_empty() || key.contains(['=', '\0']) || value.contains('\0')
            })
        {
            return Err(HostError::InvalidRequest("invalid argument or environment"));
        }
        validate_geometry(self.columns, self.rows)?;
        let size = command.program.len()
            + command.cwd.as_os_str().len()
            + self.owner.task_id().len()
            + command.args.iter().map(|arg| arg.len() + 1).sum::<usize>()
            + command
                .env
                .iter()
                .map(|(key, value)| key.len() + value.len() + 2)
                .sum::<usize>()
            + 32;
        if size > MAX_REQUEST_BYTES {
            return Err(HostError::InvalidRequest("spawn request too large"));
        }
        Ok(size)
    }
}
pub fn validate_geometry(columns: u16, rows: u16) -> Result<(), HostError> {
    if columns == 0 || rows == 0 {
        return Err(HostError::InvalidRequest("zero terminal geometry"));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Controller {
    pub installation: InstallationId,
    pub lifetime: DaemonLifetimeId,
    pub generation: ControllerGeneration,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostedSessionState {
    Live,
    Cleaning,
    ManagedRecovery,
    Exited,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostedSession {
    pub pty: PtyIdentity,
    pub session_key: String,
    pub state: HostedSessionState,
    /// None means the sequence space is exhausted, never permission to restart at one.
    pub next_io_sequence: Option<u64>,
}
#[derive(Debug)]
pub struct Connection {
    pub controller: Controller,
    pub inventory: Vec<HostedSession>,
    pub supports_replacement: bool,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum IoAction {
    Write(Vec<u8>),
    Resize { columns: u16, rows: u16 },
}
impl std::fmt::Debug for IoAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Write(_) => "Write(<redacted>)",
            Self::Resize { .. } => "Resize",
        })
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IoRequest {
    pub pty: PtyIdentity,
    pub sequence: u64,
    pub action: IoAction,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReplacementPhase {
    Prepare { executable: std::path::PathBuf },
    Commit,
    Abort,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostOutput {
    Output {
        start: OutputPosition,
        end: OutputPosition,
        data: Vec<u8>,
    },
    Exited {
        pty: PtyIdentity,
    },
    RecoveryRequired,
}
