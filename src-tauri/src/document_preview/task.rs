//! Task document authority comes from live host records, never a caller root.
use crate::db::Database;
use std::sync::Mutex;

#[derive(Debug, PartialEq, Eq)]
struct TaskIdentity {
    root: String,
    task_created_at: i64,
    project_id: String,
    workspace_id: i64,
    legacy_worktree: bool,
}

pub(crate) async fn read_task_document(
    database: &Mutex<Database>,
    task_id: &str,
    path: String,
) -> Result<serde_json::Value, String> {
    read_task_document_with(database, task_id, path, &super::READER).await
}

pub(super) async fn read_task_document_with(
    database: &Mutex<Database>,
    task_id: &str,
    path: String,
    reader: &super::DocumentReader,
) -> Result<serde_json::Value, String> {
    let identity = task_identity(database, task_id)?;
    let response = reader.read(identity.root.clone().into(), path).await?;
    let value = serde_json::to_value(&response.document)
        .map_err(|_| "DOCUMENT_PREVIEW_IO: unable to encode document response".to_string())?;
    if task_identity(database, task_id).ok().as_ref() != Some(&identity) {
        return Err("DOCUMENT_PREVIEW_CHANGED: task workspace changed during reading".into());
    }
    response.verify_root()?;
    Ok(value)
}

fn task_identity(database: &Mutex<Database>, task_id: &str) -> Result<TaskIdentity, String> {
    if task_id.trim().is_empty() {
        return Err("DOCUMENT_PREVIEW_BAD_REQUEST: taskId is required".into());
    }
    let db = crate::db::acquire_db(database);
    let unavailable = || "DOCUMENT_PREVIEW_NOT_FOUND: task workspace is unavailable".to_string();
    let io = |_| "DOCUMENT_PREVIEW_IO: unable to resolve task workspace".to_string();
    let task = db.get_task(task_id).map_err(io)?.ok_or_else(unavailable)?;
    let project_id = task.project_id.ok_or_else(unavailable)?;
    db.get_project(&project_id)
        .map_err(io)?
        .ok_or_else(unavailable)?;
    let root = crate::task_workspace_service::resolve_workspace_path(&db, task_id)
        .map_err(|_| unavailable())?;
    let worktree = db.get_worktree_for_task(task_id).map_err(io)?;
    let (workspace_id, legacy_worktree) =
        if let Some(worktree) = worktree.filter(|row| row.worktree_path == root) {
            (worktree.id, true)
        } else {
            let workspace = db
                .get_task_workspace_for_task(task_id)
                .map_err(io)?
                .filter(|row| row.workspace_path == root)
                .ok_or_else(unavailable)?;
            (workspace.id, false)
        };
    Ok(TaskIdentity {
        root,
        task_created_at: task.created_at,
        project_id,
        workspace_id,
        legacy_worktree,
    })
}
