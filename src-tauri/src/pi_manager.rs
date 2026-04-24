use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);
const PI_BUFFER_CAPACITY: usize = 262_144;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PiStreamingBehavior {
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PiRpcCommand {
    Prompt {
        message: String,
        #[serde(rename = "streamingBehavior", skip_serializing_if = "Option::is_none")]
        streaming_behavior: Option<PiStreamingBehavior>,
        id: u64,
    },
    Abort {
        id: u64,
    },
    GetState {
        id: u64,
    },
    SwitchSession {
        #[serde(rename = "sessionPath")]
        session_path: String,
        id: u64,
    },
    NewSession {
        id: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionState {
    #[serde(default)]
    pub is_streaming: bool,
    #[serde(default)]
    pub session_file: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PiRpcResponse {
    pub command: String,
    pub success: bool,
    pub state: Option<PiSessionState>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageUpdatePayload {
    #[serde(rename = "type")]
    pub type_field: String,
    #[serde(default)]
    pub delta: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default, alias = "sessionId")]
    pub session_id: Option<String>,
    #[serde(default, alias = "messageId")]
    pub message_id: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PiRpcEvent {
    AgentStart,
    AgentEnd {
        messages: Option<Value>,
    },
    MessageUpdate {
        assistant_message_event: MessageUpdatePayload,
    },
    ToolExecutionStart,
    ToolExecutionEnd,
    QueueUpdate,
    Unknown {
        event_type: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum PiRpcMessage {
    Event(PiRpcEvent),
    Response(PiRpcResponse),
}

#[derive(Debug)]
struct PiRingBuffer {
    data: Vec<u8>,
}

impl PiRingBuffer {
    fn new() -> Self {
        Self {
            data: Vec::with_capacity(PI_BUFFER_CAPACITY),
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
        if self.data.len() > PI_BUFFER_CAPACITY {
            let excess = self.data.len() - PI_BUFFER_CAPACITY;
            self.data.drain(0..excess);
        }
    }

    fn snapshot(&self) -> String {
        String::from_utf8_lossy(&self.data).to_string()
    }
}

#[derive(Debug)]
struct PiProcess {
    child: Child,
    stdin: ChildStdin,
    instance_id: u64,
    session_id: Option<String>,
    session_path: Option<String>,
    is_streaming: bool,
    terminal_input: String,
    output_buffer: PiRingBuffer,
}

#[derive(Debug, PartialEq)]
struct FrontendEvent {
    name: String,
    payload: Value,
}

#[derive(Debug)]
pub struct PiManager {
    next_request_id: Arc<AtomicU64>,
    processes: Arc<Mutex<HashMap<String, PiProcess>>>,
    command_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct AgentEndEvent {
    #[serde(default)]
    messages: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct MessageUpdateEvent {
    #[serde(rename = "assistantMessageEvent")]
    assistant_message_event: MessageUpdatePayload,
}

#[derive(Debug, Deserialize)]
struct EventEnvelope {
    #[serde(rename = "type")]
    event_type: String,
}

#[derive(Debug, Deserialize)]
struct ResponseEnvelope {
    command: String,
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Option<Value>,
}

impl PiManager {
    pub fn new() -> Self {
        Self {
            next_request_id: Arc::new(AtomicU64::new(1)),
            processes: Arc::new(Mutex::new(HashMap::new())),
            command_path: PathBuf::from("pi"),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_binary(command_path: PathBuf) -> Self {
        Self {
            next_request_id: Arc::new(AtomicU64::new(1)),
            processes: Arc::new(Mutex::new(HashMap::new())),
            command_path,
        }
    }

    pub fn next_request_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::Relaxed)
    }

    pub async fn spawn<R: tauri::Runtime>(
        &self,
        task_id: &str,
        cwd: &Path,
        app: tauri::AppHandle<R>,
    ) -> Result<u64, String> {
        let mut processes = self.processes.lock().await;

        if let Some(existing_process) = processes.get_mut(task_id) {
            match existing_process.child.try_wait() {
                Ok(None) => return Ok(existing_process.instance_id),
                Ok(Some(_)) | Err(_) => {
                    processes.remove(task_id);
                }
            }
        }

        let mut child = Command::new(&self.command_path)
            .args(["--mode", "rpc"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(cwd)
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("failed to spawn pi rpc process: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to capture pi rpc stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to capture pi rpc stdout".to_string())?;
        let stdout = BufReader::new(stdout);
        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);

        processes.insert(
            task_id.to_string(),
            PiProcess {
                child,
                stdin,
                instance_id,
                session_id: None,
                session_path: None,
                is_streaming: false,
                terminal_input: String::new(),
                output_buffer: PiRingBuffer::new(),
            },
        );

        drop(processes);

        let reader_task_id = task_id.to_string();
        let reader_processes = Arc::clone(&self.processes);
        tauri::async_runtime::spawn(async move {
            let mut reader = stdout;
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        emit_frontend_events(&app, eof_event(&reader_task_id, instance_id));
                        remove_process_if_instance_matches(
                            &reader_processes,
                            &reader_task_id,
                            instance_id,
                        )
                        .await;
                        break;
                    }
                    Ok(_) => {
                        let Ok(message) = parse_output_line(&line) else {
                            continue;
                        };

                        match &message {
                            PiRpcMessage::Event(event) => {
                                apply_event_to_process(
                                    &reader_processes,
                                    &reader_task_id,
                                    instance_id,
                                    event,
                                )
                                .await;

                                emit_frontend_events(
                                    &app,
                                    frontend_events_for_pi_event(&reader_task_id, instance_id, event),
                                );
                            }
                            PiRpcMessage::Response(response) => {
                                apply_response_to_process(
                                    &reader_processes,
                                    &reader_task_id,
                                    instance_id,
                                    response,
                                )
                                .await;
                            }
                        }
                    }
                    Err(_) => {
                        remove_process_if_instance_matches(
                            &reader_processes,
                            &reader_task_id,
                            instance_id,
                        )
                        .await;
                        break;
                    }
                }
            }
        });

        Ok(instance_id)
    }

    pub async fn send_command(&self, task_id: &str, command: &PiRpcCommand) -> Result<(), String> {
        let mut processes = self.processes.lock().await;
        let process = processes
            .get_mut(task_id)
            .ok_or_else(|| format!("no pi rpc process found for task: {task_id}"))?;
        let request = format_request(command)?;

        process
            .stdin
            .write_all(request.as_bytes())
            .await
            .map_err(|error| format!("failed to write pi rpc command: {error}"))?;
        process
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("failed to write pi rpc newline: {error}"))?;
        process
            .stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush pi rpc stdin: {error}"))
    }

    pub async fn request_state(&self, task_id: &str) -> Result<(), String> {
        self.send_command(
            task_id,
            &PiRpcCommand::GetState {
                id: self.next_request_id(),
            },
        )
        .await
    }

    pub async fn prompt(&self, task_id: &str, message: &str) -> Result<(), String> {
        let streaming_behavior = self
            .is_streaming(task_id)
            .await
            .unwrap_or(false)
            .then_some(PiStreamingBehavior::Steer);

        self.send_command(
            task_id,
            &PiRpcCommand::Prompt {
                message: message.to_string(),
                streaming_behavior,
                id: self.next_request_id(),
            },
        )
        .await
    }

    pub async fn kill(&self, task_id: &str) -> Result<(), String> {
        let mut process = {
            let mut processes = self.processes.lock().await;
            processes
                .remove(task_id)
                .ok_or_else(|| format!("no pi rpc process found for task: {task_id}"))?
        };

        let abort_request_id = self.next_request_id();
        if let Ok(request) = format_request(&PiRpcCommand::Abort {
            id: abort_request_id,
        }) {
            let _ = process.stdin.write_all(request.as_bytes()).await;
            let _ = process.stdin.write_all(b"\n").await;
            let _ = process.stdin.flush().await;
        }

        match process.child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => {
                process
                    .child
                    .kill()
                    .await
                    .map_err(|error| format!("failed to kill pi rpc process: {error}"))?;
                let _ = timeout(Duration::from_secs(2), process.child.wait()).await;
                Ok(())
            }
            Err(error) => Err(format!("failed to inspect pi rpc process: {error}")),
        }
    }

    pub async fn is_running(&self, task_id: &str) -> bool {
        let mut processes = self.processes.lock().await;
        let Some(process) = processes.get_mut(task_id) else {
            return false;
        };

        match process.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => {
                processes.remove(task_id);
                false
            }
        }
    }

    pub async fn kill_all(&self) -> Result<(), String> {
        let task_ids = {
            let processes = self.processes.lock().await;
            processes.keys().cloned().collect::<Vec<_>>()
        };

        for task_id in task_ids {
            self.kill(&task_id).await?;
        }

        Ok(())
    }

    pub async fn get_session_id(&self, task_id: &str) -> Option<String> {
        let processes = self.processes.lock().await;
        processes
            .get(task_id)
            .and_then(|process| process.session_id.clone())
    }

    pub async fn get_session_path(&self, task_id: &str) -> Option<String> {
        let processes = self.processes.lock().await;
        processes
            .get(task_id)
            .and_then(|process| process.session_path.clone())
    }

    pub async fn reset_session_state(&self, task_id: &str) {
        let mut processes = self.processes.lock().await;
        if let Some(process) = processes.get_mut(task_id) {
            process.session_id = None;
            process.session_path = None;
            process.is_streaming = false;
        }
    }

    pub async fn get_output_buffer(&self, task_id: &str) -> Option<String> {
        let processes = self.processes.lock().await;
        processes.get(task_id).map(|process| process.output_buffer.snapshot())
    }

    pub async fn is_streaming(&self, task_id: &str) -> Option<bool> {
        let processes = self.processes.lock().await;
        processes.get(task_id).map(|process| process.is_streaming)
    }

    pub async fn handle_terminal_input<R: tauri::Runtime>(
        &self,
        task_id: &str,
        data: &str,
        app: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        let mut skip_line_feed = false;

        for character in data.chars() {
            if skip_line_feed && character == '\n' {
                skip_line_feed = false;
                continue;
            }
            skip_line_feed = character == '\r';

            let action = self
                .apply_terminal_character(task_id, character)
                .await?;

            if let Some(echoed) = action.echoed_output.as_deref() {
                emit_frontend_events(app, terminal_output_events(task_id, action.instance_id, echoed));
            }

            if let Some(command) = action.command.as_ref() {
                self.send_command(task_id, command).await?;
            }
        }

        Ok(())
    }

    async fn apply_terminal_character(
        &self,
        task_id: &str,
        character: char,
    ) -> Result<TerminalInputAction, String> {
        let mut processes = self.processes.lock().await;
        let process = processes
            .get_mut(task_id)
            .ok_or_else(|| format!("no pi rpc process found for task: {task_id}"))?;

        let mut echoed_output = None;
        let mut command = None;

        match character {
            '\u{3}' => {
                process.terminal_input.clear();
                echoed_output = Some("^C\r\n".to_string());
                command = Some(PiRpcCommand::Abort {
                    id: self.next_request_id(),
                });
            }
            '\r' | '\n' => {
                let message = std::mem::take(&mut process.terminal_input);
                echoed_output = Some("\r\n".to_string());
                if !message.is_empty() {
                    command = Some(PiRpcCommand::Prompt {
                        message,
                        streaming_behavior: process
                            .is_streaming
                            .then_some(PiStreamingBehavior::Steer),
                        id: self.next_request_id(),
                    });
                }
            }
            '\u{8}' | '\u{7f}' => {
                if process.terminal_input.pop().is_some() {
                    echoed_output = Some("\u{8} \u{8}".to_string());
                }
            }
            _ if !character.is_control() => {
                process.terminal_input.push(character);
                echoed_output = Some(character.to_string());
            }
            _ => {}
        }

        if let Some(output) = echoed_output.as_ref() {
            process.output_buffer.push(output.as_bytes());
        }

        Ok(TerminalInputAction {
            instance_id: process.instance_id,
            echoed_output,
            command,
        })
    }
}

impl Clone for PiManager {
    fn clone(&self) -> Self {
        Self {
            next_request_id: Arc::clone(&self.next_request_id),
            processes: Arc::clone(&self.processes),
            command_path: self.command_path.clone(),
        }
    }
}

fn frontend_events_for_pi_event(
    task_id: &str,
    instance_id: u64,
    event: &PiRpcEvent,
) -> Vec<FrontendEvent> {
    match event {
        PiRpcEvent::MessageUpdate {
            assistant_message_event,
        } => assistant_message_event
            .delta
            .as_ref()
            .map(|delta| terminal_output_events(task_id, instance_id, delta))
            .into_iter()
            .flatten()
            .collect(),
        PiRpcEvent::AgentEnd { .. } => vec![FrontendEvent {
            name: format!("pi-complete-{task_id}"),
            payload: serde_json::json!({
                "task_id": task_id,
                "instance_id": instance_id,
                "reason": "agent_end",
            }),
        }],
        _ => Vec::new(),
    }
}

fn eof_event(task_id: &str, instance_id: u64) -> Vec<FrontendEvent> {
    vec![
        FrontendEvent {
            name: format!("pi-complete-{task_id}"),
            payload: serde_json::json!({
                "task_id": task_id,
                "instance_id": instance_id,
                "reason": "eof",
            }),
        },
        FrontendEvent {
            name: format!("pty-exit-{task_id}"),
            payload: serde_json::json!({
                "task_id": task_id,
                "instance_id": instance_id,
            }),
        },
    ]
}

fn terminal_output_events(task_id: &str, instance_id: u64, data: &str) -> Vec<FrontendEvent> {
    vec![
        FrontendEvent {
            name: format!("pi-output-{task_id}"),
            payload: serde_json::json!({
                "task_id": task_id,
                "instance_id": instance_id,
                "data": data,
            }),
        },
        FrontendEvent {
            name: format!("pty-output-{task_id}"),
            payload: serde_json::json!({
                "task_id": task_id,
                "instance_id": instance_id,
                "data": data,
            }),
        },
    ]
}

fn emit_frontend_events<R: tauri::Runtime>(app: &tauri::AppHandle<R>, events: Vec<FrontendEvent>) {
    for event in events {
        let _ = app.emit(&event.name, event.payload);
    }
}

#[derive(Debug, PartialEq)]
struct TerminalInputAction {
    instance_id: u64,
    echoed_output: Option<String>,
    command: Option<PiRpcCommand>,
}

async fn apply_event_to_process(
    processes: &Arc<Mutex<HashMap<String, PiProcess>>>,
    task_id: &str,
    instance_id: u64,
    event: &PiRpcEvent,
) {
    let mut processes = processes.lock().await;
    if let Some(process) = processes.get_mut(task_id) {
        if process.instance_id == instance_id {
            match event {
                PiRpcEvent::AgentStart => {
                    process.is_streaming = true;
                }
                PiRpcEvent::AgentEnd { .. } => {
                    process.is_streaming = false;
                }
                PiRpcEvent::MessageUpdate {
                    assistant_message_event,
                } => {
                    if let Some(session_id) = assistant_message_event.session_id.clone() {
                        process.session_id = Some(session_id);
                    }
                    if let Some(delta) = assistant_message_event.delta.as_ref() {
                        process.output_buffer.push(delta.as_bytes());
                    }
                }
                _ => {}
            }
        }
    }
}

async fn apply_response_to_process(
    processes: &Arc<Mutex<HashMap<String, PiProcess>>>,
    task_id: &str,
    instance_id: u64,
    response: &PiRpcResponse,
) {
    let mut processes = processes.lock().await;
    if let Some(process) = processes.get_mut(task_id) {
        if process.instance_id == instance_id {
            if let Some(state) = response.state.as_ref() {
                process.is_streaming = state.is_streaming;
                if let Some(session_id) = state.session_id.clone() {
                    process.session_id = Some(session_id);
                }
                if let Some(session_path) = state.session_file.clone() {
                    process.session_path = Some(session_path);
                }
            }
        }
    }
}

async fn remove_process_if_instance_matches(
    processes: &Arc<Mutex<HashMap<String, PiProcess>>>,
    task_id: &str,
    instance_id: u64,
) {
    let mut processes = processes.lock().await;
    let should_remove = processes
        .get(task_id)
        .map(|process| process.instance_id == instance_id)
        .unwrap_or(false);
    if should_remove {
        processes.remove(task_id);
    }
}

pub fn format_request(command: &PiRpcCommand) -> Result<String, String> {
    serde_json::to_string(command)
        .map_err(|error| format!("failed to serialize Pi RPC command: {error}"))
}

pub fn parse_output_line(line: &str) -> Result<PiRpcMessage, String> {
    let json_line = line.strip_suffix('\n').unwrap_or(line);

    let envelope: EventEnvelope = serde_json::from_str(json_line)
        .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?;

    if envelope.event_type == "response" {
        let response: ResponseEnvelope = serde_json::from_str(json_line)
            .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?;
        let state = match (response.command.as_str(), response.success, response.data.as_ref()) {
            ("get_state", true, Some(data)) => Some(
                serde_json::from_value::<PiSessionState>(data.clone())
                    .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?,
            ),
            _ => None,
        };

        return Ok(PiRpcMessage::Response(PiRpcResponse {
            command: response.command,
            success: response.success,
            state,
        }));
    }

    parse_event(json_line).map(PiRpcMessage::Event)
}

pub fn parse_event(line: &str) -> Result<PiRpcEvent, String> {
    let json_line = line.strip_suffix('\n').unwrap_or(line);

    let envelope: EventEnvelope = serde_json::from_str(json_line)
        .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?;

    match envelope.event_type.as_str() {
        "agent_start" => Ok(PiRpcEvent::AgentStart),
        "agent_end" => {
            let event: AgentEndEvent = serde_json::from_str(json_line)
                .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?;
            Ok(PiRpcEvent::AgentEnd {
                messages: event.messages,
            })
        }
        "message_update" => {
            let event: MessageUpdateEvent = serde_json::from_str(json_line)
                .map_err(|error| format!("failed to parse Pi RPC event: {error}"))?;
            Ok(PiRpcEvent::MessageUpdate {
                assistant_message_event: event.assistant_message_event,
            })
        }
        "tool_execution_start" => Ok(PiRpcEvent::ToolExecutionStart),
        "tool_execution_end" => Ok(PiRpcEvent::ToolExecutionEnd),
        "queue_update" => Ok(PiRpcEvent::QueueUpdate),
        other => Ok(PiRpcEvent::Unknown {
            event_type: other.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tempfile::TempDir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn mock_app_handle() -> tauri::AppHandle<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build")
            .handle()
            .clone()
    }

    fn write_fake_pi_script(temp_dir: &TempDir, body: &str) -> Result<(), String> {
        let script_path = temp_dir.path().join("pi");
        let script = format!("#!/bin/sh\n{}", body);
        fs::write(&script_path, script)
            .map_err(|error| format!("failed to write fake pi script: {error}"))?;

        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&script_path)
                .map_err(|error| format!("failed to stat fake pi script: {error}"))?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions)
                .map_err(|error| format!("failed to chmod fake pi script: {error}"))?;
        }

        Ok(())
    }

    async fn manager_with_fake_pi(script_body: &str) -> Result<(PiManager, TempDir), String> {
        let temp_dir = tempfile::tempdir().map_err(|error| format!("tempdir failed: {error}"))?;
        write_fake_pi_script(&temp_dir, script_body)?;
        let manager = PiManager::with_binary(temp_dir.path().join("pi"));
        Ok((manager, temp_dir))
    }

    #[test]
    fn test_pi_rpc_request_format() {
        let raw = format_request(&PiRpcCommand::Prompt {
            message: "hello".to_string(),
            streaming_behavior: None,
            id: 1,
        })
        .expect("request should serialize");

        assert_eq!(raw, r#"{"type":"prompt","message":"hello","id":1}"#);
    }

    #[test]
    fn test_pi_rpc_response_parse_success() {
        let event = parse_event(r#"{"type":"agent_end","messages":[{"role":"assistant"}]}"#)
            .expect("event should parse");

        assert_eq!(
            event,
            PiRpcEvent::AgentEnd {
                messages: Some(json!([{"role":"assistant"}]))
            }
        );
    }

    #[test]
    fn test_pi_rpc_response_parse_error() {
        let error = parse_event(r#"{"type":"message_update","assistantMessageEvent":invalid}"#)
            .expect_err("malformed json should error");

        assert!(error.contains("failed to parse Pi RPC event"));
    }

    #[test]
    fn test_pi_rpc_event_parse_text_delta() {
        let event = parse_event(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}"#,
        )
        .expect("message update should parse");

        assert_eq!(
            event,
            PiRpcEvent::MessageUpdate {
                assistant_message_event: MessageUpdatePayload {
                    type_field: "text_delta".to_string(),
                    delta: Some("hello".to_string()),
                    id: None,
                    role: None,
                    session_id: None,
                    message_id: None,
                    metadata: None,
                }
            }
        );
    }

    #[test]
    fn test_pi_rpc_event_parse_agent_end() {
        let event = parse_event(r#"{"type":"agent_end"}"#).expect("agent end should parse");

        assert_eq!(event, PiRpcEvent::AgentEnd { messages: None });
    }

    #[test]
    fn test_pi_rpc_event_parse_unknown_type() {
        let event = parse_event(r#"{"type":"mystery_event","foo":"bar"}"#)
            .expect("unknown event should parse");

        assert_eq!(
            event,
            PiRpcEvent::Unknown {
                event_type: "mystery_event".to_string()
            }
        );
    }

    #[test]
    fn test_pi_manager_request_ids_increment() {
        let manager = PiManager::new();

        let id1 = manager.next_request_id();
        let id2 = manager.next_request_id();

        assert_eq!(id2, id1 + 1);
    }

    #[test]
    fn test_pi_rpc_command_switch_session_uses_session_path() {
        let raw = format_request(&PiRpcCommand::SwitchSession {
            session_path: "/tmp/session-123.jsonl".to_string(),
            id: 3,
        })
        .expect("request should serialize");

        assert_eq!(
            raw,
            r#"{"type":"switch_session","sessionPath":"/tmp/session-123.jsonl","id":3}"#
        );
    }

    #[test]
    fn test_parse_output_line_get_state_response_captures_session() {
        let message = parse_output_line(
            r#"{"type":"response","command":"get_state","success":true,"data":{"isStreaming":true,"sessionFile":"/tmp/pi-session.jsonl","sessionId":"pi-session-123"}}"#,
        )
        .expect("response should parse");

        assert_eq!(
            message,
            PiRpcMessage::Response(PiRpcResponse {
                command: "get_state".to_string(),
                success: true,
                state: Some(PiSessionState {
                    is_streaming: true,
                    session_file: Some("/tmp/pi-session.jsonl".to_string()),
                    session_id: Some("pi-session-123".to_string()),
                }),
            })
        );
    }

    #[test]
    fn test_pi_reader_frontend_events_emit_terminal_compatible_output_and_only_eof_exit() {
        let output_event = frontend_events_for_pi_event(
            "task-1",
            42,
            &PiRpcEvent::MessageUpdate {
                assistant_message_event: MessageUpdatePayload {
                    type_field: "text_delta".to_string(),
                    delta: Some("hello".to_string()),
                    id: None,
                    role: None,
                    session_id: None,
                    message_id: None,
                    metadata: None,
                },
            },
        );
        let completion_event =
            frontend_events_for_pi_event("task-1", 42, &PiRpcEvent::AgentEnd { messages: None });

        assert_eq!(
            output_event,
            vec![
                FrontendEvent {
                    name: "pi-output-task-1".to_string(),
                    payload: json!({ "task_id": "task-1", "instance_id": 42, "data": "hello" }),
                },
                FrontendEvent {
                    name: "pty-output-task-1".to_string(),
                    payload: json!({ "task_id": "task-1", "instance_id": 42, "data": "hello" }),
                }
            ]
        );
        assert_eq!(
            completion_event,
            vec![FrontendEvent {
                name: "pi-complete-task-1".to_string(),
                payload: json!({ "task_id": "task-1", "instance_id": 42, "reason": "agent_end" }),
            }]
        );
        assert_eq!(
            eof_event("task-1", 42),
            vec![
                FrontendEvent {
                    name: "pi-complete-task-1".to_string(),
                    payload: json!({ "task_id": "task-1", "instance_id": 42, "reason": "eof" }),
                },
                FrontendEvent {
                    name: "pty-exit-task-1".to_string(),
                    payload: json!({ "task_id": "task-1", "instance_id": 42 }),
                }
            ]
        );
    }

    #[tokio::test]
    async fn test_terminal_input_buffers_echoes_and_submits_plain_prompt() {
        let log_dir = tempfile::tempdir().expect("tempdir should be created");
        let log_path = log_dir.path().join("commands.log");
        let script = format!(
            r#"
LOG_FILE="{}"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$LOG_FILE"
  while :; do sleep 1; done
done
"#,
            log_path.display()
        );
        let (manager, _temp_dir) = manager_with_fake_pi(&script)
            .await
            .expect("manager should be created");
        let app = mock_app_handle();

        manager
            .spawn("task-tty", Path::new("."), app.clone())
            .await
            .expect("spawn should succeed");

        manager
            .handle_terminal_input("task-tty", "hello\u{7f}o\r", &app)
            .await
            .expect("terminal input should succeed");

        timeout(Duration::from_secs(2), async {
            loop {
                let contents = tokio::fs::read_to_string(&log_path).await.unwrap_or_default();
                if contents.contains(r#"{"type":"prompt","message":"hello","id":1}"#) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("prompt should be forwarded");

        let buffer = manager
            .get_output_buffer("task-tty")
            .await
            .expect("buffer should exist");
        assert!(buffer.contains("hello\u{8} \u{8}o\r\n"));

        manager.kill("task-tty").await.expect("kill should succeed");
    }

    #[tokio::test]
    async fn test_terminal_input_uses_steer_when_pi_is_streaming() {
        let log_dir = tempfile::tempdir().expect("tempdir should be created");
        let log_path = log_dir.path().join("commands.log");
        let script = format!(
            r#"
LOG_FILE="{}"
printf '%s\n' '{{"type":"agent_start"}}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$LOG_FILE"
  while :; do sleep 1; done
done
"#,
            log_path.display()
        );
        let (manager, _temp_dir) = manager_with_fake_pi(&script)
            .await
            .expect("manager should be created");
        let app = mock_app_handle();

        manager
            .spawn("task-streaming", Path::new("."), app.clone())
            .await
            .expect("spawn should succeed");

        timeout(Duration::from_secs(2), async {
            loop {
                if manager.is_streaming("task-streaming").await == Some(true) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("streaming state should update");

        manager
            .handle_terminal_input("task-streaming", "follow up\n", &app)
            .await
            .expect("terminal input should succeed");

        timeout(Duration::from_secs(2), async {
            loop {
                let contents = tokio::fs::read_to_string(&log_path).await.unwrap_or_default();
                if contents.contains(r#""streamingBehavior":"steer""#) {
                    assert!(contents.contains(r#""message":"follow up""#));
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("steer prompt should be forwarded");

        manager
            .kill("task-streaming")
            .await
            .expect("kill should succeed");
    }

    #[tokio::test]
    async fn test_pi_manager_spawn_tracks_running_process() {
        let (manager, _temp_dir) = manager_with_fake_pi("while :; do sleep 1; done\n")
            .await
            .expect("manager should be created");
        let app = mock_app_handle();
        let cwd = Path::new(".");

        let instance_id = manager
            .spawn("task-1", cwd, app)
            .await
            .expect("spawn should succeed");

        assert!(instance_id > 0);
        assert!(manager.is_running("task-1").await);

        manager.kill("task-1").await.expect("kill should succeed");
    }

    #[tokio::test]
    async fn test_pi_manager_spawn_reader_tracks_session_id_from_stdout_events() {
        let script = r#"
printf '%s\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello","sessionId":"session-123"}}'
while :; do sleep 1; done
"#;
        let (manager, _temp_dir) = manager_with_fake_pi(script)
            .await
            .expect("manager should be created");
        let app = mock_app_handle();
        let cwd = Path::new(".");

        manager
            .spawn("task-bridge", cwd, app)
            .await
            .expect("spawn should succeed");

        timeout(Duration::from_secs(2), async {
            loop {
                if manager.get_session_id("task-bridge").await.as_deref() == Some("session-123") {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("background reader should capture session id");

        manager
            .kill("task-bridge")
            .await
            .expect("kill should succeed");
    }

    #[tokio::test]
    async fn test_pi_manager_kill_removes_process() {
        let (manager, _temp_dir) = manager_with_fake_pi("while :; do sleep 1; done\n")
            .await
            .expect("manager should be created");
        let app = mock_app_handle();
        let cwd = Path::new(".");

        manager
            .spawn("task-1", cwd, app)
            .await
            .expect("spawn should succeed");

        manager.kill("task-1").await.expect("kill should succeed");

        assert!(!manager.is_running("task-1").await);
    }

    #[tokio::test]
    async fn test_pi_manager_tracks_concurrent_tasks_independently() {
        let (manager, _temp_dir) = manager_with_fake_pi("while :; do sleep 1; done\n")
            .await
            .expect("manager should be created");
        let app = mock_app_handle();
        let cwd = Path::new(".");

        let first_instance = manager
            .spawn("task-1", cwd, app.clone())
            .await
            .expect("first spawn should succeed");
        let second_instance = manager
            .spawn("task-2", cwd, app)
            .await
            .expect("second spawn should succeed");

        assert_ne!(first_instance, second_instance);
        assert!(manager.is_running("task-1").await);
        assert!(manager.is_running("task-2").await);

        manager.kill_all().await.expect("kill_all should succeed");

        assert!(!manager.is_running("task-1").await);
        assert!(!manager.is_running("task-2").await);
    }
}
