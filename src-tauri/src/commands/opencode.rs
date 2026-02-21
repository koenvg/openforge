use std::sync::Mutex;
use tauri::State;
use serde::Serialize;
use crate::opencode_client::OpenCodeClient;
use crate::server_manager;
use crate::db;

#[derive(Serialize)]
pub struct OpenCodeStatus {
    pub api_url: String,
    pub healthy: bool,
    pub version: Option<String>,
}

/// Get OpenCode server status and API URL
#[tauri::command]
pub async fn get_opencode_status(
    client: State<'_, OpenCodeClient>,
) -> Result<OpenCodeStatus, String> {
    let health = client
        .health()
        .await
        .map_err(|e| format!("Health check failed: {}", e))?;
    
    Ok(OpenCodeStatus {
        api_url: "http://127.0.0.1:4096".to_string(),
        healthy: health.healthy,
        version: health.version,
    })
}

/// Get list of available agents from OpenCode server
#[tauri::command]
pub async fn get_agents(
    client: State<'_, OpenCodeClient>,
) -> Result<Vec<crate::opencode_client::AgentInfo>, String> {
    client
        .list_agents()
        .await
        .map_err(|e| format!("Failed to get agents: {}", e))
}

/// Create a new OpenCode session
#[tauri::command]
pub async fn create_session(
    client: State<'_, OpenCodeClient>,
    title: String,
) -> Result<String, String> {
    client
        .create_session(title)
        .await
        .map_err(|e| format!("Failed to create session: {}", e))
}

/// Send a prompt to an OpenCode session
#[tauri::command]
pub async fn send_prompt(
    client: State<'_, OpenCodeClient>,
    session_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    client
        .send_prompt(&session_id, text)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))
}

/// List available commands from a running OpenCode server for the project
#[tauri::command]
pub async fn list_opencode_commands(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::CommandInfo>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.list_commands().await
        .map_err(|e| format!("Failed to list commands: {}", e))
}

/// Search files in a running OpenCode server for the project
#[tauri::command]
pub async fn search_opencode_files(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.find_files(&query, true, 10).await
        .map_err(|e| format!("Failed to search files: {}", e))
}

/// List available agents from a running OpenCode server for the project
#[tauri::command]
pub async fn list_opencode_agents(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::AgentInfo>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.list_agents().await
        .map_err(|e| format!("Failed to list agents: {}", e))
}
