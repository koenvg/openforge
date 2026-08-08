use super::{error_response, CompanionErrorCode, CompanionRouterState};
use crate::companion_gateway::pairing::{
    PairingCoordinator, PairingError, PairingPollResponse, PairingRequestKind, PairingSubmission,
};
use axum::{
    extract::{
        connect_info::ConnectInfo, rejection::JsonRejection, DefaultBodyLimit, Path, Request, State,
    },
    http::{header::AUTHORIZATION, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::{net::SocketAddr, sync::Arc};

const PAIRING_REQUEST_MAX_BYTES: usize = 4_096;

pub(super) fn routes(pairing: Arc<PairingCoordinator>) -> Router<CompanionRouterState> {
    Router::new()
        .route(
            "/companion/v1/pairing/requests",
            post(submit_pairing_handler),
        )
        .route(
            "/companion/v1/pairing/requests/:request_id",
            get(poll_pairing_handler),
        )
        .route_layer(middleware::from_fn_with_state(
            pairing,
            pairing_request_guard,
        ))
        .layer(DefaultBodyLimit::max(PAIRING_REQUEST_MAX_BYTES))
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
        .is_some_and(|length| length > PAIRING_REQUEST_MAX_BYTES as u64);
    if oversized_header || oversized_body {
        return invalid_pairing_request_response(StatusCode::PAYLOAD_TOO_LARGE);
    }

    next.run(request).await
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
    headers: axum::http::HeaderMap,
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
