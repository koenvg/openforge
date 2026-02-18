//! Agent Coordinator
//!
//! DEPRECATED: This module is no longer actively used. Implementation logic has been moved to main.rs.
//! Kept for backward compatibility and potential future use.
//! See main.rs: start_implementation and run_action commands.

use crate::db::Database;
use crate::opencode_client::{OpenCodeClient, OpenCodeError};
use std::fmt;

/// Coordinator errors
#[derive(Debug)]
pub enum CoordinatorError {
    TaskNotFound(String),
    SessionCreationFailed(String),
    PromptFailed(String),
    AbortFailed(String),
    DatabaseError(String),
}

impl fmt::Display for CoordinatorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoordinatorError::TaskNotFound(msg) => write!(f, "Task not found: {}", msg),
            CoordinatorError::SessionCreationFailed(msg) => {
                write!(f, "Session creation failed: {}", msg)
            }
            CoordinatorError::PromptFailed(msg) => write!(f, "Prompt failed: {}", msg),
            CoordinatorError::AbortFailed(msg) => write!(f, "Abort failed: {}", msg),
            CoordinatorError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
        }
    }
}

impl std::error::Error for CoordinatorError {}

impl From<rusqlite::Error> for CoordinatorError {
    fn from(e: rusqlite::Error) -> Self {
        CoordinatorError::DatabaseError(e.to_string())
    }
}

impl From<OpenCodeError> for CoordinatorError {
    fn from(e: OpenCodeError) -> Self {
        match e {
            OpenCodeError::NetworkError(msg) => CoordinatorError::SessionCreationFailed(msg),
            OpenCodeError::ApiError { status, message } => {
                CoordinatorError::SessionCreationFailed(format!("API error {}: {}", status, message))
            }
            OpenCodeError::ParseError(msg) => CoordinatorError::SessionCreationFailed(msg),
        }
    }
}

/// Start implementation for a task
///
/// DEPRECATED: This function is no longer used. See main.rs start_implementation command instead.
/// Kept for backward compatibility.
pub async fn start_implementation(
    _db: &Database,
    _app: &tauri::AppHandle,
    _task_id: &str,
    _server_port: u16,
) -> Result<String, CoordinatorError> {
    Err(CoordinatorError::PromptFailed(
        "start_implementation is deprecated. Use main.rs start_implementation command instead.".to_string(),
    ))
}

/// Abort implementation for a task
///
/// DEPRECATED: This function is no longer used. See main.rs abort_implementation command instead.
/// Kept for backward compatibility.
pub async fn abort_implementation(
    _db: &Database,
    _app: &tauri::AppHandle,
    _task_id: &str,
    _server_port: u16,
) -> Result<(), CoordinatorError> {
    Err(CoordinatorError::AbortFailed(
        "abort_implementation is deprecated. Use main.rs abort_implementation command instead.".to_string(),
    ))
}

/// Handle implementation completion
///
/// DEPRECATED: This function is no longer used. SSE event handling is now in sse_bridge.rs.
/// Kept for backward compatibility.
pub async fn handle_implementation_complete(
    _db: &Database,
    _task_id: &str,
) -> Result<(), CoordinatorError> {
    Err(CoordinatorError::PromptFailed(
        "handle_implementation_complete is deprecated.".to_string(),
    ))
}

/// Handle implementation failure
///
/// DEPRECATED: This function is no longer used. SSE event handling is now in sse_bridge.rs.
/// Kept for backward compatibility.
pub async fn handle_implementation_failed(
    _db: &Database,
    _task_id: &str,
    _error: &str,
) -> Result<(), CoordinatorError> {
    Err(CoordinatorError::PromptFailed(
        "handle_implementation_failed is deprecated.".to_string(),
    ))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = CoordinatorError::TaskNotFound("TASK-123".to_string());
        assert_eq!(err.to_string(), "Task not found: TASK-123");

        let err = CoordinatorError::SessionCreationFailed("connection refused".to_string());
        assert_eq!(err.to_string(), "Session creation failed: connection refused");

        let err = CoordinatorError::PromptFailed("timeout".to_string());
        assert_eq!(err.to_string(), "Prompt failed: timeout");

        let err = CoordinatorError::AbortFailed("not found".to_string());
        assert_eq!(err.to_string(), "Abort failed: not found");

        let err = CoordinatorError::DatabaseError("locked".to_string());
        assert_eq!(err.to_string(), "Database error: locked");
    }
}
