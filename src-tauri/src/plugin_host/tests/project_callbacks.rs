use super::super::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_project_callbacks_route_to_app_services() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_project_callbacks");
    let project = database
        .create_project("Plugin Host", "/tmp/plugin-host")
        .expect("project fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
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

    assert_eq!(
        host.handle_host_callback("openforge.attention.listProjects", &Value::Null)
            .await
            .expect("attention callback"),
        json!([])
    );
}
