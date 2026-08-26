use super::*;
use crate::plugin_platform::{PluginPlatformError, PluginPlatformResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppRegisterBuiltinPluginRequest {
    id: String,
    name: String,
    version: String,
    api_version: i64,
    description: String,
    permissions: String,
    contributes: String,
    frontend_entry: String,
    backend_entry: Option<String>,
    install_path: String,
    #[serde(default = "legacy_source_kind")]
    source_kind: String,
    #[serde(default)]
    source_spec: String,
    #[serde(default = "empty_package_metadata")]
    package_metadata: String,
    installed_at: i64,
    #[serde(rename = "isBuiltin")]
    _is_builtin: bool,
}

fn legacy_source_kind() -> String {
    "legacy".to_string()
}

fn empty_package_metadata() -> String {
    "{}".to_string()
}

impl AppRegisterBuiltinPluginRequest {
    fn into_builtin_plugin_row(self) -> PluginPlatformResult<db::PluginRow> {
        let is_builtin =
            crate::builtin_plugins::has_sentinel_install_path(&self.id, &self.install_path);
        if !is_builtin {
            return Err(PluginPlatformError::invalid_request(
                "trusted built-in plugin registration requires a known built-in plugin id and matching builtin: install path",
            ));
        }

        if self.source_kind != "builtin" {
            return Err(PluginPlatformError::invalid_request(
                "trusted built-in plugin registration requires sourceKind builtin",
            ));
        }

        if !self.source_spec.is_empty() && self.source_spec != self.id {
            return Err(PluginPlatformError::invalid_request(
                "trusted built-in plugin registration requires sourceSpec to match the plugin id",
            ));
        }

        Ok(db::PluginRow {
            source_spec: self.id.clone(),
            id: self.id,
            name: self.name,
            version: self.version,
            api_version: self.api_version,
            description: self.description,
            permissions: self.permissions,
            contributes: self.contributes,
            frontend_entry: self.frontend_entry,
            backend_entry: self.backend_entry,
            install_path: self.install_path,
            source_kind: "builtin".to_string(),
            package_metadata: self.package_metadata,
            installed_at: self.installed_at,
            is_builtin: true,
        })
    }
}

fn plugin_platform(
    state: &AppState,
    require_app_data_dir: bool,
) -> Result<crate::plugin_platform::PluginPlatform<'_>, (StatusCode, String)> {
    crate::plugin_platform_adapter::plugin_platform_for_state(
        state,
        require_app_data_dir,
        crate::plugin_platform_adapter::PluginPlatformTransport::AppInvoke,
    )
}

fn map_plugin_platform_error(error: PluginPlatformError) -> (StatusCode, String) {
    crate::plugin_platform_adapter::map_plugin_platform_error(
        error,
        crate::plugin_platform_adapter::PluginPlatformTransport::AppInvoke,
    )
}

pub(super) async fn handle_app_plugin_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "register_builtin_plugin" => {
            let plugin =
                payload_field::<AppRegisterBuiltinPluginRequest>(&request.payload, "plugin")?
                    .into_builtin_plugin_row()
                    .map_err(map_plugin_platform_error)?;
            plugin_platform(state, false)?
                .register_builtin_plugin(&plugin)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        // Read-only discovery over a user-chosen folder: no database or app data dir
        // involved, so it deliberately skips PluginPlatform.
        "scan_plugin_folder" => {
            let folder_path = payload_string(&request.payload, "folderPath")?;
            let discovered =
                crate::plugin_folder_scan::scan_plugin_folder(std::path::Path::new(&folder_path))
                    .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
            json_value(discovered)?
        }
        "install_plugin_from_local" => {
            let source_path =
                std::path::PathBuf::from(payload_string(&request.payload, "sourcePath")?);
            let plugin = plugin_platform(state, true)?
                .install_local_plugin_bundle(&source_path)
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "install_plugin_from_npm" => {
            let package_name = payload_string(&request.payload, "packageName")?;
            let plugin = plugin_platform(state, true)?
                .install_npm_plugin_bundle(&package_name)
                .await
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "install_plugin_from_git" => {
            let git_spec = payload_string(&request.payload, "gitSpec")?;
            let plugin = plugin_platform(state, true)?
                .install_git_plugin_bundle(&git_spec)
                .await
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "install_plugin_from_source" => {
            let source_spec = payload_string(&request.payload, "sourceSpec")?;
            let plugin = plugin_platform(state, true)?
                .install_plugin_package_source(&source_spec)
                .await
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "uninstall_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            plugin_platform(state, true)?
                .uninstall_plugin(&plugin_id)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "get_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            json_value(
                plugin_platform(state, false)?
                    .plugin(&plugin_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "list_plugins" => json_value(
            plugin_platform(state, false)?
                .plugins()
                .map_err(map_plugin_platform_error)?,
        )?,
        "set_plugin_enabled" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = payload_bool(&request.payload, "enabled")?;
            plugin_platform(state, false)?
                .set_plugin_enabled(&project_id, &plugin_id, enabled)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "get_enabled_plugins" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            json_value(
                plugin_platform(state, false)?
                    .enabled_plugins(&project_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "set_app_plugin_enabled" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = payload_bool(&request.payload, "enabled")?;
            plugin_platform(state, false)?
                .set_app_plugin_enabled(&plugin_id, enabled)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "get_enabled_app_plugins" => json_value(
            plugin_platform(state, false)?
                .enabled_app_plugins()
                .map_err(map_plugin_platform_error)?,
        )?,
        "configure_start_prompt_contribution" => {
            let owner_plugin_id = payload_optional_string(&request.payload, "ownerPluginId")?
                .filter(|plugin_id| !plugin_id.trim().is_empty());
            let project_id = payload_string(&request.payload, "projectId")?;
            let id = payload_string(&request.payload, "id")?;
            let content = payload_string(&request.payload, "content")?;
            let contribution = crate::task_start_prompt::StartPromptContribution {
                owner_plugin_id,
                id: id.trim().to_string(),
                enabled: request
                    .payload
                    .get("enabled")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true),
                content,
                order: crate::task_start_prompt::parse_start_prompt_contribution_order(
                    request.payload.get("order"),
                )
                .map_err(|error| (StatusCode::BAD_REQUEST, error))?,
            };
            crate::task_start_prompt::validate_start_prompt_contribution(&contribution)
                .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
            let db = crate::db::acquire_db(&state.db);
            json_value(
                crate::task_start_prompt::upsert_start_prompt_contribution(
                    &db,
                    &project_id,
                    contribution,
                )
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?,
            )?
        }
        "set_global_plugin_default" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = request
                .payload
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let db = crate::db::acquire_db(&state.db);
            db.set_global_plugin_enabled(&plugin_id, enabled)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set global plugin default: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "get_global_plugin_defaults" => {
            let db = crate::db::acquire_db(&state.db);
            let defaults = db.get_global_plugin_defaults().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get global plugin defaults: {e}"),
                )
            })?;
            json_value(
                defaults
                    .into_iter()
                    .map(|(id, enabled)| serde_json::json!({ "pluginId": id, "enabled": enabled }))
                    .collect::<Vec<_>>(),
            )?
        }
        "get_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let scope = payload_string(&request.payload, "scope")?;
            let scope_id = payload_optional_string(&request.payload, "scopeId")?;
            let key = payload_string(&request.payload, "key")?;
            let scope =
                crate::plugin_platform::PluginStorageScope::parse(&scope, scope_id.as_deref())
                    .map_err(map_plugin_platform_error)?;
            json_value(
                plugin_platform(state, false)?
                    .plugin_storage(&plugin_id, &scope, &key)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "set_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let scope = payload_string(&request.payload, "scope")?;
            let scope_id = payload_optional_string(&request.payload, "scopeId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = request
                .payload
                .get("value")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let scope =
                crate::plugin_platform::PluginStorageScope::parse(&scope, scope_id.as_deref())
                    .map_err(map_plugin_platform_error)?;
            plugin_platform(state, false)?
                .set_plugin_storage(&plugin_id, &scope, &key, &value)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "delete_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let scope = payload_string(&request.payload, "scope")?;
            let scope_id = payload_optional_string(&request.payload, "scopeId")?;
            let key = payload_string(&request.payload, "key")?;
            let scope =
                crate::plugin_platform::PluginStorageScope::parse(&scope, scope_id.as_deref())
                    .map_err(map_plugin_platform_error)?;
            plugin_platform(state, false)?
                .delete_plugin_storage(&plugin_id, &scope, &key)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "resolve_plugin_asset_root" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            json_value(
                plugin_platform(state, false)?
                    .resolve_plugin_asset_root(&plugin_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "plugin_frontend_command_acknowledge" => {
            let acknowledgement = serde_json::from_value::<
                crate::frontend_host_request_transport::FrontendHostRequestAcknowledgement,
            >(request.payload.clone())
            .map_err(|error| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("invalid frontend host request acknowledgement: {error}"),
                )
            })?;
            serde_json::Value::Bool(state.frontend_host_requests.acknowledge(acknowledgement))
        }
        "plugin_invoke" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let command = payload_string(&request.payload, "command")?;
            let payload = request
                .payload
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            plugin_platform(state, false)?
                .invoke_backend(&plugin_id, &command, payload)
                .await
                .map_err(map_plugin_platform_error)?
        }
        "plugin_backend_when_ready" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let project_id = payload_optional_string(&request.payload, "projectId")?;
            let preserve_activation = request
                .payload
                .get("preserveActivation")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            plugin_platform(state, false)?
                .backend_when_ready(&plugin_id, project_id.as_deref(), preserve_activation)
                .await
                .map_err(map_plugin_platform_error)?
        }
        "plugin_backend_deactivate" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            plugin_platform(state, false)?
                .deactivate_backend(&plugin_id)
                .await
                .map_err(map_plugin_platform_error)?
        }
        "stop_plugin_sidecar" => {
            plugin_platform(state, false)?
                .stop_sidecar()
                .await
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
