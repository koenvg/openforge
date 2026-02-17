//! GitHub PR Comment Poller
//!
//! Background Tokio task that polls GitHub every 30-60s for new PR comments,
//! inserts them into SQLite, and emits Tauri events.
//!
//! ## Architecture
//! - Spawned as background task in main.rs setup hook
//! - Reads config from database (github_token, github_default_repo, github_poll_interval)
//! - Gets all open PRs from pull_requests table
//! - For each PR, fetches comments via GitHubClient::get_pr_comments()
//! - Inserts NEW comments only (checks if comment id exists)
//! - Emits `new-pr-comment` event with ticket_id and comment_id
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the polling loop)
//! - Individual PR errors don't stop the batch
//! - Network errors trigger retry on next cycle
//! - Skips polling when github_token is empty

use crate::db::{Database, PrRow};
use crate::github_client::GitHubClient;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

/// Start the GitHub PR comment poller background task
///
/// This function spawns a Tokio task that runs indefinitely, polling GitHub
/// at the configured interval and syncing PR comments to the database.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
///
/// # Example
/// ```no_run
/// // In main.rs setup hook:
/// tauri::async_runtime::spawn(start_github_poller(app.handle().clone()));
/// ```
pub async fn start_github_poller(app: AppHandle) {
    let github_client = GitHubClient::new();

    loop {
        // Read config from database
        let db = app.state::<Mutex<Database>>();
        let config = match read_poller_config(&db) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("[GitHub Poller] Failed to read config: {}", e);
                sleep(Duration::from_secs(60)).await; // Default fallback
                continue;
            }
        };

        // Skip polling if github_token is empty
        if config.github_token.is_empty() {
            eprintln!("[GitHub Poller] github_token is empty. Skipping poll.");
            sleep(Duration::from_secs(config.poll_interval)).await;
            continue;
        }

        println!("[GitHub Poller] Polling GitHub for PR comments...");

        // Get all open PRs from database
        let open_prs = match get_open_prs(&db) {
            Ok(prs) => prs,
            Err(e) => {
                eprintln!("[GitHub Poller] Failed to get open PRs: {}", e);
                sleep(Duration::from_secs(config.poll_interval)).await;
                continue;
            }
        };

        println!("[GitHub Poller] Found {} open PRs", open_prs.len());

        // Poll each PR for new comments
        let mut new_comment_count = 0;
        let mut error_count = 0;

        for pr in open_prs {
            match poll_pr_comments(&github_client, &db, &app, &config, &pr).await {
                Ok(count) => new_comment_count += count,
                Err(e) => {
                    eprintln!(
                        "[GitHub Poller] Failed to poll PR {}/{} #{}: {}",
                        pr.repo_owner, pr.repo_name, pr.id, e
                    );
                    error_count += 1;
                }
            }
        }

        println!(
            "[GitHub Poller] Found {} new comments ({} errors)",
            new_comment_count, error_count
        );

        // Sleep for poll interval
        sleep(Duration::from_secs(config.poll_interval)).await;
    }
}

/// Configuration for GitHub poller
#[derive(Debug)]
struct PollerConfig {
    github_token: String,
    poll_interval: u64,
}

/// Read poller configuration from database
fn read_poller_config(db: &Mutex<Database>) -> Result<PollerConfig, String> {
    let db = db.lock().unwrap();

    let github_token = db
        .get_config("github_token")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let poll_interval = db
        .get_config("github_poll_interval")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "30".to_string())
        .parse::<u64>()
        .unwrap_or(30);

    Ok(PollerConfig {
        github_token,
        poll_interval,
    })
}

/// Get all open PRs from database
fn get_open_prs(db: &Mutex<Database>) -> Result<Vec<PrRow>, String> {
    let db = db.lock().unwrap();
    db.get_open_prs().map_err(|e| e.to_string())
}

/// Poll a single PR for new comments
async fn poll_pr_comments(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    config: &PollerConfig,
    pr: &PrRow,
) -> Result<usize, String> {
    // Fetch comments from GitHub
    let comments = github_client
        .get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id, &config.github_token)
        .await
        .map_err(|e| format!("Failed to fetch comments: {}", e))?;

    let mut new_count = 0;

    // Insert new comments
    for comment in comments {
        // Check if comment already exists
        let exists = {
            let db_lock = db.lock().unwrap();
            db_lock
                .comment_exists(comment.id)
                .map_err(|e| format!("Failed to check comment existence: {}", e))?
        };

        if exists {
            continue; // Skip existing comments
        }

        // Parse created_at timestamp (ISO 8601 format)
        let created_at = parse_github_timestamp(&comment.created_at).unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        });

        // Insert new comment
        {
            let db_lock = db.lock().unwrap();
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
        }

        // Emit event to notify frontend
        if let Err(e) = app.emit(
            "new-pr-comment",
            serde_json::json!({
                "ticket_id": pr.ticket_id,
                "comment_id": comment.id
            }),
        ) {
            eprintln!("[GitHub Poller] Failed to emit event: {}", e);
        }

        new_count += 1;
    }

    Ok(new_count)
}

/// Parse GitHub timestamp (ISO 8601) to Unix timestamp
///
/// Example: "2024-01-01T00:00:00Z" -> 1704067200
fn parse_github_timestamp(timestamp: &str) -> Option<i64> {
    use chrono::{DateTime, Utc};
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_github_timestamp() {
        let timestamp = "2024-01-01T00:00:00Z";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1704067200);
    }

    #[test]
    fn test_parse_github_timestamp_invalid() {
        let timestamp = "invalid";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_none());
    }
}
