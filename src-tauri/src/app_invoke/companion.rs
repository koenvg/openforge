use super::*;

pub(super) async fn handle_app_companion_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let Some(manager) = state.companion_gateway.as_ref() else {
        return match request.command.as_str() {
            "get_companion_gateway_status" | "set_companion_gateway_enabled" => Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Companion Gateway lifecycle is unavailable".to_string(),
            )),
            _ => Ok(None),
        };
    };

    let status = match request.command.as_str() {
        "get_companion_gateway_status" => manager.status().await,
        "set_companion_gateway_enabled" => {
            let enabled = payload_bool(&request.payload, "enabled")?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.set_config(
                    crate::companion_gateway::COMPANION_GATEWAY_ENABLED_CONFIG,
                    if enabled { "true" } else { "false" },
                )
                .map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to persist Companion Gateway preference: {error}"),
                    )
                })?;
            }
            if enabled {
                let _ = manager.enable().await;
                manager.status().await
            } else {
                manager.disable().await
            }
        }
        _ => return Ok(None),
    };

    json_value(status).map(Some)
}
