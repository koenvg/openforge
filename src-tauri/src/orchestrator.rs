use crate::db::Database;
use crate::opencode_client::{OpenCodeClient, OpenCodeError};
use std::fmt;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug)]
pub enum OrchestratorError {
    Database(String),
    OpenCode(String),
    InvalidState(String),
    NotFound(String),
}

impl fmt::Display for OrchestratorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OrchestratorError::Database(msg) => write!(f, "Database error: {}", msg),
            OrchestratorError::OpenCode(msg) => write!(f, "OpenCode error: {}", msg),
            OrchestratorError::InvalidState(msg) => write!(f, "Invalid state: {}", msg),
            OrchestratorError::NotFound(msg) => write!(f, "Not found: {}", msg),
        }
    }
}

impl std::error::Error for OrchestratorError {}

impl From<rusqlite::Error> for OrchestratorError {
    fn from(e: rusqlite::Error) -> Self {
        OrchestratorError::Database(e.to_string())
    }
}

impl From<OpenCodeError> for OrchestratorError {
    fn from(e: OpenCodeError) -> Self {
        OrchestratorError::OpenCode(e.to_string())
    }
}

pub struct Orchestrator {
    opencode_client: OpenCodeClient,
}

impl Orchestrator {
    pub fn new(opencode_client: OpenCodeClient) -> Self {
        Self { opencode_client }
    }

    pub async fn start_implementation(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        ticket_id: &str,
    ) -> Result<String, OrchestratorError> {
        let session_id = uuid::Uuid::new_v4().to_string();

        // Read ticket from DB
        let ticket = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_ticket(ticket_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("Ticket {} not found", ticket_id))
                })?
        };

        // Create agent session in DB
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .create_agent_session(&session_id, ticket_id, None, "read_ticket", "running")
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        // Create OpenCode session
        let opencode_session_id = self
            .opencode_client
            .create_session(format!("Implement {}", ticket_id))
            .await?;

        // Store opencode session ID
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .set_agent_session_opencode_id(&session_id, &opencode_session_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let description = ticket.description.unwrap_or_default();
        let prompt = format!(
            "Read this JIRA ticket and propose an implementation approach.\n\n\
             Ticket: {}\n\
             Title: {}\n\
             Description: {}\n\n\
             Propose a clear implementation plan with numbered steps.",
            ticket_id, ticket.title, description
        );

        // Send prompt and get response
        let response = self
            .opencode_client
            .send_prompt(&opencode_session_id, prompt)
            .await?;

        let response_str = response.to_string();

        // Log the response
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_agent_log(&session_id, "response", &response_str)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        // Update session to paused at checkpoint
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .update_agent_session(
                    &session_id,
                    "read_ticket",
                    "paused",
                    Some(&response_str),
                    None,
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        // Emit checkpoint event
        let _ = app.emit(
            "checkpoint-reached",
            serde_json::json!({
                "ticket_id": ticket_id,
                "session_id": session_id,
                "stage": "read_ticket",
                "data": response
            }),
        );

        Ok(session_id)
    }

    pub async fn approve_checkpoint(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        session_id: &str,
    ) -> Result<(), OrchestratorError> {
        let session = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_agent_session(session_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("Session {} not found", session_id))
                })?
        };

        if session.status != "paused" {
            return Err(OrchestratorError::InvalidState(format!(
                "Session {} is not paused (status: {})",
                session_id, session.status
            )));
        }

        let opencode_session_id = session.opencode_session_id.ok_or_else(|| {
            OrchestratorError::InvalidState(format!(
                "Session {} has no OpenCode session",
                session_id
            ))
        })?;

        match session.stage.as_str() {
            "read_ticket" => {
                self.advance_to_implement(db, app, session_id, &session.ticket_id, &opencode_session_id)
                    .await
            }
            "implement" => {
                self.advance_to_create_pr(db, app, session_id, &session.ticket_id, &opencode_session_id)
                    .await
            }
            "address_comments" => {
                // Mark completed
                let db_lock = db.lock().unwrap();
                db_lock
                    .update_agent_session(session_id, "address_comments", "completed", None, None)
                    .map_err(|e| OrchestratorError::Database(e.to_string()))?;
                drop(db_lock);

                let _ = app.emit(
                    "stage-completed",
                    serde_json::json!({
                        "ticket_id": session.ticket_id,
                        "session_id": session_id,
                        "stage": "address_comments"
                    }),
                );
                Ok(())
            }
            "create_pr" => Err(OrchestratorError::InvalidState(
                "create_pr stage is already terminal".to_string(),
            )),
            other => Err(OrchestratorError::InvalidState(format!(
                "Unknown stage: {}",
                other
            ))),
        }
    }

    async fn advance_to_implement(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        session_id: &str,
        ticket_id: &str,
        opencode_session_id: &str,
    ) -> Result<(), OrchestratorError> {
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .update_agent_session(session_id, "implement", "running", None, None)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let prompt = "Approved. Implement the solution now. Make all necessary code changes.".to_string();

        let response = self
            .opencode_client
            .send_prompt(opencode_session_id, prompt)
            .await?;

        let response_str = response.to_string();

        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_agent_log(session_id, "response", &response_str)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
            db_lock
                .update_agent_session(
                    session_id,
                    "implement",
                    "paused",
                    Some(&response_str),
                    None,
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let _ = app.emit(
            "checkpoint-reached",
            serde_json::json!({
                "ticket_id": ticket_id,
                "session_id": session_id,
                "stage": "implement",
                "data": response
            }),
        );

        Ok(())
    }

    async fn advance_to_create_pr(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        session_id: &str,
        ticket_id: &str,
        opencode_session_id: &str,
    ) -> Result<(), OrchestratorError> {
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .update_agent_session(session_id, "create_pr", "running", None, None)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let prompt = "Implementation approved. Create a pull request with a descriptive title and detailed description summarizing the changes.".to_string();

        let response = self
            .opencode_client
            .send_prompt(opencode_session_id, prompt)
            .await?;

        let response_str = response.to_string();

        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_agent_log(session_id, "response", &response_str)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
            db_lock
                .update_agent_session(
                    session_id,
                    "create_pr",
                    "completed",
                    Some(&response_str),
                    None,
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let _ = app.emit(
            "stage-completed",
            serde_json::json!({
                "ticket_id": ticket_id,
                "session_id": session_id,
                "stage": "create_pr"
            }),
        );

        Ok(())
    }

    pub async fn reject_checkpoint(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        session_id: &str,
        feedback: &str,
    ) -> Result<(), OrchestratorError> {
        let session = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_agent_session(session_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("Session {} not found", session_id))
                })?
        };

        if session.status != "paused" {
            return Err(OrchestratorError::InvalidState(format!(
                "Session {} is not paused (status: {})",
                session_id, session.status
            )));
        }

        let opencode_session_id = session.opencode_session_id.ok_or_else(|| {
            OrchestratorError::InvalidState(format!(
                "Session {} has no OpenCode session",
                session_id
            ))
        })?;

        let prompt = format!(
            "Your approach was rejected. Feedback: {}\n\nRevise your approach based on this feedback.",
            feedback
        );

        let response = self
            .opencode_client
            .send_prompt(&opencode_session_id, prompt)
            .await?;

        let response_str = response.to_string();

        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_agent_log(session_id, "response", &response_str)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
            db_lock
                .update_agent_session(
                    session_id,
                    &session.stage,
                    "paused",
                    Some(&response_str),
                    None,
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let _ = app.emit(
            "checkpoint-reached",
            serde_json::json!({
                "ticket_id": session.ticket_id,
                "session_id": session_id,
                "stage": session.stage,
                "data": response
            }),
        );

        Ok(())
    }

    pub async fn address_pr_comments(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        ticket_id: &str,
        comment_ids: Vec<i64>,
    ) -> Result<String, OrchestratorError> {
        // Find the most recent session for this ticket to get the opencode session
        let prev_session = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_latest_session_for_ticket(ticket_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "No previous session for ticket {}",
                        ticket_id
                    ))
                })?
        };

        let opencode_session_id = prev_session.opencode_session_id.ok_or_else(|| {
            OrchestratorError::InvalidState(format!(
                "Previous session for {} has no OpenCode session",
                ticket_id
            ))
        })?;

        // Read comments from DB
        let comments = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_pr_comments_by_ids(&comment_ids)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
        };

        if comments.is_empty() {
            return Err(OrchestratorError::NotFound(
                "No comments found for the given IDs".to_string(),
            ));
        }

        // Create new session for addressing comments
        let session_id = uuid::Uuid::new_v4().to_string();
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .create_agent_session(
                    &session_id,
                    ticket_id,
                    Some(&opencode_session_id),
                    "address_comments",
                    "running",
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        // Build prompt from comments
        let mut prompt_parts = vec!["Address these PR review comments:\n".to_string()];
        for comment in &comments {
            let location = match (&comment.file_path, comment.line_number) {
                (Some(path), Some(line)) => format!(" on {}:{}", path, line),
                (Some(path), None) => format!(" on {}", path),
                _ => String::new(),
            };
            prompt_parts.push(format!(
                "Comment by {}{}:\n\"{}\"\n",
                comment.author, location, comment.body
            ));
        }
        prompt_parts
            .push("Fix valid issues in the code. For invalid feedback, explain why no change is needed.".to_string());

        let prompt = prompt_parts.join("\n");

        let response = self
            .opencode_client
            .send_prompt(&opencode_session_id, prompt)
            .await?;

        let response_str = response.to_string();

        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_agent_log(&session_id, "response", &response_str)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
            db_lock
                .update_agent_session(
                    &session_id,
                    "address_comments",
                    "completed",
                    Some(&response_str),
                    None,
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
            db_lock
                .mark_comments_addressed(&comment_ids)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let _ = app.emit(
            "stage-completed",
            serde_json::json!({
                "ticket_id": ticket_id,
                "session_id": session_id,
                "stage": "address_comments"
            }),
        );

        Ok(session_id)
    }

    pub fn get_session_status(
        &self,
        db: &Mutex<Database>,
        session_id: &str,
    ) -> Result<crate::db::AgentSessionRow, OrchestratorError> {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_agent_session(session_id)
            .map_err(|e| OrchestratorError::Database(e.to_string()))?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("Session {} not found", session_id))
            })
    }

    pub fn abort_session(
        &self,
        db: &Mutex<Database>,
        app: &AppHandle,
        session_id: &str,
    ) -> Result<(), OrchestratorError> {
        let session = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_agent_session(session_id)
                .map_err(|e| OrchestratorError::Database(e.to_string()))?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("Session {} not found", session_id))
                })?
        };

        {
            let db_lock = db.lock().unwrap();
            db_lock
                .update_agent_session(
                    session_id,
                    &session.stage,
                    "failed",
                    None,
                    Some("Aborted by user"),
                )
                .map_err(|e| OrchestratorError::Database(e.to_string()))?;
        }

        let _ = app.emit(
            "session-aborted",
            serde_json::json!({
                "ticket_id": session.ticket_id,
                "session_id": session_id
            }),
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_error_display() {
        let err = OrchestratorError::Database("connection failed".to_string());
        assert_eq!(err.to_string(), "Database error: connection failed");

        let err = OrchestratorError::OpenCode("timeout".to_string());
        assert_eq!(err.to_string(), "OpenCode error: timeout");

        let err = OrchestratorError::InvalidState("not paused".to_string());
        assert_eq!(err.to_string(), "Invalid state: not paused");

        let err = OrchestratorError::NotFound("session xyz".to_string());
        assert_eq!(err.to_string(), "Not found: session xyz");
    }

    #[test]
    fn test_db_agent_session_crud() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_orchestrator_sessions.db");
        let _ = std::fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // First insert a ticket (FK constraint)
        db.upsert_ticket("PROJ-1", "Test ticket", "Description", "todo", "To Do", "user", 1000, 1000)
            .expect("Failed to insert ticket");

        // Create session
        db.create_agent_session("ses-1", "PROJ-1", None, "read_ticket", "running")
            .expect("Failed to create session");

        // Read session
        let session = db.get_agent_session("ses-1").expect("Failed to get session").expect("Session not found");
        assert_eq!(session.id, "ses-1");
        assert_eq!(session.ticket_id, "PROJ-1");
        assert_eq!(session.stage, "read_ticket");
        assert_eq!(session.status, "running");
        assert!(session.opencode_session_id.is_none());
        assert!(session.checkpoint_data.is_none());

        // Update session
        db.update_agent_session("ses-1", "implement", "paused", Some("{\"plan\":\"test\"}"), None)
            .expect("Failed to update session");

        let session = db.get_agent_session("ses-1").expect("Failed to get session").expect("Session not found");
        assert_eq!(session.stage, "implement");
        assert_eq!(session.status, "paused");
        assert_eq!(session.checkpoint_data.as_deref(), Some("{\"plan\":\"test\"}"));

        // Set OpenCode session ID
        db.set_agent_session_opencode_id("ses-1", "oc-abc")
            .expect("Failed to set opencode id");

        let session = db.get_agent_session("ses-1").expect("Failed to get session").expect("Session not found");
        assert_eq!(session.opencode_session_id.as_deref(), Some("oc-abc"));

        // Get latest session for ticket
        db.create_agent_session("ses-2", "PROJ-1", Some("oc-def"), "address_comments", "running")
            .expect("Failed to create session 2");

        let latest = db.get_latest_session_for_ticket("PROJ-1").expect("Failed").expect("Not found");
        // Should be ses-2 (most recent)
        assert_eq!(latest.id, "ses-2");

        // Non-existent session
        let none = db.get_agent_session("nonexistent").expect("Failed");
        assert!(none.is_none());

        // Non-existent ticket sessions
        let none = db.get_latest_session_for_ticket("NONE-1").expect("Failed");
        assert!(none.is_none());

        // Clean up
        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_db_agent_logs() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_orchestrator_logs.db");
        let _ = std::fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Insert ticket and session first (FK constraints)
        db.upsert_ticket("PROJ-2", "Test", "Desc", "todo", "To Do", "user", 1000, 1000)
            .expect("Failed to insert ticket");
        db.create_agent_session("ses-log-1", "PROJ-2", None, "read_ticket", "running")
            .expect("Failed to create session");

        // Insert logs
        db.insert_agent_log("ses-log-1", "prompt", "Read this ticket")
            .expect("Failed to insert log");
        db.insert_agent_log("ses-log-1", "response", "I will implement X")
            .expect("Failed to insert log");

        // Read logs
        let logs = db.get_agent_logs("ses-log-1").expect("Failed to get logs");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].log_type, "prompt");
        assert_eq!(logs[0].content, "Read this ticket");
        assert_eq!(logs[1].log_type, "response");
        assert_eq!(logs[1].content, "I will implement X");

        // Empty logs for other session
        let empty = db.get_agent_logs("nonexistent").expect("Failed");
        assert!(empty.is_empty());

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_db_get_ticket() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_orchestrator_ticket.db");
        let _ = std::fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Non-existent ticket
        let none = db.get_ticket("NOPE-1").expect("Failed");
        assert!(none.is_none());

        // Insert and retrieve
        db.upsert_ticket("PROJ-3", "My ticket", "Details here", "in_progress", "In Progress", "dev", 2000, 2000)
            .expect("Failed to insert ticket");

        let ticket = db.get_ticket("PROJ-3").expect("Failed").expect("Not found");
        assert_eq!(ticket.id, "PROJ-3");
        assert_eq!(ticket.title, "My ticket");
        assert_eq!(ticket.status, "in_progress");

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }
}
