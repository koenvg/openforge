use super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_command_catalog_callbacks_route_to_app_services() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_command_catalog");
    let project = database
        .create_project("Plugin Host", "/tmp/plugin-host")
        .expect("project fixture");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

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
}

#[tokio::test]
async fn host_installed_providers_callback_returns_only_startable_agents() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_installed_providers");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    let providers = host
        .handle_host_callback("openforge.commands.listInstalledProviders", &json!({}))
        .await
        .expect("installed providers callback");
    assert!(providers.is_array());
    for provider in providers.as_array().expect("provider list") {
        let id = provider
            .get("id")
            .and_then(|value| value.as_str())
            .expect("provider id");
        assert!(
            matches!(id, "claude-code" | "opencode" | "pi" | "codex" | "grok"),
            "unexpected provider id {id}"
        );
        assert!(provider
            .get("displayName")
            .and_then(|value| value.as_str())
            .is_some());
    }
}

#[tokio::test]
async fn plugin_host_global_command_callback_routes_github_sync_backend_bridge() {
    let (database, _temp_dir) =
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
