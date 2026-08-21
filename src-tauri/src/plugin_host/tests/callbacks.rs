use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[tokio::test]
async fn host_storage_callback_round_trips_through_plugin_storage_table() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_storage_callback");
    for plugin_id in ["backend-plugin", "other-plugin"] {
        database
            .install_plugin(&crate::db::PluginRow {
                id: plugin_id.to_string(),
                name: plugin_id.to_string(),
                version: "1.0.0".to_string(),
                api_version: 1,
                description: String::new(),
                permissions: "[]".to_string(),
                contributes: "{}".to_string(),
                frontend_entry: "index.js".to_string(),
                backend_entry: None,
                install_path: "/tmp/plugin".to_string(),
                source_kind: "test".to_string(),
                source_spec: plugin_id.to_string(),
                package_metadata: "{}".to_string(),
                installed_at: 0,
                is_builtin: false,
            })
            .expect("install plugin fixture");
    }
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    host.handle_host_callback(
        "openforge.storage.set",
        &json!({
            "pluginId": "backend-plugin",
            "scope": "project",
            "scopeId": "P-1",
            "key": "repo",
            "value": { "owner": "acme" }
        }),
    )
    .await
    .expect("set storage callback");

    let value = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "backend-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get storage callback");
    assert_eq!(value, json!({ "owner": "acme" }));

    let isolated = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "other-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get isolated storage callback");
    assert_eq!(isolated, Value::Null);

    host.handle_host_callback(
        "openforge.storage.delete",
        &json!({
            "pluginId": "backend-plugin",
            "scope": "project",
            "scopeId": "P-1",
            "key": "repo"
        }),
    )
    .await
    .expect("delete storage callback");

    let deleted = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "backend-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get deleted storage callback");
    assert_eq!(deleted, Value::Null);
}

#[tokio::test]
async fn host_core_callbacks_route_to_app_services() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_core_callbacks");
    let project_dir = tempfile::tempdir().expect("project dir");
    let src_dir = project_dir.path().join("src");
    std::fs::create_dir(&src_dir).expect("src dir");
    std::fs::write(project_dir.path().join("README.md"), "# Plugin host").expect("readme fixture");
    std::fs::write(project_dir.path().join(".gitignore"), "target/\n").expect("gitignore fixture");
    std::fs::write(src_dir.join("main.ts"), "export const plugin = true").expect("source fixture");
    std::fs::write(src_dir.join("main.py"), "print('plugin')").expect("python fixture");
    std::process::Command::new("git")
        .args(["init"])
        .current_dir(project_dir.path())
        .output()
        .expect("git init fixture");
    std::process::Command::new("git")
        .args(["add", "README.md", "src/main.ts"])
        .current_dir(project_dir.path())
        .output()
        .expect("git add fixture");
    let project = database
        .create_project("Plugin Host", &project_dir.path().to_string_lossy())
        .expect("project fixture");
    database
        .set_config("theme", "light")
        .expect("config fixture");
    database
        .set_project_config(&project.id, "repo_hint", "acme/old")
        .expect("project config fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    app.manage(crate::pty_manager::PtyManager::new());
    let host = PluginHost::new(app);

    let projects = host
        .handle_host_callback("openforge.projects.list", &Value::Null)
        .await
        .expect("list projects callback");
    assert_eq!(projects.as_array().expect("projects").len(), 1);

    let project_value = host
        .handle_host_callback(
            "openforge.projects.get",
            &json!({ "projectId": project.id }),
        )
        .await
        .expect("get project callback");
    assert_eq!(project_value["name"], "Plugin Host");

    let command_catalog = host
        .handle_host_callback(
            "openforge.commands.listCatalog",
            &json!({ "projectId": project.id }),
        )
        .await
        .expect("command catalog callback");
    assert!(command_catalog.is_array());
    assert_eq!(
        host.handle_host_callback("openforge.commands.listCatalog", &json!({}))
            .await
            .expect("project-independent command catalog callback"),
        json!([])
    );
    let dir = host
        .handle_host_callback(
            "openforge.fs.readDir",
            &json!({ "projectId": project.id, "path": "src" }),
        )
        .await
        .expect("read dir callback");
    assert!(dir
        .as_array()
        .expect("dir entries")
        .iter()
        .any(|entry| entry["name"] == "main.ts"));

    let file = host
        .handle_host_callback(
            "openforge.fs.readFile",
            &json!({ "projectId": project.id, "path": "README.md" }),
        )
        .await
        .expect("read file callback");
    assert_eq!(file["content"], "# Plugin host");
    assert_eq!(file["mimeType"], "text/markdown");

    let gitignore = host
        .handle_host_callback(
            "openforge.fs.readFile",
            &json!({ "projectId": project.id, "path": ".gitignore" }),
        )
        .await
        .expect("read gitignore callback");
    assert_eq!(gitignore["type"], "text");
    assert_eq!(gitignore["content"], "target/\n");
    assert_eq!(gitignore["mimeType"], "text/plain");

    let python = host
        .handle_host_callback(
            "openforge.fs.readFile",
            &json!({ "projectId": project.id, "path": "src/main.py" }),
        )
        .await
        .expect("read python callback");
    assert_eq!(python["mimeType"], "text/python");

    let search = host
        .handle_host_callback(
            "openforge.fs.searchFiles",
            &json!({ "projectId": project.id, "query": "main", "limit": 5 }),
        )
        .await
        .expect("search callback");
    assert_eq!(search, json!(["src/main.ts"]));

    host.handle_host_callback(
        "openforge.fs.writeFile",
        &json!({ "projectId": project.id, "path": "generated.txt", "content": "hello" }),
    )
    .await
    .expect("write file callback");
    assert_eq!(
        std::fs::read_to_string(project_dir.path().join("generated.txt")).expect("generated"),
        "hello"
    );

    assert_eq!(
        host.handle_host_callback("openforge.attention.listProjects", &Value::Null)
            .await
            .expect("attention callback"),
        json!([])
    );
    assert_eq!(
        host.handle_host_callback("openforge.config.get", &json!({ "key": "theme" }))
            .await
            .expect("config get callback"),
        json!("light")
    );
    host.handle_host_callback(
        "openforge.config.set",
        &json!({ "key": "theme", "value": "dark" }),
    )
    .await
    .expect("config set callback");
    assert_eq!(
        host.handle_host_callback(
            "openforge.projectConfig.get",
            &json!({ "projectId": project.id, "key": "repo_hint" }),
        )
        .await
        .expect("project config get callback"),
        json!("acme/old")
    );
    host.handle_host_callback(
        "openforge.projectConfig.set",
        &json!({ "projectId": project.id, "key": "repo_hint", "value": "acme/new" }),
    )
    .await
    .expect("project config set callback");
    assert_eq!(
        host.handle_host_callback(
            "openforge.system.openUrl",
            &json!({ "url": "https://example.com" })
        )
        .await
        .expect("open url callback"),
        Value::Null
    );
    assert_eq!(
        host.handle_host_callback(
            "openforge.system.writeClipboardText",
            &json!({ "text": "Reviewer brief" })
        )
        .await
        .expect("write clipboard text callback"),
        Value::Null
    );
    assert_eq!(
        host.handle_host_callback(
            "openforge.notifications.notify",
            &json!({ "title": "Done" })
        )
        .await
        .expect("notification callback"),
        Value::Null
    );
}

#[tokio::test]
async fn host_app_event_callbacks_emit_once_with_production_adapter_and_sender() {
    for (method, event_name, payload) in [
        (
            "openforge.notifications.notify",
            "openforge.notification",
            json!({ "title": "Done" }),
        ),
        (
            "openforge.system.openUrl",
            "openforge.open-url",
            json!({ "url": "https://example.com" }),
        ),
        (
            "openforge.system.writeClipboardText",
            "openforge.write-clipboard-text",
            json!({ "text": "Reviewer brief" }),
        ),
    ] {
        let app = AppHandle::new();
        let bus = crate::app_events::AppEventBus::new(16, 8);
        let sender = bus.sender();
        let mut events = bus.subscribe(None).expect("subscribe to app events");
        app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
            bus,
        )));
        let host = PluginHost::with_app_event_sender(app, Some(sender));

        host.handle_host_callback(method, &payload)
            .await
            .expect("host app event callback");

        let crate::app_events::AppEventFrame::Event(event) =
            events.recv().await.expect("host app event")
        else {
            panic!("expected host app event");
        };
        assert_eq!(event.event_name, event_name);
        assert_eq!(event.payload, payload);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), events.recv())
                .await
                .is_err(),
            "{method} must emit exactly one app event"
        );
    }
}

#[tokio::test]
async fn plugin_host_global_command_callback_routes_github_sync_backend_bridge() {
    let (database, _path) =
        crate::db::test_helpers::make_test_db("plugin_host_global_command_github_sync_bridge");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app.clone());

    let review_prs = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({
                "qualifiedId": "openforge.getReviewPrs",
                "payload": null,
                "callerPluginId": "com.openforge.github-sync"
            }),
        )
        .await
        .expect("global command callback");
    assert_eq!(review_prs, json!([]));

    let task_prs = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({
                "qualifiedId": "openforge.getPullRequests",
                "payload": null,
                "callerPluginId": "com.openforge.github-sync"
            }),
        )
        .await
        .expect("Task pull request callback");
    assert_eq!(task_prs, json!([]));

    let unauthorized = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({
                "qualifiedId": "openforge.submitPrReview",
                "payload": {},
                "callerPluginId": "com.example.third-party"
            }),
        )
        .await
        .expect_err("third-party global command should fail");
    assert!(unauthorized.contains("not authorized to invoke private host command"));

    let unsupported = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({
                "qualifiedId": "openforge.notAGithubSyncCommand",
                "payload": null,
                "callerPluginId": "com.openforge.github-sync"
            }),
        )
        .await
        .expect_err("unsupported global command should fail");
    assert!(unsupported.contains("unsupported plugin host global command id"));
}

#[tokio::test]
async fn plugin_host_create_task_uses_project_worktree_default() {
    let (database, _path) =
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
async fn plugin_host_task_follow_up_routes_through_agent_session_delivery() {
    let (database, _path) =
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
async fn plugin_host_task_compose_round_trips_through_the_desktop_renderer() {
    let (database, _path) =
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
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_task_callbacks");
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
