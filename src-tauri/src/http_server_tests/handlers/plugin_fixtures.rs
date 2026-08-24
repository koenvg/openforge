use super::*;

fn sample_http_plugin(plugin_id: &str) -> crate::db::PluginRow {
    crate::db::PluginRow {
        id: plugin_id.to_string(),
        name: format!("Plugin {plugin_id}"),
        version: "1.0.0".to_string(),
        api_version: 1,
        description: "A test plugin".to_string(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: "dist/index.js".to_string(),
        backend_entry: None,
        install_path: "/tmp/plugin".to_string(),
        source_kind: "local".to_string(),
        source_spec: "local:/tmp/plugin".to_string(),
        package_metadata: "{}".to_string(),
        installed_at: 0,
        is_builtin: false,
    }
}

pub(super) fn seed_http_plugin(state: &AppState, plugin_id: &str) {
    state
        .db
        .lock()
        .expect("lock db")
        .install_plugin(&sample_http_plugin(plugin_id))
        .expect("seed plugin");
}

pub(super) fn seed_http_app_plugin(state: &AppState, plugin_id: &str) {
    let mut plugin = sample_http_plugin(plugin_id);
    plugin.package_metadata = r#"{"enablement":"app"}"#.to_string();
    state
        .db
        .lock()
        .expect("lock db")
        .install_plugin(&plugin)
        .expect("seed app plugin");
}

pub(super) fn assert_no_app_event(
    receiver: &mut tokio::sync::broadcast::Receiver<AppEventEnvelope>,
) {
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            | Err(tokio::sync::broadcast::error::TryRecvError::Closed)
    ));
}

pub(super) fn write_local_plugin_package(
    source_dir: &std::path::Path,
    plugin_id: &str,
    enablement: &str,
) {
    let requires = if enablement == "app" {
        "    \"requires\": [\"appEnablement\"],\n"
    } else {
        ""
    };
    std::fs::create_dir_all(source_dir.join("dist")).expect("create plugin dist");
    std::fs::write(
        source_dir.join("dist/index.js"),
        "export const ok = true;\n",
    )
    .expect("write plugin frontend");
    std::fs::write(
        source_dir.join("package.json"),
        format!(
            r#"{{
  "name": "openforge-http-test-plugin",
  "version": "1.2.3",
  "openforge": {{
    "id": "{plugin_id}",
    "apiVersion": 1,
    "displayName": "HTTP Test Plugin",
    "description": "Installed by HTTP bridge tests",
    "enablement": "{enablement}",
{requires}    "frontend": "dist/index.js"
  }}
}}"#
        ),
    )
    .expect("write plugin package.json");
}
