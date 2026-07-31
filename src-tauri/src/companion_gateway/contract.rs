use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub(crate) const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone)]
pub(crate) struct CompanionHostStatus {
    host_id: String,
}

impl CompanionHostStatus {
    pub(crate) fn new(host_id: String) -> Self {
        Self { host_id }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionErrorCode {
    Unauthenticated,
    Revoked,
    IncompatibleVersion,
    NotFound,
    RateLimited,
    TemporarilyUnavailable,
}

#[cfg(test)]
impl CompanionErrorCode {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::Revoked => "revoked",
            Self::IncompatibleVersion => "incompatible_version",
            Self::NotFound => "not_found",
            Self::RateLimited => "rate_limited",
            Self::TemporarilyUnavailable => "temporarily_unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionErrorBody {
    pub(crate) code: CompanionErrorCode,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CompanionErrorEnvelope {
    pub(crate) error: CompanionErrorBody,
}

impl CompanionErrorEnvelope {
    fn new(code: CompanionErrorCode, message: impl Into<String>) -> Self {
        Self {
            error: CompanionErrorBody {
                code,
                message: message.into(),
                request_id: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionHostStatusResponse {
    pub(crate) host_id: String,
    pub(crate) protocol_version: u8,
    pub(crate) server_time: String,
}

pub(crate) trait CompanionAuthorizer: Send + Sync {
    fn authorize(&self, headers: &HeaderMap) -> Result<(), CompanionErrorCode>;
}

#[derive(Debug, Default)]
pub(crate) struct PairingUnavailableAuthorizer;

impl CompanionAuthorizer for PairingUnavailableAuthorizer {
    fn authorize(&self, _headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
        Err(CompanionErrorCode::Unauthenticated)
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct AllowAllAuthorizer;

#[cfg(test)]
impl CompanionAuthorizer for AllowAllAuthorizer {
    fn authorize(&self, _headers: &HeaderMap) -> Result<(), CompanionErrorCode> {
        Ok(())
    }
}

#[derive(Clone)]
struct CompanionRouterState {
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
}

fn error_response(status: StatusCode, code: CompanionErrorCode, message: &str) -> Response {
    (status, Json(CompanionErrorEnvelope::new(code, message))).into_response()
}

async fn status_handler(State(state): State<CompanionRouterState>, headers: HeaderMap) -> Response {
    if let Err(code) = state.authorizer.authorize(&headers) {
        return error_response(
            StatusCode::UNAUTHORIZED,
            code,
            "Companion device authentication is required",
        );
    }

    Json(CompanionHostStatusResponse {
        host_id: state.host.host_id,
        protocol_version: PROTOCOL_VERSION,
        server_time: chrono::Utc::now().to_rfc3339(),
    })
    .into_response()
}

async fn not_found_handler() -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        CompanionErrorCode::NotFound,
        "Companion resource was not found",
    )
}

pub(crate) fn create_router(
    host: CompanionHostStatus,
    authorizer: Arc<dyn CompanionAuthorizer>,
) -> Router {
    Router::new()
        .route("/companion/v1/status", get(status_handler))
        .fallback(not_found_handler)
        .with_state(CompanionRouterState { host, authorizer })
}
