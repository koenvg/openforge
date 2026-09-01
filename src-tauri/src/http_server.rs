#[cfg(test)]
use crate::app_events::AppEventEnvelope;
use crate::{
    app_events::{AppEventBus, AppEventSender},
    db,
    github_client::GitHubClient,
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::WhisperManager,
};
#[cfg(test)]
use axum::extract::{Json, State};
use axum::http::StatusCode;
#[cfg(test)]
use futures::StreamExt;
use serde::Serialize;
use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::Duration;

mod authentication;
pub(crate) mod deferred_completion;
mod internal_transport;
mod legacy_transport;
mod plugin_management;
mod server_lifecycle;

// Keep the pre-split `http_server::*` surface stable for crate callers and tests.
#[allow(unused_imports)]
pub use internal_transport::{
    AppHealthResponse, AppInvokeRequest, AppInvokeResponse, AppReadinessEventsResponse,
    AppReadinessResponse,
};
#[allow(unused_imports)]
pub use legacy_transport::{
    add_task_dependency_handler, add_task_label_handler, agent_lifecycle_handler,
    create_task_handler, delete_task_handler, get_project_attention_handler,
    get_project_task_labels_handler, get_projects_handler, get_task_info_handler,
    get_tasks_handler, grok_hook_notification_permission_handler, grok_hook_post_tool_use_handler,
    grok_hook_pre_tool_use_handler, grok_hook_session_end_handler, grok_hook_session_start_handler,
    grok_hook_stop_handler, grok_hook_user_prompt_submit_handler, hard_delete_task_handler,
    hook_notification_handler, hook_notification_permission_handler, hook_post_tool_use_handler,
    hook_pre_tool_use_handler, hook_session_end_handler, hook_stop_handler,
    hook_user_prompt_submit_handler, link_task_chain_handler, list_task_labels_handler,
    opencode_event_handler, pi_agent_end_handler, pi_agent_start_handler,
    remove_task_label_handler, set_task_dependencies_handler, start_task_handler,
    update_task_handler, AddTaskDependencyRequest, AddTaskLabelRequest, AddTaskLabelResponse,
    AgentLifecycleNotificationPayload, ClaudeHookPayload, ClaudeHookQuery, CreateTaskRequest,
    CreateTaskResponse, DeleteTaskRequest, DeleteTaskResponse, GetTaskInfoResponse, GrokHookQuery,
    LinkTaskChainRequest, LinkTaskChainResponse, OpenCodePluginEventPayload,
    PiAgentLifecyclePayload, RemoveTaskLabelRequest, SetTaskDependenciesRequest, StartTaskRequest,
    TaskDependencyLink, TaskLabelsResponse, TaskListRow, TasksQuery, UpdateTaskRequest,
    UpdateTaskResponse,
};
#[allow(unused_imports)]
pub use server_lifecycle::{create_router, electron_sidecar_app_handle, start_http_sidecar_server};

#[cfg(test)]
use internal_transport::app_event_sse_data;
#[cfg(test)]
use legacy_transport::{
    bounded_claude_activity_snapshot, handle_agent_lifecycle_notification_with_refresh,
    map_hook_to_status, opencode_status_from_event, record_agent_lifecycle_notification,
    resolve_project_id, should_start_task_display_title_refresh,
};
#[cfg(test)]
use server_lifecycle::{
    resolve_http_server_port, restore_companion_gateway_in_background,
    run_electron_sidecar_with_cleanup, shutdown_sidecar_runtime, SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
};

pub(crate) fn map_terminal_task_completion_error(
    error: crate::terminal_task_completion::TerminalTaskCompletionError,
) -> (StatusCode, String) {
    let status = match &error {
        crate::terminal_task_completion::TerminalTaskCompletionError::NotFound => {
            StatusCode::NOT_FOUND
        }
        crate::terminal_task_completion::TerminalTaskCompletionError::AlreadyClaimed
        | crate::terminal_task_completion::TerminalTaskCompletionError::InvalidState { .. } => {
            StatusCode::CONFLICT
        }
        crate::terminal_task_completion::TerminalTaskCompletionError::RuntimeShutdown(_)
        | crate::terminal_task_completion::TerminalTaskCompletionError::Persistence(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    (status, error.to_string())
}
#[derive(Clone)]
pub struct AppState {
    pub app: Option<crate::backend_runtime::AppHandle>,
    pub db: std::sync::Arc<Mutex<db::Database>>,
    pub backend_token: Option<String>,
    pub pty_manager: Option<PtyManager>,
    pub deferred_completion_watcher: deferred_completion::DeferredCompletionWatcher,
    pub github_client: GitHubClient,
    pub frontend_host_requests:
        crate::frontend_host_request_transport::FrontendHostRequestTransport,
    pub plugin_host: Option<PluginHost>,
    pub plugin_lifecycle_locks: crate::plugin_platform::PluginLifecycleLocks,
    pub app_event_tx: Option<AppEventSender>,
    pub app_event_bus: Option<AppEventBus>,
    pub whisper: Option<std::sync::Arc<WhisperManager>>,
    pub sidecar_readiness: SidecarReadinessState,
    pub companion_gateway: Option<crate::companion_gateway::CompanionGatewayManager>,
    pub task_claims: TaskClaims,
    pub task_start_worktree_root: Option<std::path::PathBuf>,
    pub process_memory_history: crate::process_memory_history::ProcessMemoryHistory,
    pub poll_context: crate::github_poller::PollContext,
}

impl AppState {
    pub(crate) fn process_memory_sampling_context(
        &self,
    ) -> crate::process_memory_history::ProcessMemorySamplingContext {
        crate::process_memory_history::ProcessMemorySamplingContext {
            db: self.db.clone(),
            pty_manager: self.pty_manager.clone(),
            plugin_host: self.plugin_host.clone(),
            github_client: self.github_client.clone(),
        }
    }
}

pub use crate::task_claims::{TaskClaims, TaskOperation};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupResumeReadiness {
    pub phase: String,
    pub target_count: Option<usize>,
    pub resumed_count: Option<usize>,
    pub failed_count: Option<usize>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarDegradedState {
    pub area: String,
    pub message: String,
    pub since: String,
}

#[derive(Debug, Clone, Default)]
pub struct SidecarReadinessState {
    startup_resume: Arc<Mutex<StartupResumeReadiness>>,
    degraded: Arc<Mutex<Vec<SidecarDegradedState>>>,
}

impl Default for StartupResumeReadiness {
    fn default() -> Self {
        Self {
            phase: "pending".to_string(),
            target_count: None,
            resumed_count: None,
            failed_count: None,
            completed_at: None,
        }
    }
}

impl SidecarReadinessState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn startup_resume(&self) -> StartupResumeReadiness {
        self.startup_resume
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn degraded(&self) -> Vec<SidecarDegradedState> {
        self.degraded
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn mark_startup_resume_running(&self, target_count: usize) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.phase = "running".to_string();
            state.target_count = Some(target_count);
            state.resumed_count = Some(0);
            state.failed_count = Some(0);
            state.completed_at = None;
        }
    }

    pub fn record_startup_resume_success(&self) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.resumed_count = Some(state.resumed_count.unwrap_or(0) + 1);
        }
    }

    pub fn record_startup_resume_failure(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.failed_count = Some(state.failed_count.unwrap_or(0) + 1);
        }
        self.mark_degraded("startupResume", message);
    }

    pub fn mark_startup_resume_complete(&self) {
        if let Ok(mut state) = self.startup_resume.lock() {
            if state.failed_count.unwrap_or(0) > 0 {
                state.phase = "degraded".to_string();
            } else {
                state.phase = "complete".to_string();
            }
            state.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    pub fn mark_startup_resume_degraded(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.phase = "degraded".to_string();
            state.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
        self.mark_degraded("startupResume", message);
    }

    fn mark_degraded(&self, area: impl Into<String>, message: impl Into<String>) {
        if let Ok(mut degraded) = self.degraded.lock() {
            degraded.push(SidecarDegradedState {
                area: area.into(),
                message: message.into(),
                since: chrono::Utc::now().to_rfc3339(),
            });
        }
    }
}

#[cfg(test)]
#[path = "http_server_tests/mod.rs"]
mod tests;
