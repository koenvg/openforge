//! The project root is selected and revalidated by host records, never by callers.
use crate::db::Database;
use std::sync::Mutex;

pub(crate) async fn read_project_document(
    database: &Mutex<Database>,
    project_id: &str,
    path: String,
) -> Result<serde_json::Value, String> {
    read_project_document_with(database, project_id, path, &super::READER).await
}

pub(super) async fn read_project_document_with(
    database: &Mutex<Database>,
    project_id: &str,
    path: String,
    reader: &super::DocumentReader,
) -> Result<serde_json::Value, String> {
    let identity = project_identity(database, project_id)?;
    let response = reader.read(identity.0.clone().into(), path).await?;
    let value = serde_json::to_value(&response.document)
        .map_err(|_| "DOCUMENT_PREVIEW_IO: unable to encode document response".to_string())?;
    if project_identity(database, project_id).ok().as_ref() != Some(&identity) {
        return Err("DOCUMENT_PREVIEW_CHANGED: project changed during reading".into());
    }
    // Keep the response's permit until encoding the complete adapter result.
    response.verify_root()?;
    Ok(value)
}

fn project_identity(database: &Mutex<Database>, project_id: &str) -> Result<(String, i64), String> {
    if project_id.trim().is_empty() {
        return Err("DOCUMENT_PREVIEW_BAD_REQUEST: projectId is required".into());
    }
    let db = crate::db::acquire_db(database);
    let project = db
        .get_project(project_id)
        .map_err(|_| "DOCUMENT_PREVIEW_IO: unable to resolve project".to_string())?
        .ok_or_else(|| "DOCUMENT_PREVIEW_NOT_FOUND: project is unavailable".to_string())?;
    if project.path.is_empty() {
        return Err("DOCUMENT_PREVIEW_NOT_FOUND: project root is unavailable".into());
    }
    Ok((project.path, project.created_at))
}
