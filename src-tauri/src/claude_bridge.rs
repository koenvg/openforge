use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

use crate::db;
use crate::sse_bridge::{AgentEventPayload, CompletionPayload, FailurePayload};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum ClaudeBridgeError {
    AlreadyRunning(String),
    IoError(std::io::Error),
}

impl std::fmt::Display for ClaudeBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeBridgeError::AlreadyRunning(task_id) => {
                write!(f, "Claude bridge already running for task: {}", task_id)
            }
            ClaudeBridgeError::IoError(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl std::error::Error for ClaudeBridgeError {}

// ============================================================================
// Bridge Handle
// ============================================================================

/// Handle for a running Claude bridge (private)
struct BridgeHandle {
    cancel_tx: tokio::sync::oneshot::Sender<()>,
}

// ============================================================================
// Claude Bridge Manager
// ============================================================================

/// Manages multiple concurrent Claude NDJSON stdout bridges (one per active task)
pub struct ClaudeBridgeManager {
    bridges: Arc<Mutex<HashMap<String, BridgeHandle>>>,
}

impl ClaudeBridgeManager {
    /// Create a new Claude bridge manager
    pub fn new() -> Self {
        Self {
            bridges: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a new Claude bridge for a task
    ///
    /// # Arguments
    /// * `app` - Tauri application handle for event emission and DB access
    /// * `task_id` - Unique identifier for this task
    /// * `stdout` - The piped stdout from the spawned Claude process
    ///
    /// # Returns
    /// * `Ok(())` if bridge started successfully
    /// * `Err(ClaudeBridgeError::AlreadyRunning)` if bridge already exists for this task_id
    pub async fn start_bridge(
        &self,
        app: AppHandle,
        task_id: String,
        stdout: tokio::process::ChildStdout,
    ) -> Result<(), ClaudeBridgeError> {
        {
            let bridges = self.bridges.lock().await;
            if bridges.contains_key(&task_id) {
                return Err(ClaudeBridgeError::AlreadyRunning(task_id));
            }
        }

        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

        let task_id_clone = task_id.clone();
        let bridges_clone = self.bridges.clone();

        tokio::spawn(async move {
            println!("[Claude Bridge] Starting bridge for task {}", task_id_clone);

            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut result_received = false;

            loop {
                tokio::select! {
                    line_result = lines.next_line() => {
                        match line_result {
                            Ok(Some(line)) => {
                                if line.trim().is_empty() {
                                    continue;
                                }

                                let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
                                if let Some(ref json) = parsed {
                                    let event_type = json
                                        .get("type")
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("unknown");
                                    let subtype = json
                                        .get("subtype")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("");

                                    let timestamp = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs();

                                    match (event_type, subtype) {
                                        ("system", "init") => {
                                            // Extract claude session_id and persist to DB
                                            if let Some(claude_session_id) = json
                                                .get("session_id")
                                                .and_then(|s| s.as_str())
                                            {
                                                store_claude_session_id(
                                                    &app,
                                                    &task_id_clone,
                                                    claude_session_id,
                                                );
                                            }

                                            let payload = AgentEventPayload {
                                                task_id: task_id_clone.clone(),
                                                event_type: "system.init".to_string(),
                                                data: line.clone(),
                                                timestamp,
                                            };
                                            if let Err(e) = app.emit("agent-event", &payload) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit agent-event: {}",
                                                    e
                                                );
                                            }
                                        }

                                        ("assistant", _) => {
                                            let payload = AgentEventPayload {
                                                task_id: task_id_clone.clone(),
                                                event_type: "assistant".to_string(),
                                                data: line.clone(),
                                                timestamp,
                                            };
                                            if let Err(e) = app.emit("agent-event", &payload) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit agent-event: {}",
                                                    e
                                                );
                                            }
                                        }

                                        ("tool_use", _) => {
                                            let payload = AgentEventPayload {
                                                task_id: task_id_clone.clone(),
                                                event_type: "tool_use".to_string(),
                                                data: line.clone(),
                                                timestamp,
                                            };
                                            if let Err(e) = app.emit("agent-event", &payload) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit agent-event: {}",
                                                    e
                                                );
                                            }
                                        }

                                        ("tool_result", _) => {
                                            let payload = AgentEventPayload {
                                                task_id: task_id_clone.clone(),
                                                event_type: "tool_result".to_string(),
                                                data: line.clone(),
                                                timestamp,
                                            };
                                            if let Err(e) = app.emit("agent-event", &payload) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit agent-event: {}",
                                                    e
                                                );
                                            }
                                        }

                                        ("result", "success") => {
                                            result_received = true;
                                            println!(
                                                "[Claude Bridge] Result success → action-complete for task {}",
                                                task_id_clone
                                            );
                                            persist_session_completed(&app, &task_id_clone);
                                            let completion = CompletionPayload {
                                                task_id: task_id_clone.clone(),
                                            };
                                            if let Err(e) = app.emit("action-complete", &completion) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit action-complete: {}",
                                                    e
                                                );
                                            }
                                        }

                                        ("result", sub) if sub.starts_with("error") => {
                                            result_received = true;
                                            println!(
                                                "[Claude Bridge] Result error ({}) → implementation-failed for task {}",
                                                sub, task_id_clone
                                            );
                                            persist_session_failed(&app, &task_id_clone, &line);
                                            let failure = FailurePayload {
                                                task_id: task_id_clone.clone(),
                                                error: line.clone(),
                                            };
                                            if let Err(e) =
                                                app.emit("implementation-failed", &failure)
                                            {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit implementation-failed: {}",
                                                    e
                                                );
                                            }
                                        }

                                        _ => {
                                            // Forward other events as generic agent-events
                                            let payload = AgentEventPayload {
                                                task_id: task_id_clone.clone(),
                                                event_type: event_type.to_string(),
                                                data: line.clone(),
                                                timestamp,
                                            };
                                            if let Err(e) = app.emit("agent-event", &payload) {
                                                eprintln!(
                                                    "[Claude Bridge] Failed to emit agent-event: {}",
                                                    e
                                                );
                                            }
                                        }
                                    }
                                }
                            }

                            Ok(None) => {
                                // EOF reached
                                println!(
                                    "[Claude Bridge] stdout EOF for task {}",
                                    task_id_clone
                                );
                                if !result_received {
                                    println!(
                                        "[Claude Bridge] EOF without result — marking interrupted for task {}",
                                        task_id_clone
                                    );
                                    persist_session_interrupted(&app, &task_id_clone);
                                }
                                break;
                            }

                            Err(e) => {
                                eprintln!(
                                    "[Claude Bridge] Read error for task {}: {}",
                                    task_id_clone, e
                                );
                                if !result_received {
                                    persist_session_interrupted(&app, &task_id_clone);
                                }
                                break;
                            }
                        }
                    }

                    _ = &mut cancel_rx => {
                        println!("[Claude Bridge] Cancelled for task {}", task_id_clone);
                        break;
                    }
                }
            }

            let mut bridges = bridges_clone.lock().await;
            bridges.remove(&task_id_clone);
            println!("[Claude Bridge] Bridge removed for task {}", task_id_clone);
        });

        let handle = BridgeHandle { cancel_tx };
        let mut bridges = self.bridges.lock().await;
        bridges.insert(task_id, handle);

        Ok(())
    }

    /// Stop Claude bridge for a specific task
    ///
    /// # Arguments
    /// * `task_id` - Task identifier to stop
    pub async fn stop_bridge(&self, task_id: &str) {
        let mut bridges = self.bridges.lock().await;
        if let Some(handle) = bridges.remove(task_id) {
            let _ = handle.cancel_tx.send(());
            println!("[Claude Bridge] Stopped bridge for task {}", task_id);
        }
    }

    /// Stop all active Claude bridges
    pub async fn stop_all(&self) {
        let mut bridges = self.bridges.lock().await;
        for (task_id, handle) in bridges.drain() {
            let _ = handle.cancel_tx.send(());
            println!("[Claude Bridge] Stopped bridge for task {}", task_id);
        }
    }
}

impl Default for ClaudeBridgeManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn store_claude_session_id(app: &AppHandle, task_id: &str, claude_session_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.set_agent_session_claude_id(&session.id, claude_session_id) {
                eprintln!(
                    "[Claude Bridge] Failed to set claude session id for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_completed(app: &AppHandle, task_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) =
                db_lock.update_agent_session(&session.id, &session.stage, "completed", None, None)
            {
                eprintln!(
                    "[Claude Bridge] Failed to persist completed status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_failed(app: &AppHandle, task_id: &str, error_msg: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                "failed",
                None,
                Some(error_msg),
            ) {
                eprintln!(
                    "[Claude Bridge] Failed to persist failed status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_interrupted(app: &AppHandle, task_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                "interrupted",
                None,
                Some("Process ended without result"),
            ) {
                eprintln!(
                    "[Claude Bridge] Failed to persist interrupted status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_bridge_error_display() {
        let err = ClaudeBridgeError::AlreadyRunning("task123".to_string());
        assert_eq!(
            err.to_string(),
            "Claude bridge already running for task: task123"
        );

        let io_err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "pipe broken");
        let err = ClaudeBridgeError::IoError(io_err);
        assert!(err.to_string().contains("IO error"));
    }

    #[test]
    fn test_parse_system_init_event() {
        let json_str = r#"{"type":"system","subtype":"init","session_id":"abc123","tools":[]}"#;
        let parsed: serde_json::Value = serde_json::from_str(json_str).unwrap();

        let event_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let subtype = parsed.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
        let session_id = parsed
            .get("session_id")
            .and_then(|s| s.as_str())
            .unwrap_or("");

        assert_eq!(event_type, "system");
        assert_eq!(subtype, "init");
        assert_eq!(session_id, "abc123");
    }

    #[test]
    fn test_parse_result_success_event() {
        let json_str =
            r#"{"type":"result","subtype":"success","cost_usd":0.05,"session_id":"abc123"}"#;
        let parsed: serde_json::Value = serde_json::from_str(json_str).unwrap();

        let event_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let subtype = parsed.get("subtype").and_then(|s| s.as_str()).unwrap_or("");

        assert_eq!(event_type, "result");
        assert_eq!(subtype, "success");
    }

    #[test]
    fn test_parse_result_error_event() {
        let json_str = r#"{"type":"result","subtype":"error_max_turns","session_id":"abc123"}"#;
        let parsed: serde_json::Value = serde_json::from_str(json_str).unwrap();

        let subtype = parsed.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
        assert!(subtype.starts_with("error"));
    }

    #[tokio::test]
    async fn test_claude_bridge_manager_new() {
        let manager = ClaudeBridgeManager::new();
        let bridges = manager.bridges.lock().await;
        assert!(bridges.is_empty());
    }

    #[tokio::test]
    async fn test_stop_nonexistent_bridge_is_noop() {
        let manager = ClaudeBridgeManager::new();
        // Should not panic
        manager.stop_bridge("nonexistent_task").await;
    }

    #[tokio::test]
    async fn test_stop_all_with_empty_manager() {
        let manager = ClaudeBridgeManager::new();
        // Should not panic
        manager.stop_all().await;
    }
}
