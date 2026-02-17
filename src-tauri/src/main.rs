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
    db.get_all_tickets()
        .map_err(|e| format!("Failed to get tickets: {}", e))
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
        let jira_status = issue.fields.status.name.clone();
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

/// Poll GitHub PR comments now (one-shot sync)
#[tauri::command]
async fn poll_pr_comments_now(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    // Read config from database
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

    // Parse repo owner and name from github_default_repo (format: "owner/repo")
    let (repo_owner, repo_name) = {
        let parts: Vec<&str> = github_default_repo.split('/').collect();
        if parts.len() != 2 {
            return Err("github_default_repo must be in format 'owner/repo'".to_string());
        }
        (parts[0].to_string(), parts[1].to_string())
    };

    // Get all open PRs from database
    let open_prs = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_open_prs()
            .map_err(|e| format!("Failed to get open PRs: {}", e))?
    };

    let mut new_comment_count = 0;

    // For each PR, fetch comments and insert new ones
    for pr in open_prs {
        let comments = github_client
            .get_pr_comments(&repo_owner, &repo_name, pr.id, &github_token)
            .await
            .map_err(|e| format!("Failed to fetch PR comments: {}", e))?;

        for comment in comments {
            // Check if comment already exists
            let db_lock = db.lock().unwrap();
            let exists = db_lock
                .comment_exists(comment.id)
                .map_err(|e| format!("Failed to check comment existence: {}", e))?;

            if !exists {
                // Parse timestamp
                let created_at = chrono::DateTime::parse_from_rfc3339(&comment.created_at)
                    .map_err(|e| format!("Failed to parse timestamp: {}", e))?
                    .timestamp();

                // Insert comment
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

                // Emit event for new comment
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

/// Get all comments for a specific PR
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

            println!("OpenCode server started at: {}", opencode_manager.api_url());

            // Create OpenCode API client
            let opencode_client = OpenCodeClient::with_base_url(opencode_manager.api_url());

            // Create JIRA client
            let jira_client = JiraClient::new();

            // Create GitHub client
            let github_client = GitHubClient::new();

            // Store OpenCode manager and client in app state
            app.manage(opencode_manager);
            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);

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
            get_pr_comments,
            mark_comment_addressed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
