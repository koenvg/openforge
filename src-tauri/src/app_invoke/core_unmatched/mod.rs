use super::*;

mod agent_sessions;
mod app;
mod browser_sessions;
mod config;
mod process_memory_history;
mod projects;
mod task_labels;
mod tasks;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CommandDomain {
    Config,
    BrowserSession,
    Project,
    Task,
    AgentSession,
    TaskLabel,
    ProcessMemoryHistory,
    App,
}

fn command_domain(command: &str) -> Option<CommandDomain> {
    match command {
        "get_config" | "set_config" => Some(CommandDomain::Config),
        "get_process_memory_history" | "set_process_memory_history_enabled" => {
            Some(CommandDomain::ProcessMemoryHistory)
        }
        "list_browser_session_purge_intents" | "acknowledge_browser_session_purge_intent" => {
            Some(CommandDomain::BrowserSession)
        }
        "create_project"
        | "get_projects"
        | "update_project"
        | "get_project_config"
        | "resolve_ai_provider"
        | "set_project_config"
        | "clear_project_config"
        | "reset_project_settings_to_global" => Some(CommandDomain::Project),
        "get_task_config"
        | "set_task_config"
        | "create_task"
        | "update_task"
        | "update_task_title"
        | "update_task_source_ticket_url"
        | "tasks_active"
        | "tasks_completed"
        | "tasks_detail"
        | "get_tasks"
        | "get_project_attention"
        | "get_task_attention"
        | "get_task_lanes"
        | "get_task_detail"
        | "get_tasks_for_project"
        | "get_task_workspace" => Some(CommandDomain::Task),
        "get_session_status"
        | "get_latest_session"
        | "get_agent_sessions"
        | "list_agent_sessions"
        | "get_latest_sessions"
        | "finalize_agent_session" => Some(CommandDomain::AgentSession),
        "get_project_task_labels"
        | "create_task_label"
        | "add_task_label"
        | "remove_task_label"
        | "delete_task_label" => Some(CommandDomain::TaskLabel),
        "get_app_mode" | "get_git_branch" => Some(CommandDomain::App),
        _ => None,
    }
}

pub(super) async fn handle_app_unmatched_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    match command_domain(&request.command) {
        Some(CommandDomain::Config) => config::handle(state, request).await,
        Some(CommandDomain::ProcessMemoryHistory) => {
            process_memory_history::handle(state, request).await
        }
        Some(CommandDomain::BrowserSession) => browser_sessions::handle(state, request),
        Some(CommandDomain::Project) => projects::handle(state, request),
        Some(CommandDomain::Task) => tasks::handle(state, request),
        Some(CommandDomain::AgentSession) => agent_sessions::handle(state, request),
        Some(CommandDomain::TaskLabel) => task_labels::handle(state, request),
        Some(CommandDomain::App) => app::handle(state, request),
        None => Err((
            StatusCode::NOT_IMPLEMENTED,
            format!(
                "app IPC command is not implemented for Electron sidecar slice: {}",
                request.command
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{command_domain, CommandDomain};

    #[test]
    fn routes_unmatched_commands_by_domain() {
        let cases = [
            ("get_config", CommandDomain::Config),
            ("set_config", CommandDomain::Config),
            (
                "get_process_memory_history",
                CommandDomain::ProcessMemoryHistory,
            ),
            (
                "set_process_memory_history_enabled",
                CommandDomain::ProcessMemoryHistory,
            ),
            (
                "list_browser_session_purge_intents",
                CommandDomain::BrowserSession,
            ),
            (
                "acknowledge_browser_session_purge_intent",
                CommandDomain::BrowserSession,
            ),
            ("create_project", CommandDomain::Project),
            ("get_projects", CommandDomain::Project),
            ("update_project", CommandDomain::Project),
            ("get_project_config", CommandDomain::Project),
            ("resolve_ai_provider", CommandDomain::Project),
            ("set_project_config", CommandDomain::Project),
            ("clear_project_config", CommandDomain::Project),
            ("reset_project_settings_to_global", CommandDomain::Project),
            ("get_task_config", CommandDomain::Task),
            ("set_task_config", CommandDomain::Task),
            ("create_task", CommandDomain::Task),
            ("update_task", CommandDomain::Task),
            ("update_task_title", CommandDomain::Task),
            ("update_task_source_ticket_url", CommandDomain::Task),
            ("get_tasks", CommandDomain::Task),
            ("get_project_attention", CommandDomain::Task),
            ("get_task_attention", CommandDomain::Task),
            ("get_task_lanes", CommandDomain::Task),
            ("get_task_detail", CommandDomain::Task),
            ("get_tasks_for_project", CommandDomain::Task),
            ("get_task_workspace", CommandDomain::Task),
            ("get_session_status", CommandDomain::AgentSession),
            ("get_latest_session", CommandDomain::AgentSession),
            ("get_agent_sessions", CommandDomain::AgentSession),
            ("list_agent_sessions", CommandDomain::AgentSession),
            ("get_latest_sessions", CommandDomain::AgentSession),
            ("finalize_agent_session", CommandDomain::AgentSession),
            ("get_project_task_labels", CommandDomain::TaskLabel),
            ("create_task_label", CommandDomain::TaskLabel),
            ("add_task_label", CommandDomain::TaskLabel),
            ("remove_task_label", CommandDomain::TaskLabel),
            ("delete_task_label", CommandDomain::TaskLabel),
            ("get_app_mode", CommandDomain::App),
            ("get_git_branch", CommandDomain::App),
        ];

        for (command, expected) in cases {
            assert_eq!(command_domain(command), Some(expected), "{command}");
        }
    }

    #[test]
    fn leaves_unknown_commands_unmatched() {
        assert_eq!(command_domain("unsupported_desktop_command"), None);
    }
}
