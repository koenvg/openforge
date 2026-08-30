use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

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
