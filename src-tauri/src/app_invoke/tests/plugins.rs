use super::*;

fn builtin_plugin_payload(plugin_id: &str, name: &str, is_builtin: bool) -> serde_json::Value {
    json!({
        "plugin": {
            "id": plugin_id,
            "name": name,
            "version": "1.0.0",
            "apiVersion": 1,
            "description": "Builtin plugin",
            "permissions": "[]",
            "contributes": "{}",
            "frontendEntry": "./dist/frontend.js",
            "backendEntry": null,
            "installPath": format!("builtin:{plugin_id}"),
            "sourceKind": "builtin",
            "sourceSpec": plugin_id,
            "packageMetadata": "{}",
            "installedAt": 123,
            "isBuiltin": is_builtin
        }
    })
}

fn custom_plugin_row(plugin_id: &str) -> crate::db::PluginRow {
    crate::db::PluginRow {
        id: plugin_id.to_string(),
        name: "Custom Plugin".to_string(),
        version: "1.0.0".to_string(),
        api_version: 1,
        description: "Custom plugin".to_string(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: "index.js".to_string(),
        backend_entry: None,
        install_path: "/tmp/custom-plugin".to_string(),
        source_kind: "local".to_string(),
        source_spec: "/tmp/custom-plugin".to_string(),
        package_metadata: "{}".to_string(),
        installed_at: 123,
        is_builtin: false,
    }
}

fn external_plugin_payload() -> serde_json::Value {
    json!({
        "plugin": {
            "id": "com.example.external-row",
            "name": "External Row",
            "version": "1.0.0",
            "apiVersion": 1,
            "description": "External plugin row",
            "permissions": "[]",
            "contributes": "{}",
            "frontendEntry": "index.js",
            "backendEntry": null,
            "installPath": "/tmp/external-row",
            "sourceKind": "legacy",
            "sourceSpec": "",
            "packageMetadata": "{}",
            "installedAt": 123,
            "isBuiltin": false
        }
    })
}

fn write_local_plugin_package(source_path: &std::path::Path, plugin_id: &str) {
    std::fs::create_dir_all(source_path.join("dist")).expect("dist dir");
    std::fs::write(source_path.join("dist/index.js"), "export const x = 1;")
        .expect("frontend entry");
    std::fs::write(
        source_path.join("package.json"),
        format!(
            r#"{{
                "name": "@example/local-sidecar",
                "version": "1.0.0",
                "openforge": {{
                    "id": "{plugin_id}",
                    "apiVersion": 1,
                    "displayName": "Local Sidecar Plugin",
                    "description": "A local plugin",
                    "frontend": "dist/index.js"
                }}
            }}"#
        ),
    )
    .expect("package.json");
}

#[tokio::test]
async fn concurrent_frontend_prompt_contributions_preserve_each_plugin() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_concurrent_prompt_contributions");
    let project_id = {
        let db = crate::db::acquire_db(&state.db);
        db.create_project("Plugin Prompts", "/tmp/plugin-prompts")
            .expect("project fixture")
            .id
    };

    let first = invoke(
        &state,
        "configure_start_prompt_contribution",
        json!({
            "ownerPluginId": "com.example.first",
            "projectId": project_id,
            "id": "workflow",
            "content": "First workflow"
        }),
    );
    let second = invoke(
        &state,
        "configure_start_prompt_contribution",
        json!({
            "ownerPluginId": "com.example.second",
            "projectId": project_id,
            "id": "workflow",
            "content": "Second workflow"
        }),
    );
    let (first_result, second_result) = tokio::join!(first, second);
    first_result.expect("first contribution");
    second_result.expect("second contribution");

    let stored = {
        let db = crate::db::acquire_db(&state.db);
        db.get_project_config(
            &project_id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
        )
        .expect("read prompt contributions")
        .expect("stored prompt contributions")
    };
    let contributions: Vec<crate::agent_lifecycle::StartPromptContribution> =
        serde_json::from_str(&stored).expect("parse prompt contributions");
    assert_eq!(contributions.len(), 2);
    assert_eq!(
        contributions
            .iter()
            .map(|contribution| contribution.owner_plugin_id.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("com.example.first"), Some("com.example.second")]
    );
    let task = {
        let db = crate::db::acquire_db(&state.db);
        db.create_task(
            "Run both workflows",
            "backlog",
            Some(&project_id),
            None,
            None,
        )
        .expect("task fixture")
    };
    let prompt =
        crate::agent_lifecycle::build_task_prompt(&task, None, false, &contributions, None);
    assert!(prompt.contains("First workflow"));
    assert!(prompt.contains("Second workflow"));
}

#[tokio::test]
async fn configure_start_prompt_contribution_rejects_fractional_order() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_fractional_prompt_contribution_order");
    let project_id = {
        let db = crate::db::acquire_db(&state.db);
        db.create_project("Plugin Prompts", "/tmp/plugin-prompts")
            .expect("project fixture")
            .id
    };

    let error = invoke(
        &state,
        "configure_start_prompt_contribution",
        json!({
            "ownerPluginId": "com.example.workflow",
            "projectId": project_id,
            "id": "workflow",
            "content": "Workflow",
            "order": 1.5
        }),
    )
    .await
    .expect_err("fractional order must be rejected");

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
    assert!(error.1.contains("integer"));
}

#[tokio::test]
async fn register_builtin_plugin_rejects_external_plugin_rows() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_builtin_rejects_external_row");

    let err = invoke(&state, "register_builtin_plugin", external_plugin_payload())
        .await
        .expect_err("external rows must not use the trusted builtin registration path");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("built-in plugin"));
    assert!(invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.example.external-row" }),
    )
    .await
    .is_null());
}

#[tokio::test]
async fn register_builtin_plugin_recomputes_builtin_identity() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_builtin_recomputes_identity");

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.file-viewer", "File Viewer", false),
    )
    .await;

    let installed = invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.openforge.file-viewer" }),
    )
    .await;
    assert_eq!(installed["id"], "com.openforge.file-viewer");
    assert_eq!(installed["is_builtin"], true);
    assert_eq!(installed["source_kind"], "builtin");
}

#[tokio::test]
async fn uninstall_plugin_rejects_builtin_plugins() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_builtin_uninstall_rejects");

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.github-sync", "GitHub Sync", true),
    )
    .await;

    let err = invoke(
        &state,
        "uninstall_plugin",
        json!({ "pluginId": "com.openforge.github-sync" }),
    )
    .await
    .expect_err("built-in plugins must not be uninstallable through direct IPC");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("built-in plugin"));
    assert!(!invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.openforge.github-sync" }),
    )
    .await
    .is_null());
}

#[tokio::test]
async fn uninstall_plugin_removes_custom_plugins() {
    let (state, _temp_dir, _app_dir) = test_state_with_backend_app("app_invoke_custom_uninstall");
    {
        let db = state.db.lock().expect("db lock");
        db.install_plugin(&custom_plugin_row("com.example.custom"))
            .expect("install custom plugin");
    }

    invoke_ok(
        &state,
        "uninstall_plugin",
        json!({ "pluginId": "com.example.custom" }),
    )
    .await;

    assert!(invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.example.custom" }),
    )
    .await
    .is_null());
}

#[tokio::test]
async fn handles_db_backed_commands() {
    let (state, _temp_dir, _app_dir) = test_state_with_backend_app("app_invoke_plugin_db_backed");
    let project_id = {
        let db = state.db.lock().expect("db lock");
        db.create_project("Open Forge", "/tmp/openforge")
            .expect("create project")
            .id
    };

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.github-sync", "GitHub Sync", true),
    )
    .await;
    let list = invoke_ok(&state, "list_plugins", serde_json::Value::Null).await;
    assert_eq!(list[0]["id"], "com.openforge.github-sync");
    assert_eq!(list[0]["api_version"], 1);

    invoke_ok(
        &state,
        "set_plugin_enabled",
        json!({ "projectId": project_id, "pluginId": "com.openforge.github-sync", "enabled": true }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_enabled_plugins",
            json!({ "projectId": project_id })
        )
        .await[0]["id"],
        "com.openforge.github-sync"
    );

    invoke_ok(
        &state,
        "set_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings", "value": { "token": "secret" } }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_plugin_storage",
            json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
        )
        .await,
        json!({ "token": "secret" })
    );
    assert!(invoke_ok(
        &state,
        "get_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "task", "scopeId": "T-1", "key": "settings" }),
    )
    .await
    .is_null());
    invoke_ok(
        &state,
        "delete_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
    )
    .await;
    assert!(invoke_ok(
        &state,
        "get_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
    )
    .await
    .is_null());

    assert!(!invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.openforge.github-sync" }),
    )
    .await
    .is_null());
}

#[tokio::test]
async fn plugin_storage_ipc_preserves_scope_validation_errors() {
    let (state, _temp_dir) = test_state("app_invoke_plugin_storage_scope_errors");

    for (payload, expected) in [
        (
            json!({
                "pluginId": "com.openforge.github-sync",
                "scope": "task",
                "key": "settings"
            }),
            "Plugin storage scope 'task' requires scopeId",
        ),
        (
            json!({
                "pluginId": "com.openforge.github-sync",
                "scope": "workspace",
                "scopeId": "W-1",
                "key": "settings"
            }),
            "Unsupported plugin storage scope: workspace",
        ),
    ] {
        let error = invoke(&state, "get_plugin_storage", payload)
            .await
            .expect_err("invalid plugin storage scope should fail");
        assert_eq!(
            error,
            (StatusCode::INTERNAL_SERVER_ERROR, expected.to_string())
        );
    }
}

#[tokio::test]
async fn resolves_plugin_asset_roots_through_rust_plugin_platform() {
    let (state, _temp_dir, _app_dir) = test_state_with_backend_app("app_invoke_plugin_asset_roots");
    let source = tempfile::tempdir().expect("source plugin dir");
    write_local_plugin_package(source.path(), "com.example.assets");

    invoke_ok(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": source.path() }),
    )
    .await;
    let external = invoke_ok(
        &state,
        "resolve_plugin_asset_root",
        json!({ "pluginId": "com.example.assets" }),
    )
    .await;
    assert_eq!(external["plugin_id"], "com.example.assets");
    assert_eq!(
        external["asset_root"].as_str().expect("asset root string"),
        source.path().canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(external["is_builtin"], false);

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.file-viewer", "File Viewer", true),
    )
    .await;
    let builtin = invoke_ok(
        &state,
        "resolve_plugin_asset_root",
        json!({ "pluginId": "com.openforge.file-viewer" }),
    )
    .await;
    assert_eq!(builtin["plugin_id"], "com.openforge.file-viewer");
    assert!(builtin["asset_root"]
        .as_str()
        .expect("builtin asset root should be a string")
        .ends_with("plugins/file-viewer"));
    assert_eq!(builtin["is_builtin"], true);
}

#[tokio::test]
async fn installs_local_plugin_with_backend_app_path_state() {
    let (state, _temp_dir, _app_dir) =
        test_state_with_backend_app("app_invoke_local_plugin_backend_paths");
    let source = tempfile::tempdir().expect("source plugin dir");
    write_local_plugin_package(source.path(), "com.example.local-sidecar");

    let installed = invoke_ok(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": source.path() }),
    )
    .await;

    assert_eq!(installed["id"], "com.example.local-sidecar");
    assert_eq!(installed["source_kind"], "local");
    assert_eq!(
        installed["install_path"]
            .as_str()
            .expect("install_path should be a string"),
        source.path().canonicalize().unwrap().to_string_lossy()
    );
}

#[tokio::test]
async fn install_local_plugin_preserves_app_invoke_missing_app_path_contract() {
    let (state, _temp_dir) = test_state("app_invoke_local_plugin_missing_app_path");

    let err = invoke(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": "/tmp/plugin" }),
    )
    .await
    .expect_err("install should require app path state before PluginPlatform install work");

    assert_eq!(err.0, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(
        err.1,
        "app IPC command requires app data path state before Electron sidecar support"
    );
}

#[tokio::test]
async fn scans_a_plugin_folder_for_installable_plugin_packages() {
    let (state, _temp_dir) = test_state("app_invoke_scan_plugin_folder");
    let folder = tempfile::tempdir().expect("plugin folder");
    write_local_plugin_package(&folder.path().join("plugins/alpha"), "com.example.alpha");

    let discovered = invoke_ok(
        &state,
        "scan_plugin_folder",
        json!({ "folderPath": folder.path() }),
    )
    .await;

    let rows = discovered.as_array().expect("scan should return an array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], "com.example.alpha");
    assert_eq!(rows[0]["installable"], true);
    assert_eq!(rows[0]["needsBuild"], false);
    assert_eq!(
        rows[0]["path"].as_str().expect("path should be a string"),
        folder
            .path()
            .join("plugins/alpha")
            .canonicalize()
            .expect("package dir should canonicalize")
            .to_string_lossy()
    );
}

#[tokio::test]
async fn acknowledges_frontend_plugin_commands_exactly_once() {
    use crate::frontend_host_request_transport::FrontendHostRequestTransport;
    use crate::plugin_command_broker::{
        FrontendAgentCommandCatalog, PluginCommandInvocationContext, PluginCommandInvocationSource,
    };
    use std::time::Duration;

    let (mut state, path) = test_state("app_invoke_frontend_plugin_command_ack");
    let (event_sender, mut event_receiver) = tokio::sync::broadcast::channel(4);
    state.frontend_host_requests =
        FrontendHostRequestTransport::new(Some(event_sender), Duration::from_secs(1));
    let request_transport = state.frontend_host_requests.clone();
    let invocation = tokio::spawn(async move {
        request_transport
            .invoke_frontend_agent_command(
                "com.example.browser",
                "P-1",
                "com.example.browser.open",
                Some(json!({ "url": "http://localhost:5173" })),
                PluginCommandInvocationContext {
                    task_id: Some("T-1".to_string()),
                    project_id: "P-1".to_string(),
                    source: PluginCommandInvocationSource::AgentCli,
                },
            )
            .await
    });
    let request = event_receiver.recv().await.expect("frontend request");
    let correlation_id = request.payload["correlationId"]
        .as_str()
        .expect("correlation id")
        .to_string();
    let acknowledgement = json!({
        "correlationId": correlation_id,
        "outcome": {
            "status": "success",
            "output": { "accepted": true }
        }
    });

    assert_eq!(
        invoke_ok(
            &state,
            "plugin_frontend_command_acknowledge",
            acknowledgement.clone(),
        )
        .await,
        json!(true)
    );
    assert_eq!(
        invocation.await.expect("join").expect("result"),
        json!({ "accepted": true })
    );
    assert_eq!(
        invoke_ok(
            &state,
            "plugin_frontend_command_acknowledge",
            acknowledgement,
        )
        .await,
        json!(false)
    );

    let _ = std::fs::remove_file(path);
}
#[tokio::test]
async fn scanning_a_missing_plugin_folder_is_a_bad_request() {
    let (state, _temp_dir) = test_state("app_invoke_scan_plugin_folder_missing");

    let err = invoke(
        &state,
        "scan_plugin_folder",
        json!({ "folderPath": "/tmp/openforge-nonexistent-plugin-folder" }),
    )
    .await
    .expect_err("scanning a missing folder should fail");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("openforge-nonexistent-plugin-folder"),
        "error should name the folder: {}",
        err.1
    );
}
