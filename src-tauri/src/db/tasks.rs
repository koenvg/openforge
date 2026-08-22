use super::task_labels::{load_task_labels, persist_new_task_labels, TaskLabelRow};
use rusqlite::{OptionalExtension, Result};
use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum TaskInitialPromptUpdateError {
    NotFound(String),
    AlreadyStarted(String),
    Database(rusqlite::Error),
}

impl fmt::Display for TaskInitialPromptUpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(task_id) => write!(formatter, "task {task_id} does not exist"),
            Self::AlreadyStarted(task_id) => write!(
                formatter,
                "task {task_id} has already started; create a replacement task instead"
            ),
            Self::Database(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TaskInitialPromptUpdateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::NotFound(_) | Self::AlreadyStarted(_) => None,
        }
    }
}

impl From<rusqlite::Error> for TaskInitialPromptUpdateError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug)]
pub enum TaskCreationError {
    Storage(rusqlite::Error),
    Dependencies(rusqlite::Error),
    Labels(rusqlite::Error),
}

impl TaskCreationError {
    fn dependencies(error: rusqlite::Error) -> Self {
        if matches!(&error, rusqlite::Error::InvalidParameterName(_)) {
            Self::Dependencies(error)
        } else {
            Self::Storage(error)
        }
    }

    fn labels(error: rusqlite::Error) -> Self {
        if matches!(&error, rusqlite::Error::InvalidParameterName(_)) {
            Self::Labels(error)
        } else {
            Self::Storage(error)
        }
    }

    fn into_database_error(self) -> rusqlite::Error {
        match self {
            Self::Storage(error) | Self::Dependencies(error) | Self::Labels(error) => error,
        }
    }
}

impl fmt::Display for TaskCreationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(error) | Self::Dependencies(error) | Self::Labels(error) => {
                error.fmt(formatter)
            }
        }
    }
}

impl std::error::Error for TaskCreationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Storage(error) | Self::Dependencies(error) | Self::Labels(error) => Some(error),
        }
    }
}

impl From<rusqlite::Error> for TaskCreationError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompleteTaskWriteOutcome {
    Completed,
    NotFound,
    StaleState { current_status: String },
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

fn load_task_dependency_ids(conn: &rusqlite::Connection, task_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?1 ORDER BY created_at ASC, depends_on_task_id ASC",
    )?;
    let rows = stmt.query_map([task_id], |row| row.get(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn persist_new_task_dependencies(
    conn: &rusqlite::Connection,
    task_id: &str,
    dependency_ids: &[String],
    now: i64,
) -> Result<Vec<String>> {
    let dependency_ids = dedupe_dependency_ids(dependency_ids);
    for dependency_id in &dependency_ids {
        validate_dependency(conn, task_id, dependency_id)?;
    }

    for dependency_id in &dependency_ids {
        conn.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, dependency_id, now],
        )?;
    }
    if !dependency_ids.is_empty() {
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
    }
    Ok(dependency_ids)
}

pub(super) fn task_project_id(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> Result<Option<Option<String>>> {
    conn.query_row(
        "SELECT project_id FROM tasks WHERE id = ?1",
        [task_id],
        |row| row.get(0),
    )
    .optional()
}

fn dependency_path_exists(
    conn: &rusqlite::Connection,
    start_task_id: &str,
    target_task_id: &str,
) -> Result<bool> {
    conn.query_row(
        r#"
WITH RECURSIVE dependency_chain(id) AS (
    SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?1
    UNION
    SELECT task_dependencies.depends_on_task_id
    FROM task_dependencies
    INNER JOIN dependency_chain ON task_dependencies.task_id = dependency_chain.id
)
SELECT EXISTS(SELECT 1 FROM dependency_chain WHERE id = ?2)
        "#,
        rusqlite::params![start_task_id, target_task_id],
        |row| row.get(0),
    )
}

fn validate_dependency(
    conn: &rusqlite::Connection,
    task_id: &str,
    depends_on_task_id: &str,
) -> Result<()> {
    if task_id == depends_on_task_id {
        return Err(rusqlite::Error::InvalidParameterName(
            "task cannot depend on itself".to_string(),
        ));
    }

    let task_project = task_project_id(conn, task_id)?.ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!("task {task_id} does not exist"))
    })?;
    let dependency_project = task_project_id(conn, depends_on_task_id)?.ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!(
            "dependency task {depends_on_task_id} does not exist"
        ))
    })?;

    if task_project != dependency_project {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "dependency task {depends_on_task_id} must belong to the same project as {task_id}"
        )));
    }

    if dependency_path_exists(conn, depends_on_task_id, task_id)? {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "dependency task {depends_on_task_id} would create a cycle with {task_id}"
        )));
    }

    Ok(())
}

fn dedupe_dependency_ids(dependency_ids: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for dependency_id in dependency_ids {
        let trimmed = dependency_id.trim();
        if !trimmed.is_empty() && !result.iter().any(|id| id == trimmed) {
            result.push(trimmed.to_string());
        }
    }
    result
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

const TASK_ROW_COLUMNS: &str = "id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, title, title_source, title_generated_at, worktree_source, worktree_branch, source_ticket_url";
const COMPACT_TASK_ROW_COLUMNS: &str = "id, status, project_id, created_at, updated_at, agent, permission_mode, worktree_source, worktree_branch, COALESCE(NULLIF(title, ''), substr(initial_prompt, 1, 120)) AS title, title_source, title_generated_at, source_ticket_url";

fn task_from_row(row: &rusqlite::Row<'_>) -> Result<TaskRow> {
    Ok(TaskRow {
        id: row.get(0)?,
        initial_prompt: row.get(1)?,
        status: row.get(2)?,
        project_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        prompt: row.get(6)?,
        agent: row.get(7)?,
        permission_mode: row.get(8)?,
        title: row.get(9)?,
        title_source: row.get(10)?,
        title_generated_at: row.get(11)?,
        worktree_source: row.get(12)?,
        worktree_branch: row.get(13)?,
        source_ticket_url: row.get(14)?,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn compact_task_from_row(row: &rusqlite::Row<'_>) -> Result<CompactTaskRow> {
    Ok(CompactTaskRow {
        id: row.get(0)?,
        status: row.get(1)?,
        project_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        agent: row.get(5)?,
        permission_mode: row.get(6)?,
        worktree_source: row.get(7)?,
        worktree_branch: row.get(8)?,
        title: row.get(9)?,
        title_source: row.get(10)?,
        title_generated_at: row.get(11)?,
        source_ticket_url: row.get(12)?,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn hydrate_task_row(conn: &rusqlite::Connection, mut task: TaskRow) -> Result<TaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

fn hydrate_compact_task_row(
    conn: &rusqlite::Connection,
    mut task: CompactTaskRow,
) -> Result<CompactTaskRow> {
    task.depends_on = load_task_dependency_ids(conn, &task.id)?;
    task.labels = load_task_labels(conn, &task.id)?;
    Ok(task)
}

impl super::Database {
    /// Get all tasks for a project
    pub fn get_tasks_for_project(&self, project_id: &str) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!(
            "SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC"
        );
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id], task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_task_row(&conn, task?)?);
        }
        Ok(result)
    }

    pub fn get_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id, state], task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_task_row(&conn, task?)?);
        }
        Ok(result)
    }

    pub fn get_compact_tasks_for_project(&self, project_id: &str) -> Result<Vec<CompactTaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id], compact_task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_compact_task_row(&conn, task?)?);
        }
        Ok(result)
    }

    pub fn get_compact_tasks_for_project_excluding_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != ?2 ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id, state], compact_task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_compact_task_row(&conn, task?)?);
        }
        Ok(result)
    }

    pub fn get_compact_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<CompactTaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {COMPACT_TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id, state], compact_task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_compact_task_row(&conn, task?)?);
        }
        Ok(result)
    }

    pub fn get_tasks_for_project_by_state(
        &self,
        project_id: &str,
        state: &str,
    ) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([project_id, state], task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(hydrate_task_row(&conn, task?)?);
        }
        Ok(result)
    }

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
        let mut connection = self.conn.lock().unwrap();
        let transaction = connection.transaction()?;
        let conn = &transaction;
        let defaulted_worktree_source =
            project_defaulted_worktree_source(conn, project_id, worktree_source)?;
        let (worktree_source, worktree_branch) =
            normalize_worktree_source(defaulted_worktree_source.as_deref(), worktree_branch)?;
        // Normalize a blank title to NULL so the UI falls back to the derived title.
        let title = title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let title_source = title.as_ref().map(|_| "manual".to_string());
        // Normalize a blank source-ticket link to NULL so the UI shows nothing.
        let source_ticket_url = source_ticket_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_task_id'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(1))
            },
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
            Some(pid) => conn
                .query_row(
                    "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'task_id_prefix'",
                    [pid],
                    |row| row.get(0),
                )
                .ok(),
            None => None,
        };
        let prefix = project_prefix
            .filter(|p| !p.is_empty())
            .or_else(|| Some(global_prefix).filter(|p| !p.is_empty()))
            .unwrap_or_else(|| "T".to_string());
        let task_id = format!("{}-{}", prefix, next_id);

        conn.execute(
            "UPDATE config SET value = ?1 WHERE key = 'next_task_id'",
            [&(next_id + 1).to_string()],
        )?;

        let now = super::current_unix_timestamp()?;

        // Default prompt to initial_prompt if not provided (backward compat). A task
        // created outside backlog has already entered its execution lifecycle.
        let final_prompt = prompt.unwrap_or(initial_prompt);
        let execution_started_at = (status != "backlog").then_some(now);

        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, agent, permission_mode, worktree_source, worktree_branch, title, title_source, title_generated_at, execution_started_at, source_ticket_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            rusqlite::params![
                &task_id,
                initial_prompt,
                status,
                project_id,
                now,
                now,
                final_prompt,
                None::<String>,
                permission_mode,
                worktree_source.as_deref(),
                worktree_branch.as_deref(),
                title.as_deref(),
                title_source.as_deref(),
                None::<i64>,
                execution_started_at,
                source_ticket_url.as_deref(),
            ],
        )?;

        // Snapshot the task-level hierarchy settings that live in `task_config`.
        // A `None` field leaves the row unset so the runtime falls back to the
        // resolved project/global value (preserving legacy-task behavior).
        let bool_str = |b: bool| if b { "true" } else { "false" };
        if let Some(v) = code_cleanup_enabled {
            conn.execute(
                "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                [&task_id, "code_cleanup_tasks_enabled", bool_str(v)],
            )?;
        }
        if let Some(v) = task_display_title_updates_enabled {
            conn.execute(
                "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                [
                    &task_id,
                    "task_display_title_metadata_updates_enabled",
                    bool_str(v),
                ],
            )?;
        }
        if let Some(v) = ai_provider {
            if !v.is_empty() {
                conn.execute(
                    "INSERT OR REPLACE INTO task_config (task_id, key, value) VALUES (?1, ?2, ?3)",
                    [&task_id, "ai_provider", v],
                )?;
            }
        }

        let mut task = TaskRow {
            id: task_id,
            initial_prompt: initial_prompt.to_string(),
            status: status.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
            prompt: Some(final_prompt.to_string()),
            agent: None,
            permission_mode: permission_mode.map(|s| s.to_string()),
            worktree_source,
            worktree_branch,
            title,
            title_source,
            title_generated_at: None,
            source_ticket_url,
            depends_on: Vec::new(),
            labels: Vec::new(),
        };

        if !dependency_ids.is_empty() {
            task.depends_on = persist_new_task_dependencies(conn, &task.id, dependency_ids, now)
                .map_err(TaskCreationError::dependencies)?;
        }
        if !label_names.is_empty() {
            task.labels = persist_new_task_labels(conn, &task.id, label_names, now)
                .map_err(TaskCreationError::labels)?;
        }

        transaction.commit().map_err(TaskCreationError::Storage)?;
        Ok(task)
    }

    pub fn get_all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks ORDER BY updated_at DESC");
        let mut stmt = conn.prepare(&query)?;
        let tasks = stmt.query_map([], task_from_row)?;

        let mut result = Vec::new();
        for task in tasks {
            let mut task = task?;
            task.depends_on = load_task_dependency_ids(&conn, &task.id)?;
            task.labels = load_task_labels(&conn, &task.id)?;
            result.push(task);
        }
        Ok(result)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let query = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE id = ?1");
        let mut stmt = conn.prepare(&query)?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(hydrate_task_row(&conn, task_from_row(row)?)?))
        } else {
            Ok(None)
        }
    }

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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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

        let conn = self.conn.lock().unwrap();
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

    pub fn update_task_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "UPDATE tasks
             SET status = ?1,
                 updated_at = ?2,
                 execution_started_at = CASE
                     WHEN ?1 != 'backlog' THEN COALESCE(execution_started_at, ?2)
                     ELSE execution_started_at
                 END
             WHERE id = ?3",
            rusqlite::params![status, now, id],
        )?;
        Ok(())
    }

    pub fn add_task_dependency(&self, task_id: &str, depends_on_task_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        validate_dependency(&conn, task_id, depends_on_task_id)?;
        let now = super::current_unix_timestamp()?;
        conn.execute(
            "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![task_id, depends_on_task_id, now],
        )?;
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        Ok(())
    }

    pub fn set_task_dependencies(&self, task_id: &str, dependency_ids: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        task_project_id(&conn, task_id)?.ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!("task {task_id} does not exist"))
        })?;
        let dependency_ids = dedupe_dependency_ids(dependency_ids);
        for dependency_id in &dependency_ids {
            validate_dependency(&conn, task_id, dependency_id)?;
        }
        let now = super::current_unix_timestamp()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM task_dependencies WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        for dependency_id in dependency_ids {
            tx.execute(
                "INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, dependency_id, now],
            )?;
        }
        tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn link_task_chain(&self, task_ids: &[String]) -> Result<Vec<(String, String)>> {
        if task_ids.len() < 2 {
            return Err(rusqlite::Error::InvalidParameterName(
                "task chain must contain at least two task ids".to_string(),
            ));
        }

        let mut conn = self.conn.lock().unwrap();
        let now = super::current_unix_timestamp()?;
        let tx = conn.transaction()?;
        let mut links = Vec::new();
        for pair in task_ids.windows(2) {
            let depends_on_task_id = pair[0].trim();
            let task_id = pair[1].trim();
            validate_dependency(&tx, task_id, depends_on_task_id)?;
            tx.execute(
                "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![task_id, depends_on_task_id, now],
            )?;
            tx.execute(
                "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, task_id],
            )?;
            links.push((task_id.to_string(), depends_on_task_id.to_string()));
        }
        tx.commit()?;
        Ok(links)
    }

    /// Permanently delete a task and every associated row.
    ///
    /// Callers performing a user-visible lifecycle action must stop the Task runtime
    /// before this write. Rollback callers may use this before a Task is user-visible.
    pub fn hard_delete_task(&self, id: &str) -> Result<()> {
        self.delete_task_internal(id, None).map(|_| ())
    }

    /// Atomically delete a task only when it still has the state validated by the
    /// terminal Task completion service.
    pub fn delete_task_if_status(
        &self,
        id: &str,
        expected_status: &str,
    ) -> Result<CompleteTaskWriteOutcome> {
        self.delete_task_internal(id, Some(expected_status))
    }

    fn delete_task_internal(
        &self,
        id: &str,
        expected_status: Option<&str>,
    ) -> Result<CompleteTaskWriteOutcome> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<CompleteTaskWriteOutcome> {
            let current_status = conn
                .query_row(
                    "SELECT status FROM tasks WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(current_status) = current_status else {
                return Ok(CompleteTaskWriteOutcome::NotFound);
            };
            if expected_status.is_some_and(|expected| expected != current_status) {
                return Ok(CompleteTaskWriteOutcome::StaleState { current_status });
            }

            conn.execute(
                "DELETE FROM agent_sessions WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM pr_comments WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id = ?1)", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM pull_requests WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM self_review_comments WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM worktrees WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM task_dependencies WHERE task_id = ?1 OR depends_on_task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM task_label_assignments WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
            Ok(CompleteTaskWriteOutcome::Completed)
        })();
        match result {
            Ok(outcome) => {
                conn.execute_batch("COMMIT")?;
                Ok(outcome)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Complete a task by hiding it from active board flows while preserving its Task-owned reference data.
    ///
    /// Runtime data that depends on a live workspace is removed, but the task row, labels,
    /// and dependency links remain available for CLI/agent lookup.
    #[cfg(test)]
    pub fn complete_task(&self, id: &str) -> Result<()> {
        self.complete_task_internal(id, None).map(|_| ())
    }

    /// Atomically complete a task only when it still has the state validated by
    /// the terminal Task completion service.
    pub fn complete_task_if_status(
        &self,
        id: &str,
        expected_status: &str,
    ) -> Result<CompleteTaskWriteOutcome> {
        self.complete_task_internal(id, Some(expected_status))
    }

    fn complete_task_internal(
        &self,
        id: &str,
        expected_status: Option<&str>,
    ) -> Result<CompleteTaskWriteOutcome> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<CompleteTaskWriteOutcome> {
            let current_status = conn
                .query_row(
                    "SELECT status FROM tasks WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(current_status) = current_status else {
                return Ok(CompleteTaskWriteOutcome::NotFound);
            };
            if expected_status.is_some_and(|expected| expected != current_status) {
                return Ok(CompleteTaskWriteOutcome::StaleState { current_status });
            }

            conn.execute(
                "DELETE FROM agent_sessions WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM pr_comments WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id = ?1)", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM pull_requests WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM self_review_comments WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM worktrees WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            let now = super::current_unix_timestamp()?;
            conn.execute(
                "UPDATE tasks
                 SET status = 'done',
                     updated_at = ?1,
                     execution_started_at = COALESCE(execution_started_at, ?1)
                 WHERE id = ?2",
                rusqlite::params![now, id],
            )?;
            Ok(CompleteTaskWriteOutcome::Completed)
        })();
        match result {
            Ok(outcome) => {
                conn.execute_batch("COMMIT")?;
                Ok(outcome)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn get_all_task_ids(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM tasks")?;
        let ids = stmt.query_map([], |row| row.get(0))?;
        let mut result = Vec::new();
        for id in ids {
            result.push(id?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::{
        fs,
        sync::{Arc, Barrier},
        thread,
    };
    #[test]
    fn test_create_task_with_prompt() {
        let (db, path) = make_test_db("create_task_with_prompt");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_prompt_defaults_to_title() {
        let (db, path) = make_test_db("create_task_prompt_default");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_initial_prompt_replaces_prompt_atomically_and_preserves_relationships() {
        let (db, path) = make_test_db("update_task_initial_prompt_preserves_metadata");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_and_retrieve() {
        let (db, path) = make_test_db("create_task");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_initial_prompt_rejects_active_task_and_preserves_prompts() {
        let (db, path) = make_test_db("update_task_initial_prompt_rejects_active");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_initial_prompt_rejects_task_with_execution_history_even_if_backlog() {
        let (db, path) = make_test_db("update_task_initial_prompt_rejects_history");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_initial_prompt_is_atomic_when_racing_lifecycle_transition() {
        let (db, path) = make_test_db("update_task_initial_prompt_race");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_title_defaults_to_null() {
        let (db, path) = make_test_db("create_task_title_null");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.title, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.title, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_options_persists_manual_title() {
        let (db, path) = make_test_db("create_task_options_title");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_id_prefix_prefers_project_override() {
        let (db, path) = crate::db::test_helpers::make_test_db("prefix_override");
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
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_snapshots_task_config_when_provided() {
        let (db, path) = crate::db::test_helpers::make_test_db("task_snapshot");
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
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_options_blank_title_falls_back_to_null() {
        let (db, path) = make_test_db("create_task_options_blank_title");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_options_persists_source_ticket_url() {
        let (db, path) = make_test_db("create_task_options_source_ticket");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_options_blank_source_ticket_url_falls_back_to_null() {
        let (db, path) = make_test_db("create_task_options_blank_source_ticket");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_defaults_source_ticket_url_to_none() {
        let (db, path) = make_test_db("create_task_source_ticket_default_none");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.source_ticket_url, None);
        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.source_ticket_url, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_source_ticket_url_sets_changes_and_clears() {
        let (db, path) = make_test_db("update_task_source_ticket_url");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_title_sets_title_regardless_of_status() {
        let (db, path) = make_test_db("update_task_title_any_status");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_title_empty_clears_to_null() {
        let (db, path) = make_test_db("update_task_title_empty_clears");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_generated_task_title_sets_title_once_for_unset_task() {
        let (db, path) = make_test_db("generated_task_title_once");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_generated_task_title_never_overwrites_manual_title() {
        let (db, path) = make_test_db("generated_task_title_manual_guard");

        let task = db
            .create_task_with_options(super::NewTaskOptions {
                initial_prompt: "Original prompt",
                status: "doing",
                project_id: None,
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: Some("Manual title"),
                source_ticket_url: None,
                code_cleanup_enabled: None,
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_task_by_id() {
        let (db, path) = make_test_db("get_task_by_id");

        let task = db
            .create_task("Found me", "backlog", None, None, None)
            .expect("create failed");

        let retrieved = db.get_task(&task.id).expect("get failed");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().initial_prompt, "Found me");

        let missing = db.get_task("T-999").expect("get failed");
        assert!(missing.is_none());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_autoincrement() {
        let (db, path) = make_test_db("task_autoincrement");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_status() {
        let (db, path) = make_test_db("update_task_status");

        let task = db
            .create_task("My task", "backlog", None, None, None)
            .expect("create failed");

        db.update_task_status(&task.id, "doing")
            .expect("update status failed");

        let updated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(updated.status, "doing");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_dependencies_round_trip_and_deduplicate() {
        let (db, path) = make_test_db("task_dependencies_round_trip");
        db.set_config("task_id_prefix", "T").unwrap();
        let prerequisite = db
            .create_task("Prerequisite", "done", None, None, None)
            .expect("create prerequisite");
        let dependent = db
            .create_task("Dependent", "backlog", None, None, None)
            .expect("create dependent");

        db.set_task_dependencies(
            &dependent.id,
            &[prerequisite.id.clone(), prerequisite.id.clone()],
        )
        .expect("set dependencies");

        let retrieved = db.get_task(&dependent.id).expect("get failed").unwrap();
        assert_eq!(retrieved.depends_on, vec![prerequisite.id]);

        let tasks = db.get_all_tasks().expect("get all");
        let listed = tasks
            .iter()
            .find(|task| task.id == dependent.id)
            .expect("dependent listed");
        assert_eq!(listed.depends_on, vec!["T-1".to_string()]);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_dependency_validation_rejects_self_unknown_and_cross_project() {
        let (db, path) = make_test_db("task_dependency_validation");
        db.set_config("task_id_prefix", "T").unwrap();
        let project_a = db.create_project("A", "/tmp/a").expect("create project a");
        let project_b = db.create_project("B", "/tmp/b").expect("create project b");
        let first = db
            .create_task("First", "backlog", Some(&project_a.id), None, None)
            .expect("create first");
        let second = db
            .create_task("Second", "backlog", Some(&project_b.id), None, None)
            .expect("create second");

        assert!(db.add_task_dependency(&first.id, &first.id).is_err());
        assert!(db.add_task_dependency(&first.id, "T-999").is_err());
        assert!(db.add_task_dependency(&first.id, &second.id).is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_set_task_dependencies_rejects_unknown_task_even_when_empty() {
        let (db, path) = make_test_db("task_dependency_unknown_empty");

        assert!(db.set_task_dependencies("T-404", &[]).is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_dependency_validation_rejects_cycles() {
        let (db, path) = make_test_db("task_dependency_cycles");
        db.set_config("task_id_prefix", "T").unwrap();
        let first = db
            .create_task("First", "backlog", None, None, None)
            .expect("create first");
        let second = db
            .create_task("Second", "backlog", None, None, None)
            .expect("create second");
        let third = db
            .create_task("Third", "backlog", None, None, None)
            .expect("create third");

        db.add_task_dependency(&second.id, &first.id)
            .expect("second depends on first");
        db.add_task_dependency(&third.id, &second.id)
            .expect("third depends on second");

        assert!(db.add_task_dependency(&first.id, &third.id).is_err());
        assert!(db
            .set_task_dependencies(&first.id, std::slice::from_ref(&third.id))
            .is_err());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_link_task_chain_rolls_back_on_invalid_edge() {
        let (db, path) = make_test_db("task_dependency_chain_rollback");
        db.set_config("task_id_prefix", "T").unwrap();
        let project_a = db.create_project("A", "/tmp/a").expect("create project a");
        let project_b = db.create_project("B", "/tmp/b").expect("create project b");
        db.create_task("First", "backlog", Some(&project_a.id), None, None)
            .expect("create first");
        let second = db
            .create_task("Second", "backlog", Some(&project_a.id), None, None)
            .expect("create second");
        db.create_task("Third", "backlog", Some(&project_b.id), None, None)
            .expect("create third");

        assert!(db
            .link_task_chain(&["T-1".to_string(), "T-2".to_string(), "T-3".to_string()])
            .is_err());

        let second = db.get_task(&second.id).expect("get second").unwrap();
        assert!(second.depends_on.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_complete_task_preserves_dependency_edges_for_completed_references() {
        let (db, path) = make_test_db("complete_task_dependency_edges");
        db.set_config("task_id_prefix", "T").unwrap();
        let prerequisite = db
            .create_task("Prerequisite", "done", None, None, None)
            .expect("create prerequisite");
        let dependent = db
            .create_task("Dependent", "backlog", None, None, None)
            .expect("create dependent");
        db.add_task_dependency(&dependent.id, &prerequisite.id)
            .expect("add dependency");

        db.complete_task(&prerequisite.id)
            .expect("complete prerequisite");

        let dependent = db.get_task(&dependent.id).expect("get dependent").unwrap();
        assert_eq!(dependent.depends_on, vec![prerequisite.id.clone()]);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_complete_task_retains_record_and_removes_worktree_metadata() {
        let (db, path) = make_test_db("complete_task_retains_record");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Complete me", "backlog", Some(&project.id), None, None)
            .expect("create failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/project",
            "/tmp/project/.worktrees/T-1",
            "openforge/T-1",
        )
        .expect("create worktree metadata");
        assert_eq!(db.get_all_tasks().expect("get failed").len(), 1);
        assert!(db
            .get_worktree_for_task(&task.id)
            .expect("get worktree")
            .is_some());

        db.complete_task(&task.id).expect("complete failed");

        let completed = db
            .get_task(&task.id)
            .expect("get completed task")
            .expect("completed task record should remain");
        assert_eq!(completed.status, "done");
        assert_eq!(completed.initial_prompt, "Complete me");
        assert_eq!(db.get_all_tasks().expect("get failed").len(), 1);
        assert!(db
            .get_worktree_for_task(&task.id)
            .expect("get worktree")
            .is_none());
        assert!(db
            .get_tasks_for_project_excluding_state(&project.id, "done")
            .expect("get visible tasks")
            .is_empty());
        let done_tasks = db
            .get_tasks_for_project_by_state(&project.id, "done")
            .expect("get done tasks");
        assert_eq!(done_tasks.len(), 1);
        assert_eq!(done_tasks[0].id, task.id);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_complete_task_removes_runtime_children() {
        let (db, path) = make_test_db("complete_task_children");
        insert_test_task(&db);

        db.create_agent_session("ses-del", "T-100", None, "implement", "running", "opencode")
            .expect("create session failed");

        db.insert_pull_request(
            99,
            "T-100",
            "acme",
            "repo",
            "PR title",
            "https://example.com",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");
        db.insert_pr_comment(
            501,
            99,
            "reviewer",
            "Fix this",
            "review",
            Some("main.rs"),
            Some(10),
            false,
            1000,
        )
        .expect("insert comment failed");

        db.insert_self_review_comment("T-100", "issue", Some("main.rs"), Some(5), "Looks wrong")
            .expect("insert self review failed");

        db.complete_task("T-100").expect("complete failed");

        let task = db
            .get_task("T-100")
            .expect("get failed")
            .expect("completed task record should remain");
        assert_eq!(task.status, "done");

        let sessions = db
            .get_latest_session_for_ticket("T-100")
            .expect("get session failed");
        assert!(sessions.is_none());

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get self review failed");
        assert!(comments.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_custom_prefix() {
        let (db, path) = make_test_db("task_custom_prefix");
        db.set_config("task_id_prefix", "FOO").unwrap();
        let task = db
            .create_task("Custom prefix task", "backlog", None, None, None)
            .expect("create failed");
        assert_eq!(task.id, "FOO-1");
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_fallback_when_prefix_missing() {
        let (db, path) = make_test_db("task_fallback_missing");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_fallback_when_prefix_empty() {
        let (db, path) = make_test_db("task_fallback_empty");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_permission_mode_defaults_agent_to_none() {
        let (db, path) = make_test_db("create_task_permission_mode");
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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_existing_worktree_branch_source() {
        let (db, path) = make_test_db("create_task_existing_worktree_branch");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_with_disabled_worktree_source() {
        let (db, path) = make_test_db("create_task_disabled_worktree_source");

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
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_agent_fields_default_to_none() {
        let (db, path) = make_test_db("create_task_agent_none");

        let task = db
            .create_task("No agent task", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.agent, None);
        assert_eq!(task.permission_mode, None);

        let retrieved = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(retrieved.agent, None);
        assert_eq!(retrieved.permission_mode, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_board_status_parses_canonical_and_legacy_values() {
        use crate::db::BoardStatus;
        use std::str::FromStr;

        assert_eq!(
            BoardStatus::from_str("backlog").unwrap(),
            BoardStatus::Backlog
        );
        assert_eq!(BoardStatus::from_str("todo").unwrap(), BoardStatus::Backlog);
        assert_eq!(BoardStatus::from_str("doing").unwrap(), BoardStatus::Doing);
        assert_eq!(
            BoardStatus::from_str("in_progress").unwrap(),
            BoardStatus::Doing
        );
        assert_eq!(BoardStatus::from_str("done").unwrap(), BoardStatus::Done);
    }

    #[test]
    fn test_board_status_rejects_unknown_values() {
        use crate::db::BoardStatus;
        use std::str::FromStr;

        assert!(BoardStatus::from_str("wat").is_err());
    }

    #[test]
    fn test_board_status_done_is_not_writable() {
        use crate::db::BoardStatus;

        // 'done' still parses so legacy rows remain readable...
        assert!(BoardStatus::Backlog.is_writable());
        assert!(BoardStatus::Doing.is_writable());
        // ...but it can never be assigned as a new status (AVIV-118 black hole).
        assert!(!BoardStatus::Done.is_writable());
    }

    #[test]
    fn test_board_status_serializes_to_canonical_lowercase_strings() {
        use crate::db::BoardStatus;

        assert_eq!(
            serde_json::to_string(&BoardStatus::Backlog).unwrap(),
            "\"backlog\""
        );
        assert_eq!(
            serde_json::to_string(&BoardStatus::Doing).unwrap(),
            "\"doing\""
        );
        assert_eq!(
            serde_json::to_string(&BoardStatus::Done).unwrap(),
            "\"done\""
        );
    }
}
