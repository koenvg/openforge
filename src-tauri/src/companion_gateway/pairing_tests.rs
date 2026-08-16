use super::{
    contract::{create_router, CompanionErrorEnvelope, CompanionHostStatus, PROTOCOL_VERSION},
    devices::{CompanionDeviceStore, DatabaseCompanionDeviceStore},
    pairing::{PairingBootstrap, PairingCoordinator, PairingDecision},
};
use axum::{
    body::Body,
    extract::connect_info::ConnectInfo,
    http::{header::AUTHORIZATION, HeaderMap, HeaderValue, Request, StatusCode},
    response::Response,
};
use base64::Engine;
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";
const FINGERPRINT: &str = "AA:BB:CC:DD";
const ENDPOINT: &str = "https://192.168.1.20:17424";

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

fn assert_schema_accepts(schema_name: &str, instance: &serde_json::Value) {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1.openapi.json",
    ))
    .expect("OpenAPI JSON");
    let schema = &contract["components"]["schemas"][schema_name];
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(schema)
        .expect("valid JSON schema");
    let errors = validator
        .iter_errors(instance)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "schema errors: {errors:?}");
}

#[test]
fn shared_dart_fixtures_conform_to_the_openapi_schemas() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1-fixtures.json",
    ))
    .expect("shared Companion fixtures");
    for (fixture, schema) in [
        ("pairingSubmissionStatus", "PairingSubmissionStatus"),
        ("pairingPending", "PairingPoll"),
        ("pairingApproved", "PairingPoll"),
        ("hostStatus", "HostStatus"),
    ] {
        assert_schema_accepts(schema, &fixtures[fixture]);
    }
}

fn bootstrap() -> PairingBootstrap {
    PairingBootstrap {
        protocol_version: PROTOCOL_VERSION,
        host_id: HOST_ID.to_string(),
        certificate_sha256: FINGERPRINT.to_string(),
        endpoint_candidates: vec![ENDPOINT.to_string()],
    }
}

fn test_coordinator(name: &str, ttl: Duration) -> (Arc<PairingCoordinator>, std::path::PathBuf) {
    let (database, path) = crate::db::test_helpers::make_test_db(name);
    let store: Arc<dyn CompanionDeviceStore> = Arc::new(DatabaseCompanionDeviceStore::new(
        Arc::new(std::sync::Mutex::new(database)),
    ));
    (Arc::new(PairingCoordinator::new(store, ttl)), path)
}

async fn submit_request(
    router: &axum::Router,
    secret: &str,
    device_name: &str,
    platform: &str,
) -> Response {
    submit_request_from(
        router,
        secret,
        device_name,
        platform,
        "0.0.0.0:0".parse().expect("unspecified peer"),
    )
    .await
}

async fn submit_request_from(
    router: &axum::Router,
    secret: &str,
    device_name: &str,
    platform: &str,
    peer: SocketAddr,
) -> Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/companion/v1/pairing/requests")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "secret": secret,
                "deviceName": device_name,
                "platform": platform,
            })
            .to_string(),
        ))
        .expect("pairing request");
    request.extensions_mut().insert(ConnectInfo(peer));
    router
        .clone()
        .oneshot(request)
        .await
        .expect("router response")
}

async fn poll_request(router: &axum::Router, request_id: &str, secret: &str) -> Response {
    router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/companion/v1/pairing/requests/{request_id}"))
                .header(AUTHORIZATION, format!("Pairing {secret}"))
                .body(Body::empty())
                .expect("poll request"),
        )
        .await
        .expect("router response")
}

#[tokio::test]
async fn approval_issues_one_device_credential_that_authenticates_status_and_can_be_revoked() {
    let (coordinator, path) =
        test_coordinator("companion_pairing_router_approval", Duration::from_secs(60));
    let session = coordinator
        .start(bootstrap())
        .expect("start pairing session");
    let qr: serde_json::Value = serde_json::from_str(&session.qr_payload).expect("QR JSON");
    assert_eq!(
        qr.as_object()
            .expect("QR object")
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        std::collections::BTreeSet::from([
            "certificateSha256",
            "endpointCandidates",
            "hostId",
            "oneTimeSecret",
            "protocolVersion",
        ])
    );
    assert_eq!(qr["hostId"], HOST_ID);
    assert_eq!(qr["certificateSha256"], FINGERPRINT);
    assert_eq!(qr["endpointCandidates"][0], ENDPOINT);
    assert!(session.qr_payload.find("backend").is_none());

    let router = create_router(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator.clone(),
    );
    let submitted = submit_request(
        &router,
        qr["oneTimeSecret"].as_str().expect("pairing secret"),
        "Koen's iPhone",
        "ios",
    )
    .await;
    assert_eq!(submitted.status(), StatusCode::ACCEPTED);
    let submitted_json = response_json(submitted).await;
    assert_schema_accepts("PairingSubmissionStatus", &submitted_json);
    let request_id = submitted_json["requestId"]
        .as_str()
        .expect("request id")
        .to_string();
    assert!(submitted_json.get("credential").is_none());

    let pending = coordinator
        .status()
        .expect("desktop pairing status")
        .expect("active pairing session");
    assert_eq!(
        pending
            .pending_request
            .expect("pending request")
            .device_name,
        "Koen's iPhone"
    );
    let waiting = poll_request(
        &router,
        &request_id,
        qr["oneTimeSecret"].as_str().expect("pairing secret"),
    )
    .await;
    assert_eq!(waiting.status(), StatusCode::ACCEPTED);
    let waiting_json = response_json(waiting).await;
    assert_schema_accepts("PairingPoll", &waiting_json);
    assert!(waiting_json.get("credential").is_none());

    coordinator
        .decide(&request_id, PairingDecision::Approve)
        .expect("approve request");
    let delivery = coordinator
        .status()
        .expect("desktop pairing status")
        .expect("credential delivery session");
    assert!(delivery.delivery_pending);
    assert!(
        coordinator.start(bootstrap()).is_err(),
        "a new QR session must not destroy an approved unclaimed credential",
    );
    let approved = poll_request(
        &router,
        &request_id,
        qr["oneTimeSecret"].as_str().expect("pairing secret"),
    )
    .await;
    assert_eq!(approved.status(), StatusCode::OK);
    let approved_json = response_json(approved).await;
    assert_schema_accepts("PairingPoll", &approved_json);
    let credential = approved_json["credential"]
        .as_str()
        .expect("one-time credential")
        .to_string();
    let device_id = approved_json["deviceId"]
        .as_str()
        .expect("device id")
        .to_string();
    assert_eq!(
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&credential)
            .expect("credential encoding")
            .len(),
        32,
        "credential must contain 256 bits of entropy"
    );

    let claimed_again = poll_request(
        &router,
        &request_id,
        qr["oneTimeSecret"].as_str().expect("pairing secret"),
    )
    .await;
    assert_eq!(claimed_again.status(), StatusCode::GONE);
    assert!(response_json(claimed_again)
        .await
        .get("credential")
        .is_none());
    let mut stream_headers = HeaderMap::new();
    stream_headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {credential}")).expect("authorization header"),
    );
    coordinator.notify_gateway_running();
    let mut stream_authorization = coordinator
        .authorize_stream(&stream_headers)
        .expect("authorized stream context");
    assert_eq!(stream_authorization.device_id(), device_id);

    let status_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/companion/v1/status")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header(AUTHORIZATION, format!("Bearer {credential}"))
                .body(Body::empty())
                .expect("status request"),
        )
        .await
        .expect("router response");
    assert_eq!(status_response.status(), StatusCode::OK);
    let status_json = response_json(status_response).await;
    assert_eq!(status_json["hostId"], HOST_ID);
    assert_eq!(status_json["protocolVersion"], PROTOCOL_VERSION);

    let devices = coordinator.devices().expect("paired devices");
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].device_name, "Koen's iPhone");
    assert_eq!(devices[0].platform, "ios");
    let persisted_row = std::fs::read(&path).expect("SQLite database bytes");
    assert!(
        !persisted_row
            .windows(credential.len())
            .any(|window| window == credential.as_bytes()),
        "SQLite must never contain the clear device credential"
    );

    coordinator.revoke(&device_id).expect("revoke device");
    let termination = stream_authorization.wait_for_termination().await;
    assert!(termination.terminates(&device_id));
    coordinator.notify_gateway_closing();
    assert!(matches!(
        coordinator.authorize_stream(&stream_headers),
        Err(super::contract::CompanionErrorCode::TemporarilyUnavailable)
    ));
    let revoked = router
        .oneshot(
            Request::builder()
                .uri("/companion/v1/status")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header(AUTHORIZATION, format!("Bearer {credential}"))
                .body(Body::empty())
                .expect("revoked status request"),
        )
        .await
        .expect("router response");
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
    let envelope: CompanionErrorEnvelope =
        serde_json::from_value(response_json(revoked).await).expect("error envelope");
    assert_eq!(envelope.error.code.as_str(), "revoked");

    coordinator
        .remove_revoked(&device_id)
        .expect("remove revoked device");
    assert!(coordinator.devices().expect("paired devices").is_empty());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn identical_pairing_submission_retry_returns_the_original_request() {
    let (coordinator, path) = test_coordinator(
        "companion_pairing_idempotent_submission",
        Duration::from_secs(60),
    );
    let session = coordinator
        .start(bootstrap())
        .expect("start pairing session");
    let qr: serde_json::Value = serde_json::from_str(&session.qr_payload).expect("pairing QR JSON");
    let secret = qr["oneTimeSecret"].as_str().expect("pairing secret");
    let router = create_router(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator,
    );

    let first = submit_request(&router, secret, "My Android phone", "android").await;
    assert_eq!(first.status(), StatusCode::ACCEPTED);
    let first_json = response_json(first).await;

    let retry = submit_request(&router, secret, "My Android phone", "android").await;
    assert_eq!(retry.status(), StatusCode::ACCEPTED);
    let retry_json = response_json(retry).await;
    assert_eq!(retry_json["requestId"], first_json["requestId"]);
    assert_eq!(retry_json["expiresAt"], first_json["expiresAt"]);

    let changed = submit_request(&router, secret, "Another Android", "android").await;
    assert_eq!(changed.status(), StatusCode::GONE);

    let changed_platform = submit_request(&router, secret, "My Android phone", "ios").await;
    assert_eq!(changed_platform.status(), StatusCode::GONE);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn rejection_cancellation_expiry_and_secret_reuse_never_issue_credentials() {
    let (coordinator, path) = test_coordinator(
        "companion_pairing_router_rejection",
        Duration::from_millis(20),
    );
    let router = create_router(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator.clone(),
    );

    let rejected_session = coordinator.start(bootstrap()).expect("start session");
    let rejected_qr: serde_json::Value =
        serde_json::from_str(&rejected_session.qr_payload).expect("QR JSON");
    let rejected_secret = rejected_qr["oneTimeSecret"].as_str().expect("secret");
    let submitted = submit_request(&router, rejected_secret, "Pixel 9", "android").await;
    let request_id = response_json(submitted).await["requestId"]
        .as_str()
        .expect("request id")
        .to_string();
    let reused = submit_request(&router, rejected_secret, "Other phone", "android").await;
    assert_eq!(reused.status(), StatusCode::GONE);
    assert!(response_json(reused).await.get("credential").is_none());

    coordinator
        .decide(&request_id, PairingDecision::Reject)
        .expect("reject request");
    let rejected = poll_request(&router, &request_id, rejected_secret).await;
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);
    assert!(response_json(rejected).await.get("credential").is_none());

    let cancelled_session = coordinator.start(bootstrap()).expect("start session");
    let cancelled_qr: serde_json::Value =
        serde_json::from_str(&cancelled_session.qr_payload).expect("QR JSON");
    coordinator
        .cancel(&cancelled_session.session_id)
        .expect("cancel session");
    let cancelled = submit_request(
        &router,
        cancelled_qr["oneTimeSecret"].as_str().expect("secret"),
        "Cancelled phone",
        "ios",
    )
    .await;
    assert_eq!(cancelled.status(), StatusCode::GONE);
    assert!(response_json(cancelled).await.get("credential").is_none());

    let expired_session = coordinator.start(bootstrap()).expect("start session");
    let expired_qr: serde_json::Value =
        serde_json::from_str(&expired_session.qr_payload).expect("QR JSON");
    tokio::time::sleep(Duration::from_millis(30)).await;
    let expired = submit_request(
        &router,
        expired_qr["oneTimeSecret"].as_str().expect("secret"),
        "Late phone",
        "android",
    )
    .await;
    assert_eq!(expired.status(), StatusCode::GONE);
    assert!(response_json(expired).await.get("credential").is_none());
    assert!(coordinator.devices().expect("paired devices").is_empty());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn pairing_submission_is_rate_limited_without_echoing_secrets() {
    let (coordinator, path) = test_coordinator(
        "companion_pairing_router_rate_limit",
        Duration::from_secs(60),
    );
    let session = coordinator.start(bootstrap()).expect("start session");
    let qr: serde_json::Value = serde_json::from_str(&session.qr_payload).expect("QR JSON");
    let secret = qr["oneTimeSecret"].as_str().expect("secret");
    let router = create_router(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator,
    );

    let mut limited = None;
    let attacker_secret = "A".repeat(43);
    let attacker: SocketAddr = "192.168.1.30:50000".parse().expect("attacker peer");
    for _ in 0..20 {
        let response =
            submit_request_from(&router, &attacker_secret, "Unknown", "android", attacker).await;
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            limited = Some(response);
            break;
        }
    }
    let limited_json = response_json(limited.expect("rate-limited response")).await;
    assert_eq!(limited_json["error"]["code"], "rate_limited");
    assert!(!limited_json.to_string().contains(secret));
    assert!(!limited_json.to_string().contains(&attacker_secret));

    let legitimate = submit_request_from(
        &router,
        secret,
        "Koen's iPhone",
        "ios",
        "192.168.1.31:50001".parse().expect("legitimate peer"),
    )
    .await;
    assert_eq!(legitimate.status(), StatusCode::ACCEPTED);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn malformed_and_oversized_pairing_requests_use_safe_contract_errors() {
    let (coordinator, path) = test_coordinator(
        "companion_pairing_router_invalid_boundary",
        Duration::from_secs(60),
    );
    let session = coordinator.start(bootstrap()).expect("start session");
    let qr: serde_json::Value = serde_json::from_str(&session.qr_payload).expect("QR JSON");
    let router = create_router(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator,
    );

    let malformed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/pairing/requests")
                .header("content-type", "application/json")
                .body(Body::from("{"))
                .expect("malformed request"),
        )
        .await
        .expect("router response");
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(malformed).await["error"]["code"],
        "invalid_request",
    );

    let unsupported_content_type = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/pairing/requests")
                .body(Body::from("{}"))
                .expect("request without JSON content type"),
        )
        .await
        .expect("router response");
    assert_eq!(unsupported_content_type.status(), StatusCode::BAD_REQUEST);

    let unknown_field = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/pairing/requests")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "secret": qr["oneTimeSecret"],
                        "deviceName": "Phone",
                        "platform": "ios",
                        "unexpected": true,
                    })
                    .to_string(),
                ))
                .expect("request with unknown field"),
        )
        .await
        .expect("router response");
    assert_eq!(unknown_field.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(unknown_field).await["error"]["code"],
        "invalid_request",
    );

    let oversized = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/companion/v1/pairing/requests")
                .header("content-type", "application/json")
                .header("content-length", "5000")
                .body(Body::from("{}"))
                .expect("oversized request"),
        )
        .await
        .expect("router response");
    assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        response_json(oversized).await["error"]["code"],
        "invalid_request",
    );

    let mut limited = false;
    for _ in 0..20 {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/companion/v1/pairing/requests")
                    .header("content-type", "application/json")
                    .header("content-length", "5000")
                    .body(Body::from("{}"))
                    .expect("repeated oversized request"),
            )
            .await
            .expect("router response");
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            limited = true;
            break;
        }
    }
    assert!(
        limited,
        "oversized requests must consume the peer rate limit"
    );

    let _ = std::fs::remove_file(path);
}
