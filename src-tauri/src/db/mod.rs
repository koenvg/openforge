use log::warn;
use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod agent_review;
mod agents;
mod authored_prs;
mod board_status;
mod config;
pub(crate) mod migrations;
mod plugins;
mod projects;
mod pull_request_readiness;
mod pull_requests;
mod review;
mod roadmap;
mod self_review;
mod task_workspaces;
mod tasks;
mod worktrees;

pub use agents::AgentSessionRow;
pub use authored_prs::AuthoredPrRow;
pub use board_status::BoardStatus;
pub use plugins::PluginRow;
pub use projects::{ProjectAttentionRow, ProjectRow};
pub use pull_request_readiness::PrMergeReadinessFacts;
pub(crate) use pull_request_readiness::{
    build_merge_readiness_facts, ci_status_for_readiness, enforce_actor_scoped_readiness,
    finalize_readiness_facts_for_poll, needs_rest_ci_for_snapshot, queued_validation_sha,
    review_status_for_readiness, select_snapshot_readiness_inputs, MergeReadinessInputs,
};
pub use pull_requests::{PrCommentRow, PrRow};
pub use review::ReviewPrRow;
pub use task_workspaces::TaskWorkspaceRow;
pub use tasks::{NewTaskOptions, TaskLabelRow, TaskRow};
pub use worktrees::WorktreeRow;

pub(crate) const STARTUP_RESUMABLE_AGENT_SESSION_STATUSES: [&str; 4] =
    ["running", "paused", "interrupted", "completed"];

use crate::github_client::PrLabel;

/// Parse the nullable JSON-TEXT `labels` column into a vector of [`PrLabel`].
///
/// Mirrors the `ci_check_runs` nullable-JSON-TEXT storage pattern: the column
/// holds a serialized JSON array (or NULL). Invalid/NULL values decode to an
/// empty vector so the frontend always receives an array it can map over.
pub(crate) fn parse_labels_column(raw: Option<String>) -> Vec<PrLabel> {
    raw.and_then(|json| serde_json::from_str::<Vec<PrLabel>>(&json).ok())
        .unwrap_or_default()
}

/// Serialize labels for the nullable JSON-TEXT `labels` column. Returns `None`
/// for an empty label set so the column stays NULL, matching the
/// `ci_check_runs` pattern.
pub(crate) fn serialize_labels_column(labels: &[PrLabel]) -> Option<String> {
    if labels.is_empty() {
        None
    } else {
        serde_json::to_string(labels).ok()
    }
}

/// Database connection wrapper for thread-safe access
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }

        let mut conn = Connection::open(&db_path)?;

        migrations::bootstrap_existing_db(&conn)?;

        migrations::get_migrations()
            .to_latest(&mut conn)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        migrations::ensure_tasks_columns(&conn)?;
        migrations::ensure_pr_number_column(&conn)?;
        migrations::ensure_mergeability_columns(&conn)?;
        migrations::ensure_is_queued_columns(&conn)?;
        migrations::ensure_labels_columns(&conn)?;
        migrations::ensure_pull_request_readiness_columns(&conn)?;
        migrations::ensure_task_dependency_table(&conn)?;
        migrations::ensure_task_label_tables(&conn)?;
        migrations::ensure_plugin_tables(&conn)?;

        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };

        Ok(db)
    }

    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }
}

pub fn acquire_db(db: &std::sync::Mutex<Database>) -> std::sync::MutexGuard<'_, Database> {
    match db.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("[db] Warning: recovering from poisoned mutex");
            poisoned.into_inner()
        }
    }
}

#[cfg(test)]
pub mod test_helpers {
    use super::*;
    use std::fs;

    pub fn make_test_db(name: &str) -> (Database, std::path::PathBuf) {
        let db_path = std::env::temp_dir().join(format!("test_{}.db", name));
        let _ = fs::remove_file(&db_path);
        let db = Database::new(db_path.clone()).expect("Failed to create database");
        (db, db_path)
    }

    pub fn insert_test_task(db: &Database) {
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, summary, agent, permission_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-100", "Test task", "backlog", None::<String>, 1000, 1000, "Test task", None::<String>, None::<String>, None::<String>],
        ).expect("Failed to insert test task");
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[test]
    fn test_acquire_db_with_healthy_mutex() {
        let (db, db_path) = super::test_helpers::make_test_db("acquire_db_healthy");
        let mutex = std::sync::Mutex::new(db);
        let guard = super::acquire_db(&mutex);
        assert!(guard.get_config("app_mode").is_ok());
        drop(guard);
        drop(mutex);
        let _ = fs::remove_file(&db_path);
    }
}
