use super::*;

const COMPANION_COMMANDS: [&str; 12] = [
    "get_companion_gateway_status",
    "set_companion_gateway_enabled",
    "set_companion_tailscale_hostname",
    "start_companion_pairing",
    "get_companion_pairing_status",
    "cancel_companion_pairing",
    "approve_companion_pairing",
    "reject_companion_pairing",
    "list_companion_devices",
    "revoke_companion_device",
    "remove_companion_device",
    "reset_companion_host_identity",
];

fn companion_operation_error(error: String) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, error)
}

pub(super) async fn handle_app_companion_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    if !COMPANION_COMMANDS.contains(&request.command.as_str()) {
        return Ok(None);
    }
    let Some(manager) = state.companion_gateway.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Companion Gateway lifecycle is unavailable".to_string(),
        ));
    };

    let value = match request.command.as_str() {
        "get_companion_gateway_status" => json_value(manager.status().await)?,
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
            let status = if enabled {
                let _ = manager.enable().await;
                manager.status().await
            } else {
                manager.disable().await
            };
            json_value(status)?
        }
        "set_companion_tailscale_hostname" => {
            let hostname = payload_string(&request.payload, "hostname")?;
            let hostname = crate::companion_gateway::normalize_magicdns_hostname(&hostname)
                .map_err(companion_operation_error)?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.set_config(
                    crate::companion_gateway::COMPANION_TAILSCALE_HOSTNAME_CONFIG,
                    &hostname,
                )
                .map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to persist Companion Tailscale hostname: {error}"),
                    )
                })?;
            }
            json_value(manager.configure_tailscale_hostname(hostname).await)?
        }
        "start_companion_pairing" => json_value(
            manager
                .start_pairing()
                .await
                .map_err(companion_operation_error)?,
        )?,
        "get_companion_pairing_status" => json_value(
            manager
                .pairing_status()
                .map_err(companion_operation_error)?,
        )?,
        "cancel_companion_pairing" => {
            let session_id = payload_string(&request.payload, "sessionId")?;
            manager
                .cancel_pairing(&session_id)
                .await
                .map_err(companion_operation_error)?;
            serde_json::Value::Null
        }
        "approve_companion_pairing" | "reject_companion_pairing" => {
            let request_id = payload_string(&request.payload, "requestId")?;
            let decision = if request.command == "approve_companion_pairing" {
                crate::companion_gateway::PairingDecision::Approve
            } else {
                crate::companion_gateway::PairingDecision::Reject
            };
            manager
                .decide_pairing(&request_id, decision)
                .await
                .map_err(companion_operation_error)?;
            serde_json::Value::Null
        }
        "list_companion_devices" => {
            json_value(manager.devices().map_err(companion_operation_error)?)?
        }
        "revoke_companion_device" => {
            let device_id = payload_string(&request.payload, "deviceId")?;
            manager
                .revoke_device(&device_id)
                .await
                .map_err(companion_operation_error)?;
            serde_json::Value::Null
        }
        "remove_companion_device" => {
            let device_id = payload_string(&request.payload, "deviceId")?;
            manager
                .remove_revoked_device(&device_id)
                .await
                .map_err(companion_operation_error)?;
            serde_json::Value::Null
        }
        "reset_companion_host_identity" => json_value(
            manager
                .reset_host_identity()
                .await
                .map_err(companion_operation_error)?,
        )?,
        _ => unreachable!("Companion command was checked above"),
    };

    Ok(Some(value))
}
