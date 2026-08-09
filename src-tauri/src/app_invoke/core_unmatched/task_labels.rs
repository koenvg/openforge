use super::*;

pub(super) fn handle(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "get_project_task_labels" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let labels = {
                let db = crate::db::acquire_db(&state.db);
                db.get_project_task_labels(&project_id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get project labels: {e}"),
                    )
                })?
            };
            json_value(labels)
        }
        "create_task_label" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let name = payload_string(&request.payload, "name")?;
            let label = {
                let db = crate::db::acquire_db(&state.db);
                db.create_task_label(&project_id, &name).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to create task label: {e}"),
                    )
                })?
            };
            json_value(label)
        }
        "add_task_label" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let name = payload_string(&request.payload, "name")?;
            let label = {
                let db = crate::db::acquire_db(&state.db);
                db.add_task_label(&task_id, &name).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to add task label: {e}"),
                    )
                })?
            };
            json_value(label)
        }
        "remove_task_label" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let label_id = payload_i64(&request.payload, "labelId")?;
            let db = crate::db::acquire_db(&state.db);
            db.remove_task_label(&task_id, label_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to remove task label: {e}"),
                )
            })?;
            Ok(serde_json::Value::Null)
        }
        "delete_task_label" => {
            let label_id = payload_i64(&request.payload, "labelId")?;
            let affected_task_ids = {
                let db = crate::db::acquire_db(&state.db);
                db.delete_task_label(label_id).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to delete task label: {e}"),
                    )
                })?
            };
            for task_id in affected_task_ids {
                publish_task_changed(state, &task_id);
            }
            Ok(serde_json::Value::Null)
        }
        _ => unreachable!("task label handler only receives task label commands"),
    }
}
