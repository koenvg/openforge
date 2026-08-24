use super::{
    task_dependencies::{persist_new_task_dependencies, TaskDependencyPersistenceError},
    task_labels::persist_new_task_labels,
    tasks::TaskRow,
    TaskLabelPersistenceError,
};
use rusqlite::{types::Type, OptionalExtension, Result};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskCreationError {
    #[error("{0}")]
    Storage(#[from] rusqlite::Error),
    #[error("{0}")]
    Dependencies(#[source] TaskDependencyPersistenceError),
    #[error("{0}")]
    Labels(#[source] TaskLabelPersistenceError),
}

impl TaskCreationError {
    fn dependencies(error: TaskDependencyPersistenceError) -> Self {
        match error {
            TaskDependencyPersistenceError::Storage(error) => Self::Storage(error),
            domain_error => Self::Dependencies(domain_error),
        }
    }

    fn labels(error: TaskLabelPersistenceError) -> Self {
        match error {
            TaskLabelPersistenceError::Storage(error) => Self::Storage(error),
            domain_error => Self::Labels(domain_error),
        }
    }

    fn into_database_error(self) -> rusqlite::Error {
        match self {
            Self::Storage(error) => error,
            Self::Dependencies(error) => error.into_database_error(),
            Self::Labels(error) => error.into_database_error(),
        }
    }
}

/// Worktree-specific options for the task creation convenience method.
pub struct TaskWorktreeOptions<'a> {
    pub source: Option<&'a str>,
    pub branch: Option<&'a str>,
}

/// Full option set for creating a task. Task creation helpers delegate here
/// with defaults so optional fields flow through a single code path.
pub struct NewTaskOptions<'a> {
    pub initial_prompt: &'a str,
    pub status: &'a str,
    pub project_id: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub permission_mode: Option<&'a str>,
    pub worktree_source: Option<&'a str>,
    pub worktree_branch: Option<&'a str>,
    pub title: Option<&'a str>,
    pub source_ticket_url: Option<&'a str>,
    /// When `Some`, snapshot `code_cleanup_tasks_enabled` into `task_config` at
    /// creation. `None` leaves it unset so the runtime resolves project/global.
    pub code_cleanup_enabled: Option<bool>,
    /// When `Some`, snapshot `task_display_title_metadata_updates_enabled` into
    /// `task_config` at creation. `None` leaves it unset.
    pub task_display_title_updates_enabled: Option<bool>,
    /// When `Some` (and non-empty), snapshot `ai_provider` into `task_config` at
    /// creation. `None`/empty leaves it unset so the runtime resolves project/global.
    pub ai_provider: Option<&'a str>,
}

fn project_defaulted_worktree_source(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    worktree_source: Option<&str>,
) -> Result<Option<String>> {
    if let Some(source) = worktree_source
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(source.to_string()));
    }

    let Some(project_id) = project_id else {
        return Ok(None);
    };

    let default = conn
        .query_row(
            "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'use_worktrees'",
            [project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if default.as_deref() == Some("false") {
        Ok(Some("disabled".to_string()))
    } else {
        Ok(None)
    }
}

fn normalize_worktree_source(
    worktree_source: Option<&str>,
    worktree_branch: Option<&str>,
) -> Result<(Option<String>, Option<String>)> {
    match worktree_source
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("existingBranch") => {
            let branch = worktree_branch
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    rusqlite::Error::InvalidParameterName(
                        "worktree branch is required for existing branch worktrees".to_string(),
                    )
                })?;
            Ok((Some("existingBranch".to_string()), Some(branch.to_string())))
        }
        Some("newBranchFromMain") => Ok((Some("newBranchFromMain".to_string()), None)),
        Some("disabled") => Ok((Some("disabled".to_string()), None)),
        Some(value) => Err(rusqlite::Error::InvalidParameterName(format!(
            "invalid worktree source '{value}'"
        ))),
        None => Ok((None, None)),
    }
}

struct NormalizedTaskOptions<'a> {
    initial_prompt: &'a str,
    status: &'a str,
    project_id: Option<&'a str>,
    prompt: &'a str,
    permission_mode: Option<&'a str>,
    worktree_source: Option<String>,
    worktree_branch: Option<String>,
    title: Option<String>,
    source_ticket_url: Option<String>,
    code_cleanup_enabled: Option<bool>,
    task_display_title_updates_enabled: Option<bool>,
    ai_provider: Option<&'a str>,
}

fn normalize_task_options<'a>(
    conn: &rusqlite::Connection,
    opts: NewTaskOptions<'a>,
) -> Result<NormalizedTaskOptions<'a>> {
    let NewTaskOptions {
        initial_prompt,
        status,
        project_id,
        prompt,
        permission_mode,
        worktree_source,
        worktree_branch,
        title,
        source_ticket_url,
        code_cleanup_enabled,
        task_display_title_updates_enabled,
        ai_provider,
    } = opts;
    let defaulted_worktree_source =
        project_defaulted_worktree_source(conn, project_id, worktree_source)?;
    let (worktree_source, worktree_branch) =
        normalize_worktree_source(defaulted_worktree_source.as_deref(), worktree_branch)?;

    Ok(NormalizedTaskOptions {
        initial_prompt,
        status,
        project_id,
        prompt: prompt.unwrap_or(initial_prompt),
        permission_mode,
        worktree_source,
        worktree_branch,
        title: title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        source_ticket_url: source_ticket_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        code_cleanup_enabled,
        task_display_title_updates_enabled,
        ai_provider,
    })
}

#[derive(Debug, Error)]
#[error(
    "invalid next_task_id config value '{0}': expected a positive 64-bit integer with room for the next ID"
)]
struct InvalidTaskIdCounter(String);

fn parse_next_task_id(value: String) -> Result<(i64, i64)> {
    let parsed = value
        .parse::<i64>()
        .ok()
        .filter(|next_id| *next_id > 0)
        .and_then(|next_id| {
            next_id
                .checked_add(1)
                .map(|following_id| (next_id, following_id))
        });

    parsed.ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            Box::new(InvalidTaskIdCounter(value)),
        )
    })
}

fn allocate_task_id(conn: &rusqlite::Connection, project_id: Option<&str>) -> Result<String> {
    let (next_id, following_id) = conn.query_row(
        "SELECT value FROM config WHERE key = 'next_task_id'",
        [],
        |row| parse_next_task_id(row.get(0)?),
    )?;

    // Resolve the task-ID prefix as project_config ?? config ?? "T". The
    // single global `next_task_id` counter is unchanged, so IDs stay globally
    // unique and sequential; only the prefix is per-project.
    let global_prefix: String = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'task_id_prefix'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "T".to_string());
    let project_prefix: Option<String> = match project_id {
        Some(project_id) => conn
            .query_row(
                "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'task_id_prefix'",
                [project_id],
                |row| row.get(0),
            )
            .ok(),
        None => None,
    };
    let prefix = project_prefix
        .filter(|prefix| !prefix.is_empty())
        .or_else(|| Some(global_prefix).filter(|prefix| !prefix.is_empty()))
        .unwrap_or_else(|| "T".to_string());
    let task_id = format!("{prefix}-{next_id}");

    conn.execute(
        "UPDATE config SET value = ?1 WHERE key = 'next_task_id'",
        [&following_id.to_string()],
    )?;

    Ok(task_id)
}

fn insert_task_row(
    conn: &rusqlite::Connection,
    task_id: String,
    opts: &NormalizedTaskOptions<'_>,
    now: i64,
) -> Result<TaskRow> {
    let title_source = opts.title.as_ref().map(|_| "manual".to_string());
    let execution_started_at = (opts.status != "backlog").then_some(now);

    conn.execute(
        "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, worktree_source, worktree_branch, title, title_source, title_generated_at, execution_started_at, source_ticket_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        rusqlite::params![
            &task_id,
            opts.initial_prompt,
            opts.status,
            opts.project_id,
            now,
            now,
            opts.prompt,
            None::<String>,
            opts.permission_mode,
            opts.worktree_source.as_deref(),
            opts.worktree_branch.as_deref(),
            opts.title.as_deref(),
            title_source.as_deref(),
            None::<i64>,
            execution_started_at,
            opts.source_ticket_url.as_deref(),
        ],
    )?;

    Ok(TaskRow {
        id: task_id,
        initial_prompt: opts.initial_prompt.to_string(),
        status: opts.status.to_string(),
        project_id: opts.project_id.map(str::to_string),
        created_at: now,
        updated_at: now,
        prompt: Some(opts.prompt.to_string()),
        agent: None,
        permission_mode: opts.permission_mode.map(str::to_string),
        worktree_source: opts.worktree_source.clone(),
        worktree_branch: opts.worktree_branch.clone(),
        title: opts.title.clone(),
        title_source,
        title_generated_at: None,
        source_ticket_url: opts.source_ticket_url.clone(),
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn persist_task_config_snapshots(
    conn: &rusqlite::Connection,
    task_id: &str,
    opts: &NormalizedTaskOptions<'_>,
) -> Result<()> {
    let bool_str = |value: bool| if value { "true" } else { "false" };
    if let Some(value) = opts.code_cleanup_enabled {
        conn.execute(
            "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
            [task_id, "code_cleanup_tasks_enabled", bool_str(value)],
        )?;
    }
    if let Some(value) = opts.task_display_title_updates_enabled {
        conn.execute(
            "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
            [
                task_id,
                "task_display_title_metadata_updates_enabled",
                bool_str(value),
            ],
        )?;
    }
    if let Some(value) = opts.ai_provider {
        if !value.is_empty() {
            conn.execute(
                "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                [task_id, "ai_provider", value],
            )?;
        }
    }

    Ok(())
}

fn persist_task_dependency_metadata(
    conn: &rusqlite::Connection,
    task: &mut TaskRow,
    dependency_ids: &[String],
    now: i64,
) -> std::result::Result<(), TaskCreationError> {
    if !dependency_ids.is_empty() {
        task.depends_on = persist_new_task_dependencies(conn, &task.id, dependency_ids, now)
            .map_err(TaskCreationError::dependencies)?;
    }

    Ok(())
}

fn persist_task_label_metadata(
    conn: &rusqlite::Connection,
    task: &mut TaskRow,
    label_names: &[String],
    now: i64,
) -> std::result::Result<(), TaskCreationError> {
    if !label_names.is_empty() {
        task.labels = persist_new_task_labels(conn, &task.id, label_names, now)
            .map_err(TaskCreationError::labels)?;
    }

    Ok(())
}

fn create_task_in_transaction(
    conn: &rusqlite::Connection,
    opts: NewTaskOptions<'_>,
    dependency_ids: &[String],
    label_names: &[String],
) -> std::result::Result<TaskRow, TaskCreationError> {
    let opts = normalize_task_options(conn, opts)?;
    let task_id = allocate_task_id(conn, opts.project_id)?;
    let now = super::current_unix_timestamp()?;
    let mut task = insert_task_row(conn, task_id, &opts, now)?;

    persist_task_config_snapshots(conn, &task.id, &opts)?;
    persist_task_dependency_metadata(conn, &mut task, dependency_ids, now)?;
    persist_task_label_metadata(conn, &mut task, label_names, now)?;

    Ok(task)
}

fn run_task_creation_transaction(
    connection: &mut rusqlite::Connection,
    opts: NewTaskOptions<'_>,
    dependency_ids: &[String],
    label_names: &[String],
) -> std::result::Result<TaskRow, TaskCreationError> {
    let transaction = connection.transaction()?;
    let task = create_task_in_transaction(&transaction, opts, dependency_ids, label_names)?;
    transaction.commit()?;
    Ok(task)
}

impl super::Database {
    pub fn create_task(
        &self,
        initial_prompt: &str,
        status: &str,
        project_id: Option<&str>,
        prompt: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Result<TaskRow> {
        self.create_task_with_worktree_source(
            initial_prompt,
            status,
            project_id,
            prompt,
            permission_mode,
            TaskWorktreeOptions {
                source: None,
                branch: None,
            },
        )
    }

    pub fn create_task_with_worktree_source(
        &self,
        initial_prompt: &str,
        status: &str,
        project_id: Option<&str>,
        prompt: Option<&str>,
        permission_mode: Option<&str>,
        worktree: TaskWorktreeOptions<'_>,
    ) -> Result<TaskRow> {
        self.create_task_with_options(NewTaskOptions {
            initial_prompt,
            status,
            project_id,
            prompt,
            permission_mode,
            worktree_source: worktree.source,
            worktree_branch: worktree.branch,
            title: None,
            source_ticket_url: None,
            code_cleanup_enabled: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
    }

    pub fn create_task_with_options(&self, opts: NewTaskOptions) -> Result<TaskRow> {
        self.create_task_with_metadata(opts, &[], &[])
            .map_err(TaskCreationError::into_database_error)
    }

    pub fn create_task_with_metadata(
        &self,
        opts: NewTaskOptions,
        dependency_ids: &[String],
        label_names: &[String],
    ) -> std::result::Result<TaskRow, TaskCreationError> {
        let mut connection = self.lock_conn()?;
        run_task_creation_transaction(&mut connection, opts, dependency_ids, label_names)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{test_helpers::*, TaskDependencyPersistenceError, TaskLabelPersistenceError};
    use std::error::Error as _;

    #[test]
    fn task_creation_error_preserves_sources_and_from_conversion() {
        let storage_error = super::TaskCreationError::from(rusqlite::Error::InvalidQuery);
        assert!(matches!(
            &storage_error,
            super::TaskCreationError::Storage(rusqlite::Error::InvalidQuery)
        ));
        assert_eq!(
            storage_error.to_string(),
            rusqlite::Error::InvalidQuery.to_string()
        );
        assert!(storage_error
            .source()
            .expect("storage error must be the source")
            .downcast_ref::<rusqlite::Error>()
            .is_some());

        let dependency_error = super::TaskCreationError::Dependencies(
            TaskDependencyPersistenceError::TaskNotFound("T-404".to_string()),
        );
        assert_eq!(dependency_error.to_string(), "task T-404 does not exist");
        assert!(dependency_error
            .source()
            .expect("dependency error must be the source")
            .downcast_ref::<TaskDependencyPersistenceError>()
            .is_some());

        let label_error = super::TaskCreationError::Labels(TaskLabelPersistenceError::BlankName);
        assert_eq!(label_error.to_string(), "label name is required");
        assert!(label_error
            .source()
            .expect("label error must be the source")
            .downcast_ref::<TaskLabelPersistenceError>()
            .is_some());
    }

    #[test]
    fn test_create_task_with_prompt() {
        let (db, _temp_dir) = make_test_db("create_task_with_prompt");
        db.set_config("task_id_prefix", "T").unwrap();

        let task = db
            .create_task("My task", "backlog", None, Some("Custom prompt"), None)
            .expect("create failed");

        assert_eq!(task.id, "T-1");
        assert_eq!(task.initial_prompt, "My task");
        assert_eq!(task.prompt, Some("Custom prompt".to_string()));

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.prompt, Some("Custom prompt".to_string()));

        drop(db);
    }

    #[test]
    fn test_create_task_prompt_defaults_to_title() {
        let (db, _temp_dir) = make_test_db("create_task_prompt_default");
        db.set_config("task_id_prefix", "T").unwrap();

        let task = db
            .create_task("My task", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.id, "T-1");
        assert_eq!(task.initial_prompt, "My task");
        assert_eq!(task.prompt, Some("My task".to_string()));

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.prompt, Some("My task".to_string()));

        drop(db);
    }

    #[test]
    fn test_create_task_with_metadata_normalizes_and_deduplicates_label_names() {
        let (db, _temp_dir) = make_test_db("create_task_with_normalized_labels");
        db.set_config("task_id_prefix", "T").unwrap();
        let project = db
            .create_project("Project", "/tmp/create-task-with-normalized-labels")
            .expect("create project");
        let existing = db
            .create_task_label(&project.id, "Bug")
            .expect("create existing label");
        let labels = [
            "  Bug  ".to_string(),
            "bug".to_string(),
            "BUG".to_string(),
            " feature ".to_string(),
        ];

        let task = db
            .create_task_with_metadata(
                super::NewTaskOptions {
                    initial_prompt: "Task with labels",
                    status: "backlog",
                    project_id: Some(&project.id),
                    prompt: None,
                    permission_mode: None,
                    worktree_source: None,
                    worktree_branch: None,
                    title: None,
                    source_ticket_url: None,
                    code_cleanup_enabled: None,
                    task_display_title_updates_enabled: None,
                    ai_provider: None,
                },
                &[],
                &labels,
            )
            .expect("create task with labels");

        assert_eq!(
            task.labels
                .iter()
                .map(|label| label.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Bug", "feature"]
        );
        assert_eq!(task.labels[0].id, existing.id);
        assert_eq!(
            db.get_task(&task.id).expect("get task").unwrap().labels,
            task.labels
        );
        assert_eq!(
            db.get_project_task_labels(&project.id)
                .expect("get project labels"),
            task.labels
        );

        drop(db);
    }

    #[test]
    fn test_create_task_with_metadata_rolls_back_every_write_when_label_assignment_fails() {
        let (db, _temp_dir) = make_test_db("create_task_with_metadata_rollback");
        db.set_config("task_id_prefix", "T").unwrap();
        let project = db
            .create_project("Project", "/tmp/create-task-with-metadata-rollback")
            .expect("create project");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project.id), None, None)
            .expect("create dependency");
        {
            let conn = db.connection();
            conn.lock()
                .expect("lock connection")
                .execute_batch(
                    "CREATE TRIGGER fail_blocked_task_label_assignment
                     BEFORE INSERT ON task_label_assignments
                     WHEN (SELECT name FROM task_labels WHERE id = NEW.label_id) = 'blocked'
                     BEGIN
                         SELECT RAISE(ABORT, 'forced label assignment failure');
                     END;",
                )
                .expect("create failure trigger");
        }
        let dependency_ids = [dependency.id];
        let label_names = ["cleanup".to_string(), "blocked".to_string()];
        let failed_task_id = "T-2";

        let error = db
            .create_task_with_metadata(
                super::NewTaskOptions {
                    initial_prompt: "Atomic task",
                    status: "backlog",
                    project_id: Some(&project.id),
                    prompt: None,
                    permission_mode: None,
                    worktree_source: None,
                    worktree_branch: None,
                    title: None,
                    source_ticket_url: None,
                    code_cleanup_enabled: Some(true),
                    task_display_title_updates_enabled: Some(false),
                    ai_provider: Some("opencode"),
                },
                &dependency_ids,
                &label_names,
            )
            .expect_err("label assignment failure must abort task creation");

        assert!(matches!(error, super::TaskCreationError::Storage(_)));
        assert!(db
            .get_task(failed_task_id)
            .expect("get rolled-back task")
            .is_none());
        for key in [
            "code_cleanup_tasks_enabled",
            "task_display_title_metadata_updates_enabled",
            "ai_provider",
        ] {
            assert_eq!(
                db.get_task_config(failed_task_id, key)
                    .expect("get rolled-back task config"),
                None,
                "task config snapshot {key} was not rolled back"
            );
        }
        assert!(db
            .get_project_task_labels(&project.id)
            .expect("get rolled-back labels")
            .is_empty());
        {
            let conn = db.connection();
            let conn = conn.lock().expect("lock connection");
            let (dependency_count, label_assignment_count): (i64, i64) = conn
                .query_row(
                    "SELECT
                         (SELECT COUNT(*) FROM task_dependencies WHERE task_id = ?1),
                         (SELECT COUNT(*) FROM task_label_assignments WHERE task_id = ?1)",
                    [failed_task_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("count rolled-back task metadata");
            assert_eq!(dependency_count, 0);
            assert_eq!(label_assignment_count, 0);
        }

        let next_task = db
            .create_task("Next task", "backlog", Some(&project.id), None, None)
            .expect("create next task");
        assert_eq!(next_task.id, failed_task_id);

        drop(db);
    }
    #[test]
    fn test_create_task_and_retrieve() {
        let (db, _temp_dir) = make_test_db("create_task");
        db.set_config("task_id_prefix", "T").unwrap();

        let task = db
            .create_task("My task", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.id, "T-1");
        assert_eq!(task.initial_prompt, "My task");
        assert_eq!(task.status, "backlog");

        let tasks = db.get_all_tasks().expect("get_all failed");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "T-1");
        assert_eq!(tasks[0].initial_prompt, "My task");

        drop(db);
    }

    #[test]
    fn test_create_task_title_defaults_to_null() {
        let (db, _temp_dir) = make_test_db("create_task_title_null");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.title, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.title, None);

        drop(db);
    }

    #[test]
    fn test_create_task_with_options_persists_manual_title() {
        let (db, _temp_dir) = make_test_db("create_task_options_title");
        db.set_config("task_id_prefix", "T").unwrap();

        let task = db
            .create_task_with_options(super::NewTaskOptions {
                initial_prompt: "Do the work",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: Some("  Custom title  "),
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create failed");

        // Titles are trimmed and treated as manual user input.
        assert_eq!(task.title.as_deref(), Some("Custom title"));
        assert_eq!(task.title_source.as_deref(), Some("manual"));
        assert_eq!(task.title_generated_at, None);

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.title.as_deref(), Some("Custom title"));
        assert_eq!(retrieved.title_source.as_deref(), Some("manual"));
        assert_eq!(retrieved.title_generated_at, None);

        drop(db);
    }

    #[test]
    fn test_task_id_prefix_prefers_project_override() {
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("prefix_override");
        let project = db.create_project("Web", "/tmp/web").unwrap();
        db.set_project_config(&project.id, "task_id_prefix", "WEB")
            .unwrap();
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .unwrap();
        assert!(task.id.starts_with("WEB-"), "got {}", task.id);

        drop(db);
    }

    #[test]
    fn test_create_task_snapshots_task_config_when_provided() {
        let (db, _temp_dir) = crate::db::test_helpers::make_test_db("task_snapshot");
        let project = db.create_project("P", "/tmp/p").unwrap();
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                code_cleanup_enabled: Some(true),
                task_display_title_updates_enabled: Some(false),
                ai_provider: Some("opencode"),
            })
            .unwrap();

        assert_eq!(
            db.get_task_config(&task.id, "code_cleanup_tasks_enabled")
                .unwrap(),
            Some("true".to_string())
        );
        assert_eq!(
            db.get_task_config(&task.id, "task_display_title_metadata_updates_enabled")
                .unwrap(),
            Some("false".to_string())
        );
        assert_eq!(
            db.get_task_config(&task.id, "ai_provider").unwrap(),
            Some("opencode".to_string())
        );
        // Resolver reads the snapshot.
        assert!(db.resolve_task_bool(&task.id, "code_cleanup_tasks_enabled", false));
        assert_eq!(db.resolve_ai_provider_for_task(&task.id), "opencode");

        drop(db);
    }

    #[test]
    fn test_create_task_with_options_blank_title_falls_back_to_null() {
        let (db, _temp_dir) = make_test_db("create_task_options_blank_title");

        let task = db
            .create_task_with_options(super::NewTaskOptions {
                initial_prompt: "Do the work",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: Some("   "),
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create failed");

        assert_eq!(task.title, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.title, None);

        drop(db);
    }

    #[test]
    fn test_create_task_with_options_persists_source_ticket_url() {
        let (db, _temp_dir) = make_test_db("create_task_options_source_ticket");

        let url = "https://github.com/koenvg/openforge/issues/1294";
        let task = db
            .create_task_with_options(super::NewTaskOptions {
                initial_prompt: "Do the work",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: Some(url),
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create failed");

        assert_eq!(task.source_ticket_url.as_deref(), Some(url));

        // Round-trips through the single-row read path.
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.source_ticket_url.as_deref(), Some(url));

        // And through the bulk read path.
        let all = db.get_all_tasks().expect("get_all failed");
        let found = all.iter().find(|t| t.id == task.id).expect("task missing");
        assert_eq!(found.source_ticket_url.as_deref(), Some(url));

        drop(db);
    }

    #[test]
    fn test_create_task_with_options_blank_source_ticket_url_falls_back_to_null() {
        let (db, _temp_dir) = make_test_db("create_task_options_blank_source_ticket");

        let task = db
            .create_task_with_options(super::NewTaskOptions {
                initial_prompt: "Do the work",
                status: "backlog",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: Some("   "),
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create failed");

        assert_eq!(task.source_ticket_url, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.source_ticket_url, None);

        drop(db);
    }

    #[test]
    fn test_create_task_defaults_source_ticket_url_to_none() {
        let (db, _temp_dir) = make_test_db("create_task_source_ticket_default_none");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.source_ticket_url, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.source_ticket_url, None);

        drop(db);
    }

    #[test]
    fn test_create_task_autoincrement() {
        let (db, _temp_dir) = make_test_db("task_autoincrement");
        db.set_config("task_id_prefix", "T").unwrap();

        let task1 = db
            .create_task("Task 1", "backlog", None, None, None)
            .expect("create 1 failed");
        let task2 = db
            .create_task("Task 2", "backlog", None, None, None)
            .expect("create 2 failed");
        let task3 = db
            .create_task("Task 3", "backlog", None, None, None)
            .expect("create 3 failed");

        assert_eq!(task1.id, "T-1");
        assert_eq!(task2.id, "T-2");
        assert_eq!(task3.id, "T-3");

        drop(db);
    }

    #[test]
    fn test_create_task_rejects_malformed_next_task_id_values() {
        for (case, value) in [
            ("blank", ""),
            ("non-numeric", "not-a-number"),
            ("zero", "0"),
            ("negative", "-7"),
            ("overflow", "9223372036854775808"),
            ("exhausted", "9223372036854775807"),
        ] {
            let (db, _temp_dir) = make_test_db(&format!("malformed_task_counter_{case}"));
            db.set_config("next_task_id", value)
                .expect("set malformed task counter");

            let error = db
                .create_task("Must not be created", "backlog", None, None, None)
                .expect_err("malformed task counter must fail task creation");

            assert!(
                error
                    .to_string()
                    .contains("invalid next_task_id config value"),
                "unexpected error for {case}: {error}"
            );
            assert!(
                db.get_all_tasks()
                    .expect("get tasks after failed creation")
                    .is_empty(),
                "task was created for {case}"
            );
            assert_eq!(
                db.get_config("next_task_id")
                    .expect("get malformed task counter")
                    .as_deref(),
                Some(value),
                "task counter changed for {case}"
            );
        }
    }

    #[test]
    fn test_create_task_reports_malformed_counter_before_duplicate_id_collision() {
        let (db, _temp_dir) = make_test_db("malformed_counter_duplicate_collision");
        let existing = db
            .create_task("Existing task", "backlog", None, None, None)
            .expect("create existing task");
        db.set_config("next_task_id", "not-a-number")
            .expect("set malformed task counter");

        let error = db
            .create_task("Must not collide", "backlog", None, None, None)
            .expect_err("malformed task counter must fail before task insertion");

        assert!(
            error
                .to_string()
                .contains("invalid next_task_id config value"),
            "unexpected error: {error}"
        );
        let tasks = db.get_all_tasks().expect("get tasks after failed creation");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, existing.id);
        assert_eq!(
            db.get_config("next_task_id")
                .expect("get malformed task counter")
                .as_deref(),
            Some("not-a-number")
        );
    }

    #[test]
    fn test_create_task_custom_prefix() {
        let (db, _temp_dir) = make_test_db("task_custom_prefix");
        db.set_config("task_id_prefix", "FOO").unwrap();
        let task = db
            .create_task("Custom prefix task", "backlog", None, None, None)
            .expect("create failed");
        assert_eq!(task.id, "FOO-1");
        drop(db);
    }

    #[test]
    fn test_create_task_fallback_when_prefix_missing() {
        let (db, _temp_dir) = make_test_db("task_fallback_missing");
        let conn = db.connection();
        conn.lock()
            .unwrap()
            .execute("DELETE FROM config WHERE key = 'task_id_prefix'", [])
            .unwrap();
        drop(conn);
        let task = db
            .create_task("Fallback task", "backlog", None, None, None)
            .expect("create failed");
        assert!(
            task.id.starts_with("T-"),
            "Expected T- prefix as fallback, got: {}",
            task.id
        );
        drop(db);
    }

    #[test]
    fn test_create_task_fallback_when_prefix_empty() {
        let (db, _temp_dir) = make_test_db("task_fallback_empty");
        db.set_config("task_id_prefix", "").unwrap();
        let task = db
            .create_task("Fallback task", "backlog", None, None, None)
            .expect("create failed");
        assert!(
            task.id.starts_with("T-"),
            "Expected T- prefix as fallback, got: {}",
            task.id
        );
        drop(db);
    }

    #[test]
    fn test_create_task_with_permission_mode_defaults_agent_to_none() {
        let (db, _temp_dir) = make_test_db("create_task_permission_mode");
        db.set_config("task_id_prefix", "T").unwrap();

        let task = db
            .create_task(
                "Permission mode task",
                "backlog",
                None,
                Some("Do permission-mode work"),
                Some("auto"),
            )
            .expect("create failed");

        assert_eq!(task.id, "T-1");
        assert_eq!(task.agent, None);
        assert_eq!(task.permission_mode, Some("auto".to_string()));

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.agent, None);
        assert_eq!(retrieved.permission_mode, Some("auto".to_string()));

        drop(db);
    }

    #[test]
    fn test_create_task_with_existing_worktree_branch_source() {
        let (db, _temp_dir) = make_test_db("create_task_existing_worktree_branch");

        let task = db
            .create_task_with_worktree_source(
                "Continue PR",
                "backlog",
                None,
                None,
                None,
                super::TaskWorktreeOptions {
                    source: Some("existingBranch"),
                    branch: Some("feature/open-pr"),
                },
            )
            .expect("create failed");

        assert_eq!(task.worktree_source.as_deref(), Some("existingBranch"));
        assert_eq!(task.worktree_branch.as_deref(), Some("feature/open-pr"));

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.worktree_source.as_deref(), Some("existingBranch"));
        assert_eq!(
            retrieved.worktree_branch.as_deref(),
            Some("feature/open-pr")
        );

        drop(db);
    }

    #[test]
    fn test_create_task_with_disabled_worktree_source() {
        let (db, _temp_dir) = make_test_db("create_task_disabled_worktree_source");

        let task = db
            .create_task_with_worktree_source(
                "Run in project directory",
                "backlog",
                None,
                None,
                None,
                super::TaskWorktreeOptions {
                    source: Some("disabled"),
                    branch: Some("feature/ignored"),
                },
            )
            .expect("create failed");

        assert_eq!(task.worktree_source.as_deref(), Some("disabled"));
        assert_eq!(task.worktree_branch, None);

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.worktree_source.as_deref(), Some("disabled"));
        assert_eq!(retrieved.worktree_branch, None);

        drop(db);
    }

    #[test]
    fn test_create_task_agent_fields_default_to_none() {
        let (db, _temp_dir) = make_test_db("create_task_agent_none");

        let task = db
            .create_task("No agent task", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.agent, None);
        assert_eq!(task.permission_mode, None);

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.agent, None);
        assert_eq!(retrieved.permission_mode, None);

        drop(db);
    }
}
