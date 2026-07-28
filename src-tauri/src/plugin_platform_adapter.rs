use crate::{http_server::AppState, plugin_platform::PluginPlatform};
use axum::http::StatusCode;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PluginPlatformTransport {
    AppInvoke,
    HttpPluginManagement,
}

pub(crate) fn plugin_platform_for_state(
    state: &AppState,
    require_app_data_dir: bool,
    transport: PluginPlatformTransport,
) -> Result<PluginPlatform<'_>, (StatusCode, String)> {
    let app_data_dir = if require_app_data_dir {
        Some(app_data_dir_for_state(state, transport)?)
    } else {
        None
    };

    Ok(PluginPlatform::new(
        state.db.as_ref(),
        app_data_dir,
        state.plugin_host.as_ref(),
        &state.plugin_lifecycle_locks,
    ))
}

fn app_data_dir_for_state(
    state: &AppState,
    transport: PluginPlatformTransport,
) -> Result<PathBuf, (StatusCode, String)> {
    let Some(app) = state.app.as_ref() else {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            missing_app_data_message(transport),
        ));
    };

    app.path().app_data_dir().map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to resolve app data directory: {error}"),
        )
    })
}

fn missing_app_data_message(transport: PluginPlatformTransport) -> String {
    match transport {
        PluginPlatformTransport::AppInvoke => {
            "app IPC command requires app data path state before Electron sidecar support"
                .to_string()
        }
        PluginPlatformTransport::HttpPluginManagement => {
            "plugin installation requires app data path state before Electron sidecar support"
                .to_string()
        }
    }
}

pub(crate) fn plugin_platform_error_status(
    message: &str,
    transport: PluginPlatformTransport,
) -> StatusCode {
    if message.starts_with("Unknown plugin:") {
        StatusCode::NOT_FOUND
    } else if message.contains("built-in plugin")
        || message.contains("sourceKind builtin")
        || message.contains("sourceSpec to match")
        || http_only_app_data_error(message, transport)
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

fn http_only_app_data_error(message: &str, transport: PluginPlatformTransport) -> bool {
    transport == PluginPlatformTransport::HttpPluginManagement
        && message.contains("app data directory is required")
}

pub(crate) fn map_plugin_platform_error(
    message: String,
    transport: PluginPlatformTransport,
) -> (StatusCode, String) {
    (plugin_platform_error_status(&message, transport), message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_status_maps_common_plugin_platform_messages_for_both_transports() {
        for transport in [
            PluginPlatformTransport::AppInvoke,
            PluginPlatformTransport::HttpPluginManagement,
        ] {
            assert_eq!(
                plugin_platform_error_status("Unknown plugin: plugin.test", transport),
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                plugin_platform_error_status("built-in plugin registration rejected", transport),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                plugin_platform_error_status("sourceKind builtin is reserved", transport),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                plugin_platform_error_status("sourceSpec to match plugin id", transport),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                plugin_platform_error_status("backend not configured for plugin.test", transport),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                plugin_platform_error_status(
                    "backend entry must stay within the plugin install root",
                    transport,
                ),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                plugin_platform_error_status("plugin host state is not available", transport),
                StatusCode::SERVICE_UNAVAILABLE
            );
            assert_eq!(
                plugin_platform_error_status("unexpected plugin failure", transport),
                StatusCode::INTERNAL_SERVER_ERROR
            );
        }
    }

    #[test]
    fn error_status_preserves_http_only_app_data_directory_contract() {
        assert_eq!(
            plugin_platform_error_status(
                "app data directory is required to install plugins",
                PluginPlatformTransport::HttpPluginManagement,
            ),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            plugin_platform_error_status(
                "app data directory is required to install plugins",
                PluginPlatformTransport::AppInvoke,
            ),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
