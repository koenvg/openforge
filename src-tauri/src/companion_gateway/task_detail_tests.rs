use super::{
    attention::UnavailableCompanionAttentionSource,
    contract::{
        create_router_with_sources, AllowAllAuthorizer, CompanionAuthorizer, CompanionErrorCode,
        CompanionHostStatus,
    },
    devices::InMemoryCompanionDeviceStore,
    pairing::{CompanionAuthenticatedDevice, PairingCoordinator},
    task_detail::{
        CompanionTaskDetail, CompanionTaskDetailSource, DatabaseCompanionTaskDetailSource,
    },
};
use axum::{body::Body, http::Request, response::Response};
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

const HOST_ID: &str = "65d91f21-6732-45a6-9418-3dfaf4c93f52";

#[derive(Debug)]
struct FixedTaskDetailSource {
    detail: Result<Option<CompanionTaskDetail>, String>,
}

impl CompanionTaskDetailSource for FixedTaskDetailSource {
    fn get(&self, _task_id: &str) -> Result<Option<CompanionTaskDetail>, String> {
        self.detail.clone()
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
    source: Arc<dyn CompanionTaskDetailSource>,
) -> axum::Router {
    create_router_with_sources(
        CompanionHostStatus::new(HOST_ID.to_string()),
        authorizer,
        test_pairing(),
        Arc::new(UnavailableCompanionAttentionSource),
        source,
    )
}

async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("response JSON")
}

fn detail() -> CompanionTaskDetail {
    CompanionTaskDetail {
        task_id: "KVG-2946".to_string(),
        initial_prompt: "## Investigate mobile detail\n\nShow the **complete** prompt.".to_string(),
        title: "Mobile Task detail".to_string(),
        project_id: "P-1".to_string(),
        project_name: "OpenForge".to_string(),
        board_status: "doing".to_string(),
        agent_state: "failed".to_string(),
        agent_error_summary: Some("Agent failed. Review details on the desktop.".to_string()),
        labels: vec!["mobile".to_string(), "review".to_string()],
        dependencies: vec![super::task_detail::CompanionTaskRelationship {
            task_id: "KVG-2944".to_string(),
            title: "Prepare companion contract".to_string(),
            board_status: "done".to_string(),
            project_id: "P-2".to_string(),
            project_name: "Release Tools".to_string(),
        }],
        dependent_tasks: vec![super::task_detail::CompanionDependentTask {
            task_id: "KVG-2947".to_string(),
            title: "Ship companion release".to_string(),
            board_status: "backlog".to_string(),
            project_id: "P-2".to_string(),
            project_name: "Release Tools".to_string(),
            remaining_dependency_count: 1,
        }],
        created_at: 1_754_000_000,
        updated_at: 1_754_000_100,
        agent_updated_at: Some(1_754_000_200),
    }
}

#[tokio::test]
async fn authenticated_task_detail_returns_only_the_approved_read_model() {
    let response = router(
        Arc::new(AllowAllAuthorizer),
        Arc::new(FixedTaskDetailSource {
            detail: Ok(Some(detail())),
        }),
    )
    .oneshot(
        Request::builder()
            .uri("/companion/v1/tasks/KVG-2946")
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
    assert_eq!(json["taskId"], "KVG-2946");
    assert_eq!(
        json["initialPrompt"],
        "## Investigate mobile detail\n\nShow the **complete** prompt."
    );
    assert_eq!(json["boardStatus"], "doing");
    assert_eq!(json["agentState"], "failed");
    assert_eq!(json["agentTerminalAvailable"], false);
    assert_eq!(json["labels"], serde_json::json!(["mobile", "review"]));
    assert_eq!(json["dependencies"][0]["taskId"], "KVG-2944");
    assert_eq!(json["dependencies"][0]["boardStatus"], "done");
    assert_eq!(json["dependencies"][0]["projectId"], "P-2");
    assert_eq!(json["dependencies"][0]["projectName"], "Release Tools");
    assert_eq!(json["dependentTasks"][0]["taskId"], "KVG-2947");
    assert_eq!(json["dependentTasks"][0]["projectId"], "P-2");
    assert_eq!(json["dependentTasks"][0]["projectName"], "Release Tools");
    assert_eq!(json["dependentTasks"][0]["remainingDependencyCount"], 1);
    assert_eq!(
        json.as_object()
            .expect("Task detail object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec![
            "agentErrorSummary",
            "agentState",
            "agentTerminalAvailable",
            "agentUpdatedAt",
            "boardStatus",
            "createdAt",
            "dependencies",
            "dependentTasks",
            "initialPrompt",
            "labels",
            "projectId",
            "projectName",
            "taskId",
            "title",
            "updatedAt",
        ]
    );
}

#[tokio::test]
async fn task_detail_maps_authorization_not_found_and_source_failures_to_stable_errors() {
    for (authorizer, source, expected_status, expected_code) in [
        (
            Arc::new(RejectAuthorizer(CompanionErrorCode::Revoked)) as Arc<dyn CompanionAuthorizer>,
            Arc::new(FixedTaskDetailSource {
                detail: Ok(Some(detail())),
            }) as Arc<dyn CompanionTaskDetailSource>,
            axum::http::StatusCode::UNAUTHORIZED,
            "revoked",
        ),
        (
            Arc::new(AllowAllAuthorizer) as Arc<dyn CompanionAuthorizer>,
            Arc::new(FixedTaskDetailSource { detail: Ok(None) })
                as Arc<dyn CompanionTaskDetailSource>,
            axum::http::StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            Arc::new(AllowAllAuthorizer) as Arc<dyn CompanionAuthorizer>,
            Arc::new(FixedTaskDetailSource {
                detail: Err("database path /Users/secret/openforge.db".to_string()),
            }) as Arc<dyn CompanionTaskDetailSource>,
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
        ),
    ] {
        let response = router(authorizer, source)
            .oneshot(
                Request::builder()
                    .uri("/companion/v1/tasks/missing")
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
        let json = response_json(response).await;
        assert_eq!(json["error"]["code"], expected_code);
        assert!(!json.to_string().contains("/Users/secret"));
    }
}

#[tokio::test]
async fn sqlite_task_detail_includes_full_prompt_and_safe_agent_semantics() {
    let (database, _temp_dir) = crate::db::test_helpers::make_test_db("companion_task_detail");
    let project = database
        .create_project("OpenForge", "/Users/secret/repository")
        .expect("project");
    let relationship_project = database
        .create_project("Release Tools", "/Users/secret/release-tools")
        .expect("relationship project");
    let task = database
        .create_task(
            "\n[image#1]: data:image/png;base64,cHJvbXB0LXNlY3JldA==\nPrompt-derived title",
            "doing",
            Some(&project.id),
            Some("provider token sk-secret and diff contents"),
            None,
        )
        .expect("task");
    let dependency = database
        .create_task(
            "\n[image#2]: data:image/png;base64,cmVsYXRpb25zaGlwLXNlY3JldA==\nPrepare companion contract",
            "done",
            Some(&relationship_project.id),
            None,
            None,
        )
        .expect("dependency");
    {
        let connection = database.connection();
        connection
            .lock()
            .expect("lock database")
            .execute(
                "UPDATE tasks SET title = '   ' WHERE id = ?1",
                [&dependency.id],
            )
            .expect("store whitespace title");
    }
    let noncanonical_image_line = "[image#1]: data:image/png;base64,   ";
    let literal_dependency = database
        .create_task(
            &format!("{noncanonical_image_line}\nReview the generated changes"),
            "backlog",
            Some(&relationship_project.id),
            None,
            None,
        )
        .expect("literal dependency");
    let other_dependency = database
        .create_task(
            "Finish release notes",
            "backlog",
            Some(&relationship_project.id),
            None,
            None,
        )
        .expect("other dependency");
    let dependent = database
        .create_task(
            "Ship companion release",
            "backlog",
            Some(&relationship_project.id),
            None,
            None,
        )
        .expect("dependent");
    database
        .add_task_label(&task.id, "mobile")
        .expect("Task Label");
    database
        .add_task_dependency(&task.id, &dependency.id)
        .expect("dependency link");
    database
        .add_task_dependency(&task.id, &literal_dependency.id)
        .expect("literal dependency link");
    database
        .add_task_dependency(&dependent.id, &task.id)
        .expect("dependent link");
    database
        .add_task_dependency(&dependent.id, &other_dependency.id)
        .expect("dependent remaining link");
    database
        .create_agent_session(
            "provider-session-secret",
            &task.id,
            Some("provider-session-id"),
            "implement",
            "failed",
            "opencode",
        )
        .expect("session");
    database
        .update_agent_session(
            "provider-session-secret",
            "implement",
            "failed",
            None,
            Some("Bearer secret-token failed at /Users/secret/repository/src/main.rs"),
        )
        .expect("failed session");

    let database = Arc::new(std::sync::Mutex::new(database));
    let response = router(
        Arc::new(AllowAllAuthorizer),
        Arc::new(DatabaseCompanionTaskDetailSource::new(database)),
    )
    .oneshot(
        Request::builder()
            .uri(format!("/companion/v1/tasks/{}", task.id))
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
    assert_eq!(json["title"], "Prompt-derived title");
    assert_eq!(
        json["initialPrompt"],
        "\n[image#1]: data:image/png;base64,cHJvbXB0LXNlY3JldA==\nPrompt-derived title"
    );
    assert_eq!(json["projectName"], "OpenForge");
    assert_eq!(json["boardStatus"], "doing");
    assert_eq!(json["agentState"], "failed");
    assert_eq!(
        json["agentErrorSummary"],
        "Agent failed. Review details on the desktop."
    );
    assert_eq!(json["labels"], serde_json::json!(["mobile"]));
    assert_eq!(json["dependencies"][0]["taskId"], dependency.id);
    assert_eq!(
        json["dependencies"][0]["title"],
        "Prepare companion contract"
    );
    assert_eq!(json["dependencies"][0]["boardStatus"], "done");
    assert_eq!(
        json["dependencies"][0]["projectId"],
        relationship_project.id
    );
    assert_eq!(json["dependencies"][0]["projectName"], "Release Tools");
    assert_eq!(json["dependencies"][1]["taskId"], literal_dependency.id);
    assert_eq!(
        json["dependencies"][1]["title"],
        "[image#1]: data:image/png;base64,"
    );
    assert_eq!(json["dependentTasks"][0]["taskId"], dependent.id);
    assert_eq!(json["dependentTasks"][0]["title"], "Ship companion release");
    assert_eq!(json["dependentTasks"][0]["boardStatus"], "backlog");
    assert_eq!(
        json["dependentTasks"][0]["projectId"],
        relationship_project.id
    );
    assert_eq!(json["dependentTasks"][0]["projectName"], "Release Tools");
    assert_eq!(json["dependentTasks"][0]["remainingDependencyCount"], 1);
    let encoded = json.to_string();
    for forbidden in [
        "provider-session-secret",
        "provider-session-id",
        "secret-token",
        "/Users/secret",
        "prompt-secret",
        "diff contents",
    ] {
        assert!(
            !encoded.contains(forbidden),
            "leaked {forbidden}: {encoded}"
        );
    }
}
