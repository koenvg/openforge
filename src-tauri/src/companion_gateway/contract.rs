use super::pairing::{
    PairingCoordinator, PairingError, PairingPollResponse, PairingRequestKind, PairingSubmission,
};
use axum::{
    extract::{
        connect_info::ConnectInfo, rejection::JsonRejection, DefaultBodyLimit, Path, Request, State,
    },
    http::{header::AUTHORIZATION, HeaderMap, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};

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
    InvalidRequest,
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
            Self::InvalidRequest => "invalid_request",
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

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct PairingUnavailableAuthorizer;

#[cfg(test)]
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
    pairing: Arc<PairingCoordinator>,
}

fn error_response(status: StatusCode, code: CompanionErrorCode, message: &str) -> Response {
    (status, Json(CompanionErrorEnvelope::new(code, message))).into_response()
}

fn pairing_error_response(error: PairingError) -> Response {
    let (status, code, message) = match error {
        PairingError::Invalid => (
            StatusCode::UNAUTHORIZED,
            CompanionErrorCode::Unauthenticated,
            "Pairing authorization is invalid",
        ),
        PairingError::Gone => (
            StatusCode::GONE,
            CompanionErrorCode::NotFound,
            "Pairing session is no longer available",
        ),
        PairingError::Rejected => (
            StatusCode::FORBIDDEN,
            CompanionErrorCode::Unauthenticated,
            "Pairing request was rejected",
        ),
        PairingError::RateLimited => (
            StatusCode::TOO_MANY_REQUESTS,
            CompanionErrorCode::RateLimited,
            "Too many pairing attempts",
        ),
        PairingError::InvalidDevice => (
            StatusCode::BAD_REQUEST,
            CompanionErrorCode::InvalidRequest,
            "Device name or platform is invalid",
        ),
        PairingError::Unavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            CompanionErrorCode::TemporarilyUnavailable,
            "Pairing is temporarily unavailable",
        ),
    };
    error_response(status, code, message)
}

fn invalid_pairing_request_response(status: StatusCode) -> Response {
    error_response(
        status,
        CompanionErrorCode::InvalidRequest,
        "Pairing request body is invalid",
    )
}

async fn pairing_request_guard(
    State(pairing): State<Arc<PairingCoordinator>>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    request: Request,
    next: Next,
) -> Response {
    let kind = if request.method() == Method::POST {
        PairingRequestKind::Submission
    } else {
        PairingRequestKind::Poll
    };
    let peer = connect_info
        .map(|ConnectInfo(address)| address.ip())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    if let Err(error) = pairing.admit_request(peer, kind) {
        return pairing_error_response(error);
    }

    let oversized_header = request
        .headers()
        .get(AUTHORIZATION)
        .is_some_and(|value| value.as_bytes().len() > 128);
    let oversized_body = request
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > 4_096);
    if oversized_header || oversized_body {
        return invalid_pairing_request_response(StatusCode::PAYLOAD_TOO_LARGE);
    }

    next.run(request).await
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
async fn submit_pairing_handler(
    State(state): State<CompanionRouterState>,
    submission: Result<Json<PairingSubmission>, JsonRejection>,
) -> Response {
    let Json(submission) = match submission {
        Ok(submission) => submission,
        Err(rejection) => {
            let status = if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            };
            return invalid_pairing_request_response(status);
        }
    };
    match state.pairing.submit(submission) {
        Ok(response) => (StatusCode::ACCEPTED, Json(response)).into_response(),
        Err(error) => pairing_error_response(error),
    }
}

async fn poll_pairing_handler(
    State(state): State<CompanionRouterState>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(secret) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Pairing "))
    else {
        return pairing_error_response(PairingError::Invalid);
    };
    match state.pairing.poll(&request_id, secret) {
        Ok(
            response @ PairingPollResponse {
                status: "pending", ..
            },
        ) => (StatusCode::ACCEPTED, Json(response)).into_response(),
        Ok(response) => Json(response).into_response(),
        Err(error) => pairing_error_response(error),
    }
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
    pairing: Arc<PairingCoordinator>,
) -> Router {
    let pairing_routes = Router::new()
        .route(
            "/companion/v1/pairing/requests",
            post(submit_pairing_handler),
        )
        .route(
            "/companion/v1/pairing/requests/:request_id",
            get(poll_pairing_handler),
        )
        .route_layer(middleware::from_fn_with_state(
            pairing.clone(),
            pairing_request_guard,
        ))
        .layer(DefaultBodyLimit::max(4_096));

    Router::new()
        .route("/companion/v1/status", get(status_handler))
        .merge(pairing_routes)
        .fallback(not_found_handler)
        .with_state(CompanionRouterState {
            host,
            authorizer,
            pairing,
        })
}
