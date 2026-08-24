use thiserror::Error;

pub(crate) type PluginPlatformResult<T> = Result<T, PluginPlatformError>;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub(crate) enum PluginPlatformError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    InvalidRequest(String),
    #[error("{0}")]
    AppDataDirRequired(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Internal(String),
}

impl From<PluginPlatformError> for String {
    fn from(error: PluginPlatformError) -> Self {
        error.to_string()
    }
}

impl PluginPlatformError {
    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub(crate) fn invalid_request(message: impl Into<String>) -> Self {
        Self::InvalidRequest(message.into())
    }

    pub(crate) fn app_data_dir_required(message: impl Into<String>) -> Self {
        Self::AppDataDirRequired(message.into())
    }

    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self::Unavailable(message.into())
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
}
