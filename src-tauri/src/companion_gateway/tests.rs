use super::{
    advertisement::{
        CompanionAdvertisement, CompanionAdvertisementHandle, CompanionAdvertiser,
        NoopCompanionAdvertiser,
    },
    contract::{
        create_router, AllowAllAuthorizer, CompanionErrorEnvelope, CompanionHostStatus,
        PairingUnavailableAuthorizer,
    },
    devices::{CompanionDeviceRecord, CompanionDeviceStore, InMemoryCompanionDeviceStore},
    identity::{CompanionIdentityStore, DelayedIdentityStore, InMemoryIdentityStore},
    lifecycle::{
        unique_offered_endpoints, CompanionGatewayEndpoint, CompanionGatewayManager, GatewayPhase,
    },
    network::{CompanionEndpointKind, FixedEndpointProvider},
    pairing::{CompanionStreamTermination, PairingCoordinator, PairingDecision},
    tailscale::FixedTailscaleHostnameProvider,
};
use axum::{body::Body, http::Request, response::Response};
use std::{
    net::IpAddr,
    sync::{mpsc, Arc, Mutex},
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

struct BlockingIdentityStore {
    inner: InMemoryIdentityStore,
    entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl CompanionIdentityStore for BlockingIdentityStore {
    fn load(&self) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        if let Some(entered) = self
            .entered
            .lock()
            .map_err(|_| "blocking identity entry lock was poisoned".to_string())?
            .take()
        {
            let _ = entered.send(());
        }
        self.release
            .lock()
            .map_err(|_| "blocking identity release lock was poisoned".to_string())?
            .recv()
            .map_err(|_| "blocking identity release signal was dropped".to_string())?;
        self.inner.load()
    }

    fn save(&self, identity: &super::identity::CompanionHostIdentity) -> Result<(), String> {
        self.inner.save(identity)
    }
}

struct RevocationObservingIdentityStore {
    inner: InMemoryIdentityStore,
    devices: Arc<InMemoryCompanionDeviceStore>,
    all_devices_revoked_at_save: Mutex<Vec<bool>>,
}

impl RevocationObservingIdentityStore {
    fn new(devices: Arc<InMemoryCompanionDeviceStore>) -> Self {
        Self {
            inner: InMemoryIdentityStore::default(),
            devices,
            all_devices_revoked_at_save: Mutex::new(Vec::new()),
        }
    }

    fn observations(&self) -> Vec<bool> {
        self.all_devices_revoked_at_save
            .lock()
            .expect("identity observation lock")
            .clone()
    }
}

impl CompanionIdentityStore for RevocationObservingIdentityStore {
    fn load(&self) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        self.inner.load()
    }

    fn save(&self, identity: &super::identity::CompanionHostIdentity) -> Result<(), String> {
        let devices = self.devices.list()?;
        self.all_devices_revoked_at_save
            .lock()
            .map_err(|_| "identity observation lock was poisoned".to_string())?
            .push(devices.iter().all(|device| device.revoked_at.is_some()));
        self.inner.save(identity)
    }
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
async fn restoring_an_enabled_gateway_waits_for_slow_platform_trust_initialization() {
    let manager = CompanionGatewayManager::new(
        Arc::new(DelayedIdentityStore::new(Duration::from_millis(2_100))),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );

    let status = manager.restore().await;

    assert!(status.enabled);
    assert_eq!(status.phase, GatewayPhase::Running);
    assert!(status.error.is_none());
    assert_eq!(status.endpoints.len(), 1);
    manager.shutdown().await;
}

#[tokio::test]
async fn gateway_status_stays_responsive_while_platform_trust_is_blocked() {
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let manager = CompanionGatewayManager::new(
        Arc::new(BlockingIdentityStore {
            inner: InMemoryIdentityStore::default(),
            entered: Mutex::new(Some(entered_tx)),
            release: Mutex::new(release_rx),
        }),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let enabling_manager = manager.clone();
    let enabling = tokio::spawn(async move { enabling_manager.enable().await });
    let entered = tokio::time::timeout(Duration::from_secs(1), entered_rx).await;
    if entered.is_err() {
        let _ = release_tx.send(());
    }
    entered
        .expect("platform trust initialization must begin")
        .expect("platform trust entry signal");

    let status = tokio::time::timeout(Duration::from_millis(50), manager.status()).await;
    release_tx
        .send(())
        .expect("release platform trust initialization");
    let status = status.expect("status must not wait for platform trust initialization");

    assert!(status.enabled);
    assert_eq!(status.phase, GatewayPhase::Starting);
    enabling
        .await
        .expect("enable task")
        .expect("gateway should eventually start");
    manager.shutdown().await;
}

#[test]
fn dual_stack_magicdns_listeners_offer_one_canonical_candidate() {
    let endpoints = vec![
        CompanionGatewayEndpoint {
            kind: CompanionEndpointKind::Lan,
            url: "https://192.168.1.20:17424".to_string(),
        },
        CompanionGatewayEndpoint {
            kind: CompanionEndpointKind::Tailscale,
            url: "https://forge-mac.example.ts.net:17424".to_string(),
        },
        CompanionGatewayEndpoint {
            kind: CompanionEndpointKind::Tailscale,
            url: "https://forge-mac.example.ts.net:17424".to_string(),
        },
    ];

    assert_eq!(
        unique_offered_endpoints(&endpoints),
        vec![endpoints[0].clone(), endpoints[1].clone()]
    );
}

#[tokio::test]
async fn unavailable_detection_is_single_flight_and_cached_across_status_calls() {
    let detector = Arc::new(FixedTailscaleHostnameProvider::unavailable());
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Tailscale,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        detector.clone(),
        None,
        0,
    );

    let (first, second) = tokio::join!(manager.status(), manager.status());
    let third = manager.status().await;

    assert_eq!(first.tailscale.detected_hostname, None);
    assert_eq!(second.tailscale.detected_hostname, None);
    assert_eq!(third.tailscale.detected_hostname, None);
    assert_eq!(detector.calls(), 1);
}

#[tokio::test]
async fn canceling_the_first_status_waiter_does_not_strand_detection() {
    let detector = Arc::new(FixedTailscaleHostnameProvider::delayed_unavailable(
        Duration::from_millis(100),
    ));
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Tailscale,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        detector.clone(),
        None,
        0,
    );
    let first_manager = manager.clone();
    let first_waiter = tokio::spawn(async move { first_manager.status().await });
    tokio::time::timeout(Duration::from_secs(1), async {
        while detector.calls() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("detection should start");

    first_waiter.abort();
    let _ = first_waiter.await;
    let recovered = tokio::time::timeout(Duration::from_secs(1), manager.status())
        .await
        .expect("later status should observe the independent detection result");

    assert_eq!(recovered.tailscale.detected_hostname, None);
    assert_eq!(detector.calls(), 1);
}

#[tokio::test]
async fn disabled_gateway_status_still_presents_a_reliable_magicdns_candidate() {
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Tailscale,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::detected(
            "forge-mac.example.ts.net",
            vec![IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)],
        )),
        None,
        0,
    );

    let status = manager.status().await;

    assert_eq!(status.phase, GatewayPhase::Disabled);
    assert_eq!(
        status.tailscale.detected_hostname.as_deref(),
        Some("forge-mac.example.ts.net")
    );
    assert_eq!(
        status.tailscale.effective_hostname.as_deref(),
        Some("forge-mac.example.ts.net")
    );
    assert!(status.endpoints.is_empty());
}

#[tokio::test]
async fn reliable_local_magicdns_hostname_is_offered_for_the_tailscale_listener() {
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![
            (
                CompanionEndpointKind::Lan,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
            (
                CompanionEndpointKind::Tailscale,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
        ])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::detected(
            "forge-mac.example.ts.net",
            vec![IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)],
        )),
        None,
        0,
    );

    let running = manager.enable().await.expect("gateway should start");

    assert_eq!(
        running.tailscale.detected_hostname.as_deref(),
        Some("forge-mac.example.ts.net")
    );
    assert_eq!(
        running.tailscale.effective_hostname.as_deref(),
        Some("forge-mac.example.ts.net")
    );
    assert_eq!(running.tailscale.configured_hostname, None);
    assert!(running.endpoints.iter().any(|endpoint| endpoint.kind
        == CompanionEndpointKind::Tailscale
        && endpoint
            .url
            .starts_with("https://forge-mac.example.ts.net:")));
    let pairing = manager.start_pairing().await.expect("pairing session");
    let qr: serde_json::Value = serde_json::from_str(&pairing.qr_payload).expect("pairing QR JSON");
    assert!(qr["endpointCandidates"]
        .as_array()
        .expect("endpoint candidates")
        .iter()
        .any(|endpoint| endpoint
            .as_str()
            .is_some_and(|url| url.starts_with("https://forge-mac.example.ts.net:"))));

    manager.disable().await;
}

#[tokio::test]
async fn manual_magicdns_hostname_is_used_when_local_detection_is_unavailable() {
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![
            (
                CompanionEndpointKind::Lan,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
            (
                CompanionEndpointKind::Tailscale,
                IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            ),
        ])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::unavailable()),
        None,
        0,
    );
    let running = manager.enable().await.expect("gateway should start");
    assert_eq!(running.tailscale.detected_hostname, None);

    let configured = manager
        .configure_tailscale_hostname("forge-mac.manual-tailnet.ts.net".to_string())
        .await;

    assert_eq!(
        configured.tailscale.configured_hostname.as_deref(),
        Some("forge-mac.manual-tailnet.ts.net")
    );
    assert!(configured.endpoints.iter().any(|endpoint| endpoint.kind
        == CompanionEndpointKind::Tailscale
        && endpoint
            .url
            .starts_with("https://forge-mac.manual-tailnet.ts.net:")));
    let pairing = manager.start_pairing().await.expect("pairing session");
    assert!(
        pairing
            .qr_payload
            .contains("https://forge-mac.manual-tailnet.ts.net:"),
        "manual MagicDNS endpoint should be carried in the pairing host record"
    );

    manager.disable().await;
}

#[tokio::test]
async fn manual_hostname_is_not_offered_without_a_tailscale_listener() {
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::unavailable()),
        None,
        0,
    );
    manager.enable().await.expect("gateway should start");

    let configured = manager
        .configure_tailscale_hostname("forge-mac.manual-tailnet.ts.net".to_string())
        .await;
    let pairing = manager.start_pairing().await.expect("pairing session");

    assert!(configured
        .endpoints
        .iter()
        .all(|endpoint| endpoint.kind != CompanionEndpointKind::Tailscale));
    assert!(!pairing
        .qr_payload
        .contains("forge-mac.manual-tailnet.ts.net"));

    manager.disable().await;
}

#[tokio::test]
async fn detected_magicdns_hostname_is_ignored_when_it_cannot_be_confirmed_locally() {
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Tailscale,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::detected(
            "other-mac.example.ts.net",
            vec![IpAddr::V4(std::net::Ipv4Addr::new(100, 64, 0, 99))],
        )),
        None,
        0,
    );

    let running = manager.enable().await.expect("gateway should start");

    assert_eq!(running.tailscale.detected_hostname, None);
    assert_eq!(running.tailscale.effective_hostname, None);
    assert!(running
        .endpoints
        .iter()
        .all(|endpoint| !endpoint.url.contains("other-mac.example.ts.net")));

    manager.disable().await;
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
async fn resetting_host_identity_replaces_certificate_and_revokes_every_device() {
    let identity_store = Arc::new(InMemoryIdentityStore::default());
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    for (device_id, verifier_byte) in [("device-1", 1_u8), ("device-2", 2_u8)] {
        device_store
            .save(&CompanionDeviceRecord {
                device_id: device_id.to_string(),
                device_name: format!("Phone {verifier_byte}"),
                platform: "ios".to_string(),
                credential_verifier: [verifier_byte; 32],
                paired_at: 1_722_340_800,
                last_seen_at: None,
                revoked_at: None,
            })
            .expect("seed paired device");
    }
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let mut terminations = manager.subscribe_stream_terminations();
    let first = manager.enable().await.expect("first identity");

    let reset = manager.reset_host_identity().await.expect("identity reset");

    assert!(reset.enabled);
    assert_eq!(reset.phase, GatewayPhase::Running);
    assert_ne!(reset.host_id, first.host_id);
    assert_ne!(reset.certificate_fingerprint, first.certificate_fingerprint);
    let devices = manager.devices().expect("paired devices");
    assert_eq!(devices.len(), 2);
    assert!(devices.iter().all(|device| device.revoked_at.is_some()));
    assert_eq!(
        terminations.recv().await.expect("revoke-all signal"),
        CompanionStreamTermination::AllDevicesRevoked
    );
    assert_eq!(
        terminations.recv().await.expect("gateway closing signal"),
        CompanionStreamTermination::GatewayClosing
    );
    manager.disable().await;
}

#[tokio::test]
async fn identity_reset_revokes_devices_before_persisting_replacement_identity() {
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    device_store
        .save(&CompanionDeviceRecord {
            device_id: "device-1".to_string(),
            device_name: "Phone".to_string(),
            platform: "ios".to_string(),
            credential_verifier: [1_u8; 32],
            paired_at: 1_722_340_800,
            last_seen_at: None,
            revoked_at: None,
        })
        .expect("seed paired device");
    let identity_store = Arc::new(RevocationObservingIdentityStore::new(device_store.clone()));
    let manager_identity_store: Arc<dyn CompanionIdentityStore> = identity_store.clone();
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store;
    let manager = CompanionGatewayManager::new(
        manager_identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );

    manager.enable().await.expect("gateway start");
    assert_eq!(identity_store.observations(), vec![false]);

    manager.reset_host_identity().await.expect("identity reset");
    assert_eq!(identity_store.observations(), vec![false, true]);
    manager.disable().await;
}

#[tokio::test]
async fn identity_persistence_failure_leaves_gateway_and_device_trust_unchanged() {
    let identity_store = Arc::new(InMemoryIdentityStore::default());
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    for (device_id, revoked_at) in [("device-1", None), ("device-2", Some(1_700_000_000))] {
        device_store
            .save(&CompanionDeviceRecord {
                device_id: device_id.to_string(),
                device_name: "Phone".to_string(),
                platform: "ios".to_string(),
                credential_verifier: if device_id == "device-1" {
                    [1_u8; 32]
                } else {
                    [2_u8; 32]
                },
                paired_at: 1_722_340_800,
                last_seen_at: None,
                revoked_at,
            })
            .expect("seed paired device");
    }
    let manager_identity_store: Arc<dyn CompanionIdentityStore> = identity_store.clone();
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        manager_identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let running = manager.enable().await.expect("gateway start");
    let mut terminations = manager.subscribe_stream_terminations();
    identity_store.fail_next_save();

    assert!(manager.reset_host_identity().await.is_err());

    let unchanged = manager.status().await;
    assert_eq!(unchanged.phase, GatewayPhase::Running);
    assert_eq!(unchanged.host_id, running.host_id);
    assert_eq!(
        unchanged.certificate_fingerprint,
        running.certificate_fingerprint
    );
    let devices = device_store.list().expect("paired devices");
    assert_eq!(
        devices
            .iter()
            .find(|device| device.device_id == "device-1")
            .expect("active device")
            .revoked_at,
        None
    );
    assert_eq!(
        devices
            .iter()
            .find(|device| device.device_id == "device-2")
            .expect("previously revoked device")
            .revoked_at,
        Some(1_700_000_000)
    );
    assert!(matches!(
        terminations.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
    manager.disable().await;
}

#[tokio::test]
async fn revocation_rollback_failure_disables_gateway_fail_closed() {
    let identity_store = Arc::new(InMemoryIdentityStore::default());
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    device_store
        .save(&CompanionDeviceRecord {
            device_id: "device-1".to_string(),
            device_name: "Phone".to_string(),
            platform: "ios".to_string(),
            credential_verifier: [1_u8; 32],
            paired_at: 1_722_340_800,
            last_seen_at: None,
            revoked_at: None,
        })
        .expect("seed paired device");
    let manager_identity_store: Arc<dyn CompanionIdentityStore> = identity_store.clone();
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        manager_identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let running = manager.enable().await.expect("gateway start");
    identity_store.fail_next_save();
    device_store.fail_next_rollback_revoke_all();

    let error = manager
        .reset_host_identity()
        .await
        .expect_err("reset must fail closed");

    assert!(error.contains("failed to restore paired-device trust"));
    let disabled = manager.status().await;
    assert!(!disabled.enabled);
    assert_eq!(disabled.phase, GatewayPhase::Disabled);
    assert_eq!(
        identity_store
            .load()
            .expect("identity read")
            .expect("identity")
            .host_id,
        running.host_id.expect("running host")
    );
    assert!(device_store
        .list()
        .expect("paired devices")
        .iter()
        .all(|device| device.revoked_at.is_some()));
}

#[tokio::test]
async fn revoke_all_failure_restores_previous_identity_without_stopping_gateway() {
    let identity_store = Arc::new(InMemoryIdentityStore::default());
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    device_store
        .save(&CompanionDeviceRecord {
            device_id: "device-1".to_string(),
            device_name: "Phone".to_string(),
            platform: "ios".to_string(),
            credential_verifier: [1_u8; 32],
            paired_at: 1_722_340_800,
            last_seen_at: None,
            revoked_at: None,
        })
        .expect("seed paired device");
    let manager_identity_store: Arc<dyn CompanionIdentityStore> = identity_store.clone();
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        manager_identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let running = manager.enable().await.expect("gateway start");
    device_store.fail_next_revoke_all();

    assert!(manager.reset_host_identity().await.is_err());

    let unchanged = manager.status().await;
    assert_eq!(unchanged.phase, GatewayPhase::Running);
    assert_eq!(unchanged.host_id, running.host_id);
    assert_eq!(
        identity_store
            .load()
            .expect("identity read")
            .expect("identity")
            .host_id,
        running.host_id.expect("running host")
    );
    assert!(device_store
        .list()
        .expect("paired devices")
        .iter()
        .all(|device| device.revoked_at.is_none()));
    manager.disable().await;
}

#[tokio::test]
async fn disable_waits_for_identity_reset_and_remains_the_final_lifecycle_state() {
    let identity_store: Arc<dyn CompanionIdentityStore> =
        Arc::new(DelayedIdentityStore::new(Duration::from_millis(40)));
    let manager = CompanionGatewayManager::new(
        identity_store,
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    manager.enable().await.expect("gateway start");
    let reset_manager = manager.clone();
    let reset = tokio::spawn(async move { reset_manager.reset_host_identity().await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    let disable_manager = manager.clone();
    let disable = tokio::spawn(async move { disable_manager.disable().await });

    let reset_status = reset.await.expect("reset task").expect("identity reset");
    let disabled_status = disable.await.expect("disable task");

    assert_eq!(reset_status.phase, GatewayPhase::Running);
    assert_eq!(disabled_status.phase, GatewayPhase::Disabled);
    assert_eq!(manager.status().await.phase, GatewayPhase::Disabled);
}

#[tokio::test]
async fn aborting_reset_caller_does_not_cancel_the_destructive_transition() {
    let identity_store: Arc<dyn CompanionIdentityStore> =
        Arc::new(DelayedIdentityStore::new(Duration::from_millis(40)));
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    device_store
        .save(&CompanionDeviceRecord {
            device_id: "device-1".to_string(),
            device_name: "Phone".to_string(),
            platform: "ios".to_string(),
            credential_verifier: [1_u8; 32],
            paired_at: 1_722_340_800,
            last_seen_at: None,
            revoked_at: None,
        })
        .expect("seed paired device");
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        identity_store,
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let first = manager.enable().await.expect("gateway start");
    let reset_manager = manager.clone();
    let reset = tokio::spawn(async move { reset_manager.reset_host_identity().await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    reset.abort();
    let _ = reset.await;

    tokio::time::sleep(Duration::from_millis(250)).await;
    let completed = manager.status().await;
    assert_eq!(completed.phase, GatewayPhase::Running);
    assert_ne!(completed.host_id, first.host_id);
    assert!(device_store
        .list()
        .expect("paired devices")
        .iter()
        .all(|device| device.revoked_at.is_some()));
    manager.disable().await;
}

#[tokio::test]
async fn revocation_signal_targets_only_the_selected_device() {
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    for (device_id, verifier_byte) in [("device-1", 1_u8), ("device-2", 2_u8)] {
        device_store
            .save(&CompanionDeviceRecord {
                device_id: device_id.to_string(),
                device_name: format!("Phone {verifier_byte}"),
                platform: "ios".to_string(),
                credential_verifier: [verifier_byte; 32],
                paired_at: 1_722_340_800,
                last_seen_at: None,
                revoked_at: None,
            })
            .expect("seed paired device");
    }
    let manager_device_store: Arc<dyn CompanionDeviceStore> = device_store.clone();
    let manager = CompanionGatewayManager::new(
        Arc::new(InMemoryIdentityStore::default()),
        manager_device_store,
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        0,
    );
    let mut terminations = manager.subscribe_stream_terminations();

    manager
        .revoke_device("device-1")
        .await
        .expect("revoke selected device");

    let signal = terminations.recv().await.expect("device revocation signal");
    assert_eq!(
        signal,
        CompanionStreamTermination::DeviceRevoked {
            device_id: "device-1".to_string(),
        }
    );
    assert!(signal.terminates("device-1"));
    assert!(!signal.terminates("device-2"));
    let devices = device_store.list().expect("paired devices");
    assert!(devices
        .iter()
        .find(|device| device.device_id == "device-1")
        .expect("device 1")
        .revoked_at
        .is_some());
    assert!(devices
        .iter()
        .find(|device| device.device_id == "device-2")
        .expect("device 2")
        .revoked_at
        .is_none());
}

#[tokio::test]
async fn incompatible_protocol_is_reported_only_after_device_authentication() {
    let incompatible = create_router(
        CompanionHostStatus::new("host-1".to_string()),
        Arc::new(AllowAllAuthorizer),
        test_pairing(),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/status")
            .header("openforge-companion-protocol-version", "2")
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");
    assert_eq!(incompatible.status(), axum::http::StatusCode::CONFLICT);
    let incompatible_error: CompanionErrorEnvelope =
        serde_json::from_value(response_json(incompatible).await).expect("error envelope");
    assert_eq!(
        incompatible_error.error.code,
        super::contract::CompanionErrorCode::IncompatibleVersion
    );

    let unauthenticated = create_router(
        CompanionHostStatus::new("host-1".to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        test_pairing(),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/status")
            .header("openforge-companion-protocol-version", "2")
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");
    assert_eq!(
        unauthenticated.status(),
        axum::http::StatusCode::UNAUTHORIZED
    );
    let unauthenticated_error: CompanionErrorEnvelope =
        serde_json::from_value(response_json(unauthenticated).await).expect("error envelope");
    assert_eq!(
        unauthenticated_error.error.code,
        super::contract::CompanionErrorCode::Unauthenticated
    );
}

#[tokio::test]
async fn authenticated_routes_apply_a_conservative_per_peer_rate_limit() {
    let router = create_router(
        CompanionHostStatus::new("host-1".to_string()),
        Arc::new(AllowAllAuthorizer),
        test_pairing(),
    );
    let peer = axum::extract::connect_info::ConnectInfo(std::net::SocketAddr::from((
        [192, 0, 2, 10],
        48_000,
    )));

    for _ in 0..120 {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/companion/v1/status")
                    .header("openforge-companion-protocol-version", "1")
                    .extension(peer)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("router response");
        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    let limited = router
        .oneshot(
            Request::builder()
                .uri("/companion/v1/status")
                .header("openforge-companion-protocol-version", "1")
                .extension(peer)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("router response");
    assert_eq!(limited.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
    let error: CompanionErrorEnvelope =
        serde_json::from_value(response_json(limited).await).expect("error envelope");
    assert_eq!(
        error.error.code,
        super::contract::CompanionErrorCode::RateLimited
    );
}

#[tokio::test]
async fn process_level_tls_gateway_accepts_only_pinned_authenticated_companions() {
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

    let pairing = manager
        .start_pairing()
        .await
        .expect("pairing session should start");
    let qr: serde_json::Value = serde_json::from_str(&pairing.qr_payload).expect("pairing QR JSON");
    let secret = qr["oneTimeSecret"].as_str().expect("pairing secret");
    let submission: serde_json::Value = client
        .post(format!("{base_url}/companion/v1/pairing/requests"))
        .json(&serde_json::json!({
            "secret": secret,
            "deviceName": "TLS smoke test phone",
            "platform": "ios"
        }))
        .send()
        .await
        .expect("pinned pairing request")
        .json()
        .await
        .expect("pairing response");
    let request_id = submission["requestId"]
        .as_str()
        .expect("pairing request id");
    manager
        .decide_pairing(request_id, PairingDecision::Approve)
        .await
        .expect("approve TLS smoke test device");
    let approval: serde_json::Value = client
        .get(format!(
            "{base_url}/companion/v1/pairing/requests/{request_id}"
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Pairing {secret}"))
        .send()
        .await
        .expect("pinned pairing poll")
        .json()
        .await
        .expect("pairing approval");
    let credential = approval["credential"].as_str().expect("device credential");

    let status_response = client
        .get(format!("{base_url}/companion/v1/status"))
        .header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        )
        .bearer_auth(credential)
        .send()
        .await
        .expect("pinned authenticated status request");
    assert_eq!(status_response.status(), reqwest::StatusCode::OK);
    let host_status: super::contract::CompanionHostStatusResponse =
        status_response.json().await.expect("host status response");
    assert_eq!(host_status.host_id, identity.host_id);

    let internal_token_response = client
        .get(format!("{base_url}/companion/v1/status"))
        .header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        )
        .bearer_auth("internal-sidecar-token")
        .send()
        .await
        .expect("TLS request should complete");
    assert_eq!(
        internal_token_response.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    let envelope: CompanionErrorEnvelope = internal_token_response
        .json()
        .await
        .expect("error envelope");
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
    assert_eq!(paths.len(), 6);
    let status_path = paths["/status"].as_object().expect("status path item");
    assert_eq!(
        status_path.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["get"],
        "authenticated v1 resources must remain read-only"
    );
    let attention_path = paths["/attention"]
        .as_object()
        .expect("attention path item");
    assert_eq!(
        attention_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
        "attention must expose no mutation or generic command capability"
    );
    let task_detail_path = paths["/tasks/{taskId}"]
        .as_object()
        .expect("Task detail path item");
    assert_eq!(
        task_detail_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
        "Task detail must expose no mutation or generic command capability"
    );
    let events_path = paths["/events"].as_object().expect("events path item");
    assert_eq!(
        events_path.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["get"],
        "live events must expose no mutation or generic command capability"
    );
    let public_events = events_path["get"]["x-sse-events"]
        .as_array()
        .expect("documented SSE vocabulary");
    assert_eq!(
        public_events
            .iter()
            .map(|event| event["event"].as_str().expect("SSE event name"))
            .collect::<Vec<_>>(),
        vec![
            "resources-invalidated",
            "stream-gap",
            "authorization-revoked",
            "gateway-closing",
        ]
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
    let protocol_parameter = &contract["components"]["parameters"]["CompanionProtocolVersion"];
    assert_eq!(
        protocol_parameter["name"],
        super::contract::PROTOCOL_VERSION_HEADER
    );
    assert_eq!(protocol_parameter["in"], "header");
    assert_eq!(protocol_parameter["required"], true);
    assert_eq!(
        protocol_parameter["schema"]["const"],
        super::contract::PROTOCOL_VERSION
    );
    for operation in [
        &status_path["get"],
        &attention_path["get"],
        &task_detail_path["get"],
        &events_path["get"],
    ] {
        assert!(
            operation["parameters"]
                .as_array()
                .expect("authenticated operation parameters")
                .iter()
                .any(|parameter| parameter["$ref"]
                    == "#/components/parameters/CompanionProtocolVersion"),
            "authenticated resources must negotiate the Companion protocol version"
        );
    }

    let documented_responses = status_path["get"]["responses"]
        .as_object()
        .expect("status responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(documented_responses.contains_key(status));
    }
    let attention_responses = attention_path["get"]["responses"]
        .as_object()
        .expect("attention responses");
    for status in ["200", "401", "409", "429", "503"] {
        assert!(attention_responses.contains_key(status));
    }
    let task_detail_responses = task_detail_path["get"]["responses"]
        .as_object()
        .expect("Task detail responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(task_detail_responses.contains_key(status));
    }
    let event_responses = events_path["get"]["responses"]
        .as_object()
        .expect("event responses");
    for status in ["200", "400", "401", "409", "429", "503"] {
        assert!(event_responses.contains_key(status));
    }

    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1-fixtures.json"
    ))
    .expect("Companion v1 fixtures");
    let mut attention_schema = contract["components"]["schemas"]["AttentionSnapshot"].clone();
    *attention_schema
        .pointer_mut("/properties/items/items")
        .expect("attention item schema") =
        contract["components"]["schemas"]["AttentionItem"].clone();
    assert_schema_accepts(&attention_schema, &fixtures["attentionSnapshot"]);
    let task_detail_schema = &contract["components"]["schemas"]["TaskDetail"];
    assert_schema_accepts(task_detail_schema, &fixtures["taskDetail"]);
    let task_detail_properties = task_detail_schema["properties"]
        .as_object()
        .expect("Task detail properties");
    for forbidden in [
        "prompt",
        "filesystemPath",
        "worktree",
        "diff",
        "terminalBuffer",
        "providerSessionId",
        "token",
    ] {
        assert!(!task_detail_properties.contains_key(forbidden));
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
            .header(
                super::contract::PROTOCOL_VERSION_HEADER,
                super::contract::PROTOCOL_VERSION.to_string(),
            )
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
async fn disable_wins_over_an_inflight_enable_after_detection_finishes() {
    let detector = Arc::new(FixedTailscaleHostnameProvider::delayed_unavailable(
        Duration::from_millis(100),
    ));
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        detector.clone(),
        None,
        0,
    );
    let enable_manager = manager.clone();
    let enable_task = tokio::spawn(async move { enable_manager.enable().await });
    tokio::time::timeout(Duration::from_secs(1), async {
        while detector.calls() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("enable detection should start");

    let disabled = manager.disable().await;
    enable_task
        .await
        .expect("enable task should complete")
        .expect("initial enable should complete before serialized disable");
    let final_status = manager.status().await;

    assert_eq!(disabled.phase, GatewayPhase::Disabled);
    assert!(!final_status.enabled);
    assert_eq!(final_status.phase, GatewayPhase::Disabled);
    assert!(final_status.endpoints.is_empty());
}

#[tokio::test]
async fn concurrent_enables_share_one_listener_startup() {
    let probe =
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).expect("reserve port");
    let port = probe.local_addr().expect("reserved address").port();
    drop(probe);
    let manager = CompanionGatewayManager::new_with_tailscale(
        Arc::new(InMemoryIdentityStore::default()),
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![(
            CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(NoopCompanionAdvertiser),
        Arc::new(FixedTailscaleHostnameProvider::delayed_unavailable(
            Duration::from_millis(50),
        )),
        None,
        port,
    );

    let (first, second) = tokio::join!(manager.enable(), manager.enable());
    let first = first.expect("first enable");
    let second = second.expect("second enable");

    assert_eq!(first.phase, GatewayPhase::Running);
    assert_eq!(second.phase, GatewayPhase::Running);
    assert_eq!(first.endpoints, second.endpoints);
    assert_eq!(manager.status().await.phase, GatewayPhase::Running);

    manager.disable().await;
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
