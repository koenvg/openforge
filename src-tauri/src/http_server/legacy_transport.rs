mod events;
mod hook_routes;
mod models;
mod task_read_routes;
mod task_routes;

use super::AppState;
use axum::{
    routing::{get, post},
    Router,
};

pub(in crate::http_server) use events::handle_agent_lifecycle_notification;
pub use hook_routes::{
    agent_lifecycle_handler, grok_hook_notification_permission_handler,
    grok_hook_post_tool_use_handler, grok_hook_pre_tool_use_handler, grok_hook_session_end_handler,
    grok_hook_session_start_handler, grok_hook_stop_handler, grok_hook_user_prompt_submit_handler,
    hook_notification_handler, hook_notification_permission_handler, hook_post_tool_use_handler,
    hook_pre_tool_use_handler, hook_session_end_handler, hook_stop_handler,
    hook_user_prompt_submit_handler, opencode_event_handler, pi_agent_end_handler,
    pi_agent_start_handler,
};
pub use models::{
    AddTaskDependencyRequest, AddTaskLabelRequest, AddTaskLabelResponse,
    AgentLifecycleNotificationPayload, ClaudeHookPayload, ClaudeHookQuery, CreateTaskRequest,
    CreateTaskResponse, DeleteTaskRequest, DeleteTaskResponse, GetTaskInfoResponse, GrokHookQuery,
    LinkTaskChainRequest, LinkTaskChainResponse, OpenCodePluginEventPayload,
    PiAgentLifecyclePayload, RemoveTaskLabelRequest, SetTaskDependenciesRequest, StartTaskRequest,
    TaskDependencyLink, TaskLabelsResponse, TaskListRow, TasksQuery, UpdateTaskRequest,
    UpdateTaskResponse,
};
pub use task_routes::{
    add_task_dependency_handler, add_task_label_handler, create_task_handler, delete_task_handler,
    get_project_attention_handler, get_project_task_labels_handler, get_projects_handler,
    get_task_info_handler, get_tasks_handler, hard_delete_task_handler, link_task_chain_handler,
    list_task_labels_handler, remove_task_label_handler, set_task_dependencies_handler,
    start_task_handler, update_task_handler,
};

#[cfg(test)]
pub(super) use events::{
    handle_agent_lifecycle_notification_with_refresh, record_agent_lifecycle_notification,
    should_start_task_display_title_refresh,
};
#[cfg(test)]
pub(super) use hook_routes::{
    bounded_claude_activity_snapshot, map_hook_to_status, opencode_status_from_event,
};
#[cfg(test)]
pub(super) use task_routes::resolve_project_id;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/create_task", post(create_task_handler))
        .route("/start_task", post(start_task_handler))
        .route("/update_task", post(update_task_handler))
        .route("/delete_task", post(delete_task_handler))
        .route("/hard_delete_task", post(hard_delete_task_handler))
        .route(
            "/set_task_dependencies",
            post(set_task_dependencies_handler),
        )
        .route("/add_task_dependency", post(add_task_dependency_handler))
        .route("/link_task_chain", post(link_task_chain_handler))
        .route("/task/:id/labels", get(list_task_labels_handler))
        .route("/add_task_label", post(add_task_label_handler))
        .route("/remove_task_label", post(remove_task_label_handler))
        .route("/task/:id", get(get_task_info_handler))
        .route("/projects", get(get_projects_handler))
        .route("/project/:id/labels", get(get_project_task_labels_handler))
        .route("/tasks", get(get_tasks_handler))
        .route(
            "/v2/projects/:project_id/tasks/active",
            get(task_read_routes::active_tasks_handler),
        )
        .route(
            "/v2/projects/:project_id/tasks/completed",
            get(task_read_routes::completed_tasks_handler),
        )
        .route(
            "/v2/projects/:project_id/tasks/:task_id",
            get(task_read_routes::task_detail_handler),
        )
        .route("/project/:id/attention", get(get_project_attention_handler))
        .route("/hooks/agent-lifecycle", post(agent_lifecycle_handler))
        .route("/hooks/pi-agent-start", post(pi_agent_start_handler))
        .route("/hooks/pi-agent-end", post(pi_agent_end_handler))
        .route("/hooks/opencode-event", post(opencode_event_handler))
        .route("/hooks/stop", post(hook_stop_handler))
        .route(
            "/hooks/user-prompt-submit",
            post(hook_user_prompt_submit_handler),
        )
        .route("/hooks/pre-tool-use", post(hook_pre_tool_use_handler))
        .route("/hooks/post-tool-use", post(hook_post_tool_use_handler))
        .route("/hooks/session-end", post(hook_session_end_handler))
        .route("/hooks/notification", post(hook_notification_handler))
        .route(
            "/hooks/notification-permission",
            post(hook_notification_permission_handler),
        )
        .route(
            "/hooks/grok-session-start",
            post(grok_hook_session_start_handler),
        )
        .route(
            "/hooks/grok-user-prompt-submit",
            post(grok_hook_user_prompt_submit_handler),
        )
        .route(
            "/hooks/grok-pre-tool-use",
            post(grok_hook_pre_tool_use_handler),
        )
        .route(
            "/hooks/grok-post-tool-use",
            post(grok_hook_post_tool_use_handler),
        )
        .route("/hooks/grok-stop", post(grok_hook_stop_handler))
        .route(
            "/hooks/grok-session-end",
            post(grok_hook_session_end_handler),
        )
        .route(
            "/hooks/grok-notification-permission",
            post(grok_hook_notification_permission_handler),
        )
}
