// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod opencode_manager;
mod opencode_client;
mod jira_client;
mod jira_sync;
mod github_client;
mod github_poller;
mod orchestrator;

use std::sync::Mutex;
use tauri::{Manager, State, Emitter};
use opencode_manager::OpenCodeManager;
use opencode_client::OpenCodeClient;
use jira_client::JiraClient;
use github_client::GitHubClient;
use db::TicketRow;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get OpenCode server status and API URL
#[tauri::command]
async fn get_opencode_status(
    manager: State<'_, OpenCodeManager>,
    client: State<'_, OpenCodeClient>,
) -> Result<OpenCodeStatus, String> {
    let api_url = manager.api_url();
    
    // Check health via API client
    let health = client
        .health()
        .await
        .map_err(|e| format!("Health check failed: {}", e))?;
    
    Ok(OpenCodeStatus {
        api_url,
        healthy: health.healthy,
        version: health.version,
    })
}

/// Create a new OpenCode session
#[tauri::command]
async fn create_session(
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
async fn send_prompt(
    client: State<'_, OpenCodeClient>,
    session_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    client
        .send_prompt(&session_id, text)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))
}

/// Get all tickets from the database
#[tauri::command]
async fn get_tickets(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<TicketRow>, String> {
    let db = db.lock().unwrap();
    match db.get_all_tickets() {
        Ok(tickets) => {
            println!("[get_tickets] Returning {} tickets", tickets.len());
            Ok(tickets)
        }
        Err(e) => {
            eprintln!("[get_tickets] Error: {}", e);
            Err(format!("Failed to get tickets: {}", e))
        }
    }
}

/// Sync JIRA now (one-shot sync, not the background loop)
#[tauri::command]
async fn sync_jira_now(
    db: State<'_, Mutex<db::Database>>,
    jira_client: State<'_, JiraClient>,
) -> Result<usize, String> {
    // Read config from database
    let (jira_base_url, jira_username, jira_api_token, jira_board_id, filter_assigned_to_me, exclude_done_tickets, custom_jql) = {
        let db_lock = db.lock().unwrap();

        let jira_base_url = db_lock
            .get_config("jira_base_url")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_base_url not configured")?;

        let jira_username = db_lock
            .get_config("jira_username")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_username not configured")?;

        let jira_api_token = db_lock
            .get_config("jira_api_token")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_api_token not configured")?;

        let jira_board_id = db_lock
            .get_config("jira_board_id")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        let filter_assigned_to_me = db_lock
            .get_config("filter_assigned_to_me")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_else(|| "true".to_string())
            == "true";

        let exclude_done_tickets = db_lock
            .get_config("exclude_done_tickets")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_else(|| "true".to_string())
            == "true";

        let custom_jql = db_lock
            .get_config("custom_jql")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        (jira_base_url, jira_username, jira_api_token, jira_board_id, filter_assigned_to_me, exclude_done_tickets, custom_jql)
    };

    // Build JQL query
    let mut conditions = Vec::new();
    if filter_assigned_to_me {
        conditions.push("assignee = currentUser()".to_string());
    }
    if !jira_board_id.is_empty() {
        conditions.push(format!("project = {}", jira_board_id));
    }
    if exclude_done_tickets {
        conditions.push("status != Done".to_string());
    }
    if !custom_jql.is_empty() {
        conditions.push(custom_jql);
    }

    let jql = if conditions.is_empty() {
        "ORDER BY updated DESC".to_string()
    } else {
        format!("{} ORDER BY updated DESC", conditions.join(" AND "))
    };

    // Fetch issues from JIRA
    let issues = jira_client
        .search_issues(&jira_base_url, &jira_username, &jira_api_token, &jql)
        .await
        .map_err(|e| format!("Failed to fetch issues from JIRA: {}", e))?;

    // Upsert tickets to database
    let mut success_count = 0;
    for issue in issues {
        let jira_status = issue.fields.status.as_ref().map(|s| s.name.clone()).unwrap_or_default();
        let status = map_jira_status_to_cockpit(&jira_status);
        let description = issue
            .fields
            .description
            .as_ref()
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let assignee = issue
            .fields
            .assignee
            .as_ref()
            .map(|u| u.display_name.clone())
            .unwrap_or_default();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let db_lock = db.lock().unwrap();
        if let Err(e) = db_lock.upsert_ticket(
            &issue.key,
            &issue.fields.summary,
            &description,
            status,
            &jira_status,
            &assignee,
            now,
            now,
        ) {
            eprintln!("Failed to upsert ticket {}: {}", issue.key, e);
        } else {
            success_count += 1;
        }
        drop(db_lock);
    }

    Ok(success_count)
}

/// Transition a ticket to a new status
#[tauri::command]
async fn transition_ticket(
    db: State<'_, Mutex<db::Database>>,
    jira_client: State<'_, JiraClient>,
    key: String,
    transition_id: String,
) -> Result<(), String> {
    // Read JIRA credentials from config
    let (jira_base_url, jira_username, jira_api_token) = {
        let db_lock = db.lock().unwrap();

        let jira_base_url = db_lock
            .get_config("jira_base_url")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_base_url not configured")?;

        let jira_username = db_lock
            .get_config("jira_username")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_username not configured")?;

        let jira_api_token = db_lock
            .get_config("jira_api_token")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .ok_or("jira_api_token not configured")?;

        (jira_base_url, jira_username, jira_api_token)
    };

    // Call JIRA API to transition ticket
    jira_client
        .transition_ticket(&jira_base_url, &jira_username, &jira_api_token, &key, &transition_id)
        .await
        .map_err(|e| format!("Failed to transition ticket: {}", e))
}

#[tauri::command]
async fn poll_pr_comments_now(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    let (github_token, github_default_repo) = {
        let db_lock = db.lock().unwrap();

        let github_token = db_lock
            .get_config("github_token")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        let github_default_repo = db_lock
            .get_config("github_default_repo")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        (github_token, github_default_repo)
    };

    if github_token.is_empty() {
        return Err("github_token not configured".to_string());
    }

    let parts: Vec<&str> = github_default_repo.split('/').collect();
    if parts.len() != 2 {
        return Err("github_default_repo must be in format 'owner/repo'".to_string());
    }
    let (repo_owner, repo_name) = (parts[0].to_string(), parts[1].to_string());

    let github_prs = github_client
        .list_open_prs(&repo_owner, &repo_name, &github_token)
        .await
        .map_err(|e| format!("Failed to list open PRs: {}", e))?;

    let ticket_ids = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_all_ticket_ids()
            .map_err(|e| format!("Failed to get ticket IDs: {}", e))?
    };

    let open_pr_ids: Vec<i64> = github_prs.iter().map(|pr| pr.number).collect();

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .close_stale_open_prs(&repo_owner, &repo_name, &open_pr_ids)
            .map_err(|e| format!("Failed to close stale PRs: {}", e))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    for pr in &github_prs {
        let matched_ticket = ticket_ids.iter().find(|tid| {
            pr.title.contains(tid.as_str()) || pr.head.ref_name.contains(tid.as_str())
        });
        if let Some(ticket_id) = matched_ticket {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.insert_pull_request(
                pr.number,
                ticket_id,
                &repo_owner,
                &repo_name,
                &pr.title,
                &pr.html_url,
                &pr.state,
                now,
                now,
            );
        }
    }

    let open_prs = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_open_prs()
            .map_err(|e| format!("Failed to get open PRs: {}", e))?
    };

    let mut new_comment_count = 0;

    for pr in open_prs {
        let comments = github_client
            .get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id, &github_token)
            .await
            .map_err(|e| format!("Failed to fetch PR comments: {}", e))?;

        for comment in comments {
            let db_lock = db.lock().unwrap();
            let exists = db_lock
                .comment_exists(comment.id)
                .map_err(|e| format!("Failed to check comment existence: {}", e))?;

            if !exists {
                let created_at = chrono::DateTime::parse_from_rfc3339(&comment.created_at)
                    .map_err(|e| format!("Failed to parse timestamp: {}", e))?
                    .timestamp();

                db_lock
                    .insert_pr_comment(
                        comment.id,
                        pr.id,
                        &comment.user.login,
                        &comment.body,
                        &comment.comment_type,
                        comment.path.as_deref(),
                        comment.line,
                        created_at,
                    )
                    .map_err(|e| format!("Failed to insert comment: {}", e))?;

                new_comment_count += 1;

                let _ = app.emit("new-pr-comment", serde_json::json!({
                    "pr_id": pr.id,
                    "comment_id": comment.id,
                    "author": comment.user.login,
                    "body": comment.body,
                }));
            }
            drop(db_lock);
        }
    }

    Ok(new_comment_count)
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    #[cfg(target_os = "windows")]
    let cmd = "start";

    std::process::Command::new(cmd)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_pull_requests(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {}", e))
}

#[tauri::command]
async fn get_pr_comments(
    db: State<'_, Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {}", e))
}

/// Mark a PR comment as addressed
#[tauri::command]
async fn mark_comment_addressed(
    db: State<'_, Mutex<db::Database>>,
    comment_id: i64,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {}", e))
}

/// Start ticket implementation via orchestrator
#[tauri::command]
async fn start_ticket_implementation(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    ticket_id: String,
) -> Result<String, String> {
    orchestrator.start_implementation(&db, &app, &ticket_id)
        .await
        .map_err(|e| e.to_string())
}

/// Approve a checkpoint in the orchestrator
#[tauri::command]
async fn approve_checkpoint(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    orchestrator.approve_checkpoint(&db, &app, &session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Reject a checkpoint with feedback
#[tauri::command]
async fn reject_checkpoint(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    session_id: String,
    feedback: String,
) -> Result<(), String> {
    orchestrator.reject_checkpoint(&db, &app, &session_id, &feedback)
        .await
        .map_err(|e| e.to_string())
}

/// Address selected PR comments via orchestrator
#[tauri::command]
async fn address_selected_pr_comments(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    ticket_id: String,
    comment_ids: Vec<i64>,
) -> Result<String, String> {
    orchestrator.address_pr_comments(&db, &app, &ticket_id, comment_ids)
        .await
        .map_err(|e| e.to_string())
}

/// Get the status of an agent session
#[tauri::command]
async fn get_session_status(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    session_id: String,
) -> Result<db::AgentSessionRow, String> {
    orchestrator.get_session_status(&db, &session_id)
        .map_err(|e| e.to_string())
}

/// Abort an agent session
#[tauri::command]
async fn abort_session(
    orchestrator: State<'_, orchestrator::Orchestrator>,
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    orchestrator.abort_session(&db, &app, &session_id)
        .map_err(|e| e.to_string())
}

/// Get agent logs for a session
#[tauri::command]
async fn get_agent_logs(
    db: State<'_, Mutex<db::Database>>,
    session_id: String,
) -> Result<Vec<db::AgentLogRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_agent_logs(&session_id)
        .map_err(|e| format!("Failed to get agent logs: {}", e))
}

/// Check if OpenCode CLI is installed on the system
#[tauri::command]
async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    let output = std::process::Command::new("which")
        .arg("opencode")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("opencode")
                .arg("--version")
                .output()
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            Ok(OpenCodeInstallStatus {
                installed: true,
                path: Some(path),
                version,
            })
        }
        _ => Ok(OpenCodeInstallStatus {
            installed: false,
            path: None,
            version: None,
        }),
    }
}

#[tauri::command]
async fn get_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
) -> Result<Option<String>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_config(&key)
        .map_err(|e| format!("Failed to get config: {}", e))
}

#[tauri::command]
async fn set_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock.set_config(&key, &value)
        .map_err(|e| format!("Failed to set config: {}", e))
}

/// Map JIRA status to cockpit status
fn map_jira_status_to_cockpit(jira_status: &str) -> &'static str {
    match jira_status {
        "To Do" => "todo",
        "In Progress" => "in_progress",
        "In Review" | "Code Review" => "in_review",
        "Testing" | "QA" => "testing",
        "Done" | "Closed" => "done",
        _ => "todo",
    }
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(serde::Serialize)]
struct OpenCodeStatus {
    api_url: String,
    healthy: bool,
    version: Option<String>,
}

#[derive(serde::Serialize)]
struct OpenCodeInstallStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct SseEventPayload {
    event_type: String,
    data: String,
}

// ============================================================================
// Background Tasks
// ============================================================================

/// Background task that subscribes to OpenCode SSE events and forwards them to the frontend
async fn start_sse_bridge(app_handle: tauri::AppHandle, client: opencode_client::OpenCodeClient) {
    loop {
        println!("SSE bridge: Connecting to OpenCode event stream...");
        match client.subscribe_events().await {
            Ok(event_stream) => {
                println!("SSE bridge: Connected to event stream");
                use tokio_stream::StreamExt;
                let mut stream = event_stream.into_stream();
                let mut buffer = String::new();
                
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            if let Ok(text) = std::str::from_utf8(&bytes) {
                                buffer.push_str(text);
                                
                                while let Some(pos) = buffer.find("\n\n") {
                                    let event_block = buffer[..pos].to_string();
                                    buffer = buffer[pos + 2..].to_string();
                                    
                                    let mut event_type = String::from("message");
                                    let mut data_lines = Vec::new();
                                    
                                    for line in event_block.lines() {
                                        if let Some(value) = line.strip_prefix("event:") {
                                            event_type = value.trim().to_string();
                                        } else if let Some(value) = line.strip_prefix("data:") {
                                            data_lines.push(value.trim().to_string());
                                        } else if let Some(value) = line.strip_prefix("event: ") {
                                            event_type = value.to_string();
                                        } else if let Some(value) = line.strip_prefix("data: ") {
                                            data_lines.push(value.to_string());
                                        }
                                    }
                                    
                                    let data = data_lines.join("\n");
                                    
                                    if !data.is_empty() {
                                        let payload = SseEventPayload {
                                            event_type: event_type.clone(),
                                            data,
                                        };
                                        let _ = app_handle.emit("opencode-event", payload);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("SSE bridge: Stream error: {}", e);
                            break;
                        }
                    }
                }
                println!("SSE bridge: Stream ended, will reconnect...");
            }
            Err(e) => {
                eprintln!("SSE bridge: Failed to connect: {}", e);
            }
        }
        
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Get app data directory and initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = app_data_dir.join("ai_command_center.db");

            println!("Initializing database at: {:?}", db_path);

            let database = db::Database::new(db_path).expect("Failed to initialize database");

            // Store database in app state for access from commands
            app.manage(Mutex::new(database));

            println!("Database initialized successfully");

            // Start OpenCode server and wait for it to be healthy
            let opencode_manager = tauri::async_runtime::block_on(async {
                OpenCodeManager::start().await
            })
            .expect("Failed to start OpenCode server");

            let api_url = opencode_manager.api_url();
            println!("OpenCode server started at: {}", api_url);

            // Create OpenCode API client
            let opencode_client = OpenCodeClient::with_base_url(api_url.clone());

            // Create JIRA client
            let jira_client = JiraClient::new();

            // Create GitHub client
            let github_client = GitHubClient::new();

            // Create orchestrator (uses OpenCodeClient for AI agent control)
            let orchestrator = orchestrator::Orchestrator::new(OpenCodeClient::with_base_url(api_url.clone()));

            // Store OpenCode manager and client in app state
            app.manage(opencode_manager);
            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);
            app.manage(orchestrator);

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                jira_sync::start_jira_sync(app_handle).await;
            });

            println!("JIRA sync task started");

            let app_handle_github = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                github_poller::start_github_poller(app_handle_github).await;
            });

            println!("GitHub poller task started");

            let app_handle_sse = app.handle().clone();
            let sse_client = OpenCodeClient::with_base_url(api_url);
            tauri::async_runtime::spawn(async move {
                start_sse_bridge(app_handle_sse, sse_client).await;
            });

            println!("SSE event bridge started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opencode_status,
            create_session,
            send_prompt,
            get_tickets,
            sync_jira_now,
            transition_ticket,
            poll_pr_comments_now,
            get_pull_requests,
            get_pr_comments,
            mark_comment_addressed,
            start_ticket_implementation,
            approve_checkpoint,
            reject_checkpoint,
            address_selected_pr_comments,
            get_session_status,
            abort_session,
            get_agent_logs,
            open_url,
            get_config,
            set_config,
            check_opencode_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
