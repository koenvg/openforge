use super::AppState;
use crate::{
    app_events::publish_app_event_to_runtime,
    db,
    plugin_command_broker::{
        PluginCommandBroker, PluginCommandDiscoveryContext, PluginCommandDiscoveryError,
    },
    plugin_platform::PluginPlatformError,
};
use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPluginFromLocalRequest {
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPluginEnabledRequest {
    pub plugin_id: String,
    pub project_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetPluginEnabledResponse {
    pub plugin_id: String,
    pub project_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppPluginEnabledRequest {
    pub plugin_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetAppPluginEnabledResponse {
    pub plugin_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadPluginRequest {
    pub plugin_id: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribePluginCommandRequest {
    pub command_id: String,
    pub task_id: Option<String>,
    pub project_id: Option<String>,
}

fn deserialize_present_json<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde_json::Value::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokePluginCommandRequest {
    pub command_id: String,
    pub task_id: Option<String>,
    pub project_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_present_json")]
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReloadPluginResponse {
    pub plugin_id: String,
    pub project_id: Option<String>,
    pub reloaded: bool,
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/install_plugin_from_local",
            post(install_plugin_from_local_handler),
        )
        .route("/set_plugin_enabled", post(set_plugin_enabled_handler))
        .route(
            "/set_app_plugin_enabled",
            post(set_app_plugin_enabled_handler),
        )
        .route("/reload_plugin", post(reload_plugin_handler))
        .route("/plugin_commands/list", post(list_plugin_commands_handler))
        .route(
            "/plugin_commands/describe",
            post(describe_plugin_command_handler),
        )
        .route(
            "/plugin_commands/invoke",
            post(invoke_plugin_command_handler),
        )
}

fn http_plugin_platform(
    state: &AppState,
    require_app_data_dir: bool,
) -> Result<crate::plugin_platform::PluginPlatform<'_>, (StatusCode, String)> {
    crate::plugin_platform_adapter::plugin_platform_for_state(
        state,
        require_app_data_dir,
        crate::plugin_platform_adapter::PluginPlatformTransport::HttpPluginManagement,
    )
}

#[cfg(test)]
fn http_plugin_error_status(error: &PluginPlatformError) -> StatusCode {
    crate::plugin_platform_adapter::plugin_platform_error_status(
        error,
        crate::plugin_platform_adapter::PluginPlatformTransport::HttpPluginManagement,
    )
}

fn map_http_plugin_error(error: PluginPlatformError) -> (StatusCode, String) {
    crate::plugin_platform_adapter::map_plugin_platform_error(
        error,
        crate::plugin_platform_adapter::PluginPlatformTransport::HttpPluginManagement,
    )
}

fn map_plugin_command_error(error: PluginCommandDiscoveryError) -> (StatusCode, String) {
    let status = match &error {
        PluginCommandDiscoveryError::MissingContext
        | PluginCommandDiscoveryError::TaskMissingProject { .. } => StatusCode::BAD_REQUEST,
        PluginCommandDiscoveryError::ConflictingContext { .. } => StatusCode::CONFLICT,
        PluginCommandDiscoveryError::TaskNotFound { .. }
        | PluginCommandDiscoveryError::ProjectNotFound { .. }
        | PluginCommandDiscoveryError::PluginNotInstalled { .. }
        | PluginCommandDiscoveryError::CommandNotFound { .. } => StatusCode::NOT_FOUND,
        PluginCommandDiscoveryError::PluginDisabled { .. } => StatusCode::FORBIDDEN,
        PluginCommandDiscoveryError::FrontendUnavailable { .. }
        | PluginCommandDiscoveryError::Runtime(_) => StatusCode::SERVICE_UNAVAILABLE,
        PluginCommandDiscoveryError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string())
}

async fn list_plugin_commands_handler(
    State(state): State<AppState>,
    Json(context): Json<PluginCommandDiscoveryContext>,
) -> Result<Json<Vec<crate::plugin_command_broker::AgentCommandDescriptor>>, (StatusCode, String)> {
    let platform = http_plugin_platform(&state, false)?;
    let broker = PluginCommandBroker::with_frontend(
        Arc::clone(&state.db),
        &platform,
        &state.frontend_host_requests,
    );
    broker
        .list(&context)
        .await
        .map(Json)
        .map_err(map_plugin_command_error)
}

async fn describe_plugin_command_handler(
    State(state): State<AppState>,
    Json(request): Json<DescribePluginCommandRequest>,
) -> Result<Json<crate::plugin_command_broker::AgentCommandDescriptor>, (StatusCode, String)> {
    let platform = http_plugin_platform(&state, false)?;
    let broker = PluginCommandBroker::with_frontend(
        Arc::clone(&state.db),
        &platform,
        &state.frontend_host_requests,
    );
    let context = PluginCommandDiscoveryContext {
        task_id: request.task_id,
        project_id: request.project_id,
    };
    broker
        .describe(&context, &request.command_id)
        .await
        .map(Json)
        .map_err(map_plugin_command_error)
}

async fn invoke_plugin_command_handler(
    State(state): State<AppState>,
    Json(request): Json<InvokePluginCommandRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let platform = http_plugin_platform(&state, false)?;
    let broker = PluginCommandBroker::with_frontend(
        Arc::clone(&state.db),
        &platform,
        &state.frontend_host_requests,
    );
    let context = PluginCommandDiscoveryContext {
        task_id: request.task_id,
        project_id: request.project_id,
    };
    broker
        .invoke(&context, &request.command_id, request.input)
        .await
        .map(Json)
        .map_err(map_plugin_command_error)
}

async fn install_plugin_from_local_handler(
    State(state): State<AppState>,
    Json(request): Json<InstallPluginFromLocalRequest>,
) -> Result<Json<db::PluginRow>, (StatusCode, String)> {
    let plugin = http_plugin_platform(&state, true)?
        .install_local_plugin_bundle(&PathBuf::from(request.source_path))
        .map_err(map_http_plugin_error)?;
    let payload = serde_json::json!({
        "plugin_id": plugin.id.clone(),
    });
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "plugin-installation-changed",
        &payload,
    );
    Ok(Json(plugin))
}

async fn set_plugin_enabled_handler(
    State(state): State<AppState>,
    Json(request): Json<SetPluginEnabledRequest>,
) -> Result<Json<SetPluginEnabledResponse>, (StatusCode, String)> {
    http_plugin_platform(&state, false)?
        .set_plugin_enabled(&request.project_id, &request.plugin_id, request.enabled)
        .map_err(map_http_plugin_error)?;

    let payload = serde_json::json!({
        "plugin_id": request.plugin_id.clone(),
        "project_id": request.project_id.clone(),
        "enabled": request.enabled,
    });
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "project-plugin-enablement-changed",
        &payload,
    );
    Ok(Json(SetPluginEnabledResponse {
        plugin_id: request.plugin_id,
        project_id: request.project_id,
        enabled: request.enabled,
    }))
}

async fn set_app_plugin_enabled_handler(
    State(state): State<AppState>,
    Json(request): Json<SetAppPluginEnabledRequest>,
) -> Result<Json<SetAppPluginEnabledResponse>, (StatusCode, String)> {
    let SetAppPluginEnabledRequest { plugin_id, enabled } = request;
    http_plugin_platform(&state, false)?
        .set_app_plugin_enabled(&plugin_id, enabled)
        .map_err(map_http_plugin_error)?;

    let payload = serde_json::json!({ "plugin_id": plugin_id.clone(), "enabled": enabled });
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "app-plugin-enablement-changed",
        &payload,
    );
    Ok(Json(SetAppPluginEnabledResponse { plugin_id, enabled }))
}

async fn reload_plugin_handler(
    State(state): State<AppState>,
    Json(request): Json<ReloadPluginRequest>,
) -> Result<Json<ReloadPluginResponse>, (StatusCode, String)> {
    let plugin_id = request.plugin_id;
    let project_id = request.project_id;
    let installed = http_plugin_platform(&state, false)?
        .plugin(&plugin_id)
        .map_err(map_http_plugin_error)?;
    if installed.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Unknown plugin: {plugin_id}"),
        ));
    }

    let payload = serde_json::json!({
        "plugin_id": plugin_id.clone(),
        "project_id": project_id.clone(),
    });
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "plugin-reload-requested",
        &payload,
    );

    Ok(Json(ReloadPluginResponse {
        plugin_id,
        project_id,
        reloaded: true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_models_deserialize_camel_case_fields() {
        let install: InstallPluginFromLocalRequest =
            serde_json::from_str(r#"{"sourcePath":"/tmp/plugin.tgz"}"#).expect("install request");
        assert_eq!(install.source_path, "/tmp/plugin.tgz");

        let enabled: SetPluginEnabledRequest =
            serde_json::from_str(r#"{"pluginId":"plugin.test","projectId":"P-1","enabled":true}"#)
                .expect("enabled request");
        assert_eq!(enabled.plugin_id, "plugin.test");
        assert_eq!(enabled.project_id, "P-1");
        assert!(enabled.enabled);

        let reload: ReloadPluginRequest =
            serde_json::from_str(r#"{"pluginId":"plugin.test","projectId":"P-1"}"#)
                .expect("reload request");
        assert_eq!(reload.plugin_id, "plugin.test");
        assert_eq!(reload.project_id.as_deref(), Some("P-1"));

        let missing_input: InvokePluginCommandRequest =
            serde_json::from_str(r#"{"commandId":"plugin.test.run","projectId":"P-1"}"#)
                .expect("missing input request");
        assert_eq!(missing_input.input, None);
        let null_input: InvokePluginCommandRequest = serde_json::from_str(
            r#"{"commandId":"plugin.test.run","projectId":"P-1","input":null}"#,
        )
        .expect("null input request");
        assert_eq!(null_input.input, Some(serde_json::Value::Null));
        let object_input: InvokePluginCommandRequest = serde_json::from_str(
            r#"{"commandId":"plugin.test.run","projectId":"P-1","input":{"force":true}}"#,
        )
        .expect("object input request");
        assert_eq!(
            object_input.input,
            Some(serde_json::json!({ "force": true }))
        );
    }

    #[test]
    fn response_models_preserve_snake_case_fields() {
        let enabled = serde_json::to_value(SetPluginEnabledResponse {
            plugin_id: "plugin.test".to_string(),
            project_id: "P-1".to_string(),
            enabled: true,
        })
        .expect("enabled response");
        assert_eq!(enabled["plugin_id"], "plugin.test");
        assert_eq!(enabled["project_id"], "P-1");
        assert!(enabled.get("pluginId").is_none());

        let reload = serde_json::to_value(ReloadPluginResponse {
            plugin_id: "plugin.test".to_string(),
            project_id: Some("P-1".to_string()),
            reloaded: true,
        })
        .expect("reload response");
        assert_eq!(reload["plugin_id"], "plugin.test");
        assert_eq!(reload["project_id"], "P-1");
        assert!(reload.get("pluginId").is_none());
    }

    #[test]
    fn plugin_error_variants_preserve_existing_http_statuses_and_messages() {
        let cases = [
            (
                PluginPlatformError::not_found("Unknown plugin: plugin.test"),
                StatusCode::NOT_FOUND,
                "Unknown plugin: plugin.test",
            ),
            (
                PluginPlatformError::invalid_request(
                    "backend entry must stay within the plugin install root",
                ),
                StatusCode::BAD_REQUEST,
                "backend entry must stay within the plugin install root",
            ),
            (
                PluginPlatformError::unavailable("plugin host state is not available"),
                StatusCode::SERVICE_UNAVAILABLE,
                "plugin host state is not available",
            ),
            (
                PluginPlatformError::internal("unexpected plugin failure"),
                StatusCode::INTERNAL_SERVER_ERROR,
                "unexpected plugin failure",
            ),
        ];

        for (error, expected_status, expected_message) in cases {
            assert_eq!(http_plugin_error_status(&error), expected_status);
            assert_eq!(error.to_string(), expected_message);
        }
    }
}
