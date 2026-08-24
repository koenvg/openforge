use super::*;

pub(super) async fn handle(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let key = payload_string(&request.payload, "key")?;
    match request.command.as_str() {
        "get_config" => {
            if crate::secure_store::is_secret(&key) {
                let value = crate::secure_config::get(&state.db, &key)
                    .await
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get secret config: {error}"),
                        )
                    })?;
                json_value(value)
            } else {
                let value = {
                    let db = crate::db::acquire_db(&state.db);
                    db.get_config(&key).map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get config: {error}"),
                        )
                    })?
                };
                json_value(value)
            }
        }
        "set_config" => {
            let value = payload_string(&request.payload, "value")?;
            if crate::secure_store::is_secret(&key) {
                crate::secure_config::set(&state.db, &key, &value)
                    .await
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to set secret config: {error}"),
                        )
                    })?;
            } else {
                let db = crate::db::acquire_db(&state.db);
                db.set_config(&key, &value).map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set config: {error}"),
                    )
                })?;
            }
            if key == crate::pty_manager::GHOSTTY_TERMINAL_VIEW_CONFIG {
                if let Some(pty_manager) = &state.pty_manager {
                    pty_manager.set_terminal_view_enabled(value == "true");
                }
            }
            if matches!(
                key.as_str(),
                "project_sidebar_order" | "project_sidebar_hidden"
            ) {
                publish_project_catalog_changed(state);
            }
            Ok(serde_json::Value::Null)
        }
        _ => unreachable!("config handler only receives config commands"),
    }
}
