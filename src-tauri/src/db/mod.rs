use log::warn;
use rusqlite::{Connection, OptionalExtension, Result};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod agent_review;
mod agent_terminal_replay;
mod agents;
mod authored_prs;
mod board_status;
mod browser_session_purges;
mod config;
pub(crate) mod migrations;
mod plugins;
mod project_attention;
mod project_config;
mod projects;
mod pull_request_readiness;
mod pull_requests;
mod review;
mod settings_reset;
mod sqlite;
mod startup_resume_eligibility;
mod task_attention;
mod task_config;
mod task_creation;
mod task_dependencies;
mod task_labels;
mod task_lifecycle;
mod task_persistence;
mod task_start;
mod task_workspaces;
mod tasks;
mod worktrees;

pub use agents::AgentSessionRow;
pub use authored_prs::AuthoredPrRow;
pub use board_status::BoardStatus;
pub use browser_session_purges::BrowserSessionPurgeIntentRow;
pub use plugins::PluginRow;
pub use project_attention::ProjectAttentionRow;
pub use projects::ProjectRow;
pub use pull_request_readiness::PrMergeReadinessFacts;
pub(crate) use pull_request_readiness::{
    build_merge_readiness_facts, ci_status_for_readiness, enforce_actor_scoped_readiness,
    finalize_readiness_facts_for_poll, needs_rest_ci_for_snapshot, queued_validation_sha,
    review_status_for_readiness, select_snapshot_readiness_inputs, MergeReadinessInputs,
    PullRequestReadinessInput, PullRequestReadinessStatus, PullRequestReadinessView,
};
pub use pull_requests::{PrCommentRow, PrRow};
pub use review::ReviewPrRow;
#[cfg(test)]
pub use task_creation::TaskWorktreeOptions;
pub use task_creation::{NewTaskOptions, TaskCreationError};
pub use task_labels::{TaskLabelPersistenceError, TaskLabelRow};
pub use task_lifecycle::CompleteTaskWriteOutcome;
pub(crate) use task_start::{FinalizeTaskStartError, TaskStartFinalization};
pub use task_workspaces::TaskWorkspaceRow;
// This is part of the Database API even though production callers currently only format it.
#[allow(unused_imports)]
pub use task_dependencies::TaskDependencyPersistenceError;
pub use tasks::{
    CompactTaskRow, TaskInitialPromptUpdateError, TaskRelationshipReferenceRow, TaskRow,
};
pub use worktrees::WorktreeRow;

pub(crate) const STARTUP_RESUMABLE_AGENT_SESSION_STATUSES: [&str; 3] =
    ["running", "paused", "interrupted"];

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

pub(super) fn task_project_id(conn: &Connection, task_id: &str) -> Result<Option<Option<String>>> {
    conn.query_row(
        "SELECT project_id FROM tasks WHERE id = ?1",
        [task_id],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn current_unix_timestamp() -> Result<i64> {
    crate::unix_timestamp::seconds(std::time::SystemTime::now())
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

#[derive(Debug)]
struct ConnectionMutexPoisoned;

impl std::fmt::Display for ConnectionMutexPoisoned {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("database connection mutex poisoned")
    }
}

impl std::error::Error for ConnectionMutexPoisoned {}

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
        migrations::ensure_handoff_notes_removed(&conn)?;
        migrations::ensure_pr_number_column(&conn)?;
        migrations::ensure_mergeability_columns(&conn)?;
        migrations::ensure_is_queued_columns(&conn)?;
        migrations::ensure_labels_columns(&conn)?;
        migrations::ensure_pull_request_readiness_columns(&conn)?;
        migrations::ensure_task_dependency_table(&conn)?;
        migrations::ensure_task_label_tables(&conn)?;
        migrations::ensure_plugin_tables(&conn)?;
        migrations::ensure_browser_session_purge_intents_table(&conn)?;
        // After ensure_plugin_tables: global_plugins has a foreign key onto plugins.
        migrations::ensure_hierarchy_tables(&conn)?;

        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };

        Ok(db)
    }

    pub(crate) fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| rusqlite::Error::ToSqlConversionFailure(Box::new(ConnectionMutexPoisoned)))
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

    pub fn make_test_db(name: &str) -> (Database, tempfile::TempDir) {
        let temp_dir = tempfile::Builder::new()
            .prefix(&format!("openforge-{name}-"))
            .tempdir()
            .expect("Failed to create temporary database directory");
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(db_path).expect("Failed to create database");
        (db, temp_dir)
    }

    pub fn insert_test_task(db: &Database) {
        db.set_config("task_id_prefix", "T")
            .expect("Failed to set test task ID prefix");
        db.set_config("next_task_id", "100")
            .expect("Failed to set next test task ID");
        let task = db
            .create_task("Test task", "backlog", None, Some("Test task"), None)
            .expect("Failed to insert test task");
        assert_eq!(task.id, "T-100");
    }
}

#[cfg(test)]
mod tests {
    use super::test_helpers::{insert_test_task, make_test_db};

    #[test]
    fn insert_test_task_preserves_fixture_and_reserves_task_id() {
        let (db, _temp_dir) = make_test_db("insert_test_task");

        insert_test_task(&db);

        let task = db
            .get_task("T-100")
            .expect("get test task")
            .expect("test task should exist");
        assert_eq!(task.id, "T-100");
        assert_eq!(task.initial_prompt, "Test task");
        assert_eq!(task.status, "backlog");
        assert_eq!(task.project_id, None);
        assert_eq!(task.prompt.as_deref(), Some("Test task"));
        assert_eq!(task.agent, None);
        assert_eq!(task.permission_mode, None);

        let next_task = db
            .create_task("Next task", "backlog", None, None, None)
            .expect("create next task");
        assert_eq!(next_task.id, "T-101");
    }

    #[test]
    fn make_test_db_isolates_repeated_names() {
        let (_first_db, first_temp_dir) = super::test_helpers::make_test_db("repeated_name");
        let (_second_db, second_temp_dir) = super::test_helpers::make_test_db("repeated_name");

        assert_ne!(first_temp_dir.path(), second_temp_dir.path());
    }

    #[test]
    fn test_acquire_db_with_healthy_mutex() {
        let (db, _temp_dir) = super::test_helpers::make_test_db("acquire_db_healthy");
        let mutex = std::sync::Mutex::new(db);
        let guard = super::acquire_db(&mutex);
        assert!(guard.get_config("app_mode").is_ok());
        drop(guard);
        drop(mutex);
    }

    #[test]
    fn database_operations_return_storage_error_when_connection_mutex_is_poisoned() {
        let (db, _temp_dir) = super::test_helpers::make_test_db("connection_mutex_poisoned");
        let conn = db.connection();
        let poisoner = std::thread::spawn(move || {
            let _guard = conn.lock().expect("connection mutex should start healthy");
            panic!("poison database connection mutex");
        });
        assert!(poisoner.join().is_err());

        let result = db.get_config("app_mode");

        let error = match result {
            Err(rusqlite::Error::ToSqlConversionFailure(error)) => error,
            Err(error) => panic!("unexpected storage error: {error}"),
            Ok(_) => panic!("poisoned connection lock unexpectedly succeeded"),
        };
        assert!(error
            .downcast_ref::<super::ConnectionMutexPoisoned>()
            .is_some());
        let custom_result = db.update_task_initial_prompt("T-missing", "updated prompt");
        assert!(matches!(
            custom_result,
            Err(super::TaskInitialPromptUpdateError::Database(
                rusqlite::Error::ToSqlConversionFailure(_)
            ))
        ));
        drop(db);
    }
}
