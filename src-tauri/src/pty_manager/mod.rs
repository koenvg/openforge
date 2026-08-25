mod attachment;
#[cfg(test)]
mod attachment_tests;
mod commands;
pub(crate) use commands::PiSessionTarget;
mod events;
mod managed_process;
mod pids;
mod session;

use crate::terminal_model::ShadowMode;
#[cfg(test)]
use attachment::PtyAttachmentHub;
use attachment::PtyAttachmentHubs;
pub(crate) use attachment::{AgentTerminalAttachmentError, AgentTerminalEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg(test)]
#[derive(Debug)]
struct AgentEventStreamStartGate {
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
#[cfg(test)]
use pids::{
    is_shell_session_key_for_task, shell_pid_file_name, shell_session_key,
    write_managed_process_identity,
};
#[cfg(test)]
use session::{frozen_seconds, PtySession, PtySessionKind, NEXT_INSTANCE_ID};
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

pub(crate) const GHOSTTY_TERMINAL_VIEW_CONFIG: &str = "ghostty_terminal_state_enabled";

/// Manages multiple PTY sessions (one per task)
#[derive(Clone)]
pub struct PtyManager {
    sessions: PtySessions,
    pid_dir_override: Option<PathBuf>,
    last_output: LastOutputTimes,
    output_buffers: PtyOutputBuffers,
    attachment_hubs: PtyAttachmentHubs,
    agent_spawn_generations: AgentSpawnGenerations,
    lifecycle_locks: LifecycleLockRegistry,
    shadow_mode: ShadowMode,
    terminal_view_enabled: Arc<AtomicBool>,
    pending_shell_spawns: Arc<dashmap::DashMap<String, (String, u64)>>,
    #[cfg(test)]
    agent_event_stream_start_gate: Arc<std::sync::Mutex<Option<AgentEventStreamStartGate>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PtyBufferState {
    pub buffer: Option<String>,
    #[serde(rename = "isLive")]
    pub is_live: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalViewSnapshot {
    pub instance_id: u64,
    pub watermark: u64,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyProcessDiagnosticSession {
    pub session_key: String,
    pub task_id: String,
    pub session_kind: String,
    pub pid: Option<u32>,
    pub pty_instance_id: u64,
    pub pid_file_name: String,
}

pub(crate) struct PtySpawnContext<'a> {
    pub task_id: &'a str,
    pub cwd: &'a std::path::Path,
    pub cols: u16,
    pub rows: u16,
    pub app_handle: Option<crate::backend_runtime::AppHandle>,
    pub app_event_tx: Option<crate::app_events::AppEventSender>,
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
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pid_dir_override: None,
            last_output: Arc::new(Mutex::new(HashMap::new())),
            output_buffers: Arc::new(Mutex::new(HashMap::new())),
            attachment_hubs: Arc::new(Mutex::new(HashMap::new())),
            agent_spawn_generations: Arc::new(Mutex::new(HashMap::new())),
            lifecycle_locks: LifecycleLockRegistry::default(),
            shadow_mode: ShadowMode::from_environment(),
            terminal_view_enabled: Arc::new(AtomicBool::new(false)),
            pending_shell_spawns: Arc::new(dashmap::DashMap::new()),
            #[cfg(test)]
            agent_event_stream_start_gate: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub(crate) fn set_terminal_view_enabled(&self, enabled: bool) {
        self.terminal_view_enabled.store(enabled, Ordering::Release);
    }

    pub(crate) fn terminal_view_enabled(&self) -> bool {
        self.terminal_view_enabled.load(Ordering::Acquire)
    }

    fn terminal_model_enabled(&self) -> bool {
        self.shadow_mode.is_enabled() || self.terminal_view_enabled()
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

    pub(crate) fn set_shadow_mode(&mut self, mode: ShadowMode) {
        self.shadow_mode = mode;
    }
}

#[cfg(test)]
mod tests;
