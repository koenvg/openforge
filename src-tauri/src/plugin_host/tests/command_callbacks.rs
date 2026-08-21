use super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_command_catalog_callbacks_route_to_app_services() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_command_catalog");
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
