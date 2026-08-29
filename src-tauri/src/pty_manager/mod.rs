mod attachment;
#[cfg(test)]
mod attachment_tests;
mod commands;
pub(crate) use commands::PiSessionTarget;
mod events;
mod managed_process;
mod ordered_writer;
mod pids;
mod session;
mod terminal_model_bridge;

#[cfg(test)]
use crate::terminal_model::TerminalModelTestFault;
#[cfg(test)]
use attachment::PtyAttachmentHub;
#[cfg(test)]
use attachment::PtyAttachmentHubs;
pub(crate) use attachment::{AgentTerminalAttachmentError, AgentTerminalEvent};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;
#[cfg(test)]
use std::sync::Arc;

#[cfg(test)]
#[derive(Debug)]
struct AgentEventStreamStartGate {
    reached_tx: std::sync::mpsc::Sender<()>,
    release_rx: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
#[derive(Debug)]
struct ShellSpawnPendingGate {
    reached_tx: tokio::sync::oneshot::Sender<()>,
    release_rx: tokio::sync::oneshot::Receiver<()>,
}

#[cfg(test)]
#[derive(Debug)]
struct ResizeStartGate {
    reached_tx: std::sync::mpsc::Sender<()>,
    release_rx: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
use commands::resolve_shell_path;
#[cfg(test)]
pub(crate) use commands::{build_claude_args, get_shell_path};
#[cfg(test)]
use events::{
    finalize_pty_exit, find_utf8_boundary, pty_output_channel, read_pty_output_loop,
    spawn_batched_pty_event_emitter, PtyEventEmitterConfig, PtyExitAction, PtyExitCleanupContext,
    PtyOutputBatcher, PtyOutputReceiver, RingBuffer, CLAUDE_BUFFER_CAPACITY,
    PTY_OUTPUT_QUEUE_CAPACITY, PTY_READ_BUFFER_SIZE,
};
#[cfg(test)]
use managed_process::ManagedProcessIdentity;
pub(crate) use pids::shell_session_key;
#[cfg(test)]
use pids::{is_shell_session_key_for_task, shell_pid_file_name, write_managed_process_identity};
use session::TerminalSessions;
#[cfg(test)]
use session::{frozen_seconds, PtySession, PtySessionKind, NEXT_INSTANCE_ID};
#[cfg(test)]
use session::{
    AgentSpawnGenerations, LastOutputTimes, LifecycleLockRegistry, PtyOutputBuffers, PtySessions,
};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum PtyError {
    InvalidWorkspaceCwd { path: String, reason: String },
    SpawnFailed(String),
    ProcessNotFound(String),
    IoError(std::io::Error),
    WriteFailed(String),
    CleanupFailed(String),
}

impl fmt::Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PtyError::InvalidWorkspaceCwd { path, reason } => {
                write!(f, "workspace cwd '{}' is not accessible: {}", path, reason)
            }
            PtyError::SpawnFailed(msg) => write!(f, "Failed to spawn PTY: {}", msg),
            PtyError::ProcessNotFound(task_id) => {
                write!(f, "No PTY process found for task: {}", task_id)
            }
            PtyError::IoError(e) => write!(f, "IO error: {}", e),
            PtyError::WriteFailed(msg) => write!(f, "Failed to write to PTY: {}", msg),
            PtyError::CleanupFailed(msg) => write!(f, "Failed to clean up PTY: {}", msg),
        }
    }
}

impl std::error::Error for PtyError {}

impl From<std::io::Error> for PtyError {
    fn from(err: std::io::Error) -> Self {
        PtyError::IoError(err)
    }
}

// ============================================================================
// PTY Manager
// ============================================================================

/// Manages multiple PTY sessions (one per task)
#[derive(Clone)]
pub struct PtyManager {
    terminal_sessions: TerminalSessions,
    #[cfg(test)]
    sessions: PtySessions,
    pid_dir_override: Option<PathBuf>,
    #[cfg(test)]
    last_output: LastOutputTimes,
    #[cfg(test)]
    output_buffers: PtyOutputBuffers,
    #[cfg(test)]
    attachment_hubs: PtyAttachmentHubs,
    #[cfg(test)]
    agent_spawn_generations: AgentSpawnGenerations,
    #[cfg(test)]
    lifecycle_locks: LifecycleLockRegistry,
    #[cfg(test)]
    terminal_model_test_fault: Arc<std::sync::Mutex<TerminalModelTestFault>>,
    #[cfg(test)]
    pending_shell_spawns: Arc<dashmap::DashMap<String, (String, u64)>>,
    #[cfg(test)]
    agent_event_stream_start_gate: Arc<std::sync::Mutex<Option<AgentEventStreamStartGate>>>,
    #[cfg(test)]
    shell_spawn_pending_gate: Arc<std::sync::Mutex<Option<ShellSpawnPendingGate>>>,
    #[cfg(test)]
    test_environment: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PtyBufferState {
    pub buffer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<TerminalViewSnapshot>,
    #[serde(rename = "isLive")]
    pub is_live: bool,
    #[serde(rename = "instanceId")]
    pub instance_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalViewSnapshot {
    pub instance_id: u64,
    pub watermark: u64,
    pub data: String,
    pub compatibility_data: String,
}
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionLifecycleState {
    Live,
    Cleaning,
    ManagedRecovery,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyProcessDiagnosticSession {
    pub session_key: String,
    pub task_id: String,
    pub session_kind: String,
    pub lifecycle_state: TerminalSessionLifecycleState,
    pub pid: Option<u32>,
    pub pty_instance_id: u64,
    pub pid_file_name: String,
}

pub(crate) struct PtySpawnContext<'a> {
    pub task_id: &'a str,
    pub cwd: &'a std::path::Path,
    pub cols: u16,
    pub rows: u16,
    pub event_publisher: crate::app_events::RuntimeEventPublisher,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalImageProtocol {
    Iterm2,
}

pub(crate) fn terminal_environment(
    image_protocol: Option<TerminalImageProtocol>,
) -> Vec<(&'static str, &'static str)> {
    let mut environment = vec![
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("TERM_PROGRAM", "vscode"),
    ];
    if image_protocol == Some(TerminalImageProtocol::Iterm2) {
        environment.push(("ITERM_SESSION_ID", "openforge"));
    }
    environment
}

impl PtyManager {
    pub fn new() -> Self {
        let terminal_sessions = TerminalSessions::new();
        #[cfg(test)]
        let test_handles = terminal_sessions.test_handles();
        Self {
            #[cfg(test)]
            sessions: test_handles.sessions,
            #[cfg(test)]
            last_output: test_handles.last_output,
            #[cfg(test)]
            output_buffers: test_handles.output_buffers,
            #[cfg(test)]
            attachment_hubs: test_handles.attachment_hubs,
            #[cfg(test)]
            agent_spawn_generations: test_handles.agent_spawn_generations,
            #[cfg(test)]
            lifecycle_locks: test_handles.lifecycle_locks,
            #[cfg(test)]
            pending_shell_spawns: test_handles.pending_shell_spawns,
            terminal_sessions,
            pid_dir_override: None,
            #[cfg(test)]
            terminal_model_test_fault: Arc::new(std::sync::Mutex::new(
                TerminalModelTestFault::None,
            )),
            #[cfg(test)]
            agent_event_stream_start_gate: Arc::new(std::sync::Mutex::new(None)),
            #[cfg(test)]
            shell_spawn_pending_gate: Arc::new(std::sync::Mutex::new(None)),
            #[cfg(test)]
            test_environment: std::collections::HashMap::new(),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl PtyManager {
    pub fn set_pid_dir(&mut self, dir: PathBuf) {
        self.pid_dir_override = Some(dir);
    }

    pub(crate) fn set_test_environment_variable(
        &mut self,
        key: impl Into<String>,
        value: impl Into<String>,
    ) {
        self.test_environment.insert(key.into(), value.into());
    }

    pub(crate) fn set_terminal_model_test_fault(&self, fault: TerminalModelTestFault) {
        *self
            .terminal_model_test_fault
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = fault;
    }

    pub(super) fn take_terminal_model_test_fault(&self) -> TerminalModelTestFault {
        std::mem::take(
            &mut *self
                .terminal_model_test_fault
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}

#[cfg(test)]
mod tests;
