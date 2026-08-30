use super::*;

mod agent_session_callbacks;
mod command_callbacks;
mod filesystem_callbacks;
mod host_app_event_callbacks;
mod lifecycle;
mod project_callbacks;
mod stdio_test_support;
mod storage_config_callbacks;
mod task_callbacks;
mod transport;

fn build_plugin_host() -> PluginHost {
    PluginHost::new(AppHandle::new())
}
