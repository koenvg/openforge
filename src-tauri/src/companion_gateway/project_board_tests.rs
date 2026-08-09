use super::{
    attention::DatabaseCompanionAttentionSource,
    contract::{
        create_router_with_project_board, create_router_with_sources_event_access_and_pty,
        AllowAllAuthorizer, CompanionHostStatus, CompanionRouterSources,
        PairingUnavailableAuthorizer, PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER,
    },
    devices::InMemoryCompanionDeviceStore,
    live_events::GatewayCompanionStreamAccess,
    pairing::PairingCoordinator,
    project_board::DatabaseCompanionProjectBoardSource,
    task_detail::DatabaseCompanionTaskDetailSource,
};
use crate::app_events::AppEventBus;
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

fn pairing() -> Arc<PairingCoordinator> {
    Arc::new(PairingCoordinator::new(
        Arc::new(InMemoryCompanionDeviceStore::default()),
        Duration::from_secs(60),
    ))
}

fn request(uri: impl AsRef<str>) -> Request<Body> {
    Request::builder()
        .uri(uri.as_ref())
        .header(PROTOCOL_VERSION_HEADER, PROTOCOL_VERSION.to_string())
        .body(Body::empty())
        .expect("request")
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

fn resolve_schema_refs(
    value: &serde_json::Value,
    contract: &serde_json::Value,
) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(reference) = object.get("$ref").and_then(serde_json::Value::as_str) {
                if let Some(pointer) = reference.strip_prefix('#') {
                    return resolve_schema_refs(
                        contract.pointer(pointer).expect("OpenAPI schema reference"),
                        contract,
                    );
                }
            }
            serde_json::Value::Object(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), resolve_schema_refs(value, contract)))
                    .collect(),
            )
        }
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .iter()
                .map(|value| resolve_schema_refs(value, contract))
                .collect(),
        ),
        value => value.clone(),
    }
}

fn assert_matches_openapi_schema(schema_name: &str, value: &serde_json::Value) {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-v1.openapi.json"
    ))
    .expect("OpenAPI JSON");
    let schema = resolve_schema_refs(&contract["components"]["schemas"][schema_name], &contract);
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(&schema)
        .expect("valid OpenAPI schema");
    let errors = validator
        .iter_errors(value)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "{schema_name} errors: {errors:?}");
}
#[tokio::test]
async fn authenticated_project_catalog_is_visible_safe_and_in_desktop_order() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_project_catalog");
    let alpha = database
        .create_project("Alpha", "/secret/alpha")
        .expect("alpha");
    let beta = database
        .create_project("Beta", "/secret/beta")
        .expect("beta");
    let hidden = database
        .create_project("Hidden", "/secret/hidden")
        .expect("hidden");
    database
        .set_config(
            "project_sidebar_order",
            &serde_json::to_string(&vec![&beta.id, &hidden.id, &alpha.id]).expect("order"),
        )
        .expect("project order");
    database
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![&hidden.id]).expect("hidden projects"),
        )
        .expect("project visibility");
    let source = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::new(
        std::sync::Mutex::new(database),
    )));
    let router = create_router_with_project_board(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing(),
        source,
    );

    let response = router
        .oneshot(request("/companion/v1/projects"))
        .await
        .expect("catalog response");
    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_matches_openapi_schema("ProjectCatalog", &json);
    assert_eq!(
        json["projects"]
            .as_array()
            .expect("projects")
            .iter()
            .map(|project| project["projectId"].as_str().expect("project id"))
            .collect::<Vec<_>>(),
        vec![beta.id.as_str(), alpha.id.as_str()]
    );
    assert_eq!(json["projects"][0]["name"], "Beta");
    assert!(!json.to_string().contains("/secret/"));
    assert!(json["projects"]
        .as_array()
        .expect("projects")
        .iter()
        .all(|project| project.as_object().expect("project").len() == 2));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn authenticated_project_board_returns_one_authoritative_safe_snapshot() {
    let (database, path) = crate::db::test_helpers::make_test_db("companion_project_board");
    let project = database
        .create_project("OpenForge", "/secret/openforge")
        .expect("project");
    let focus_older = database
        .create_task(
            "\n[image#1]: data:image/png;base64,c2VjcmV0\nReview generated changes",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("focus older");
    let focus_newer = database
        .create_task("Fix the gateway", "doing", Some(&project.id), None, None)
        .expect("focus newer");
    database
        .update_task_title(&focus_newer.id, "Gateway fix")
        .expect("task title");
    let in_flight = database
        .create_task("Running", "doing", Some(&project.id), None, None)
        .expect("in flight");
    database
        .create_agent_session(
            "board-running",
            &in_flight.id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("running session");
    let out_of_focus = database
        .create_task("Set aside", "doing", Some(&project.id), None, None)
        .expect("out of focus");
    database
        .set_project_config(
            &project.id,
            "low_fire_task_ids",
            &serde_json::to_string(&vec![&out_of_focus.id]).expect("out of focus config"),
        )
        .expect("out of focus config");
    let backlog = database
        .create_task("Backlog", "backlog", Some(&project.id), None, None)
        .expect("backlog");
    let completed = database
        .create_task("Completed", "done", Some(&project.id), None, None)
        .expect("completed");
    let legacy = database
        .create_task("Legacy completed", "done", Some(&project.id), None, None)
        .expect("legacy");
    {
        let connection = database.connection();
        let connection = connection.lock().expect("connection");
        connection
            .execute(
                "UPDATE tasks SET updated_at = CASE id
                 WHEN ?1 THEN 100 WHEN ?2 THEN 200 WHEN ?3 THEN 300
                 WHEN ?4 THEN 400 WHEN ?5 THEN 500 ELSE updated_at END",
                rusqlite::params![
                    &focus_older.id,
                    &focus_newer.id,
                    &in_flight.id,
                    &out_of_focus.id,
                    &backlog.id,
                ],
            )
            .expect("task activity");
        connection
            .execute(
                "UPDATE agent_sessions SET updated_at = 600 WHERE id = 'board-running'",
                [],
            )
            .expect("session activity");
        connection
            .execute(
                "UPDATE tasks SET status = 'completed' WHERE id = ?1",
                [&legacy.id],
            )
            .expect("legacy status");
    }
    let source = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::new(
        std::sync::Mutex::new(database),
    )));
    let router = create_router_with_project_board(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing(),
        source,
    );

    let response = router
        .oneshot(request(format!(
            "/companion/v1/projects/{}/board",
            project.id
        )))
        .await
        .expect("board response");
    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_matches_openapi_schema("ProjectBoard", &json);
    assert_eq!(json["projectId"], project.id);
    assert_eq!(json["projectName"], "OpenForge");
    assert_eq!(
        json["counts"],
        serde_json::json!({
            "focus": 2,
            "inFlight": 1,
            "outOfFocus": 1,
            "backlog": 1
        })
    );
    assert_eq!(json["lanes"]["focus"][0]["taskId"], focus_newer.id);
    assert_eq!(json["lanes"]["focus"][0]["title"], "Gateway fix");
    assert_eq!(
        json["lanes"]["focus"][1]["title"],
        "Review generated changes"
    );
    assert_eq!(json["lanes"]["inFlight"][0]["taskId"], in_flight.id);
    assert_eq!(json["lanes"]["inFlight"][0]["state"], "active");
    assert_eq!(json["lanes"]["outOfFocus"][0]["taskId"], out_of_focus.id);
    assert_eq!(json["lanes"]["backlog"][0]["taskId"], backlog.id);
    assert_eq!(json["lanes"]["backlog"][0]["lane"], "backlog");
    let serialized = json.to_string();
    for sensitive in [
        "/secret/openforge",
        "c2VjcmV0",
        "initialPrompt",
        "handoffNotes",
        "provider",
        "sessionId",
        completed.id.as_str(),
        legacy.id.as_str(),
    ] {
        assert!(!serialized.contains(sensitive), "leaked {sensitive}");
    }

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn project_board_hides_authorization_visibility_and_existence() {
    let (database, path) =
        crate::db::test_helpers::make_test_db("companion_project_board_safe_errors");
    let visible = database
        .create_project("Visible", "/visible")
        .expect("visible");
    let hidden = database
        .create_project("Hidden", "/hidden")
        .expect("hidden");
    database
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![&hidden.id]).expect("hidden config"),
        )
        .expect("hidden config");
    let source = Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::new(
        std::sync::Mutex::new(database),
    )));
    let allowed = create_router_with_project_board(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(AllowAllAuthorizer),
        pairing(),
        source.clone(),
    );

    for project_id in [&hidden.id, "P-999", "not-a-project"] {
        let response = allowed
            .clone()
            .oneshot(request(format!(
                "/companion/v1/projects/{project_id}/board"
            )))
            .await
            .expect("safe board response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let json = response_json(response).await;
        assert_eq!(json["error"]["code"], "not_found");
        assert!(!json.to_string().contains("/hidden"));
    }

    let denied = create_router_with_project_board(
        CompanionHostStatus::new(HOST_ID.to_string()),
        Arc::new(PairingUnavailableAuthorizer),
        pairing(),
        source,
    )
    .oneshot(request(format!(
        "/companion/v1/projects/{}/board",
        visible.id
    )))
    .await
    .expect("unauthorized response");
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(denied).await["error"]["code"],
        "unauthenticated"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn hidden_projects_are_also_concealed_from_attention_and_task_detail() {
    let (database, path) =
        crate::db::test_helpers::make_test_db("companion_hidden_project_surfaces");
    let hidden = database
        .create_project("Hidden", "/secret/hidden")
        .expect("hidden Project");
    let task = database
        .create_task("Hidden task prompt", "doing", Some(&hidden.id), None, None)
        .expect("hidden Task");
    database
        .set_config(
            "project_sidebar_hidden",
            &serde_json::to_string(&vec![&hidden.id]).expect("hidden Project configuration"),
        )
        .expect("hide Project");
    let database = Arc::new(std::sync::Mutex::new(database));
    let authorizer: Arc<dyn super::contract::CompanionAuthorizer> = Arc::new(AllowAllAuthorizer);
    let stream_access = Arc::new(GatewayCompanionStreamAccess::new(Arc::clone(&authorizer)));
    let router = create_router_with_sources_event_access_and_pty(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        pairing(),
        CompanionRouterSources {
            attention: Arc::new(DatabaseCompanionAttentionSource::new(Arc::clone(&database))),
            project_board: Arc::new(DatabaseCompanionProjectBoardSource::new(Arc::clone(
                &database,
            ))),
            task_detail: Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
            task_actions: Arc::new(super::task_actions::UnavailableCompanionTaskActionService),
            events: AppEventBus::new(16, 8),
            stream_access,
            pty_manager: crate::pty_manager::PtyManager::new(),
        },
    );

    let attention = router
        .clone()
        .oneshot(request("/companion/v1/attention"))
        .await
        .expect("attention response");
    assert_eq!(attention.status(), StatusCode::OK);
    let attention_json = response_json(attention).await;
    assert_eq!(attention_json["items"], serde_json::json!([]));
    assert!(!attention_json.to_string().contains(&task.id));

    let detail = router
        .oneshot(request(format!("/companion/v1/tasks/{}", task.id)))
        .await
        .expect("Task detail response");
    assert_eq!(detail.status(), StatusCode::NOT_FOUND);
    let detail_json = response_json(detail).await;
    assert_eq!(detail_json["error"]["code"], "not_found");
    assert!(!detail_json.to_string().contains(&hidden.id));

    let _ = std::fs::remove_file(path);
}
