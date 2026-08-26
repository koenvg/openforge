use super::*;

pub(super) fn handle(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "create_project" => {
            let name = payload_string(&request.payload, "name")?;
            let path = payload_string(&request.payload, "path")?;
            let project = {
                let db = crate::db::acquire_db(&state.db);
                db.create_project(&name, &path).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to create project: {e}"),
                    )
                })?
            };
            publish_project_changed(state, &project.id);
            json_value(project)
        }
        "get_projects" => {
            let projects = {
                let db = crate::db::acquire_db(&state.db);
                db.get_all_projects().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get projects: {e}"),
                    )
                })?
            };
            json_value(projects)
        }
        "update_project" => {
            let id = payload_string(&request.payload, "id")?;
            let name = payload_string(&request.payload, "name")?;
            let path = payload_string(&request.payload, "path")?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.update_project(&id, &name, &path).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update project: {e}"),
                    )
                })?;
            }
            publish_project_changed(state, &id);
            Ok(serde_json::Value::Null)
        }
        "get_project_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = {
                let db = crate::db::acquire_db(&state.db);
                db.get_project_config(&project_id, &key).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get project config: {e}"),
                    )
                })?
            };
            json_value(value)
        }
        "resolve_ai_provider" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let value = {
                let db = crate::db::acquire_db(&state.db);
                db.try_resolve_ai_provider(&project_id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to resolve AI provider: {e}"),
                    )
                })?
            };
            json_value(value)
        }
        "set_project_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.set_project_config(&project_id, &key, &value)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to set project config: {e}"),
                        )
                    })?;
            }
            if matches!(key.as_str(), "focus_filter_states" | "low_fire_task_ids") {
                publish_project_board_changed(state, &project_id);
            }
            Ok(serde_json::Value::Null)
        }
        "clear_project_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let key = payload_string(&request.payload, "key")?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.clear_project_config(&project_id, &key).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to clear project config: {e}"),
                    )
                })?;
            }
            Ok(serde_json::Value::Null)
        }
        "reset_project_settings_to_global" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.reset_project_settings_to_global(&project_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to reset project settings: {e}"),
                        )
                    })?;
            }
            publish_project_board_changed(state, &project_id);
            Ok(serde_json::Value::Null)
        }
        _ => unreachable!("project handler only receives project commands"),
    }
}
