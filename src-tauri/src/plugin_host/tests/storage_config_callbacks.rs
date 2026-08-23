use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_storage_callback_round_trips_through_plugin_storage_table() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_storage_callback");
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
async fn host_config_callbacks_route_to_app_services() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_config_callbacks");
    let project = database
        .create_project("Plugin Host", "/tmp/plugin-host")
        .expect("project fixture");
    database
        .set_config("theme", "light")
        .expect("config fixture");
    database
        .set_project_config(&project.id, "repo_hint", "acme/old")
        .expect("project config fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

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
}
