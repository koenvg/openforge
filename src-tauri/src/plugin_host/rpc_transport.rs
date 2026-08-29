use super::{PluginHost, SidecarState};
use log::warn;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;
use tokio::time::timeout;

#[derive(Default)]
pub(in crate::plugin_host) struct PluginTransportState {
    pub(in crate::plugin_host) writer: Option<Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>>,
    pub(in crate::plugin_host) pending: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    pub(in crate::plugin_host) session_id: u64,
    pub(in crate::plugin_host) process_token: u64,
}

impl PluginHost {
    pub async fn invoke_backend(
        &self,
        plugin_id: &str,
        command: &str,
        backend_path: &std::path::Path,
        payload: Value,
    ) -> Result<Value, String> {
        let backend_path = backend_path.to_string_lossy().into_owned();
        let params = json!({
            "pluginId": plugin_id,
            "command": command,
            "backendPath": backend_path,
            "payload": payload,
        });
        let (request_id, request) = crate::plugin_rpc::format_request(plugin_id, command, params);
        self.send_request_and_wait(
            request_id,
            &request,
            &format!("plugin backend response: {plugin_id}.{command}"),
            &format!("invoking {plugin_id}.{command}"),
            crate::plugin_rpc::DEFAULT_TIMEOUT,
        )
        .await
    }

    pub async fn when_backend_ready(
        &self,
        plugin_id: &str,
        backend_path: &std::path::Path,
        project_id: Option<&str>,
        preserve_activation: bool,
        package_metadata: Option<&Value>,
    ) -> Result<Value, String> {
        let backend_path = backend_path.to_string_lossy().into_owned();
        let params = json!({
            "pluginId": plugin_id,
            "backendPath": backend_path,
            "projectId": project_id,
            "preserveActivation": preserve_activation,
            "packageMetadata": package_metadata,
        });
        let (request_id, request) =
            crate::plugin_rpc::format_request("plugin", "backend.whenReady", params);
        self.send_request_and_wait(
            request_id,
            &request,
            &format!("plugin backend readiness: {plugin_id}"),
            &format!("waiting for plugin backend readiness: {plugin_id}"),
            crate::plugin_rpc::DEFAULT_TIMEOUT,
        )
        .await
    }

    pub async fn list_agent_commands(
        &self,
        plugin_id: &str,
        backend_path: &std::path::Path,
        project_id: &str,
    ) -> Result<Vec<crate::plugin_command_broker::AgentCommandDescriptor>, String> {
        let params = json!({
            "pluginId": plugin_id,
            "backendPath": backend_path.to_string_lossy(),
            "projectId": project_id,
        });
        let (request_id, request) =
            crate::plugin_rpc::format_request("plugin", "commands.list", params);
        let value = self
            .send_request_and_wait(
                request_id,
                &request,
                &format!("agent-facing Plugin Command discovery: {plugin_id}"),
                &format!("discovering agent-facing Plugin Commands for {plugin_id}"),
                crate::plugin_rpc::DEFAULT_TIMEOUT,
            )
            .await?;
        serde_json::from_value(value).map_err(|error| {
            format!("invalid agent-facing Plugin Command descriptors for {plugin_id}: {error}")
        })
    }

    pub async fn invoke_agent_command(
        &self,
        plugin_id: &str,
        backend_path: &std::path::Path,
        project_id: &str,
        command_id: &str,
        input: Option<Value>,
        context: crate::plugin_command_broker::PluginCommandInvocationContext,
    ) -> Result<Value, String> {
        let mut params = json!({
            "pluginId": plugin_id,
            "backendPath": backend_path.to_string_lossy(),
            "projectId": project_id,
            "commandId": command_id,
            "context": context,
        });
        if let Some(input) = input {
            params["input"] = input;
        }
        let (request_id, request) =
            crate::plugin_rpc::format_request("plugin", "commands.invoke", params);
        self.send_request_and_wait(
            request_id,
            &request,
            &format!("agent-facing Plugin Command response: {command_id}"),
            &format!("invoking agent-facing Plugin Command {command_id}"),
            crate::plugin_rpc::DEFAULT_TIMEOUT,
        )
        .await
    }

    pub async fn deactivate_backend(&self, plugin_id: &str) -> Result<Value, String> {
        let params = json!({ "pluginId": plugin_id });
        let (request_id, request) =
            crate::plugin_rpc::format_request("plugin", "backend.deactivate", params);
        self.send_request_and_wait(
            request_id,
            &request,
            &format!("plugin backend deactivation: {plugin_id}"),
            &format!("deactivating plugin backend: {plugin_id}"),
            crate::plugin_rpc::DEFAULT_TIMEOUT,
        )
        .await
    }

    /// Requests bounded V8 and per-plugin lifecycle metrics from a running plugin host.
    ///
    /// Returns `Ok(None)` without starting the plugin host when it is stopped.
    ///
    /// # Errors
    ///
    /// Returns an error when transport I/O, timeout handling, or response deserialization fails.
    pub async fn process_diagnostics(
        &self,
    ) -> Result<Option<super::PluginHostRuntimeDiagnostics>, String> {
        if !self.is_sidecar_running() {
            return Ok(None);
        }

        let (request_id, request) =
            crate::plugin_rpc::format_request("plugin", "host.diagnostics", json!({}));
        let value = self
            .send_request_and_wait(
                request_id,
                &request,
                "plugin host process diagnostics",
                "collecting plugin host process diagnostics",
                crate::plugin_rpc::DEFAULT_TIMEOUT,
            )
            .await?;
        serde_json::from_value(value)
            .map(Some)
            .map_err(|error| format!("invalid plugin host process diagnostics: {error}"))
    }

    async fn send_request_and_wait(
        &self,
        request_id: u64,
        request: &str,
        timeout_context: &str,
        closed_context: &str,
        wait_timeout: Duration,
    ) -> Result<Value, String> {
        if !self.is_sidecar_running() {
            self.start_sidecar().await?;
        }

        self.wait_for_transport_ready().await?;

        let (response_tx, response_rx) = oneshot::channel();
        let writer = {
            let mut transport = self.transport_lock()?;
            let writer = transport
                .writer
                .as_ref()
                .cloned()
                .ok_or_else(|| "plugin backend transport not connected".to_string())?;
            transport.pending.insert(request_id, response_tx);
            writer
        };

        if let Err(error) = self.write_request(writer, request_id, request).await {
            self.remove_pending_request(request_id);
            return Err(error);
        }

        timeout(wait_timeout, response_rx)
            .await
            .map_err(|_| {
                self.remove_pending_request(request_id);
                format!("timed out waiting for {timeout_context}")
            })?
            .map_err(|_| format!("plugin backend transport closed while {closed_context}"))?
    }

    async fn wait_for_transport_ready(&self) -> Result<(), String> {
        loop {
            let notified = self.state_change.notified();

            let (state, desired_running, session_id, process_token) = {
                let runtime = self.runtime_lock()?;
                (
                    runtime.state.clone(),
                    runtime.desired_running,
                    runtime.session_id,
                    runtime.process_token,
                )
            };

            let writer_ready = {
                let transport = self.transport_lock()?;
                transport.writer.is_some()
                    && transport.session_id == session_id
                    && transport.process_token == process_token
            };

            match state {
                SidecarState::Running if writer_ready => return Ok(()),
                SidecarState::Running | SidecarState::Starting if desired_running => {
                    notified.await;
                }
                SidecarState::Running | SidecarState::Starting => {
                    return Err("plugin sidecar is not accepting backend invocations".to_string());
                }
                SidecarState::Stopping => {
                    return Err("plugin sidecar is stopping".to_string());
                }
                SidecarState::Stopped => {
                    return Err("plugin sidecar is not running".to_string());
                }
                SidecarState::Crashed => {
                    return Err("plugin sidecar crashed before transport became ready".to_string());
                }
            }
        }
    }
    pub(super) async fn read_sidecar_stdout(
        &self,
        stdout: tokio::process::ChildStdout,
        session_id: u64,
        process_token: u64,
    ) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            match crate::plugin_rpc::parse_message(&line) {
                Ok(crate::plugin_rpc::ParsedMessage::Response(response)) => {
                    let sender = match self.transport_lock() {
                        Ok(mut transport) => {
                            if transport.session_id != session_id
                                || transport.process_token != process_token
                            {
                                None
                            } else {
                                transport.pending.remove(&response.id)
                            }
                        }
                        Err(error) => {
                            warn!("[plugin_host] failed to lock transport state: {}", error);
                            None
                        }
                    };

                    if let Some(sender) = sender {
                        let result = match response.result {
                            crate::plugin_rpc::RpcResult::Success(value) => Ok(value),
                            crate::plugin_rpc::RpcResult::Error(code, message) => {
                                Err(crate::plugin_rpc::rpc_error_from_code(code, &message))
                            }
                        };
                        let _ = sender.send(result);
                    }
                }
                Ok(crate::plugin_rpc::ParsedMessage::Request(request)) => {
                    // Service host callbacks concurrently. If we awaited each one
                    // inline, a slow callback (a GitHub diff fetch, or a long
                    // agent generation) would head-of-line block this single
                    // reader loop and starve every other in-flight plugin RPC —
                    // including method responses — until they hit the 30s timeout.
                    // Each callback is an independent JSON-RPC request matched by
                    // id, so out-of-order completion is safe.
                    let host = self.clone();
                    tokio::spawn(async move {
                        host.handle_sidecar_host_callback(request, session_id, process_token)
                            .await;
                    });
                }
                Err(error) => {
                    warn!("[plugin_host] failed to parse sidecar message: {}", error.0);
                }
            }
        }
    }

    async fn handle_sidecar_host_callback(
        &self,
        request: crate::plugin_rpc::ParsedRequest,
        session_id: u64,
        process_token: u64,
    ) {
        let response = match self
            .handle_host_callback(&request.method, &request.params)
            .await
        {
            Ok(result) => crate::plugin_rpc::format_success_response(request.id, result),
            Err(error) => crate::plugin_rpc::format_error_response(request.id, -32603, &error),
        };

        let writer = match self.transport_lock() {
            Ok(transport) => {
                if transport.session_id != session_id || transport.process_token != process_token {
                    None
                } else {
                    transport.writer.as_ref().cloned()
                }
            }
            Err(error) => {
                warn!(
                    "[plugin_host] failed to lock transport for host callback: {}",
                    error
                );
                None
            }
        };

        let Some(writer) = writer else {
            warn!(
                "[plugin_host] cannot respond to sidecar host callback {}: transport unavailable",
                request.method
            );
            return;
        };

        if let Err(error) = self.write_response(writer, request.id, &response).await {
            warn!(
                "[plugin_host] failed to write sidecar host callback response for {}: {}",
                request.method, error
            );
        }
    }

    async fn write_request(
        &self,
        writer: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
        request_id: u64,
        request: &str,
    ) -> Result<(), String> {
        self.write_framed_message(writer, request_id, request, "request")
            .await
    }

    async fn write_response(
        &self,
        writer: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
        response_id: u64,
        response: &str,
    ) -> Result<(), String> {
        self.write_framed_message(writer, response_id, response, "response")
            .await
    }

    async fn write_framed_message(
        &self,
        writer: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
        message_id: u64,
        message: &str,
        kind: &str,
    ) -> Result<(), String> {
        let mut writer = writer.lock().await;
        writer
            .write_all(message.as_bytes())
            .await
            .map_err(|error| format!("failed to write plugin {kind} {message_id}: {error}"))?;
        writer
            .write_all(b"\n")
            .await
            .map_err(|error| format!("failed to frame plugin {kind} {message_id}: {error}"))?;
        writer
            .flush()
            .await
            .map_err(|error| format!("failed to flush plugin {kind} {message_id}: {error}"))
    }

    fn remove_pending_request(&self, request_id: u64) {
        if let Ok(mut transport) = self.transport_lock() {
            transport.pending.remove(&request_id);
        }
    }

    pub(super) fn reset_transport(&self, session_id: u64, process_token: u64, error: &str) {
        let mut pending = Vec::new();
        if let Ok(mut transport) = self.transport_lock() {
            if transport.session_id != session_id {
                return;
            }
            if process_token != 0 && transport.process_token != process_token {
                return;
            }

            transport.writer = None;
            pending = transport
                .pending
                .drain()
                .map(|(_, sender)| sender)
                .collect();
        }

        for sender in pending {
            let _ = sender.send(Err(error.to_string()));
        }
    }
}
