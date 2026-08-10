use super::{
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router_with_sources_and_event_access, create_router_with_sources_and_events,
        create_router_with_sources_event_access_and_pty, CompanionAuthorizer, CompanionErrorCode,
        CompanionHostStatus, CompanionRouterSources,
    },
    devices::{CompanionDeviceRecord, CompanionDeviceStore, InMemoryCompanionDeviceStore},
    live_events::{
        CompanionStreamAccess, CompanionStreamTermination, GatewayCompanionStreamAccess,
        PairingCompanionStreamAccess,
    },
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    project_board::DatabaseCompanionProjectBoardSource,
    task_detail::UnavailableCompanionTaskDetailSource,
};
use crate::app_events::{AppEvent, AppEventBus, AppEventCursor, DeliveryClass};
use axum::{
    body::Body,
    http::{HeaderMap, Request, StatusCode},
    response::Response,
};
use futures::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tower::ServiceExt;

#[derive(Default)]
struct MutableAuthorizer {
    authorized: AtomicBool,
}

impl MutableAuthorizer {
    fn authorized() -> Self {
        Self {
            authorized: AtomicBool::new(true),
        }
    }
}

impl CompanionAuthorizer for MutableAuthorizer {
    fn authorize(
        &self,
        _headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        if self.authorized.load(Ordering::SeqCst) {
            Ok(CompanionAuthenticatedDevice {
                device_id: "test-device".to_string(),
            })
        } else {
            Err(CompanionErrorCode::Revoked)
        }
    }
}

struct TestStreamAccess {
    streams: Mutex<Vec<tokio::sync::mpsc::UnboundedSender<CompanionStreamTermination>>>,
}

impl TestStreamAccess {
    fn new() -> Self {
        Self {
            streams: Mutex::new(Vec::new()),
        }
    }

    fn terminate(&self, termination: CompanionStreamTermination) {
        if let Ok(mut streams) = self.streams.lock() {
            streams.retain(|stream| stream.send(termination).is_ok());
        }
    }
}

impl CompanionStreamAccess for TestStreamAccess {
    fn open(
        &self,
        _headers: &HeaderMap,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode>
    {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        self.streams
            .lock()
            .map_err(|_| CompanionErrorCode::TemporarilyUnavailable)?
            .push(sender);
        Ok(receiver)
    }

    fn gateway_closing(&self) {
        self.terminate(CompanionStreamTermination::GatewayClosing);
    }
}

fn test_router(authorizer: Arc<dyn CompanionAuthorizer>, events: AppEventBus) -> axum::Router {
    create_router_with_sources_and_events(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        authorizer,
        Arc::new(PairingCoordinator::new(
            Arc::new(InMemoryCompanionDeviceStore::default()),
            Duration::from_secs(120),
        )),
        Arc::new(UnavailableCompanionAttentionSource),
        Arc::new(UnavailableCompanionTaskDetailSource),
        events,
    )
}

fn test_router_with_access(
    authorizer: Arc<dyn CompanionAuthorizer>,
    events: AppEventBus,
    access: Arc<dyn CompanionStreamAccess>,
) -> axum::Router {
    create_router_with_sources_and_event_access(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        authorizer,
        Arc::new(PairingCoordinator::new(
            Arc::new(InMemoryCompanionDeviceStore::default()),
            Duration::from_secs(120),
        )),
        Arc::new(UnavailableCompanionAttentionSource),
        Arc::new(UnavailableCompanionTaskDetailSource),
        events,
        access,
    )
}

async fn open_events(router: axum::Router, cursor: Option<String>) -> Response {
    open_events_with_credential(router, cursor, "test-device").await
}

async fn open_events_with_credential(
    router: axum::Router,
    cursor: Option<String>,
    credential: &str,
) -> Response {
    let mut request = Request::builder()
        .uri("/companion/v1/events")
        .header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        )
        .header("authorization", format!("Bearer {credential}"));
    if let Some(cursor) = cursor {
        request = request.header("last-event-id", cursor);
    }
    router
        .oneshot(request.body(Body::empty()).expect("build request"))
        .await
        .expect("request should succeed")
}

async fn next_sse_chunk(response: Response) -> String {
    let mut stream = response.into_body().into_data_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("SSE event should arrive")
        .expect("SSE stream should stay open")
        .expect("SSE chunk should be valid");
    String::from_utf8(chunk.to_vec()).expect("SSE should be UTF-8")
}

#[tokio::test]
async fn companion_events_require_device_authorization() {
    let events = AppEventBus::new(16, 8);
    let response = test_router(Arc::new(MutableAuthorizer::default()), events)
        .oneshot(
            Request::builder()
                .uri("/companion/v1/events")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header("last-event-id", "malformed")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn task_and_agent_events_expose_only_coarse_resource_invalidations() {
    let events = AppEventBus::new(16, 8);
    let response = open_events(
        test_router(Arc::new(MutableAuthorizer::authorized()), events.clone()),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    events
        .try_emit(AppEvent::new(
            "agent-status-changed",
            serde_json::json!({
                "task_id": "KVG-2947",
                "project_id": "P-4",
                "status": "blocked",
                "provider": "secret-provider",
                "pty_instance_id": 47
            }),
            DeliveryClass::StateInvalidation,
            Some("task:KVG-2947".to_string()),
        ))
        .expect("event should publish");

    let chunk = next_sse_chunk(response).await;
    assert!(chunk.contains("event: resources-invalidated"));
    assert!(chunk.contains("\"kind\":\"attention\""));
    assert!(chunk.contains("\"kind\":\"project_board\",\"id\":\"P-4\""));
    assert!(chunk.contains("\"kind\":\"task\",\"id\":\"KVG-2947\""));
    assert!(!chunk.contains("secret-provider"));
    assert!(!chunk.contains("pty_instance_id"));
    assert!(!chunk.contains("blocked"));
}

#[tokio::test]
async fn hidden_project_task_events_do_not_expose_resource_identifiers() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_hidden_live_events");
    let visible = database
        .create_project("Visible", "/secret/visible")
        .expect("visible project");
    let hidden = database
        .create_project("Hidden", "/secret/hidden")
        .expect("hidden project");
    database
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![&hidden.id]).expect("hidden Project configuration"),
        )
        .expect("hide Project");
    let project_board = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::new(
        Mutex::new(database),
    )));
    let events = AppEventBus::new(16, 8);
    let authorizer: Arc<dyn CompanionAuthorizer> = Arc::new(MutableAuthorizer::authorized());
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        authorizer,
        Arc::new(PairingCoordinator::new(
            Arc::new(InMemoryCompanionDeviceStore::default()),
            Duration::from_secs(120),
        )),
        CompanionRouterSources {
            attention: Arc::new(UnavailableCompanionAttentionSource),
            project_board,
            task_detail: Arc::new(UnavailableCompanionTaskDetailSource),
            task_actions: Arc::new(super::task_actions::UnavailableCompanionTaskActionService),
            task_creator: Arc::new(super::task_creation::UnavailableCompanionTaskCreator),
            task_start: Arc::new(super::task_start::UnavailableCompanionTaskStarter),
            events: events.clone(),
            stream_access,
            pty_manager: crate::pty_manager::PtyManager::new(),
        },
    );
    let response = open_events(router, None).await;

    events
        .tasks()
        .updated("T-hidden", Some(&hidden.id))
        .expect("hidden event should publish internally");
    events
        .tasks()
        .updated("T-visible", Some(&visible.id))
        .expect("visible event should publish internally");

    let chunk = next_sse_chunk(response).await;
    assert!(chunk.contains("T-visible"));
    assert!(chunk.contains(&visible.id));
    assert!(!chunk.contains("T-hidden"));
    assert!(!chunk.contains(&hidden.id));

    drop(path);
}
#[tokio::test]
async fn project_events_expose_only_catalog_and_board_resource_identifiers() {
    let events = AppEventBus::new(16, 8);
    let catalog_response = open_events(
        test_router(Arc::new(MutableAuthorizer::authorized()), events.clone()),
        None,
    )
    .await;
    events
        .try_emit(AppEvent::new(
            "project-catalog-changed",
            serde_json::json!({ "reason": "sidebar reordered", "path": "/secret/repo" }),
            DeliveryClass::StateInvalidation,
            Some("projects".to_string()),
        ))
        .expect("catalog event should publish");
    let catalog_chunk = next_sse_chunk(catalog_response).await;
    assert!(catalog_chunk.contains("\"kind\":\"project_catalog\""));
    assert!(!catalog_chunk.contains("sidebar reordered"));
    assert!(!catalog_chunk.contains("/secret/repo"));

    let board_response = open_events(
        test_router(Arc::new(MutableAuthorizer::authorized()), events.clone()),
        None,
    )
    .await;
    events
        .try_emit(AppEvent::new(
            "project-board-changed",
            serde_json::json!({ "project_id": "P-4", "task_ids": ["secret-task"] }),
            DeliveryClass::StateInvalidation,
            Some("project:P-4".to_string()),
        ))
        .expect("board event should publish");
    let board_chunk = next_sse_chunk(board_response).await;
    assert!(board_chunk.contains("\"kind\":\"project_board\",\"id\":\"P-4\""));
    assert!(!board_chunk.contains("secret-task"));
}
#[tokio::test]
async fn companion_events_resume_from_last_event_id_when_replay_is_available() {
    let events = AppEventBus::new(16, 8);
    let first = events
        .tasks()
        .updated("T-1", Some("P-4"))
        .expect("first event should publish");
    events
        .tasks()
        .updated("T-2", Some("P-4"))
        .expect("second event should publish");

    let response = open_events(
        test_router(Arc::new(MutableAuthorizer::authorized()), events),
        Some(AppEventCursor::after(first.id).as_sse_id()),
    )
    .await;
    let chunk = next_sse_chunk(response).await;

    assert!(chunk.contains("T-2"));
    assert!(!chunk.contains("T-1"));
}

#[tokio::test]
async fn expired_cursor_reports_a_public_gap_without_internal_event_payloads() {
    let events = AppEventBus::new(16, 1);
    let first = events
        .tasks()
        .updated("T-1", Some("P-4"))
        .expect("first event should publish");
    events
        .tasks()
        .updated("T-2", Some("P-4"))
        .expect("second event should publish");
    events
        .tasks()
        .updated("T-3", Some("P-4"))
        .expect("third event should publish");

    let response = open_events(
        test_router(Arc::new(MutableAuthorizer::authorized()), events),
        Some(AppEventCursor::after(first.id).as_sse_id()),
    )
    .await;
    let chunk = next_sse_chunk(response).await;

    assert!(chunk.contains("event: stream-gap"));
    assert!(chunk.contains("\"refreshRequired\":true"));
    assert!(!chunk.contains("T-2"));
    assert!(!chunk.contains("T-3"));
}

#[tokio::test]
async fn revoked_streams_emit_typed_terminal_state_and_close() {
    let events = AppEventBus::new(16, 8);
    let access = Arc::new(TestStreamAccess::new());
    let response = open_events(
        test_router_with_access(
            Arc::new(MutableAuthorizer::authorized()),
            events.clone(),
            access.clone(),
        ),
        None,
    )
    .await;
    events
        .tasks()
        .updated("T-must-not-leak-after-revocation", Some("P-4"))
        .expect("queued invalidation should publish");
    access.terminate(CompanionStreamTermination::AuthorizationRevoked);

    let chunk = next_sse_chunk(response).await;
    assert!(chunk.contains("event: authorization-revoked"));
    assert!(chunk.contains("\"reason\":\"revoked\""));
    assert!(!chunk.contains("T-must-not-leak-after-revocation"));
}

#[tokio::test]
async fn revoking_one_device_closes_only_that_devices_canonical_sse_stream() {
    let device_store = Arc::new(InMemoryCompanionDeviceStore::default());
    for (device_id, credential) in [
        ("device-1", "credential-one"),
        ("device-2", "credential-two"),
    ] {
        device_store
            .save(&CompanionDeviceRecord {
                device_id: device_id.to_string(),
                device_name: device_id.to_string(),
                platform: "ios".to_string(),
                credential_verifier: Sha256::digest(credential.as_bytes()).into(),
                paired_at: 1_722_340_800,
                last_seen_at: None,
                revoked_at: None,
            })
            .expect("seed paired device");
    }
    let pairing = Arc::new(PairingCoordinator::new(
        device_store,
        Duration::from_secs(120),
    ));
    pairing.notify_gateway_running();
    let events = AppEventBus::new(16, 8);
    let stream_access = Arc::new(PairingCompanionStreamAccess::new(pairing.clone()));
    let router = create_router_with_sources_and_event_access(
        CompanionHostStatus::new("65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string()),
        pairing.clone(),
        pairing.clone(),
        Arc::new(UnavailableCompanionAttentionSource),
        Arc::new(UnavailableCompanionTaskDetailSource),
        events.clone(),
        stream_access,
    );
    let revoked_response =
        open_events_with_credential(router.clone(), None, "credential-one").await;
    let active_response = open_events_with_credential(router, None, "credential-two").await;

    pairing.revoke("device-1").expect("revoke first device");

    let revoked_chunk = next_sse_chunk(revoked_response).await;
    assert!(revoked_chunk.contains("event: authorization-revoked"));
    events
        .tasks()
        .updated("T-visible-to-active-device", Some("P-4"))
        .expect("publish invalidation");
    let active_chunk = next_sse_chunk(active_response).await;
    assert!(active_chunk.contains("event: resources-invalidated"));
    assert!(active_chunk.contains("T-visible-to-active-device"));
    assert!(!active_chunk.contains("authorization-revoked"));
}

#[tokio::test]
async fn gateway_shutdown_is_a_public_terminal_event() {
    let events = AppEventBus::new(16, 8);
    let access = Arc::new(TestStreamAccess::new());
    let response = open_events(
        test_router_with_access(
            Arc::new(MutableAuthorizer::authorized()),
            events.clone(),
            access.clone(),
        ),
        None,
    )
    .await;

    access.gateway_closing();

    let chunk = next_sse_chunk(response).await;
    assert!(chunk.contains("event: gateway-closing"));
    assert!(!chunk.contains("companion-gateway-closing"));

    let resumed_access = Arc::new(TestStreamAccess::new());
    let resumed = open_events(
        test_router_with_access(
            Arc::new(MutableAuthorizer::authorized()),
            events.clone(),
            resumed_access.clone(),
        ),
        None,
    )
    .await;
    events
        .tasks()
        .updated("T-after-reenable", Some("P-4"))
        .expect("post-reenable event should publish");
    let resumed_chunk = next_sse_chunk(resumed).await;
    assert!(resumed_chunk.contains("event: resources-invalidated"));
    assert!(resumed_chunk.contains("T-after-reenable"));
}
