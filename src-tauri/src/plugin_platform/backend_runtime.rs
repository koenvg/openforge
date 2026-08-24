use super::PluginPlatform;
use crate::plugin_host::PluginHost;
use serde_json::Value;
use std::path::PathBuf;

struct InstalledBackend<'a> {
    plugin_host: &'a PluginHost,
    path: PathBuf,
}

impl PluginPlatform<'_> {
    fn plugin_host(&self) -> Result<&PluginHost, String> {
        self.plugin_host
            .ok_or_else(|| "plugin host state is not available".to_string())
    }

    fn installed_backend(&self, plugin_id: &str) -> Result<InstalledBackend<'_>, String> {
        let path = self.resolve_installed_backend_path(plugin_id)?;
        let plugin_host = self.plugin_host()?;

        Ok(InstalledBackend { plugin_host, path })
    }

    pub(crate) async fn invoke_backend(
        &self,
        plugin_id: &str,
        command: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let backend = self.installed_backend(plugin_id)?;

        backend
            .plugin_host
            .invoke_backend(plugin_id, command, &backend.path, payload)
            .await
    }

    pub(crate) async fn backend_when_ready(
        &self,
        plugin_id: &str,
        project_id: Option<&str>,
        preserve_activation: bool,
    ) -> Result<Value, String> {
        let backend_path = self.resolve_installed_backend_path(plugin_id)?;
        let package_metadata = self
            .plugin(plugin_id)?
            .and_then(|plugin| serde_json::from_str::<Value>(&plugin.package_metadata).ok());
        let plugin_host = self.plugin_host()?;

        plugin_host
            .when_backend_ready(
                plugin_id,
                &backend_path,
                project_id,
                preserve_activation,
                package_metadata.as_ref(),
            )
            .await
    }

    pub(crate) async fn agent_command_descriptors(
        &self,
        plugin_id: &str,
        project_id: &str,
    ) -> Result<Vec<crate::plugin_command_broker::AgentCommandDescriptor>, String> {
        let backend = self.installed_backend(plugin_id)?;
        backend
            .plugin_host
            .list_agent_commands(plugin_id, &backend.path, project_id)
            .await
    }

    pub(crate) async fn invoke_agent_command(
        &self,
        plugin_id: &str,
        project_id: &str,
        command_id: &str,
        input: Option<Value>,
        context: crate::plugin_command_broker::PluginCommandInvocationContext,
    ) -> Result<Value, String> {
        let backend = self.installed_backend(plugin_id)?;
        backend
            .plugin_host
            .invoke_agent_command(
                plugin_id,
                &backend.path,
                project_id,
                command_id,
                input,
                context,
            )
            .await
    }

    pub(crate) async fn deactivate_backend(&self, plugin_id: &str) -> Result<Value, String> {
        let plugin_host = self.plugin_host()?;

        plugin_host.deactivate_backend(plugin_id).await
    }

    pub(crate) async fn stop_sidecar(&self) -> Result<(), String> {
        let plugin_host = self.plugin_host()?;
        plugin_host.stop_sidecar().await
    }
}
