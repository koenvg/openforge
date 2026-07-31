use crate::db::BoardStatus;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionTaskDetail {
    pub(crate) task_id: String,
    pub(crate) title: String,
    pub(crate) project_id: String,
    pub(crate) project_name: String,
    pub(crate) board_status: String,
    pub(crate) handoff_notes: Option<String>,
    pub(crate) agent_state: String,
    pub(crate) agent_error_summary: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) agent_updated_at: Option<i64>,
}

pub(crate) trait CompanionTaskDetailSource: Send + Sync {
    fn get(&self, task_id: &str) -> Result<Option<CompanionTaskDetail>, String>;
}

#[derive(Clone)]
pub(crate) struct DatabaseCompanionTaskDetailSource {
    database: Arc<Mutex<crate::db::Database>>,
}

impl DatabaseCompanionTaskDetailSource {
    pub(crate) fn new(database: Arc<Mutex<crate::db::Database>>) -> Self {
        Self { database }
    }
}

impl CompanionTaskDetailSource for DatabaseCompanionTaskDetailSource {
    fn get(&self, task_id: &str) -> Result<Option<CompanionTaskDetail>, String> {
        let database = self
            .database
            .lock()
            .map_err(|_| "Companion Task detail database lock was poisoned".to_string())?;
        let Some(task) = database
            .get_task(task_id)
            .map_err(|error| format!("failed to read Companion Task: {error}"))?
        else {
            return Ok(None);
        };
        let project_id = task
            .project_id
            .as_deref()
            .ok_or_else(|| "Companion Task has no Project".to_string())?;
        let project = database
            .get_project(project_id)
            .map_err(|error| format!("failed to read Companion Task Project: {error}"))?
            .ok_or_else(|| "Companion Task Project was not found".to_string())?;
        let board_status = task
            .status
            .parse::<BoardStatus>()
            .map_err(|_| "Companion Task has an invalid Board Status".to_string())?;
        let session = database
            .get_latest_session_for_ticket(task_id)
            .map_err(|error| format!("failed to read Companion Agent state: {error}"))?;
        let (agent_state, agent_error_summary, agent_updated_at) =
            session.as_ref().map_or(("waiting", None, None), |session| {
                (
                    normalized_agent_state(&session.status),
                    safe_agent_error_summary(&session.status, session.error_message.as_deref()),
                    Some(session.updated_at),
                )
            });

        Ok(Some(CompanionTaskDetail {
            task_id: task.id.clone(),
            title: crate::task_attention::task_display_title(
                &task.id,
                task.title.as_deref(),
                &task.initial_prompt,
            ),
            project_id: project.id,
            project_name: project.name,
            board_status: board_status.as_str().to_string(),
            handoff_notes: normalized_handoff_notes(task.summary.as_deref()),
            agent_state: agent_state.to_string(),
            agent_error_summary,
            created_at: task.created_at,
            updated_at: task.updated_at,
            agent_updated_at,
        }))
    }
}

fn normalized_handoff_notes(summary: Option<&str>) -> Option<String> {
    let notes = summary?.replace("\\n", "\n");
    if notes.trim().is_empty() {
        None
    } else {
        Some(notes)
    }
}

fn normalized_agent_state(status: &str) -> &'static str {
    match status {
        "running" => "running",
        "paused" => "blocked",
        "failed" | "interrupted" => "failed",
        "completed" => "complete",
        _ => "waiting",
    }
}

fn safe_agent_error_summary(status: &str, error_message: Option<&str>) -> Option<String> {
    error_message
        .map(str::trim)
        .filter(|error| !error.is_empty())?;
    match status {
        "failed" => Some("Agent failed. Review details on the desktop.".to_string()),
        "interrupted" => Some("Agent was interrupted. Review details on the desktop.".to_string()),
        _ => None,
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionTaskDetailSource;

#[cfg(test)]
impl CompanionTaskDetailSource for UnavailableCompanionTaskDetailSource {
    fn get(&self, _task_id: &str) -> Result<Option<CompanionTaskDetail>, String> {
        Err("Companion Task detail source is unavailable".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_states_are_normalized_for_the_public_contract() {
        for (status, expected) in [
            ("queued", "waiting"),
            ("running", "running"),
            ("paused", "blocked"),
            ("failed", "failed"),
            ("interrupted", "failed"),
            ("completed", "complete"),
        ] {
            assert_eq!(normalized_agent_state(status), expected);
        }
    }

    #[test]
    fn agent_error_summary_never_copies_the_stored_error() {
        let raw = "Bearer secret failed at /Users/me/repository";
        let summary = safe_agent_error_summary("failed", Some(raw)).expect("safe summary");
        assert_eq!(summary, "Agent failed. Review details on the desktop.");
        assert!(!summary.contains("secret"));
        assert!(!summary.contains("/Users"));
    }

    #[test]
    fn blank_handoff_notes_are_absent_and_escaped_newlines_match_desktop() {
        assert_eq!(normalized_handoff_notes(Some("  \n")), None);
        assert_eq!(
            normalized_handoff_notes(Some("Summary\\nReady for review")),
            Some("Summary\nReady for review".to_string())
        );
    }
}
