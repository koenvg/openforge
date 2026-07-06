use super::AppState;
use crate::{app_events::publish_app_event_to_runtime, db};
use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
pub struct ReloadPluginRequest {
    pub plugin_id: String,
    pub project_id: Option<String>,
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
        .route("/reload_plugin", post(reload_plugin_handler))
}

fn http_plugin_app_data_dir(state: &AppState) -> Result<PathBuf, (StatusCode, String)> {
    let Some(app) = state.app.as_ref() else {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            "plugin installation requires app data path state before Electron sidecar support"
                .to_string(),
        ));
    };

    app.path().app_data_dir().map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to resolve app data directory: {error}"),
        )
    })
}

fn http_plugin_platform(
    state: &AppState,
    require_app_data_dir: bool,
) -> Result<crate::plugin_platform::PluginPlatform<'_>, (StatusCode, String)> {
    let app_data_dir = if require_app_data_dir {
        Some(http_plugin_app_data_dir(state)?)
    } else {
        None
    };

    Ok(crate::plugin_platform::PluginPlatform::new(
        state.db.as_ref(),
        app_data_dir,
        state.plugin_host.as_ref(),
    ))
}

fn http_plugin_error_status(message: &str) -> StatusCode {
    if message.starts_with("Unknown plugin:") {
        StatusCode::NOT_FOUND
    } else if message.contains("built-in plugin")
        || message.contains("sourceKind builtin")
        || message.contains("sourceSpec to match")
        || message.contains("app data directory is required")
        || message.contains("backend not configured")
        || message.contains("backend entry")
        || message.contains("install root")
    {
        StatusCode::BAD_REQUEST
    } else if message.contains("plugin host state is not available") {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn map_http_plugin_error(message: String) -> (StatusCode, String) {
    (http_plugin_error_status(&message), message)
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
    fn plugin_error_status_maps_existing_messages() {
        assert_eq!(
            http_plugin_error_status("Unknown plugin: plugin.test"),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            http_plugin_error_status("backend entry must stay within the plugin install root"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            http_plugin_error_status("plugin host state is not available"),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            http_plugin_error_status("unexpected plugin failure"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
