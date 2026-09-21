use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

fn build_host_with_scoped_service() -> (
    PluginHost,
    String,
    Arc<crate::scoped_agent_session_test_support::TestScopedSessionRuntime>,
    tempfile::TempDir,
) {
    let (database, temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_scoped_agent_session_lifecycle");
    let project = database
        .create_project("Scoped sessions", "/repo")
        .expect("create Project fixture");
    let database = Arc::new(Mutex::new(database));
    let (service, runtime) =
        crate::scoped_agent_session_test_support::test_scoped_agent_session_service(
            database.clone(),
        );
    let app = AppHandle::new();
    app.manage(database);
    app.manage(service);
    (PluginHost::new(app), project.id, runtime, temp_dir)
}

fn build_host_with_agent_session() -> (PluginHost, String) {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_agent_session_list");
    let project = database
        .create_project("Agent Sessions", "/repo")
        .expect("create Project fixture");
    let task = database
        .create_task(
            "Private task prompt",
            "doing",
            Some(&project.id),
            Some("Historical import"),
            None,
        )
        .expect("create Task fixture");
    database
        .update_task_title(&task.id, "Historical import")
        .expect("set Task title fixture");
    database
        .create_task_workspace_record(
            &task.id,
            &project.id,
            "/repo",
            "/repo",
            "project_dir",
            None,
            "pi",
        )
        .expect("create workspace fixture");
    database
        .create_agent_session(
            "session-1",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create Agent Session fixture");
    database
        .set_agent_session_pi_id("session-1", "pi-session-1")
        .expect("set provider Agent Session ID");
    database
        .connection()
        .lock()
        .expect("lock database")
        .execute_batch(
            "UPDATE tasks
                SET created_at = 10,
                    updated_at = 20
              WHERE id = (SELECT ticket_id FROM agent_sessions WHERE id = 'session-1');
             UPDATE agent_sessions
                SET created_at = 110,
                    updated_at = 120,
                    checkpoint_data = 'private checkpoint',
                    error_message = 'private error'
              WHERE id = 'session-1';",
        )
        .expect("set callback fixture timestamps");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    (PluginHost::new(app), task.id)
}

fn valid_request() -> Value {
    json!({
        "pluginId": "com.example.history-import",
        "provider": "pi",
        "overlaps": {
            "startInclusive": 100,
            "endExclusive": 200,
        },
        "pageSize": 100,
    })
}

#[tokio::test]
async fn plugin_host_lists_compact_agent_sessions_with_plugin_identity() {
    let (host, task_id) = build_host_with_agent_session();

    let page = host
        .handle_host_callback("openforge.agentSessions.list", &valid_request())
        .await
        .expect("list Agent Sessions callback");

    assert_eq!(
        page,
        json!({
            "items": [{
                "id": "session-1",
                "provider": "pi",
                "providerSessionId": "pi-session-1",
                "createdAt": 110,
                "updatedAt": 120,
                "task": {
                    "id": task_id,
                    "title": "Historical import",
                    "status": "doing",
                    "createdAt": 10,
                    "updatedAt": 20,
                },
                "workspace": {
                    "rootPath": "/repo",
                    "kind": "project",
                },
            }],
            "nextCursor": null,
        })
    );
    let serialized = page.to_string();
    for excluded in [
        "Private task prompt",
        "private checkpoint",
        "private error",
        "checkpointData",
        "errorMessage",
    ] {
        assert!(
            !serialized.contains(excluded),
            "payload contained {excluded}"
        );
    }
}

#[tokio::test]
async fn plugin_host_agent_session_list_requires_plugin_identity() {
    let (host, _task_id) = build_host_with_agent_session();
    let mut request = valid_request();
    request
        .as_object_mut()
        .expect("request object")
        .remove("pluginId");

    let error = host
        .handle_host_callback("openforge.agentSessions.list", &request)
        .await
        .expect_err("missing plugin identity must fail");

    assert!(error.contains("pluginId"), "unexpected error: {error}");
}

#[tokio::test]
async fn plugin_host_agent_session_list_reports_actionable_invalid_request_errors() {
    let (host, _task_id) = build_host_with_agent_session();
    let cases = [
        (
            json!({
                "pluginId": "com.example.history-import",
                "provider": "pi",
                "pageSize": 100,
            }),
            "overlaps",
        ),
        (
            json!({
                "pluginId": "com.example.history-import",
                "provider": "pi",
                "overlaps": { "startInclusive": 100, "endExclusive": 100 },
                "pageSize": 100,
            }),
            "startInclusive",
        ),
        (
            json!({
                "pluginId": "com.example.history-import",
                "provider": "pi",
                "overlaps": { "startInclusive": 100, "endExclusive": 200 },
                "pageSize": 0,
            }),
            "pageSize",
        ),
        (
            json!({
                "pluginId": "com.example.history-import",
                "provider": "pi",
                "overlaps": { "startInclusive": 100, "endExclusive": 200 },
                "pageSize": 100,
                "cursor": "not-a-valid-cursor",
            }),
            "cursor is malformed",
        ),
    ];

    for (request, expected) in cases {
        let error = host
            .handle_host_callback("openforge.agentSessions.list", &request)
            .await
            .expect_err("invalid request must fail");
        assert!(
            error.contains(expected),
            "expected {expected:?} in {error:?}"
        );
    }
}

#[tokio::test]
async fn plugin_host_scoped_agent_session_callbacks_require_identity_and_scope() {
    let (host, _task_id) = build_host_with_agent_session();
    let scope = json!({
        "namespace": "review",
        "targetKey": "PR-42",
        "revision": "sha-1",
    });

    let missing_identity = host
        .handle_host_callback("openforge.agentSessions.status", &json!({ "scope": scope }))
        .await
        .expect_err("scoped callback without plugin identity must fail");
    assert!(missing_identity.contains("pluginId"));

    let invalid_scope = host
        .handle_host_callback(
            "openforge.agentSessions.status",
            &json!({
                "pluginId": "com.example.reviewer",
                "scope": { "namespace": "review", "targetKey": "PR-42" },
            }),
        )
        .await
        .expect_err("invalid Session Scope must fail");
    assert!(invalid_scope.starts_with("INVALID_SCOPE:"));
}

#[tokio::test]
async fn plugin_host_scoped_agent_session_callbacks_report_missing_host_service() {
    let (host, _task_id) = build_host_with_agent_session();
    let error = host
        .handle_host_callback(
            "openforge.agentSessions.status",
            &json!({
                "pluginId": "com.example.reviewer",
                "scope": {
                    "namespace": "review",
                    "targetKey": "PR-42",
                    "revision": "sha-1",
                },
            }),
        )
        .await
        .expect_err("missing scoped Agent Session service must fail");

    assert!(error.starts_with("HOST_UNAVAILABLE:"));
}

#[tokio::test]
async fn plugin_host_scoped_agent_session_callbacks_round_trip_lifecycle_and_errors() {
    let (host, project_id, runtime, _temp_dir) = build_host_with_scoped_service();
    let scope = json!({
        "namespace": "review",
        "targetKey": "PR-42",
        "revision": "sha-1",
    });
    let start = json!({
        "pluginId": "com.example.reviewer",
        "scope": scope,
        "projectId": project_id,
        "checkoutRevision": "main",
        "initialInput": "Review this",
    });

    let legacy_error = host
        .handle_host_callback(
            "openforge.agentSessions.start",
            &json!({
                "pluginId": "com.example.reviewer",
                "scope": {
                    "namespace": "review",
                    "targetKey": "PR-legacy",
                    "revision": "sha-legacy",
                },
                "projectId": project_id,
                "checkoutRevision": "main",
                "initialInput": "Review this",
                "toolPolicy": "review-read-only",
            }),
        )
        .await
        .expect_err("legacy toolPolicy must be rejected");
    assert!(legacy_error.starts_with("INVALID_SCOPE:"));

    let started = host
        .handle_host_callback("openforge.agentSessions.start", &start)
        .await
        .expect("start scoped Agent Session");
    assert_eq!(started["status"], "running");
    assert_eq!(started["queuePosition"], Value::Null);
    assert_eq!(started["queueReason"], Value::Null);
    assert_eq!(started["acceptsInput"], true);
    assert_eq!(started["workspaceAvailable"], true);

    let duplicate = host
        .handle_host_callback("openforge.agentSessions.start", &start)
        .await
        .expect_err("duplicate scope must fail");
    assert!(duplicate.starts_with("DUPLICATE_SCOPE:"));

    let status_request = json!({
        "pluginId": "com.example.reviewer",
        "scope": scope,
    });
    let status = host
        .handle_host_callback("openforge.agentSessions.status", &status_request)
        .await
        .expect("read scoped Agent Session status");
    assert_eq!(status["id"], started["id"]);

    let forbidden = host
        .handle_host_callback(
            "openforge.agentSessions.status",
            &json!({ "pluginId": "com.example.other", "scope": scope }),
        )
        .await
        .expect_err("another plugin must not read the scope");
    assert!(forbidden.starts_with("FORBIDDEN:"));

    host.handle_host_callback(
        "openforge.agentSessions.input",
        &json!({
            "pluginId": "com.example.reviewer",
            "scope": scope,
            "input": "Continue",
        }),
    )
    .await
    .expect("send scoped Agent Session input");
    assert_eq!(
        runtime.inputs.lock().expect("lock inputs").as_slice(),
        ["Continue"]
    );

    let aborted = host
        .handle_host_callback("openforge.agentSessions.abort", &status_request)
        .await
        .expect("abort scoped Agent Session");
    assert_eq!(aborted["status"], "aborted");
    assert_eq!(runtime.aborts.lock().expect("lock aborts").len(), 1);

    host.handle_host_callback("openforge.agentSessions.release", &status_request)
        .await
        .expect("release scoped Agent Session");
    let released = host
        .handle_host_callback("openforge.agentSessions.status", &status_request)
        .await
        .expect("read released scoped Agent Session status");
    assert_eq!(released, Value::Null);
}
