use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[tokio::test]
async fn plugin_host_create_task_uses_project_worktree_default() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_create_task_worktree_default");
    let project = database
        .create_project("Plugin Tasks", "/tmp/plugin-tasks")
        .expect("project fixture");
    database
        .set_project_config(&project.id, "use_worktrees", "false")
        .expect("set worktree default");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app.clone());

    let created = host
        .handle_host_callback(
            "openforge.tasks.create",
            &json!({
                "initialPrompt": "Scheduled backend task",
                "projectId": project.id,
            }),
        )
        .await
        .expect("task create callback");

    assert_eq!(created["worktree_source"], "disabled");
    assert_eq!(created["worktree_branch"], Value::Null);
}

#[tokio::test]
async fn plugin_host_prompt_contribution_order_requires_i64_and_preserves_safe_maximum() {
    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_prompt_contribution_order");
    let project = database
        .create_project("Plugin Prompts", "/tmp/plugin-prompts")
        .expect("project fixture");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);
    let request = |order| {
        json!({
            "pluginId": "com.example.workflow",
            "projectId": project.id,
            "id": "workflow",
            "content": "Workflow",
            "order": order
        })
    };

    let error = host
        .handle_host_callback(
            "openforge.tasks.configureStartPromptContribution",
            &request(json!(1.5)),
        )
        .await
        .expect_err("fractional order must be rejected");
    assert!(error.contains("integer"));

    let contributions = host
        .handle_host_callback(
            "openforge.tasks.configureStartPromptContribution",
            &request(json!(MAX_SAFE_INTEGER)),
        )
        .await
        .expect("safe maximum order");
    assert_eq!(contributions[0]["order"], MAX_SAFE_INTEGER);
}

#[tokio::test]
async fn plugin_host_prompt_contribution_list_distinguishes_empty_from_malformed_config() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_prompt_contribution_list");
    let empty_project = database
        .create_project("Empty Plugin Prompts", "/tmp/empty-plugin-prompts")
        .expect("empty project fixture");
    database
        .set_project_config(
            &empty_project.id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            "[]",
        )
        .expect("empty contribution fixture");
    let malformed_project = database
        .create_project("Malformed Plugin Prompts", "/tmp/malformed-plugin-prompts")
        .expect("malformed project fixture");
    database
        .set_project_config(
            &malformed_project.id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            "not valid json",
        )
        .expect("malformed contribution fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    let contributions = host
        .handle_host_callback(
            "openforge.tasks.listStartPromptContributions",
            &json!({ "projectId": empty_project.id }),
        )
        .await
        .expect("stored empty config must produce an empty contribution list");
    assert_eq!(contributions, json!([]));

    let error = host
        .handle_host_callback(
            "openforge.tasks.listStartPromptContributions",
            &json!({ "projectId": malformed_project.id }),
        )
        .await
        .expect_err("malformed config must reject the contribution list request");
    assert!(
        error.contains(&format!(
            "failed to parse stored start prompt contributions for project {}",
            malformed_project.id
        )),
        "unexpected error: {error}"
    );
}

#[tokio::test]
async fn plugin_host_task_follow_up_routes_through_agent_session_delivery() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_task_follow_up_callback");
    let project = database
        .create_project("Plugin Tasks", "/tmp/plugin-tasks")
        .expect("project fixture");
    let task = database
        .create_task("Follow up", "doing", Some(&project.id), None, None)
        .expect("Task fixture");
    database
        .create_agent_session("session-1", &task.id, None, "implementing", "running", "pi")
        .expect("Agent Session fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    app.manage(crate::pty_manager::PtyManager::new());
    let host = PluginHost::new(app);

    let error = host
        .handle_host_callback(
            "openforge.tasks.sendFollowUp",
            &json!({ "taskId": task.id, "message": "Review the feedback" }),
        )
        .await
        .expect_err("missing Agent PTY should report a delivery failure");
    assert!(error.contains("AGENT_FOLLOW_UP_DELIVERY_FAILED"));
}

#[tokio::test]
async fn plugin_host_lists_compact_paginated_task_usage_candidates() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_task_usage_candidates");
    let project = database
        .create_project("Usage", "/repo")
        .expect("create Project fixture");
    let task = database
        .create_task(
            "Private usage prompt",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("create Task fixture");
    database
        .update_task_title(&task.id, "Usage attribution")
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
        .expect("workspace fixture");
    database
        .create_agent_session("session-1", &task.id, None, "implement", "running", "pi")
        .expect("create Agent Session fixture");
    database
        .set_agent_session_pi_id("session-1", "pi-session-1")
        .expect("provider Agent Session id fixture");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    let page = host
        .handle_host_callback(
            "openforge.tasks.listUsageCandidates",
            &json!({
                "provider": "pi",
                "periodStart": 0,
                "pageSize": 100,
            }),
        )
        .await
        .expect("list Task usage candidates callback");

    assert_eq!(page["nextCursor"], Value::Null);
    assert_eq!(page["items"][0]["taskId"], task.id);
    assert_eq!(page["items"][0]["title"], "Usage attribution");
    assert_eq!(page["items"][0]["sessions"][0]["id"], "pi-session-1");
    assert_eq!(page["items"][0]["workspace"]["path"], "/repo");
    assert_eq!(page["items"][0]["workspace"]["kind"], "project");
    assert!(page["items"][0].get("prompt").is_none());
    assert!(page["items"][0].get("initial_prompt").is_none());
    assert!(!page.to_string().contains("Private usage prompt"));
}

#[tokio::test]
async fn plugin_host_lists_filtered_task_agent_sessions() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_task_agent_sessions");
    let task = database
        .create_task("Usage attribution", "doing", None, None, None)
        .expect("Task fixture");
    for (id, provider) in [
        ("old-pi", "pi"),
        ("new-claude", "claude-code"),
        ("new-pi", "pi"),
    ] {
        database
            .create_agent_session(id, &task.id, None, "implement", "completed", provider)
            .expect("Agent Session fixture");
    }
    database
        .connection()
        .lock()
        .expect("lock connection")
        .execute(
            "UPDATE agent_sessions SET created_at = CASE id WHEN 'old-pi' THEN 100 WHEN 'new-pi' THEN 200 ELSE 300 END",
            [],
        )
        .expect("adjust Agent Session timestamps");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    let sessions = host
        .handle_host_callback(
            "openforge.tasks.listSessions",
            &json!({
                "taskId": task.id,
                "provider": "pi",
                "createdAtOrAfter": 150,
            }),
        )
        .await
        .expect("list Agent Sessions callback");

    assert_eq!(
        sessions
            .as_array()
            .expect("Agent Sessions")
            .iter()
            .map(|session| session["id"].as_str().expect("Agent Session id"))
            .collect::<Vec<_>>(),
        vec!["new-pi"]
    );
}

#[tokio::test]
async fn plugin_host_task_compose_round_trips_through_the_desktop_renderer() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_task_compose_callback");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let (event_sender, mut events) = tokio::sync::broadcast::channel(4);
    let host = PluginHost::with_app_event_sender(app, Some(event_sender));
    let callback_host = host.clone();
    let callback = tokio::spawn(async move {
        callback_host
            .handle_host_callback(
                "openforge.tasks.compose",
                &json!({
                    "projectId": "P-1",
                    "initialPrompt": "Review issue 42",
                    "sourceTicketUrl": "https://example.com/issues/42"
                }),
            )
            .await
    });

    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("compose request event timeout")
        .expect("compose request event");
    assert_eq!(
        event.event_name,
        crate::frontend_host_request_transport::FRONTEND_HOST_REQUEST_EVENT
    );
    assert_eq!(event.payload["operation"], "composeTask");
    assert_eq!(event.payload["request"]["projectId"], "P-1");
    let correlation_id = event.payload["correlationId"]
        .as_str()
        .expect("compose request correlation id");
    let state = host
        .app_state_for_host_callback()
        .expect("plugin host app state");
    assert!(state.frontend_host_requests.acknowledge(
        crate::frontend_host_request_transport::FrontendHostRequestAcknowledgement {
            correlation_id: correlation_id.to_string(),
            outcome: crate::frontend_host_request_transport::FrontendHostRequestOutcome::Success {
                output: json!({ "task": { "id": "T-composed" }, "started": false }),
            },
        }
    ));

    assert_eq!(
        callback
            .await
            .expect("compose callback join")
            .expect("compose callback"),
        json!({ "task": { "id": "T-composed" }, "started": false })
    );
}

#[tokio::test]
async fn plugin_host_task_callbacks_create_start_and_read_state() {
    let (database, _temp_dir) = crate::db::test_helpers::make_test_db("plugin_host_task_callbacks");
    let project_dir = tempfile::tempdir().expect("project dir");
    let project = database
        .create_project("Plugin Tasks", &project_dir.path().to_string_lossy())
        .expect("project fixture");
    let dependency = database
        .create_task("Dependency", "done", Some(&project.id), None, None)
        .expect("dependency fixture");
    database
        .set_project_config(
            &project.id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            r#"[{"id":"backend-owned","enabled":true,"content":"Legacy unowned brief","order":5}]"#,
        )
        .expect("legacy unowned contribution fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let (event_sender, mut events) = tokio::sync::broadcast::channel(16);
    let host = PluginHost::with_app_event_sender(app.clone(), Some(event_sender));

    let created = host
        .handle_host_callback(
            "openforge.tasks.create",
            &json!({
                "initialPrompt": "Scheduled backend task",
                "projectId": project.id,
                "dependsOn": [dependency.id],
                "labelNames": ["scheduled"]
            }),
        )
        .await
        .expect("task create callback");
    let task_id = created["id"].as_str().expect("created task id").to_string();
    assert_eq!(created["initial_prompt"], "Scheduled backend task");
    assert_eq!(created["status"], "backlog");
    assert_eq!(created["project_id"], project.id);
    assert_eq!(created["depends_on"], json!([dependency.id]));
    assert_eq!(created["labels"][0]["name"], "scheduled");

    let created_event = events.try_recv().expect("created Task invalidation");
    assert_eq!(created_event.event_name, "task-changed");
    assert_eq!(created_event.payload["task_id"], task_id);
    assert_eq!(created_event.payload["project_id"], project.id);
    let project_tasks = host
        .handle_host_callback("openforge.tasks.list", &json!({ "projectId": project.id }))
        .await
        .expect("task list callback");
    let project_tasks = project_tasks.as_array().expect("project tasks");
    assert!(project_tasks.iter().any(|task| task["id"] == task_id));
    assert!(!project_tasks.iter().any(|task| task["id"] == dependency.id));

    let project_tasks_with_done = host
        .handle_host_callback(
            "openforge.tasks.list",
            &json!({ "projectId": project.id, "includeDone": true }),
        )
        .await
        .expect("task list including done callback");
    assert!(project_tasks_with_done
        .as_array()
        .expect("project tasks including done")
        .iter()
        .any(|task| task["id"] == dependency.id));

    let fetched = host
        .handle_host_callback("openforge.tasks.get", &json!({ "taskId": task_id }))
        .await
        .expect("task get callback");
    assert_eq!(fetched["id"], task_id);

    // A missing Task resolves to null instead of rejecting, so plugins can tell a
    // deleted/completed Task apart from a transient load failure.
    let missing = host
        .handle_host_callback("openforge.tasks.get", &json!({ "taskId": "T-missing" }))
        .await
        .expect("missing task get callback");
    assert_eq!(missing, Value::Null);

    assert_eq!(
        host.handle_host_callback(
            "openforge.tasks.updateStatus",
            &json!({ "taskId": task_id, "status": "doing" }),
        )
        .await
        .expect("task status callback"),
        Value::Null
    );
    let contributions = host
        .handle_host_callback(
            "openforge.tasks.configureStartPromptContribution",
            &json!({
                "pluginId": "com.example.backend",
                "projectId": project.id,
                "id": "backend-owned",
                "enabled": true,
                "content": "## Plugin Brief\n- backend owned",
                "order": 5
            }),
        )
        .await
        .expect("configure start prompt contribution callback");
    assert_eq!(contributions[0]["id"], "backend-owned");
    assert_eq!(contributions[0]["ownerPluginId"], "com.example.backend");
    assert_eq!(contributions[0]["enabled"], true);
    assert_eq!(
        contributions[0]["content"],
        "## Plugin Brief\n- backend owned"
    );

    let contributions = host
        .handle_host_callback(
            "openforge.tasks.configureStartPromptContribution",
            &json!({
                "pluginId": "com.example.other-backend",
                "projectId": project.id,
                "id": "backend-owned",
                "enabled": true,
                "content": "## Other Plugin Brief",
                "order": 6
            }),
        )
        .await
        .expect("configure same local contribution id for another plugin");
    assert_eq!(
        contributions.as_array().expect("contributions array").len(),
        2
    );
    assert_eq!(
        contributions[1]["ownerPluginId"],
        "com.example.other-backend"
    );

    let contributions = host
        .handle_host_callback(
            "openforge.tasks.listStartPromptContributions",
            &json!({ "projectId": project.id }),
        )
        .await
        .expect("list start prompt contributions callback");
    assert_eq!(contributions[0]["id"], "backend-owned");

    {
        let db_state = app
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .expect("database state");
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        let task = db
            .get_task(&task_id)
            .expect("get updated task")
            .expect("task exists");
        assert_eq!(task.status, "doing");
        db.create_task_workspace_record(
            &task_id,
            &project.id,
            project_dir.path().to_str().expect("workspace path"),
            project_dir.path().to_str().expect("repo path"),
            "project_dir",
            None,
            "pi",
        )
        .expect("workspace fixture");
        db.create_agent_session(
            "session-1",
            &task_id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("session fixture");
    }

    let workspace = host
        .handle_host_callback(
            "openforge.tasks.getWorkspace",
            &json!({ "taskId": task_id }),
        )
        .await
        .expect("workspace callback");
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(
        workspace["workspace_path"],
        project_dir.path().to_string_lossy().as_ref()
    );

    let latest_session = host
        .handle_host_callback(
            "openforge.tasks.getLatestSession",
            &json!({ "taskId": task_id }),
        )
        .await
        .expect("latest session callback");
    assert_eq!(latest_session["id"], "session-1");
    assert_eq!(latest_session["ticket_id"], task_id);

    let start_task_id = {
        let db_state = app
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .expect("database state");
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        db.create_task(
            "Start through plugin callback",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("start Task fixture")
        .id
    };
    let start_error = host
        .handle_host_callback(
            "openforge.tasks.startImplementation",
            &json!({ "taskId": start_task_id }),
        )
        .await
        .expect_err("start should route through app lifecycle and report unavailable PTY manager");
    assert!(
        start_error.contains("PTY manager is not available"),
        "unexpected start error: {start_error}"
    );
}
