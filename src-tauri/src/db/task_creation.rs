use super::{
    task_dependencies::{persist_new_task_dependencies, TaskDependencyPersistenceError},
    task_labels::persist_new_task_labels,
    tasks::TaskRow,
    TaskLabelPersistenceError,
};
use rusqlite::{types::Type, OptionalExtension, Result};
use thiserror::Error;

pub const MAX_ACTIVE_TASKS_PER_PROJECT: usize = 500;

#[derive(Debug, Error)]
pub enum TaskCreationError {
    #[error("project {project_id} already contains the maximum of {max} active Tasks")]
    ActiveTaskLimit { project_id: String, max: usize },
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
            domain_error @ Self::ActiveTaskLimit { .. } => {
                rusqlite::Error::ToSqlConversionFailure(Box::new(domain_error))
            }
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
        .optional()?
        .unwrap_or_else(|| "T".to_string());
    let project_prefix: Option<String> = match project_id {
        Some(project_id) => conn
            .query_row(
                "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'task_id_prefix'",
                [project_id],
                |row| row.get(0),
            )
            .optional()?,
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
    let prompt_preview = super::tasks::prompt_preview(opts.initial_prompt);

    conn.execute(
        "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, worktree_source, worktree_branch, title, title_source, title_generated_at, execution_started_at, source_ticket_url, prompt_preview)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
            prompt_preview,
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

fn enforce_active_task_limit(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    status: &str,
) -> std::result::Result<(), TaskCreationError> {
    let Some(project_id) = project_id.filter(|_| status != "done") else {
        return Ok(());
    };
    let active_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND status != 'done'",
        [project_id],
        |row| row.get(0),
    )?;
    if active_count >= MAX_ACTIVE_TASKS_PER_PROJECT as i64 {
        return Err(TaskCreationError::ActiveTaskLimit {
            project_id: project_id.to_string(),
            max: MAX_ACTIVE_TASKS_PER_PROJECT,
        });
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
    enforce_active_task_limit(conn, opts.project_id, opts.status)?;
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
mod tests;
