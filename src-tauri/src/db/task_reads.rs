use super::{
    task_dependencies::load_task_dependency_ids_for_tasks,
    task_labels::{load_task_labels_for_tasks, MAX_TASK_LABEL_NAME_CHARS},
    task_persistence::{
        hydrate_task_relationship_references, hydrate_task_rows, task_from_row,
        task_relationship_reference_from_row, TASK_ROW_COLUMNS,
    },
    tasks::{
        resolved_projection_title, ActiveTasks, CompletedTaskPage, CompletedTaskQuery,
        CompletionCoverage, CompletionRangeStatus, TaskDetail, TaskRead, TaskReadError,
        TaskReference, TaskSummary,
    },
    Database,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params_from_iter, types::Value, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

const COMPLETED_TASK_PAGE_SIZE: usize = 50;
const MAX_COMPLETED_TASK_SEARCH_CHARS: usize = 200;
const MAX_COMPLETED_TASK_LABEL_FILTERS: usize = 20;
const COMPLETED_TASK_CURSOR_VERSION: u8 = 1;
const COMPLETION_DATE_CURSOR_VERSION: u8 = 2;
const MAX_SAFE_UNIX_SECOND: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CompletedTaskScope {
    project_id: String,
    search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completed_from: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completed_before: Option<i64>,
    labels: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedTaskCursor {
    version: u8,
    scope: CompletedTaskScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completed_at: Option<i64>,
    id: String,
}

struct NormalizedCompletedTaskQuery {
    scope: CompletedTaskScope,
    cursor: Option<CompletedTaskCursor>,
    completion_range: Option<(i64, i64)>,
}

pub struct Tasks<'database> {
    database: &'database Database,
}

impl Database {
    pub fn tasks(&self) -> Tasks<'_> {
        Tasks { database: self }
    }
}

impl Tasks<'_> {
    pub fn active(&self, project_id: &str) -> Result<ActiveTasks, TaskReadError> {
        let mut connection = self.database.lock_conn()?;
        let transaction = connection.transaction()?;
        require_project(&transaction, project_id)?;

        let query = format!(
            "SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE project_id = ?1 AND status != 'done' ORDER BY updated_at DESC, id DESC"
        );
        let mut statement = transaction.prepare(&query)?;
        let rows = statement.query_map([project_id], task_from_row)?;
        let task_rows = rows.collect::<Result<Vec<_>>>()?;
        drop(statement);
        let tasks = hydrate_task_rows(&transaction, task_rows)?
            .iter()
            .map(TaskDetail::from)
            .collect();

        let related = query_active_relationship_references(&transaction, project_id)?
            .iter()
            .map(TaskReference::from)
            .collect();
        transaction.commit()?;
        Ok(ActiveTasks { tasks, related })
    }

    pub fn completed(
        &self,
        project_id: &str,
        query: CompletedTaskQuery,
    ) -> Result<CompletedTaskPage, TaskReadError> {
        let query = normalize_completed_task_query(project_id, query)?;
        let mut connection = self.database.lock_conn()?;
        let transaction = connection.transaction()?;
        require_project(&transaction, project_id)?;

        let mut conditions = vec![
            "tasks.status = 'done'".to_string(),
            "tasks.project_id = ?".to_string(),
        ];
        let mut parameters = vec![Value::Text(project_id.to_string())];
        if let Some(search) = &query.scope.search {
            conditions.push(
                "(LOWER(tasks.id) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(NULLIF(tasks.title, ''), NULLIF(tasks.prompt_preview, ''), tasks.id)) LIKE ? ESCAPE '\\' OR LOWER(tasks.prompt_preview) LIKE ? ESCAPE '\\')"
                    .to_string(),
            );
            let pattern = Value::Text(escaped_like_pattern(search));
            parameters.extend([pattern.clone(), pattern.clone(), pattern]);
        }
        for label in &query.scope.labels {
            conditions.push(
                "EXISTS (SELECT 1 FROM task_label_assignments assignments INNER JOIN task_labels labels ON labels.id = assignments.label_id WHERE assignments.task_id = tasks.id AND labels.name_normalized = ?)"
                    .to_string(),
            );
            parameters.push(Value::Text(label.clone()));
        }
        let completion_coverage =
            completion_coverage(&transaction, &query, &conditions, &parameters)?;
        let date_ordered = query.completion_range.is_some();
        if let Some((from, before)) = query.completion_range {
            conditions.extend([
                "tasks.completed_at IS NOT NULL".to_string(),
                "tasks.completed_at >= ?".to_string(),
                "tasks.completed_at < ?".to_string(),
            ]);
            parameters.extend([Value::Integer(from), Value::Integer(before)]);
        }
        if let Some(cursor) = &query.cursor {
            let key = if date_ordered {
                cursor.completed_at.ok_or(TaskReadError::InvalidCursor)?
            } else {
                cursor.updated_at.ok_or(TaskReadError::InvalidCursor)?
            };
            let column = if date_ordered {
                "completed_at"
            } else {
                "updated_at"
            };
            conditions.push(format!(
                "(tasks.{column} < ? OR (tasks.{column} = ? AND tasks.id < ?))"
            ));
            parameters.extend([
                Value::Integer(key),
                Value::Integer(key),
                Value::Text(cursor.id.clone()),
            ]);
        }

        let order_column = if date_ordered {
            "completed_at"
        } else {
            "updated_at"
        };
        let sql = format!(
            "SELECT tasks.id, tasks.status, tasks.project_id, tasks.created_at, tasks.updated_at, tasks.title, tasks.source_ticket_url, tasks.prompt_preview, tasks.completed_at FROM tasks WHERE {} ORDER BY tasks.{order_column} DESC, tasks.id DESC LIMIT ?",
            conditions.join(" AND ")
        );
        parameters.push(Value::Integer((COMPLETED_TASK_PAGE_SIZE + 1) as i64));
        let mut statement = transaction.prepare(&sql)?;
        let rows =
            statement.query_map(params_from_iter(parameters.iter()), task_summary_from_row)?;
        let mut tasks = rows.collect::<Result<Vec<_>>>()?;
        drop(statement);
        let has_more = tasks.len() > COMPLETED_TASK_PAGE_SIZE;
        if has_more {
            tasks.pop();
        }
        let tasks = hydrate_task_summaries(&transaction, tasks)?;
        let next_cursor = if has_more {
            tasks
                .last()
                .map(|task| encode_completed_task_cursor(&query.scope, task))
                .transpose()?
        } else {
            None
        };
        transaction.commit()?;
        Ok(CompletedTaskPage {
            tasks,
            next_cursor,
            completion_coverage,
        })
    }

    pub fn detail(
        &self,
        project_id: &str,
        task_id: &str,
    ) -> Result<Option<TaskRead>, TaskReadError> {
        let mut connection = self.database.lock_conn()?;
        let transaction = connection.transaction()?;
        require_project(&transaction, project_id)?;

        let sql = format!("SELECT {TASK_ROW_COLUMNS} FROM tasks WHERE id = ?1 AND project_id = ?2");
        let mut statement = transaction.prepare(&sql)?;
        let task = statement
            .query_row([task_id, project_id], task_from_row)
            .optional()?;
        drop(statement);
        let Some(task) = task else {
            transaction.commit()?;
            return Ok(None);
        };
        let mut hydrated = hydrate_task_rows(&transaction, vec![task])?;
        let task = TaskDetail::from(&hydrated.remove(0));
        let related = query_task_relationship_references(&transaction, task_id)?
            .iter()
            .map(TaskReference::from)
            .collect();
        transaction.commit()?;
        Ok(Some(TaskRead { task, related }))
    }
}

fn require_project(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> Result<(), TaskReadError> {
    let exists = connection
        .query_row("SELECT 1 FROM projects WHERE id = ?1", [project_id], |_| {
            Ok(())
        })
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(TaskReadError::ProjectNotFound(project_id.to_string()))
    }
}
fn completion_coverage(
    connection: &rusqlite::Connection,
    query: &NormalizedCompletedTaskQuery,
    base_conditions: &[String],
    base_parameters: &[Value],
) -> Result<CompletionCoverage, TaskReadError> {
    let tracked_from = connection
        .query_row(
            "SELECT tracked_from FROM task_completion_coverage WHERE id = 1",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten();
    let count_sql = format!(
        "SELECT COUNT(*) FROM tasks WHERE {} AND tasks.completed_at IS NULL",
        base_conditions.join(" AND ")
    );
    let unknown_completed_task_count = connection.query_row(
        &count_sql,
        params_from_iter(base_parameters.iter()),
        |row| row.get(0),
    )?;
    let range_status = match (query.completion_range, tracked_from) {
        (None, _) => CompletionRangeStatus::NotRequested,
        (Some((from, _)), Some(start)) if from >= start => CompletionRangeStatus::Complete,
        (Some((_, before)), Some(start)) if before > start => CompletionRangeStatus::Partial,
        (Some(_), _) => CompletionRangeStatus::Unavailable,
    };
    Ok(CompletionCoverage {
        tracked_from,
        unknown_completed_task_count,
        range_status,
    })
}

fn normalize_completed_task_query(
    project_id: &str,
    query: CompletedTaskQuery,
) -> Result<NormalizedCompletedTaskQuery, TaskReadError> {
    let completion_range = match (query.completed_from, query.completed_before) {
        (None, None) => None,
        (Some(from), Some(before))
            if from >= 0 && before <= MAX_SAFE_UNIX_SECOND && from < before =>
        {
            Some((from, before))
        }
        _ => return Err(TaskReadError::InvalidCompletionRange),
    };
    let search = query
        .search
        .map(|search| search.trim().to_lowercase())
        .filter(|search| !search.is_empty());
    if let Some(search) = &search {
        let requested = search.chars().count();
        if requested > MAX_COMPLETED_TASK_SEARCH_CHARS {
            return Err(TaskReadError::SearchTooLong {
                requested,
                max: MAX_COMPLETED_TASK_SEARCH_CHARS,
            });
        }
    }
    if query.labels.len() > MAX_COMPLETED_TASK_LABEL_FILTERS {
        return Err(TaskReadError::TooManyLabels {
            requested: query.labels.len(),
            max: MAX_COMPLETED_TASK_LABEL_FILTERS,
        });
    }
    let labels = query
        .labels
        .into_iter()
        .map(|label| label.trim().to_lowercase())
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    if let Some(requested) = labels
        .iter()
        .map(|label| label.chars().count())
        .find(|length| *length > MAX_TASK_LABEL_NAME_CHARS)
    {
        return Err(TaskReadError::LabelNameTooLong {
            requested,
            max: MAX_TASK_LABEL_NAME_CHARS,
        });
    }
    let mut labels = labels;
    labels.sort();
    labels.dedup();
    let scope = CompletedTaskScope {
        project_id: project_id.to_string(),
        search,
        completed_from: completion_range.map(|(from, _)| from),
        completed_before: completion_range.map(|(_, before)| before),
        labels,
    };
    let cursor = query
        .cursor
        .as_deref()
        .map(decode_completed_task_cursor)
        .transpose()?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.scope != scope
            || cursor.id.is_empty()
            || if completion_range.is_some() {
                cursor.version != COMPLETION_DATE_CURSOR_VERSION
                    || cursor.completed_at.is_none()
                    || cursor.updated_at.is_some()
            } else {
                cursor.version != COMPLETED_TASK_CURSOR_VERSION
                    || cursor.updated_at.is_none()
                    || cursor.completed_at.is_some()
            }
    }) {
        return Err(TaskReadError::InvalidCursor);
    }
    Ok(NormalizedCompletedTaskQuery {
        scope,
        cursor,
        completion_range,
    })
}

fn encode_completed_task_cursor(
    scope: &CompletedTaskScope,
    task: &TaskSummary,
) -> Result<String, TaskReadError> {
    serde_json::to_vec(&CompletedTaskCursor {
        version: if scope.completed_from.is_some() {
            COMPLETION_DATE_CURSOR_VERSION
        } else {
            COMPLETED_TASK_CURSOR_VERSION
        },
        scope: scope.clone(),
        updated_at: scope.completed_from.is_none().then_some(task.updated_at),
        completed_at: if scope.completed_from.is_some() {
            task.completed_at
        } else {
            None
        },
        id: task.id.clone(),
    })
    .map(|payload| URL_SAFE_NO_PAD.encode(payload))
    .map_err(|_| TaskReadError::InvalidCursor)
}

fn decode_completed_task_cursor(cursor: &str) -> Result<CompletedTaskCursor, TaskReadError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| TaskReadError::InvalidCursor)?;
    serde_json::from_slice(&bytes).map_err(|_| TaskReadError::InvalidCursor)
}

fn escaped_like_pattern(search: &str) -> String {
    let escaped = search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn task_summary_from_row(row: &rusqlite::Row<'_>) -> Result<TaskSummary> {
    let id: String = row.get(0)?;
    let explicit_title: Option<String> = row.get(5)?;
    let prompt_preview: String = row.get(7)?;
    Ok(TaskSummary {
        title: resolved_projection_title(&id, explicit_title.as_deref(), &prompt_preview),
        id,
        status: row.get(1)?,
        project_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        completed_at: row.get(8)?,
        source_ticket_url: row.get(6)?,
        prompt_preview,
        depends_on: Vec::new(),
        labels: Vec::new(),
    })
}

fn hydrate_task_summaries(
    connection: &rusqlite::Connection,
    mut tasks: Vec<TaskSummary>,
) -> Result<Vec<TaskSummary>> {
    let task_ids = tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>();
    let mut dependencies = load_task_dependency_ids_for_tasks(connection, &task_ids)?;
    let mut labels = load_task_labels_for_tasks(connection, &task_ids)?;
    for task in &mut tasks {
        task.depends_on = dependencies.remove(&task.id).unwrap_or_default();
        task.labels = labels.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

fn query_active_relationship_references(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<super::tasks::TaskRelationshipReferenceRow>> {
    let mut statement = connection.prepare(
        "WITH active_tasks AS (
            SELECT id FROM tasks WHERE project_id = ?1 AND status != 'done'
        ), relationship_ids AS (
            SELECT dependencies.depends_on_task_id AS id
            FROM task_dependencies dependencies
            INNER JOIN active_tasks active ON active.id = dependencies.task_id
            UNION
            SELECT dependencies.task_id AS id
            FROM task_dependencies dependencies
            INNER JOIN active_tasks active ON active.id = dependencies.depends_on_task_id
        )
        SELECT tasks.id, tasks.status, tasks.project_id, tasks.title, tasks.prompt_preview
        FROM tasks
        INNER JOIN relationship_ids ON relationship_ids.id = tasks.id
        WHERE NOT EXISTS (SELECT 1 FROM active_tasks WHERE active_tasks.id = tasks.id)
        ORDER BY tasks.updated_at DESC, tasks.id DESC",
    )?;
    let rows = statement.query_map([project_id], task_relationship_reference_from_row)?;
    let tasks = rows.collect::<Result<Vec<_>>>()?;
    drop(statement);
    hydrate_task_relationship_references(connection, tasks)
}

fn query_task_relationship_references(
    connection: &rusqlite::Connection,
    task_id: &str,
) -> Result<Vec<super::tasks::TaskRelationshipReferenceRow>> {
    let mut statement = connection.prepare(
        "WITH relationship_ids AS (
            SELECT depends_on_task_id AS id FROM task_dependencies WHERE task_id = ?1
            UNION
            SELECT task_id AS id FROM task_dependencies WHERE depends_on_task_id = ?1
        )
        SELECT tasks.id, tasks.status, tasks.project_id, tasks.title, tasks.prompt_preview
        FROM tasks
        INNER JOIN relationship_ids ON relationship_ids.id = tasks.id
        ORDER BY tasks.updated_at DESC, tasks.id DESC",
    )?;
    let rows = statement.query_map([task_id], task_relationship_reference_from_row)?;
    let tasks = rows.collect::<Result<Vec<_>>>()?;
    drop(statement);
    hydrate_task_relationship_references(connection, tasks)
}

#[cfg(test)]
#[path = "task_reads_tests.rs"]
mod tests;
