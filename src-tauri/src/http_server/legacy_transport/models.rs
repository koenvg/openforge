use crate::db;
use serde::{Deserialize, Serialize};

/// Request to create a new task from OpenCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub initial_prompt: String,
    pub project_id: Option<String>,
    pub worktree: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// Response containing the created task ID
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub project_id: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTaskRequest {
    pub task_id: String,
}

/// Request to replace the initial prompt of a task that has never started.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateTaskRequest {
    pub task_id: String,
    pub initial_prompt: String,
}

/// Response containing the updated task ID
#[derive(Debug, Clone, Serialize)]
pub struct UpdateTaskResponse {
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteTaskRequest {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteTaskResponse {
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetTaskDependenciesRequest {
    pub task_id: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTaskDependencyRequest {
    pub task_id: String,
    pub depends_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkTaskChainRequest {
    pub chain: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkTaskChainResponse {
    pub status: String,
    pub links: Vec<TaskDependencyLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDependencyLink {
    pub task_id: String,
    pub depends_on: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GetTaskInfoResponse {
    pub id: String,
    pub initial_prompt: String,
    pub prompt: Option<String>,
    pub status: String,
    pub depends_on: Vec<String>,
    pub labels: Vec<db::TaskLabelRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskLabelsResponse {
    pub task_id: String,
    pub labels: Vec<db::TaskLabelRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTaskLabelRequest {
    pub task_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveTaskLabelRequest {
    pub task_id: String,
    pub label_id: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AddTaskLabelResponse {
    pub task_id: String,
    pub status: String,
    pub label: db::TaskLabelRow,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TasksQuery {
    pub project_id: String,
    pub state: Option<String>,
    pub include_done: Option<bool>,
    pub exclude_done: Option<bool>,
    pub compact: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum TaskListRow {
    Full(db::TaskRow),
    Compact(db::CompactTaskRow),
}

/// Payload from Claude Code hooks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeHookPayload {
    pub session_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub transcript_path: Option<String>,
    /// Untyped: a typed model would reject the whole hook on a shape change, and a rejected
    /// hook never records its lifecycle event.
    #[serde(default)]
    pub background_tasks: Option<serde_json::Value>,
    #[serde(alias = "CLAUDE_TASK_ID")]
    pub claude_task_id: Option<String>,
    #[serde(default, alias = "OPENFORGE_PTY_INSTANCE_ID")]
    pub pty_instance_id: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClaudeHookQuery {
    pub task_id: Option<String>,
    pub pty_instance_id: Option<u64>,
    pub session_id: Option<String>,
}

/// Query params carried by Grok's guarded hook curl commands (see
/// `grok_hooks::lifecycle_hook_command`). Unlike Claude's hooks, Grok's own
/// hook stdin JSON shape isn't an OpenForge-controlled contract, so task/PTY/
/// session identity travels exclusively via the URL query string here.
///
/// `pty_instance_id` is intentionally a raw `String` rather than `u64`: Grok
/// has no payload fallback for identity, so an empty or non-numeric query
/// value (e.g. `pty_instance_id=` when `$OPENFORGE_PTY_INSTANCE_ID` is unset)
/// must not fail query-string deserialization and drop the whole request.
/// `handle_grok_hook` parses it leniently instead.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct GrokHookQuery {
    pub task_id: Option<String>,
    pub pty_instance_id: Option<String>,
    pub session_id: Option<String>,
}

/// Payload from the OpenForge Pi extension when a PTY-backed Pi agent starts or finishes a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiAgentLifecyclePayload {
    pub task_id: String,
    pub pty_instance_id: u64,
}

/// Payload from the installed OpenCode plugin event hook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenCodePluginEventPayload {
    pub task_id: String,
    pub pty_instance_id: u64,
    pub event_type: String,
    pub session_id: Option<String>,
    pub status_type: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub activity_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLifecycleNotificationPayload {
    #[serde(flatten)]
    pub notification: crate::agent_lifecycle::AgentLifecycleNotification,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub activity_snapshot: Option<String>,
}
