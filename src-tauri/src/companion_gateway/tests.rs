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
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        if let Some(entered) = self
            .entered
            .lock()
            .map_err(|_| "blocking identity entry lock was poisoned".to_string())?
            .take()
        {
            let _ = entered.send(());
        }
        let release = self
            .release
            .lock()
            .map_err(|_| "blocking identity release lock was poisoned".to_string())?;
        loop {
            if cancellation.is_cancelled() {
                return Err("Companion identity read was cancelled".to_string());
            }
            match release.recv_timeout(Duration::from_millis(10)) {
                Ok(()) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("blocking identity release signal was dropped".to_string());
                }
            }
        }
        self.inner.load(cancellation)
    }

    fn save(&self, identity: &super::identity::CompanionHostIdentity) -> Result<(), String> {
        self.inner.save(identity)
    }
}

struct BlockingReplacementIdentityStore {
    inner: InMemoryIdentityStore,
    entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl CompanionIdentityStore for BlockingReplacementIdentityStore {
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        self.inner.load(cancellation)
    }

    fn save(&self, identity: &super::identity::CompanionHostIdentity) -> Result<(), String> {
        if self.inner.save_count() > 0 {
            if let Some(entered) = self
                .entered
                .lock()
                .map_err(|_| "blocking replacement entry lock was poisoned".to_string())?
                .take()
            {
                let _ = entered.send(());
            }
            self.release
                .lock()
                .map_err(|_| "blocking replacement release lock was poisoned".to_string())?
                .recv()
                .map_err(|_| "blocking replacement release signal was dropped".to_string())?;
        }
        self.inner.save(identity)
    }
}

struct CommitThenBlockIdentityStore {
    inner: InMemoryIdentityStore,
    entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl CompanionIdentityStore for CommitThenBlockIdentityStore {
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        self.inner.load(cancellation)
    }

    fn save(&self, identity: &super::identity::CompanionHostIdentity) -> Result<(), String> {
        self.inner.save(identity)
    }

    fn save_with_cancellation(
        &self,
        identity: &super::identity::CompanionHostIdentity,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<(), crate::secure_store::SecretStoreWriteError> {
        self.inner
            .save(identity)
            .map_err(crate::secure_store::SecretStoreWriteError::NotCommitted)?;
        if let Some(entered) = self
            .entered
            .lock()
            .map_err(|error| {
                crate::secure_store::SecretStoreWriteError::NotCommitted(format!(
                    "blocking identity save lock was poisoned: {error}"
                ))
            })?
            .take()
        {
            let _ = entered.send(());
        }
        while !cancellation.is_cancelled() {
            std::thread::sleep(Duration::from_millis(10));
        }
        Err(crate::secure_store::SecretStoreWriteError::CommitUnknown(
            "Companion identity persistence may have committed".to_string(),
        ))
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
    fn load(
        &self,
        cancellation: &crate::secure_store::SecretStoreCancellation,
    ) -> Result<Option<super::identity::CompanionHostIdentity>, String> {
        self.inner.load(cancellation)
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
    let (database, _temp_dir) =
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

#[tokio::test]
async fn gateway_shutdown_cancels_blocked_platform_trust_initialization() {
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
    entered_rx
        .await
        .expect("platform trust initialization must begin");

    let shutdown_completed = tokio::time::timeout(Duration::from_millis(250), manager.shutdown())
        .await
        .is_ok();
    if !shutdown_completed {
        let _ = release_tx.send(());
        manager.shutdown().await;
    }

    assert!(
        shutdown_completed,
        "gateway shutdown must cancel blocked platform trust initialization"
    );
    assert_eq!(manager.status().await.phase, GatewayPhase::Stopped);
    assert!(
        enabling.await.expect("enable task").is_err(),
        "cancelled gateway startup must not finish successfully"
    );
}

#[tokio::test]
async fn gateway_shutdown_cancels_blocked_identity_persistence() {
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let manager = CompanionGatewayManager::new(
        Arc::new(CommitThenBlockIdentityStore {
            inner: InMemoryIdentityStore::default(),
            entered: Mutex::new(Some(entered_tx)),
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
    entered_rx.await.expect("identity persistence must begin");

    tokio::time::timeout(Duration::from_millis(250), manager.shutdown())
        .await
        .expect("gateway shutdown must cancel blocked identity persistence");

    assert_eq!(manager.status().await.phase, GatewayPhase::Stopped);
    assert!(
        enabling.await.expect("enable task").is_err(),
        "cancelled identity persistence must not start the gateway"
    );
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
        assert_eq!(
            state.announcements[0].protocol_version,
            super::contract::PROTOCOL_VERSION
        );
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
    let blocked_interface = IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
    let first_interface = IpAddr::V6(std::net::Ipv6Addr::LOCALHOST);
    let blocker = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .expect("occupy one test interface");
    let port = blocker.local_addr().expect("blocked test address").port();
    let store = Arc::new(InMemoryIdentityStore::default());
    let manager = CompanionGatewayManager::new(
        store,
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Arc::new(FixedEndpointProvider::new(vec![
            (CompanionEndpointKind::Lan, first_interface),
            (CompanionEndpointKind::Lan, blocked_interface),
        ])),
        Arc::new(NoopCompanionAdvertiser),
        port,
    );

    let error = manager
        .enable()
        .await
        .expect_err("occupied second interface must fail startup");
    let blocked_address = std::net::SocketAddr::new(blocked_interface, port);
    assert!(
        error.contains(&blocked_address.to_string()),
        "startup must fail on the test-owned listener: {error}"
    );
    let rebound = std::net::TcpListener::bind(std::net::SocketAddr::new(first_interface, port))
        .expect("failed startup must release every pre-bound socket");
    drop(rebound);
    drop(blocker);
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
async fn ambiguous_identity_commit_keeps_paired_devices_revoked() {
    let inner = InMemoryIdentityStore::default();
    let initial_identity = super::identity::generate_host_identity().expect("initial identity");
    inner
        .save(&initial_identity)
        .expect("seed initial identity");
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let identity_store = Arc::new(CommitThenBlockIdentityStore {
        inner,
        entered: Mutex::new(Some(entered_tx)),
    });
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
    manager.enable().await.expect("gateway start");
    let resetting_manager = manager.clone();
    let reset = tokio::spawn(async move { resetting_manager.reset_host_identity().await });
    entered_rx
        .await
        .expect("replacement identity must commit before cancellation");

    manager.shutdown().await;
    let error = reset
        .await
        .expect("identity reset task")
        .expect_err("ambiguous persistence must fail closed");

    assert!(error.contains("paired-device trust remains revoked"));
    assert!(device_store
        .list()
        .expect("paired devices")
        .iter()
        .all(|device| device.revoked_at.is_some()));
    let committed_identity = identity_store
        .inner
        .load(&crate::secure_store::SecretStoreCancellation::default())
        .expect("identity store read")
        .expect("committed replacement identity");
    assert_ne!(committed_identity.host_id, initial_identity.host_id);
    assert_eq!(manager.status().await.phase, GatewayPhase::Stopped);
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
            .load(&crate::secure_store::SecretStoreCancellation::default())
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
            .load(&crate::secure_store::SecretStoreCancellation::default())
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
    let (save_entered_tx, save_entered_rx) = tokio::sync::oneshot::channel();
    let (release_save_tx, release_save_rx) = mpsc::channel();
    let identity_store = Arc::new(BlockingReplacementIdentityStore {
        inner: InMemoryIdentityStore::default(),
        entered: Mutex::new(Some(save_entered_tx)),
        release: Mutex::new(release_save_rx),
    });
    let manager_identity_store: Arc<dyn CompanionIdentityStore> = identity_store.clone();
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
        manager_identity_store,
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
    tokio::time::timeout(Duration::from_secs(1), save_entered_rx)
        .await
        .expect("replacement identity save should start")
        .expect("replacement identity save signal should be delivered");
    reset.abort();
    let _ = reset.await;
    release_save_tx
        .send(())
        .expect("replacement identity save should be released");

    let completed = tokio::time::timeout(
        Duration::from_secs(5),
        manager.status_after_operations_settle(),
    )
    .await
    .expect("independent reset should finish after caller cancellation");
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
async fn only_revoked_devices_can_be_removed() {
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    for (device_id, revoked_at) in [
        ("active-device", None),
        ("revoked-device", Some(1_722_340_900)),
    ] {
        device_store
            .save(&CompanionDeviceRecord {
                device_id: device_id.to_string(),
                device_name: device_id.to_string(),
                platform: "android".to_string(),
                credential_verifier: [device_id.len() as u8; 32],
                paired_at: 1_722_340_800,
                last_seen_at: None,
                revoked_at,
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

    manager
        .remove_revoked_device("revoked-device")
        .await
        .expect("remove revoked device");

    assert_eq!(
        manager
            .remove_revoked_device("active-device")
            .await
            .expect_err("active device cannot be removed"),
        "Only revoked Companion devices can be removed"
    );
    assert_eq!(
        manager
            .remove_revoked_device("missing-device")
            .await
            .expect_err("missing device cannot be removed"),
        "Companion device was not found"
    );
    let devices = device_store.list().expect("paired devices");
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].device_id, "active-device");
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
            .header("openforge-companion-protocol-version", "1")
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
            .header("openforge-companion-protocol-version", "1")
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
                    .header(
                        super::contract::PROTOCOL_VERSION_HEADER,
                        super::contract::PROTOCOL_VERSION.to_string(),
                    )
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
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
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
        .load(&crate::secure_store::SecretStoreCancellation::default())
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
    let api_description = contract["info"]["description"]
        .as_str()
        .expect("Companion API description");
    for disclosed_authority in [
        "interactive Agent terminal",
        "Create",
        "Start",
        "Delete",
        "Complete",
        "Set Aside",
        "Return to Board",
        "Merge",
        "Enqueue",
        "Run app",
        "Refresh GitHub",
    ] {
        assert!(
            api_description.contains(disclosed_authority),
            "Companion API must disclose {disclosed_authority} authority",
        );
    }
    assert!(!api_description.to_ascii_lowercase().contains("read-only"));
    let paths = contract["paths"].as_object().expect("OpenAPI paths");
    assert_eq!(paths.len(), 21);
    let status_path = paths["/status"].as_object().expect("status path item");
    assert_eq!(
        status_path.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["get"],
        "host status must expose no mutation or generic command capability"
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
    let projects_path = paths["/projects"]
        .as_object()
        .expect("Project catalog path item");
    assert_eq!(
        projects_path.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["get"],
        "Project catalog must expose no mutation or generic command capability"
    );
    let project_board_path = paths["/projects/{projectId}/board"]
        .as_object()
        .expect("Project Board path item");
    assert_eq!(
        project_board_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
        "Project Board must expose no mutation or generic command capability"
    );
    let task_prompt_catalog_path = paths["/projects/{projectId}/task-prompt-catalog"]
        .as_object()
        .expect("Task prompt catalog path item");
    assert_eq!(
        task_prompt_catalog_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
        "Task prompt catalog must expose suggestions without generic command execution",
    );
    assert_eq!(
        task_prompt_catalog_path["get"]["operationId"],
        "getCompanionTaskPromptCatalog",
    );
    assert!(task_prompt_catalog_path["get"].get("requestBody").is_none());
    let task_create_path = paths["/projects/{projectId}/tasks"]
        .as_object()
        .expect("Task creation path item");
    assert_eq!(
        task_create_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["post"],
        "Create must be the only mutation on its explicit Project-scoped path",
    );
    assert_eq!(
        task_create_path["post"]["operationId"],
        "createCompanionTask",
    );
    assert!(task_create_path["post"].get("requestBody").is_some());
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
    let task_complete_path = paths["/tasks/{taskId}/complete"]
        .as_object()
        .expect("Task Complete path item");
    assert_eq!(
        task_complete_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["post"],
        "Complete must be the only Task mutation on its explicit path",
    );
    let task_delete_path = paths["/tasks/{taskId}/delete"]
        .as_object()
        .expect("Task Delete path item");
    assert_eq!(
        task_delete_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["post"],
        "Task Delete must be the only explicit mutation on its route",
    );
    assert_eq!(
        task_delete_path["post"]["operationId"],
        "deleteCompanionBacklogTask",
    );
    let task_start_path = paths["/tasks/{taskId}/start"]
        .as_object()
        .expect("Task Start path item");
    assert_eq!(
        task_start_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["post"],
        "Task Start must be one explicit Task-scoped mutation",
    );
    assert!(task_start_path["post"].get("requestBody").is_none());
    let task_actions_path = paths["/tasks/{taskId}/actions"]
        .as_object()
        .expect("Task actions path item");
    assert_eq!(
        task_actions_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
    );
    let project_actions_path = paths["/projects/{projectId}/actions"]
        .as_object()
        .expect("Project actions path item");
    assert_eq!(
        project_actions_path
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["get"],
    );
    let explicit_action_paths = [
        ("/tasks/{taskId}/set-aside", "setAsideCompanionTask"),
        (
            "/tasks/{taskId}/return-to-board",
            "returnCompanionTaskToBoard",
        ),
        ("/tasks/{taskId}/enqueue", "enqueueCompanionTaskPullRequest"),
        ("/tasks/{taskId}/run-app", "runCompanionTaskApp"),
        ("/refresh-github", "refreshCompanionGithub"),
    ];
    for (path, operation_id) in explicit_action_paths {
        let item = paths[path].as_object().expect("explicit action path item");
        assert_eq!(
            item.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["post"]
        );
        assert_eq!(item["post"]["operationId"], operation_id);
        assert!(item["post"].get("requestBody").is_none());
    }
    let merge_operation = &paths["/tasks/{taskId}/merge"]["post"];
    assert_eq!(
        merge_operation["operationId"],
        "mergeCompanionTaskPullRequest"
    );
    assert_eq!(
        merge_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CompanionMergeRequest"
    );
    assert_eq!(
        paths["/refresh-github"]["post"]["security"],
        serde_json::json!([{ "companionDeviceBearer": [] }]),
        "GitHub refresh must require paired-device authorization",
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
        &projects_path["get"],
        &project_board_path["get"],
        &task_detail_path["get"],
        &task_complete_path["post"],
        &task_delete_path["post"],
        &task_start_path["post"],
        &task_actions_path["get"],
        &project_actions_path["get"],
        &paths["/tasks/{taskId}/set-aside"]["post"],
        &paths["/tasks/{taskId}/return-to-board"]["post"],
        &paths["/tasks/{taskId}/merge"]["post"],
        &paths["/tasks/{taskId}/enqueue"]["post"],
        &paths["/tasks/{taskId}/run-app"]["post"],
        &paths["/refresh-github"]["post"],
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
    let task_prompt_catalog_responses = task_prompt_catalog_path["get"]["responses"]
        .as_object()
        .expect("Task prompt catalog responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(task_prompt_catalog_responses.contains_key(status));
    }
    let task_create_responses = task_create_path["post"]["responses"]
        .as_object()
        .expect("Task Create responses");
    for status in ["200", "400", "401", "404", "409", "429", "503"] {
        assert!(task_create_responses.contains_key(status));
    }
    let task_detail_responses = task_detail_path["get"]["responses"]
        .as_object()
        .expect("Task detail responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(task_detail_responses.contains_key(status));
    }
    let task_complete_responses = task_complete_path["post"]["responses"]
        .as_object()
        .expect("Task Complete responses");
    for status in ["200", "401", "404", "409", "429", "503"] {
        assert!(task_complete_responses.contains_key(status));
    }
    let task_delete_responses = task_delete_path["post"]["responses"]
        .as_object()
        .expect("Task Delete responses");
    for status in ["200", "400", "401", "404", "409", "429", "503"] {
        assert!(task_delete_responses.contains_key(status));
    }
    let task_start_responses = task_start_path["post"]["responses"]
        .as_object()
        .expect("Task Start responses");
    for status in ["200", "400", "401", "404", "409", "429", "503"] {
        assert!(task_start_responses.contains_key(status));
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
    let mut task_detail_schema = contract["components"]["schemas"]["TaskDetail"].clone();
    *task_detail_schema
        .pointer_mut("/properties/dependencies/items")
        .expect("Task dependency schema") =
        contract["components"]["schemas"]["TaskRelationship"].clone();
    *task_detail_schema
        .pointer_mut("/properties/dependentTasks/items")
        .expect("dependent Task schema") =
        contract["components"]["schemas"]["DependentTask"].clone();
    assert_schema_accepts(&task_detail_schema, &fixtures["taskDetail"]);
    let mut task_prompt_suggestion_schema =
        contract["components"]["schemas"]["TaskPromptSuggestion"].clone();
    *task_prompt_suggestion_schema
        .pointer_mut("/properties/kind")
        .expect("Task prompt suggestion kind schema") =
        contract["components"]["schemas"]["TaskPromptSuggestionKind"].clone();
    let mut task_prompt_catalog_schema =
        contract["components"]["schemas"]["TaskPromptCatalog"].clone();
    *task_prompt_catalog_schema
        .pointer_mut("/properties/suggestions/items")
        .expect("Task prompt suggestion schema") = task_prompt_suggestion_schema;
    assert_schema_accepts(&task_prompt_catalog_schema, &fixtures["taskPromptCatalog"]);
    assert_schema_accepts(
        &contract["components"]["schemas"]["TaskCreateResult"],
        &fixtures["taskCreate"],
    );
    assert_schema_accepts(
        &contract["components"]["schemas"]["TaskCompleteResult"],
        &fixtures["taskCompleteResult"],
    );
    assert_schema_accepts(
        &contract["components"]["schemas"]["TaskDeleteReceipt"],
        &fixtures["taskDeleteReceipt"],
    );
    assert_schema_accepts(
        &contract["components"]["schemas"]["TaskStartResult"],
        &fixtures["taskStart"],
    );
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
        "invalid_task_state",
        "operation_in_progress",
        "not_found",
        "invalid_state",
        "desktop_action_required",
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
