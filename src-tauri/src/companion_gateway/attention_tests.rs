use super::{
    attention::{CompanionAttentionSource, DatabaseCompanionAttentionSource},
    contract::{
        create_router_with_attention, AllowAllAuthorizer, CompanionAuthorizer, CompanionErrorCode,
        CompanionHostStatus, PairingUnavailableAuthorizer,
    },
    devices::{DatabaseCompanionDeviceStore, InMemoryCompanionDeviceStore},
    pairing::{
        CompanionAuthenticatedDevice, PairingBootstrap, PairingCoordinator, PairingDecision,
        PairingSubmission,
    },
};
use crate::task_attention::TaskAttentionRow;
use axum::{body::Body, http::Request, response::Response};
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

#[derive(Debug)]
struct FixedAttentionSource {
    rows: Result<Vec<TaskAttentionRow>, String>,
}

impl FixedAttentionSource {
    fn available(rows: Vec<TaskAttentionRow>) -> Self {
        Self { rows: Ok(rows) }
    }

    fn unavailable() -> Self {
        Self {
            rows: Err("database unavailable".to_string()),
        }
    }
}

impl CompanionAttentionSource for FixedAttentionSource {
    fn snapshot(&self) -> Result<Vec<TaskAttentionRow>, String> {
        self.rows.clone()
    }
}

#[derive(Debug)]
struct RejectAuthorizer(CompanionErrorCode);

impl CompanionAuthorizer for RejectAuthorizer {
    fn authorize(
        &self,
        _headers: &axum::http::HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        Err(self.0)
    }
}

fn test_pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
}

fn router(
    authorizer: Arc<dyn CompanionAuthorizer>,
    source: Arc<dyn CompanionAttentionSource>,
) -> axum::Router {
    create_router_with_attention(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        test_pairing(),
        source,
    )
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

fn attention_row(task_id: &str, project_id: &str, activity_at: i64) -> TaskAttentionRow {
    TaskAttentionRow {
        task_id: task_id.to_string(),
        project_id: project_id.to_string(),
        project_name: format!("Project {project_id}"),
        title: format!("Task {task_id}"),
        state: "needs-input".to_string(),
        reason: "Agent needs your input to continue.".to_string(),
        activity_at,
        has_unread_agent_output: false,
    }
}

#[tokio::test]
async fn authenticated_attention_returns_only_normalized_task_rows_in_projection_order() {
    let response = router(
        Arc::new(AllowAllAuthorizer),
        Arc::new(FixedAttentionSource::available(vec![
            attention_row("T-2", "P-1", 1_754_000_200),
            attention_row("T-1", "P-1", 1_754_000_100),
            attention_row("T-3", "P-2", 1_754_000_000),
        ])),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/attention")
            .header(
                super::contract::PROTOCOL_VERSION_HEADER,
                super::contract::PROTOCOL_VERSION.to_string(),
            )
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let json = response_json(response).await;
    let items = json["items"].as_array().expect("attention items");
    assert_eq!(
        items
            .iter()
            .map(|item| item["taskId"].as_str().expect("task id"))
            .collect::<Vec<_>>(),
        vec!["T-2", "T-1", "T-3"]
    );
    assert_eq!(
        items[0]
            .as_object()
            .expect("attention item")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec![
            "activityAt",
            "projectId",
            "projectName",
            "reason",
            "state",
            "taskId",
            "title",
        ],
        "the public row must not expose pull requests, repositories, diffs, terminals, or commands"
    );
}

#[tokio::test]
async fn attention_maps_authentication_and_authorization_store_failures() {
    for (authorizer, expected_status, expected_code) in [
        (
            Arc::new(PairingUnavailableAuthorizer) as Arc<dyn CompanionAuthorizer>,
            axum::http::StatusCode::UNAUTHORIZED,
            "unauthenticated",
        ),
        (
            Arc::new(RejectAuthorizer(CompanionErrorCode::Unauthenticated))
                as Arc<dyn CompanionAuthorizer>,
            axum::http::StatusCode::UNAUTHORIZED,
            "unauthenticated",
        ),
        (
            Arc::new(RejectAuthorizer(CompanionErrorCode::Revoked)) as Arc<dyn CompanionAuthorizer>,
            axum::http::StatusCode::UNAUTHORIZED,
            "revoked",
        ),
        (
            Arc::new(RejectAuthorizer(CompanionErrorCode::TemporarilyUnavailable))
                as Arc<dyn CompanionAuthorizer>,
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
        ),
    ] {
        let response = router(
            authorizer,
            Arc::new(FixedAttentionSource::available(Vec::new())),
        )
        .oneshot(
            Request::builder()
                .uri("/companion/v1/attention")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("router response");

        assert_eq!(response.status(), expected_status);
        assert_eq!(
            response_json(response).await["error"]["code"],
            expected_code
        );
    }
}

#[tokio::test]
async fn attention_maps_projection_failures_to_a_safe_unavailable_error() {
    let response = router(
        Arc::new(AllowAllAuthorizer),
        Arc::new(FixedAttentionSource::unavailable()),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/attention")
            .header(
                super::contract::PROTOCOL_VERSION_HEADER,
                super::contract::PROTOCOL_VERSION.to_string(),
            )
            .body(Body::empty())
            .expect("request"),
    )
    .await
    .expect("router response");

    assert_eq!(
        response.status(),
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    );
    let json = response_json(response).await;
    assert_eq!(json["error"]["code"], "temporarily_unavailable");
    assert!(!json.to_string().contains("database unavailable"));
}

#[tokio::test]
async fn sqlite_projection_flows_through_production_authorization_and_attention_contract() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("companion_attention_integration");
    let project = database
        .create_project("OpenForge", "/tmp/openforge-companion-attention")
        .expect("project");
    let newest = database
        .create_task(
            "\n[image#1]: data:image/png;base64,c2VjcmV0LXByb21wdC1kYXRh\nReview the generated changes",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("newest task");
    database
        .create_agent_session(
            "attention-completed",
            &newest.id,
            None,
            "implement",
            "completed",
            "opencode",
        )
        .expect("completed session");
    let older = database
        .create_task(
            "Answer the agent question",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("older task");
    database
        .create_agent_session(
            "attention-paused",
            &older.id,
            None,
            "implement",
            "paused",
            "opencode",
        )
        .expect("paused session");
    database
        .update_agent_session(
            "attention-paused",
            "implement",
            "paused",
            Some(r#"{"question":"approve?"}"#),
            None,
        )
        .expect("checkpoint");
    let running = database
        .create_task("Still running", "doing", Some(&project.id), None, None)
        .expect("running task");
    database
        .create_agent_session(
            "attention-running",
            &running.id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("running session");
    let set_aside = database
        .create_task("Manually set aside", "doing", Some(&project.id), None, None)
        .expect("set-aside task");
    database
        .set_project_config(
            &project.id,
            "low_fire_task_ids",
            &serde_json::to_string(&vec![&set_aside.id]).expect("set-aside JSON"),
        )
        .expect("set-aside config");
    database
        .create_task("Backlog task", "backlog", Some(&project.id), None, None)
        .expect("backlog task");
    {
        let connection = database.connection();
        let connection = connection.lock().expect("connection");
        connection
            .execute(
                "UPDATE agent_sessions SET updated_at = CASE id
                 WHEN 'attention-completed' THEN 200
                 WHEN 'attention-paused' THEN 100
                 ELSE 300 END",
                [],
            )
            .expect("attention timestamps");
    }

    let database = Arc::new(std::sync::Mutex::new(database));
    let coordinator = Arc::new(PairingCoordinator::new(
        Arc::new(DatabaseCompanionDeviceStore::new(Arc::clone(&database))),
        Duration::from_secs(60),
    ));
    let source = Arc::new(DatabaseCompanionAttentionSource::new(Arc::clone(&database)));
    let pairing = coordinator
        .start(PairingBootstrap {
            protocol_version: 1,
            host_id: HOST_ID.to_string(),
            certificate_sha256: "AA:BB:CC:DD".to_string(),
            endpoint_candidates: vec!["https://192.168.1.20:17424".to_string()],
        })
        .expect("pairing session");
    let qr: serde_json::Value = serde_json::from_str(&pairing.qr_payload).expect("pairing QR");
    let secret = qr["oneTimeSecret"].as_str().expect("pairing secret");
    let submission = coordinator
        .submit(PairingSubmission {
            secret: secret.to_string(),
            device_name: "Test phone".to_string(),
            platform: "ios".to_string(),
        })
        .expect("pairing submission");
    coordinator
        .decide(&submission.request_id, PairingDecision::Approve)
        .expect("pairing approval");
    let approval = coordinator
        .poll(&submission.request_id, secret)
        .expect("credential delivery");
    let credential = approval.credential.expect("device credential");
    let device_id = approval.device_id.expect("device id");
    let router = create_router_with_attention(
        CompanionHostStatus::new(HOST_ID.to_string()),
        coordinator.clone(),
        coordinator.clone(),
        source,
    );

    for authorization in [None, Some("Bearer invalid".to_string())] {
        let mut request = Request::builder().uri("/companion/v1/attention").header(
            super::contract::PROTOCOL_VERSION_HEADER,
            super::contract::PROTOCOL_VERSION.to_string(),
        );
        if let Some(authorization) = authorization {
            request = request.header(axum::http::header::AUTHORIZATION, authorization);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).expect("request"))
            .await
            .expect("router response");
        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/companion/v1/attention")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header(
                    axum::http::header::AUTHORIZATION,
                    format!("Bearer {credential}"),
                )
                .body(Body::empty())
                .expect("attention request"),
        )
        .await
        .expect("router response");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let json = response_json(response).await;
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1.openapi.json"
    ))
    .expect("OpenAPI JSON");
    let mut schema = contract["components"]["schemas"]["AttentionSnapshot"].clone();
    *schema
        .pointer_mut("/properties/items/items")
        .expect("attention item schema") =
        contract["components"]["schemas"]["AttentionItem"].clone();
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(&schema)
        .expect("valid attention schema");
    let errors = validator
        .iter_errors(&json)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "schema errors: {errors:?}");
    let items = json["items"].as_array().expect("attention items");
    assert_eq!(
        items
            .iter()
            .map(|item| item["taskId"].as_str().expect("task id"))
            .collect::<Vec<_>>(),
        vec![newest.id.as_str(), older.id.as_str()]
    );
    assert_eq!(items[0]["title"], "Review the generated changes");
    assert!(!json.to_string().contains("c2VjcmV0LXByb21wdC1kYXRh"));
    assert!(!items.iter().any(|item| item["taskId"] == running.id));
    assert!(!items.iter().any(|item| item["taskId"] == set_aside.id));

    coordinator.revoke(&device_id).expect("revoke device");
    let revoked = router
        .oneshot(
            Request::builder()
                .uri("/companion/v1/attention")
                .header(
                    super::contract::PROTOCOL_VERSION_HEADER,
                    super::contract::PROTOCOL_VERSION.to_string(),
                )
                .header(
                    axum::http::header::AUTHORIZATION,
                    format!("Bearer {credential}"),
                )
                .body(Body::empty())
                .expect("revoked request"),
        )
        .await
        .expect("router response");
    assert_eq!(revoked.status(), axum::http::StatusCode::UNAUTHORIZED);
    assert_eq!(response_json(revoked).await["error"]["code"], "revoked");
}
