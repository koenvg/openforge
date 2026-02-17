use rusqlite::{Connection, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Ticket row from database
#[derive(Debug, Clone, Serialize)]
pub struct TicketRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub jira_status: Option<String>,
    pub assignee: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Pull request row from database
#[derive(Debug, Clone, Serialize)]
pub struct PrRow {
    pub id: i64,
    pub ticket_id: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub title: String,
    pub url: String,
    pub state: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// PR comment row from database
#[derive(Debug, Clone, Serialize)]
pub struct PrCommentRow {
    pub id: i64,
    pub pr_id: i64,
    pub author: String,
    pub body: String,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub addressed: i32,
    pub created_at: i64,
}

/// Agent session row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentSessionRow {
    pub id: String,
    pub ticket_id: String,
    pub opencode_session_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub checkpoint_data: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Agent log row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentLogRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub log_type: String,
    pub content: String,
}

/// Database connection wrapper for thread-safe access
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Initialize the database at the given path
    /// Creates the database file if it doesn't exist and runs all migrations
    pub fn new(db_path: PathBuf) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }

        let conn = Connection::open(&db_path)?;

        // Enable foreign keys
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.run_migrations()?;

        Ok(db)
    }

    /// Run all database migrations
    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Create tickets table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tickets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                jira_status TEXT,
                assignee TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Create agent_sessions table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                opencode_session_id TEXT,
                stage TEXT NOT NULL,
                status TEXT NOT NULL,
                checkpoint_data TEXT,
                error_message TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            )",
            [],
        )?;

        // Create agent_logs table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                log_type TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
            )",
            [],
        )?;

        // Create pull_requests table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pull_requests (
                id INTEGER PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            )",
            [],
        )?;

        // Create pr_comments table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pr_comments (
                id INTEGER PRIMARY KEY,
                pr_id INTEGER NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                comment_type TEXT NOT NULL,
                file_path TEXT,
                line_number INTEGER,
                addressed INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
            )",
            [],
        )?;

        // Create config table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Insert default config values (using INSERT OR IGNORE to avoid duplicates)
        let default_configs = [
            ("jira_api_token", ""),
            ("jira_base_url", ""),
            ("jira_board_id", ""),
            ("jira_username", ""),
            ("filter_assigned_to_me", "true"),
            ("exclude_done_tickets", "true"),
            ("custom_jql", ""),
            ("github_token", ""),
            ("github_default_repo", ""),
            ("opencode_port", "4096"),
            ("opencode_auto_start", "true"),
            ("jira_poll_interval", "60"),
            ("github_poll_interval", "30"),
        ];

        for (key, value) in &default_configs {
            conn.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
                [key, value],
            )?;
        }

        Ok(())
    }

    /// Get a reference to the connection for executing queries
    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }

    /// Get a config value by key
    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a config value
    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }

    /// Upsert a ticket (INSERT OR REPLACE)
    ///
    /// # Arguments
    /// * `id` - Ticket ID (JIRA key, e.g., "PROJ-123")
    /// * `title` - Ticket title/summary
    /// * `description` - Ticket description
    /// * `status` - Cockpit status (todo, in_progress, in_review, testing, done)
    /// * `jira_status` - Original JIRA status name
    /// * `assignee` - Assignee display name
    /// * `created_at` - Unix timestamp (seconds)
    /// * `updated_at` - Unix timestamp (seconds)
    pub fn upsert_ticket(
        &self,
        id: &str,
        title: &str,
        description: &str,
        status: &str,
        jira_status: &str,
        assignee: &str,
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tickets (id, title, description, status, jira_status, assignee, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            [
                id,
                title,
                description,
                status,
                jira_status,
                assignee,
                &created_at.to_string(),
                &updated_at.to_string(),
            ],
        )?;
        Ok(())
    }

    /// Get all tickets from the database
    pub fn get_all_tickets(&self) -> Result<Vec<TicketRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, jira_status, assignee, created_at, updated_at FROM tickets ORDER BY updated_at DESC"
        )?;

        let tickets = stmt.query_map([], |row| {
            Ok(TicketRow {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                jira_status: row.get(4)?,
                assignee: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut result = Vec::new();
        for ticket in tickets {
            result.push(ticket?);
        }
        Ok(result)
    }

    /// Get all open pull requests from the database
    pub fn get_open_prs(&self) -> Result<Vec<PrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at 
             FROM pull_requests 
             WHERE state = 'open' 
             ORDER BY updated_at DESC"
        )?;

        let prs = stmt.query_map([], |row| {
            Ok(PrRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                repo_owner: row.get(2)?,
                repo_name: row.get(3)?,
                title: row.get(4)?,
                url: row.get(5)?,
                state: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    /// Check if a PR comment exists by ID
    pub fn comment_exists(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM pr_comments WHERE id = ?1")?;
        let count: i64 = stmt.query_row([id], |row| row.get(0))?;
        Ok(count > 0)
    }

    /// Insert a PR comment into the database
    #[allow(clippy::too_many_arguments)]
    pub fn insert_pr_comment(
        &self,
        id: i64,
        pr_id: i64,
        author: &str,
        body: &str,
        comment_type: &str,
        file_path: Option<&str>,
        line_number: Option<i32>,
        created_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pr_comments (id, pr_id, author, body, comment_type, file_path, line_number, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                id,
                pr_id,
                author,
                body,
                comment_type,
                file_path,
                line_number,
                created_at,
            ],
        )?;
        Ok(())
    }

    /// Insert or replace a pull request in the database
    pub fn insert_pull_request(
        &self,
        id: i64,
        ticket_id: &str,
        repo_owner: &str,
        repo_name: &str,
        title: &str,
        url: &str,
        state: &str,
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO pull_requests (id, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id,
                ticket_id,
                repo_owner,
                repo_name,
                title,
                url,
                state,
                created_at,
                updated_at,
            ],
        )?;
        Ok(())
    }

    /// Get all comments for a specific PR
    pub fn get_comments_for_pr(&self, pr_id: i64) -> Result<Vec<PrCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at 
             FROM pr_comments 
             WHERE pr_id = ?1 
             ORDER BY created_at ASC"
        )?;

        let comments = stmt.query_map([pr_id], |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    pub fn mark_comment_addressed(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE pr_comments SET addressed = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn create_agent_session(
        &self,
        id: &str,
        ticket_id: &str,
        opencode_session_id: Option<&str>,
        stage: &str,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_sessions (id, ticket_id, opencode_session_id, stage, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, ticket_id, opencode_session_id, stage, status, now, now],
        )?;
        Ok(())
    }

    pub fn update_agent_session(
        &self,
        id: &str,
        stage: &str,
        status: &str,
        checkpoint_data: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET stage = ?1, status = ?2, checkpoint_data = ?3, error_message = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![stage, status, checkpoint_data, error_message, now, id],
        )?;
        Ok(())
    }

    pub fn set_agent_session_opencode_id(&self, id: &str, opencode_session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agent_sessions SET opencode_session_id = ?1 WHERE id = ?2",
            [opencode_session_id, id],
        )?;
        Ok(())
    }

    pub fn get_agent_session(&self, id: &str) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_session_for_ticket(
        &self,
        ticket_id: &str,
    ) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE ticket_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([ticket_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn insert_agent_log(&self, session_id: &str, log_type: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_logs (session_id, timestamp, log_type, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, now, log_type, content],
        )?;
        Ok(())
    }

    pub fn get_agent_logs(&self, session_id: &str) -> Result<Vec<AgentLogRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, log_type, content FROM agent_logs WHERE session_id = ?1 ORDER BY timestamp ASC",
        )?;
        let logs = stmt.query_map([session_id], |row| {
            Ok(AgentLogRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                log_type: row.get(3)?,
                content: row.get(4)?,
            })
        })?;
        let mut result = Vec::new();
        for log in logs {
            result.push(log?);
        }
        Ok(result)
    }

    pub fn get_ticket(&self, id: &str) -> Result<Option<TicketRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, jira_status, assignee, created_at, updated_at FROM tickets WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TicketRow {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                jira_status: row.get(4)?,
                assignee: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_pr_comments_by_ids(&self, ids: &[i64]) -> Result<Vec<PrCommentRow>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at FROM pr_comments WHERE id IN ({}) ORDER BY created_at ASC",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let comments = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    pub fn mark_comments_addressed(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "UPDATE pr_comments SET addressed = 1 WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        stmt.execute(param_refs.as_slice())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_database_initialization() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_ai_command_center.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        // Create database
        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Verify tables exist by querying sqlite_master
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tickets', 'agent_sessions', 'agent_logs', 'pull_requests', 'pr_comments', 'config')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count tables");

        assert_eq!(table_count, 6, "All 6 tables should be created");

        // Verify default config values
        let config_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))
            .expect("Failed to count config rows");

        assert_eq!(
            config_count, 13,
            "All 13 default config values should be inserted"
        );

        // Clean up
        drop(conn);
        drop(db);
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn test_config_operations() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_config_ops.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Test getting default config
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("4096".to_string()));

        // Test setting config
        db.set_config("opencode_port", "8080")
            .expect("Failed to set config");
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("8080".to_string()));

        // Test non-existent key
        let result = db.get_config("nonexistent").expect("Failed to query");
        assert_eq!(result, None);

        // Clean up
        drop(db);
        let _ = fs::remove_file(&db_path);
    }
}
