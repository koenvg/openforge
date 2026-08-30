use super::task_labels::TaskLabelRow;
use rusqlite::{OptionalExtension, Result};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskInitialPromptUpdateError {
    #[error("task {0} does not exist")]
    NotFound(String),
    #[error("task {0} has already started; create a replacement task instead")]
    AlreadyStarted(String),
    #[error("{0}")]
    Database(#[from] rusqlite::Error),
}

/// Task row from database
#[derive(Debug, Clone, Serialize)]
pub struct TaskRow {
    pub id: String,
    pub initial_prompt: String,
    pub status: String,
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub prompt: Option<String>,
    pub agent: Option<String>,
    pub permission_mode: Option<String>,
    pub worktree_source: Option<String>,
    pub worktree_branch: Option<String>,
    /// Explicit display title; `None` means fall back to the prompt-derived title.
    pub title: Option<String>,
    /// Origin of the explicit display title. `manual` means user-provided and must
    /// not be overwritten by automatic generation; `generated` means OpenForge set it.
    pub title_source: Option<String>,
    /// Timestamp of the first automatic title generation attempt that wrote a title.
    /// Once set, generation will not run again for this task.
    pub title_generated_at: Option<i64>,
    /// Optional link to the source ticket that this task originated from (e.g. a
    /// GitHub issue URL or Jira browse link). `None` when no ticket was provided.
    pub source_ticket_url: Option<String>,
    pub depends_on: Vec<String>,
    pub labels: Vec<TaskLabelRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompactTaskRow {
    pub id: String,
    pub status: String,
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub agent: Option<String>,
    pub permission_mode: Option<String>,
    pub worktree_source: Option<String>,
    pub worktree_branch: Option<String>,
    pub title: String,
    pub title_source: Option<String>,
    pub title_generated_at: Option<i64>,
    pub source_ticket_url: Option<String>,
    pub depends_on: Vec<String>,
    pub labels: Vec<TaskLabelRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskRelationshipReferenceRow {
    pub id: String,
    pub status: String,
    pub project_id: Option<String>,
    pub title: String,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskDetailRelationshipRow {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) project_id: Option<String>,
    pub(crate) project_name: Option<String>,
    pub(crate) title: String,
    pub(crate) remaining_dependency_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskDetailRelationships {
    pub(crate) dependencies: Vec<TaskDetailRelationshipRow>,
    pub(crate) dependents: Vec<TaskDetailRelationshipRow>,
}

impl super::Database {
    /// Replace both prompt columns for a task that has never entered execution.
    ///
    /// The guarded SQL statement is the authoritative lifecycle check: a mutable
    /// task must still be in backlog, have no durable execution marker, and have
    /// no agent-session history. The predicate and both prompt writes execute
    /// atomically while holding the database connection lock.
    pub fn update_task_initial_prompt(
        &self,
        id: &str,
        initial_prompt: &str,
    ) -> std::result::Result<(), TaskInitialPromptUpdateError> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let changed = conn.execute(
            "UPDATE tasks
             SET initial_prompt = ?1, prompt = ?1, updated_at = ?2
             WHERE id = ?3
               AND status = 'backlog'
               AND execution_started_at IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM agent_sessions WHERE ticket_id = tasks.id
               )",
            rusqlite::params![initial_prompt, now, id],
        )?;

        if changed > 0 {
            return Ok(());
        }

        let exists = conn
            .query_row("SELECT 1 FROM tasks WHERE id = ?1", [id], |_| Ok(()))
            .optional()?;
        if exists.is_none() {
            Err(TaskInitialPromptUpdateError::NotFound(id.to_string()))
        } else {
            Err(TaskInitialPromptUpdateError::AlreadyStarted(id.to_string()))
        }
    }

    /// Update a task's explicit display title. Editable at any status because the
    /// title is decoupled from the prompt. A blank title clears it back to `NULL`
    /// so the UI falls back to the prompt-derived title.
    pub fn update_task_title(&self, id: &str, title: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let trimmed = title.trim();
        let (stored_title, title_source): (Option<&str>, Option<&str>) = if trimmed.is_empty() {
            (None, None)
        } else {
            (Some(trimmed), Some("manual"))
        };
        conn.execute(
            "UPDATE tasks SET title = ?1, title_source = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![stored_title, title_source, now, id],
        )?;
        Ok(())
    }

    /// Update a task's optional source-ticket link. Editable at any status so a
    /// link can be added, changed, or cleared after the task was created. A blank
    /// or `None` value clears it back to `NULL` so the UI shows nothing.
    pub fn update_task_source_ticket_url(&self, id: &str, url: Option<&str>) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        // Normalize a blank link to NULL, matching creation (see create_task_with_options).
        let stored_url: Option<&str> = url.map(str::trim).filter(|value| !value.is_empty());
        conn.execute(
            "UPDATE tasks SET source_ticket_url = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![stored_url, now, id],
        )?;
        Ok(())
    }

    /// Set an automatically generated task display title exactly once. Generated
    /// titles never overwrite a manual title and a task with a prior generation
    /// timestamp is skipped even if the title was later cleared.
    pub fn update_generated_task_title_once(&self, id: &str, title: &str) -> Result<bool> {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Ok(false);
        }

        let conn = self.lock_conn()?;
        let now = super::current_unix_timestamp()?;
        let changed = conn.execute(
            "UPDATE tasks
             SET title = ?1, title_source = 'generated', title_generated_at = ?2, updated_at = ?2
             WHERE id = ?3
               AND title_generated_at IS NULL
               AND (title_source IS NULL OR title_source != 'manual')
               AND (title IS NULL OR TRIM(title) = '')",
            rusqlite::params![trimmed, now, id],
        )?;
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::{
        error::Error as _,
        sync::{Arc, Barrier},
        thread,
    };
    #[test]
    fn task_initial_prompt_update_error_preserves_sources_and_from_conversion() {
        let error = super::TaskInitialPromptUpdateError::from(rusqlite::Error::InvalidQuery);
        assert!(matches!(
            &error,
            super::TaskInitialPromptUpdateError::Database(rusqlite::Error::InvalidQuery)
        ));
        assert_eq!(error.to_string(), rusqlite::Error::InvalidQuery.to_string());
        assert!(error
            .source()
            .expect("database error must be the source")
            .downcast_ref::<rusqlite::Error>()
            .is_some());

        let domain_error = super::TaskInitialPromptUpdateError::NotFound("T-404".to_string());
        assert!(domain_error.source().is_none());
    }

    #[test]
    fn test_update_task_initial_prompt_replaces_prompt_atomically_and_preserves_relationships() {
        let (db, _temp_dir) = make_test_db("update_task_initial_prompt_preserves_metadata");
        let project = db
            .create_project("Project", "/tmp/update-task-initial-prompt")
            .expect("create project");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project.id), None, None)
            .expect("create dependency");
        let task = db
            .create_task("Original", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.add_task_dependency(&task.id, &dependency.id)
            .expect("add dependency");
        db.add_task_label(&task.id, "feature").expect("add label");
        let before = db.get_task(&task.id).expect("get task").unwrap();

        db.update_task_initial_prompt(&task.id, "Updated prompt")
            .expect("update initial prompt");

        let updated = db.get_task(&task.id).expect("get updated task").unwrap();
        assert_eq!(updated.initial_prompt, "Updated prompt");
        assert_eq!(updated.prompt.as_deref(), Some("Updated prompt"));
        assert_eq!(updated.labels, before.labels);
        assert_eq!(updated.depends_on, before.depends_on);

        drop(db);
    }

    #[test]
    fn test_update_task_initial_prompt_rejects_active_task_and_preserves_prompts() {
        let (db, _temp_dir) = make_test_db("update_task_initial_prompt_rejects_active");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");
        db.update_task_status(&task.id, "doing")
            .expect("update status failed");

        let error = db
            .update_task_initial_prompt(&task.id, "Updated prompt")
            .expect_err("started task must reject initial prompt updates");

        assert!(error.to_string().contains("replacement task"));
        let updated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(updated.initial_prompt, "Original");
        assert_eq!(updated.prompt.as_deref(), Some("Original"));

        drop(db);
    }

    #[test]
    fn test_update_task_initial_prompt_rejects_task_with_execution_history_even_if_backlog() {
        let (db, _temp_dir) = make_test_db("update_task_initial_prompt_rejects_history");
        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");
        db.create_agent_session("session-1", &task.id, None, "implement", "completed", "pi")
            .expect("create execution history");
        {
            let conn = db.connection();
            conn.lock()
                .expect("lock connection")
                .execute(
                    "DELETE FROM agent_sessions WHERE ticket_id = ?1",
                    [&task.id],
                )
                .expect("simulate execution-session cleanup");
        }

        let error = db
            .update_task_initial_prompt(&task.id, "Updated prompt")
            .expect_err("task with execution history must reject initial prompt updates");

        assert!(error.to_string().contains("replacement task"));
        let updated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(updated.initial_prompt, "Original");
        assert_eq!(updated.prompt.as_deref(), Some("Original"));

        drop(db);
    }

    #[test]
    fn test_update_task_initial_prompt_is_atomic_when_racing_lifecycle_transition() {
        let (db, _temp_dir) = make_test_db("update_task_initial_prompt_race");
        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");
        let task_id = task.id.clone();
        let db = Arc::new(db);
        let barrier = Arc::new(Barrier::new(2));

        let prompt_db = Arc::clone(&db);
        let prompt_barrier = Arc::clone(&barrier);
        let prompt_task_id = task_id.clone();
        let prompt_update = thread::spawn(move || {
            prompt_barrier.wait();
            prompt_db.update_task_initial_prompt(&prompt_task_id, "Updated prompt")
        });
        let lifecycle_db = Arc::clone(&db);
        let lifecycle_barrier = Arc::clone(&barrier);
        let lifecycle_task_id = task_id.clone();
        let lifecycle_update = thread::spawn(move || {
            lifecycle_barrier.wait();
            lifecycle_db.update_task_status(&lifecycle_task_id, "doing")
        });

        let prompt_result = prompt_update.join().expect("prompt thread");
        lifecycle_update
            .join()
            .expect("lifecycle thread")
            .expect("lifecycle update");

        let updated = db.get_task(&task_id).expect("get failed").unwrap();
        assert_eq!(updated.status, "doing");
        if prompt_result.is_ok() {
            assert_eq!(updated.initial_prompt, "Updated prompt");
            assert_eq!(updated.prompt.as_deref(), Some("Updated prompt"));
        } else {
            assert_eq!(updated.initial_prompt, "Original");
            assert_eq!(updated.prompt.as_deref(), Some("Original"));
        }

        drop(db);
    }

    #[test]
    fn test_update_task_source_ticket_url_sets_changes_and_clears() {
        let (db, _temp_dir) = make_test_db("update_task_source_ticket_url");

        // Starts with no source ticket (the case this feature targets: it was
        // never set at creation).
        let task = db
            .create_task("Original", "doing", None, None, None)
            .expect("create failed");
        assert_eq!(task.source_ticket_url, None);

        // Add a link after the fact.
        let url = "https://github.com/koenvg/openforge/issues/1294";
        db.update_task_source_ticket_url(&task.id, Some(url))
            .expect("set source ticket failed");
        let set = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(set.source_ticket_url.as_deref(), Some(url));

        // Change it to a different link.
        let other = "PROJ-42";
        db.update_task_source_ticket_url(&task.id, Some(other))
            .expect("change source ticket failed");
        let changed = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(changed.source_ticket_url.as_deref(), Some(other));

        // Clearing with a blank value reverts to NULL.
        db.update_task_source_ticket_url(&task.id, Some("   "))
            .expect("clear source ticket failed");
        let cleared = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(cleared.source_ticket_url, None);

        // Clearing with None also reverts to NULL.
        db.update_task_source_ticket_url(&task.id, Some(url))
            .expect("re-set source ticket failed");
        db.update_task_source_ticket_url(&task.id, None)
            .expect("clear via none failed");
        let cleared_none = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(cleared_none.source_ticket_url, None);

        drop(db);
    }

    #[test]
    fn test_update_task_title_sets_title_regardless_of_status() {
        let (db, _temp_dir) = make_test_db("update_task_title_any_status");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");
        // The title is editable even after the task has started.
        db.update_task_status(&task.id, "doing")
            .expect("update status failed");

        db.update_task_title(&task.id, "Renamed while running")
            .expect("update title failed");

        let updated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(updated.title, Some("Renamed while running".to_string()));
        // Renaming must not touch the prompt of record.
        assert_eq!(updated.initial_prompt, "Original");

        drop(db);
    }

    #[test]
    fn test_update_task_title_empty_clears_to_null() {
        let (db, _temp_dir) = make_test_db("update_task_title_empty_clears");

        let task = db
            .create_task("Original", "done", None, None, None)
            .expect("create failed");
        db.update_task_title(&task.id, "Has title")
            .expect("set title failed");
        let titled = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(titled.title, Some("Has title".to_string()));
        assert_eq!(titled.title_source.as_deref(), Some("manual"));

        // Clearing the title (blank input) reverts to the derived title and clears manual provenance.
        db.update_task_title(&task.id, "   ")
            .expect("clear title failed");
        let cleared = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(cleared.title, None);
        assert_eq!(cleared.title_source, None);

        drop(db);
    }

    #[test]
    fn test_update_generated_task_title_sets_title_once_for_unset_task() {
        let (db, _temp_dir) = make_test_db("generated_task_title_once");

        let task = db
            .create_task("Original prompt", "doing", None, None, None)
            .expect("create failed");

        assert!(db
            .update_generated_task_title_once(&task.id, "Actual migration race")
            .expect("generated title failed"));
        let generated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(generated.title.as_deref(), Some("Actual migration race"));
        assert_eq!(generated.title_source.as_deref(), Some("generated"));
        assert!(generated.title_generated_at.is_some());

        assert!(!db
            .update_generated_task_title_once(&task.id, "Different title")
            .expect("second generated title failed"));
        let unchanged = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(unchanged.title.as_deref(), Some("Actual migration race"));
        assert_eq!(unchanged.title_source.as_deref(), Some("generated"));

        drop(db);
    }

    #[test]
    fn test_generated_task_title_never_overwrites_manual_title() {
        let (db, _temp_dir) = make_test_db("generated_task_title_manual_guard");

        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "Original prompt",
                status: "doing",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: Some("Manual title"),
                source_ticket_url: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create failed");

        assert!(!db
            .update_generated_task_title_once(&task.id, "Generated title")
            .expect("generated title failed"));
        let unchanged = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(unchanged.title.as_deref(), Some("Manual title"));
        assert_eq!(unchanged.title_source.as_deref(), Some("manual"));
        assert_eq!(unchanged.title_generated_at, None);

        drop(db);
    }
}
