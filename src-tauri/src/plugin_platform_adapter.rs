use crate::{
    http_server::AppState,
    plugin_platform::{PluginPlatform, PluginPlatformError},
};
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
    error: &PluginPlatformError,
    transport: PluginPlatformTransport,
) -> StatusCode {
    match error {
        PluginPlatformError::NotFound(_) => StatusCode::NOT_FOUND,
        PluginPlatformError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
        PluginPlatformError::AppDataDirRequired(_)
            if transport == PluginPlatformTransport::HttpPluginManagement =>
        {
            StatusCode::BAD_REQUEST
        }
        PluginPlatformError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        PluginPlatformError::AppDataDirRequired(_) | PluginPlatformError::Internal(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

pub(crate) fn map_plugin_platform_error(
    error: PluginPlatformError,
    transport: PluginPlatformTransport,
) -> (StatusCode, String) {
    let status = plugin_platform_error_status(&error, transport);
    (status, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_status_follows_the_error_variant_not_its_message() {
        let message = "Unknown plugin: misleading text";
        let cases = [
            (
                PluginPlatformError::not_found(message),
                StatusCode::NOT_FOUND,
            ),
            (
                PluginPlatformError::invalid_request(message),
                StatusCode::BAD_REQUEST,
            ),
            (
                PluginPlatformError::unavailable(message),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (
                PluginPlatformError::internal(message),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];

        for transport in [
            PluginPlatformTransport::AppInvoke,
            PluginPlatformTransport::HttpPluginManagement,
        ] {
            for (error, expected_status) in &cases {
                assert_eq!(
                    plugin_platform_error_status(error, transport),
                    *expected_status
                );
            }
        }
    }

    #[test]
    fn error_status_preserves_http_only_app_data_directory_contract() {
        let error = PluginPlatformError::app_data_dir_required(
            "app data directory is required to install plugins",
        );

        assert_eq!(
            plugin_platform_error_status(&error, PluginPlatformTransport::HttpPluginManagement,),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            plugin_platform_error_status(&error, PluginPlatformTransport::AppInvoke),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
