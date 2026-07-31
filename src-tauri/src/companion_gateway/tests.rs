use super::{
    advertisement::{
        CompanionAdvertisement, CompanionAdvertisementHandle, CompanionAdvertiser,
        NoopCompanionAdvertiser,
    },
    contract::{
        create_router, AllowAllAuthorizer, CompanionErrorEnvelope, CompanionHostStatus,
        PairingUnavailableAuthorizer,
    },
    devices::InMemoryCompanionDeviceStore,
    identity::{CompanionIdentityStore, InMemoryIdentityStore},
    lifecycle::{CompanionGatewayManager, GatewayPhase},
    network::{CompanionEndpointKind, FixedEndpointProvider},
    pairing::PairingCoordinator,
};
use axum::{body::Body, http::Request, response::Response};
use std::{
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;

#[derive(Clone, Default)]
struct RecordingAdvertiser {
    state: Arc<Mutex<AdvertisementState>>,
}

#[derive(Default)]
struct AdvertisementState {
    announcements: Vec<CompanionAdvertisement>,
    active: usize,
    stops: usize,
}

struct RecordingAdvertisementHandle {
    state: Arc<Mutex<AdvertisementState>>,
}

impl Drop for RecordingAdvertisementHandle {
    fn drop(&mut self) {
        let mut state = self.state.lock().expect("advertisement state");
        state.active -= 1;
        state.stops += 1;
    }
}

impl CompanionAdvertisementHandle for RecordingAdvertisementHandle {}

impl CompanionAdvertiser for RecordingAdvertiser {
    fn advertise(
        &self,
        advertisement: CompanionAdvertisement,
    ) -> Result<Box<dyn CompanionAdvertisementHandle>, String> {
        let mut state = self.state.lock().expect("advertisement state");
        state.announcements.push(advertisement);
        state.active += 1;
        Ok(Box::new(RecordingAdvertisementHandle {
            state: Arc::clone(&self.state),
        }))
    }
}

fn test_manager(store: Arc<InMemoryIdentityStore>) -> CompanionGatewayManager {
    CompanionGatewayManager::new(
        store,
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    )
}

fn test_pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

fn assert_schema_accepts(schema: &serde_json::Value, instance: &serde_json::Value) {
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

#[tokio::test]
async fn companion_gateway_is_disabled_by_default_without_creating_identity() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = test_manager(Arc::clone(&store));

    let status = manager.status().await;

    assert!(!status.enabled);
    assert_eq!(status.phase, GatewayPhase::Disabled);
    assert!(status.host_id.is_none());
    assert_eq!(store.save_count(), 0);
}

#[test]
fn persisted_gateway_preference_defaults_off_and_restores_explicit_opt_in() {
    let (database, _path) =
        crate::db::test_helpers::make_test_db("companion_gateway_preference_defaults_off");
    assert!(!super::enabled_preference(&database).expect("default preference"));
    database
        .set_config(super::COMPANION_GATEWAY_ENABLED_CONFIG, "true")
        .expect("persist opt-in");
    assert!(super::enabled_preference(&database).expect("restored preference"));
    assert!(!crate::secure_store::is_secret("companion_host_identity"));
}

#[tokio::test]
async fn enabling_and_disabling_controls_a_separate_tls_listener() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = test_manager(store);

    let running = manager.enable().await.expect("gateway should start");
    assert!(running.enabled);
    assert_eq!(running.phase, GatewayPhase::Running);
    assert_eq!(running.endpoints.len(), 1);
    assert!(running.endpoints[0].url.starts_with("https://127.0.0.1:"));

    let disabled = manager.disable().await;
    assert!(!disabled.enabled);
    assert_eq!(disabled.phase, GatewayPhase::Disabled);
    assert!(disabled.endpoints.is_empty());
}

#[tokio::test]
async fn advertisement_follows_gateway_enable_disable_and_shutdown_lifecycle() {
    let advertiser = RecordingAdvertiser::default();
    let manager = CompanionGatewayManager::new(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(advertiser.clone()),
        0,
    );

    let first = manager.enable().await.expect("gateway should advertise");
    {
        let state = advertiser.state.lock().expect("advertisement state");
        assert_eq!(state.active, 1);
        assert_eq!(state.announcements.len(), 1);
        assert_eq!(
            state.announcements[0].host_id,
            first.host_id.clone().unwrap()
        );
        assert_eq!(state.announcements[0].protocol_version, 1);
        assert_eq!(
            state.announcements[0].addresses.as_slice(),
            &[IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)]
        );
        assert_eq!(
            state.announcements[0].port,
            first.endpoints[0]
                .url
                .rsplit(':')
                .next()
                .unwrap()
                .parse::<u16>()
                .unwrap()
        );
    }

    manager.disable().await;
    {
        let state = advertiser.state.lock().expect("advertisement state");
        assert_eq!(state.active, 0);
        assert_eq!(state.stops, 1);
    }

    manager.enable().await.expect("gateway should re-advertise");
    manager.shutdown().await;
    let state = advertiser.state.lock().expect("advertisement state");
    assert_eq!(state.active, 0);
    assert_eq!(state.stops, 2);
}

#[tokio::test]
async fn partial_multi_interface_startup_cannot_leave_an_untracked_listener() {
    let probe =
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).expect("reserve test port");
    let port = probe.local_addr().expect("test address").port();
    drop(probe);
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = CompanionGatewayManager::new(
        store,
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![
            (
                CompanionEndpointKind::Lan,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
            (
                CompanionEndpointKind::Lan,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
        ])),
        Arc::new(NoopCompanionAdvertiser),
        port,
    );

    assert!(manager.enable().await.is_err());
    let rebound = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .expect("failed startup must release every pre-bound socket");
    drop(rebound);
    let status = manager.disable().await;
    assert_eq!(status.phase, GatewayPhase::Disabled);
}

#[tokio::test]
async fn canceling_disable_still_drops_and_aborts_owned_listener_tasks() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = test_manager(store);
    let running = manager.enable().await.expect("gateway should start");
    let address = running.endpoints[0]
        .url
        .strip_prefix("https://")
        .expect("HTTPS endpoint")
        .parse::<std::net::SocketAddr>()
        .expect("socket address");
    let slow_connection = tokio::net::TcpStream::connect(address)
        .await
        .expect("slow connection");
    let disable_manager = manager.clone();
    let disable_task = tokio::spawn(async move { disable_manager.disable().await });

    tokio::time::sleep(Duration::from_millis(20)).await;
    disable_task.abort();
    let _ = disable_task.await;
    drop(slow_connection);

    let status = manager.status().await;
    assert_eq!(status.phase, GatewayPhase::Disabled);
    assert!(
        tokio::net::TcpStream::connect(address).await.is_err(),
        "canceling disable must not detach the TLS listener task"
    );
}

#[tokio::test]
async fn host_identity_and_certificate_are_reused_after_reenable() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let first_manager = test_manager(Arc::clone(&store));
    let first = first_manager.enable().await.expect("first start");
    first_manager.disable().await;

    let second_manager = test_manager(Arc::clone(&store));
    let second = second_manager.enable().await.expect("second start");

    assert_eq!(first.host_id, second.host_id);
    assert_eq!(
        first.certificate_fingerprint,
        second.certificate_fingerprint
    );
    assert_eq!(store.save_count(), 1);
    second_manager.disable().await;
}

#[tokio::test]
async fn tls_gateway_rejects_internal_bridge_credentials_and_has_no_invoke_route() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = test_manager(Arc::clone(&store));
    let status = manager.enable().await.expect("gateway should start");
    let identity = store
        .load()
        .expect("identity store read")
        .expect("identity should exist");
    let certificate = reqwest::Certificate::from_pem(identity.certificate_pem.as_bytes())
        .expect("certificate PEM");
    let client = reqwest::Client::builder()
        .add_root_certificate(certificate)
        .build()
        .expect("TLS client");
    let base_url = &status.endpoints[0].url;
    let unpinned_result = reqwest::Client::new()
        .get(format!("{base_url}/companion/v1/status"))
        .send()
        .await;
    assert!(
        unpinned_result.is_err(),
        "an unpinned client must reject the self-signed host certificate"
    );

    let status_response = client
        .get(format!("{base_url}/companion/v1/status"))
        .bearer_auth("internal-sidecar-token")
        .send()
        .await
        .expect("TLS request should complete");
    assert_eq!(status_response.status(), reqwest::StatusCode::UNAUTHORIZED);
    let envelope: CompanionErrorEnvelope = status_response.json().await.expect("error envelope");
    assert_eq!(envelope.error.code.as_str(), "unauthenticated");

    let invoke_response = client
        .post(format!("{base_url}/app/invoke"))
        .bearer_auth("internal-sidecar-token")
        .json(&serde_json::json!({"command": "get_tasks", "payload": null}))
        .send()
        .await
        .expect("TLS request should complete");
    assert_eq!(invoke_response.status(), reqwest::StatusCode::NOT_FOUND);

    manager.disable().await;
}

#[tokio::test]
async fn status_and_error_responses_conform_to_the_v1_openapi_schemas() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1.openapi.json"
    ))
    .expect("OpenAPI JSON");
    assert_eq!(contract["info"]["version"], "1.0.0");
    assert_eq!(contract["servers"][0]["url"], "/companion/v1");
    let paths = contract["paths"].as_object().expect("OpenAPI paths");
    assert_eq!(paths.len(), 3);
    let status_path = paths["/status"].as_object().expect("status path item");
    assert_eq!(
        status_path.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["get"],
        "authenticated v1 resources must remain read-only"
    );
    assert_eq!(
        paths["/pairing/requests"]
            .as_object()
            .expect("pairing submission path")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["post"],
    );
    assert_eq!(
        paths["/pairing/requests/{requestId}"]
            .as_object()
            .expect("pairing poll path")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
    );
    let documented_responses = status_path["get"]["responses"]
        .as_object()
        .expect("status responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(documented_responses.contains_key(status));
    }

    let host_id = "65d91f21-6732-45a6-9418-3dfaf4c93f52";
    let success_response = create_router(
        CompanionHostStatus::new(host_id.to_string()),
        Arc::new(AllowAllAuthorizer),
        test_pairing(),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/status")
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");
    assert_eq!(success_response.status(), axum::http::StatusCode::OK);
    let status_json = response_json(success_response).await;
    assert_schema_accepts(
        &contract["components"]["schemas"]["HostStatus"],
        &status_json,
    );
    assert_eq!(status_json["hostId"], host_id);

    let unauthorized_response = create_router(
        CompanionHostStatus::new(host_id.to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        test_pairing(),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/status")
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");
    assert_eq!(
        unauthorized_response.status(),
        axum::http::StatusCode::UNAUTHORIZED
    );
    let not_found_response = create_router(
        CompanionHostStatus::new(host_id.to_string()),
        Arc::new(AllowAllAuthorizer),
        test_pairing(),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/not-a-resource")
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");
    assert_eq!(
        not_found_response.status(),
        axum::http::StatusCode::NOT_FOUND
    );

    let mut error_schema = contract["components"]["schemas"]["ErrorEnvelope"].clone();
    *error_schema
        .pointer_mut("/properties/error/properties/code")
        .expect("error code schema") = contract["components"]["schemas"]["ErrorCode"].clone();
    for error_json in [
        response_json(unauthorized_response).await,
        response_json(not_found_response).await,
    ] {
        assert_schema_accepts(&error_schema, &error_json);
    }

    let error_codes = contract["components"]["schemas"]["ErrorCode"]["enum"]
        .as_array()
        .expect("error code enum");
    for code in [
        "unauthenticated",
        "revoked",
        "incompatible_version",
        "invalid_request",
        "not_found",
        "rate_limited",
        "temporarily_unavailable",
    ] {
        assert!(error_codes.iter().any(|entry| entry == code));
    }
}

#[tokio::test]
async fn coordinated_shutdown_closes_the_gateway_without_changing_the_opt_in_preference() {
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = test_manager(store);
    let running = manager.enable().await.expect("gateway should start");
    let endpoint = running.endpoints[0].url.clone();

    tokio::time::timeout(Duration::from_secs(1), manager.shutdown())
        .await
        .expect("gateway shutdown should stay inside the sidecar budget");
    let stopped = manager.status().await;
    assert!(stopped.enabled);
    assert_eq!(stopped.phase, GatewayPhase::Stopped);

    let connection = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("client")
        .get(format!("{endpoint}/companion/v1/status"))
        .send()
        .await;
    assert!(connection.is_err());
}
