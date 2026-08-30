use super::super::super::*;
use serde_json::json;

#[tokio::test]
async fn host_filesystem_callbacks_scope_user_data() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);

    host.handle_host_callback(
        "openforge.fs.userData.writeTextFile",
        &json!({ "pluginId": "skill-usage", "path": "telemetry/usage.json", "content": "{\"runs\":1}" }),
    )
    .await
    .expect("write plugin user data");
    assert_eq!(
        std::fs::read_to_string(
            app_data_dir
                .path()
                .join("plugin-data/skill-usage/telemetry/usage.json")
        )
        .expect("plugin data fixture"),
        "{\"runs\":1}"
    );

    let user_data_dir = host
        .handle_host_callback(
            "openforge.fs.userData.readDir",
            &json!({ "pluginId": "skill-usage", "path": "telemetry" }),
        )
        .await
        .expect("read plugin user data directory");
    assert_eq!(user_data_dir[0]["path"], "telemetry/usage.json");

    let user_data = host
        .handle_host_callback(
            "openforge.fs.userData.readTextFile",
            &json!({ "pluginId": "skill-usage", "path": "telemetry/usage.json" }),
        )
        .await
        .expect("read plugin user data");
    assert_eq!(user_data, json!("{\"runs\":1}"));

    host.handle_host_callback(
        "openforge.fs.userData.writeTextFile",
        &json!({ "pluginId": "skill-usage", "path": "telemetry/usage.json", "content": "" }),
    )
    .await
    .expect("clear plugin user data");
    assert_eq!(
        std::fs::read_to_string(
            app_data_dir
                .path()
                .join("plugin-data/skill-usage/telemetry/usage.json")
        )
        .expect("cleared plugin data"),
        ""
    );

    let non_string_content = host
        .handle_host_callback(
            "openforge.fs.userData.writeTextFile",
            &json!({ "pluginId": "skill-usage", "path": "telemetry/usage.json", "content": 0 }),
        )
        .await
        .expect_err("non-string plugin user data content should fail");
    assert_eq!(
        non_string_content,
        "plugin host callback param must be a string: content"
    );
}

#[tokio::test]
async fn host_filesystem_callbacks_commit_user_data_with_durable_append_and_atomic_replace() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);

    let first_append = host
        .handle_host_callback(
            "openforge.fs.userData.appendTextFile",
            &json!({ "pluginId": "skill-usage", "path": "events/index.jsonl", "content": "one\n" }),
        )
        .await
        .expect("append first user-data record");
    assert_eq!(first_append, json!({ "sizeBytes": 4 }));

    let second_append = host
        .handle_host_callback(
            "openforge.fs.userData.appendTextFile",
            &json!({ "pluginId": "skill-usage", "path": "events/index.jsonl", "content": "two\n" }),
        )
        .await
        .expect("append second user-data record");
    assert_eq!(second_append, json!({ "sizeBytes": 8 }));

    host.handle_host_callback(
        "openforge.fs.userData.writeTextFile",
        &json!({ "pluginId": "skill-usage", "path": "events/state.json", "content": "{\"committedBytes\":8}" }),
    )
    .await
    .expect("atomically replace generation pointer");

    let plugin_root = app_data_dir.path().join("plugin-data/skill-usage/events");
    assert_eq!(
        std::fs::read_to_string(plugin_root.join("index.jsonl")).expect("appended index"),
        "one\ntwo\n"
    );
    assert_eq!(
        std::fs::read_to_string(plugin_root.join("state.json")).expect("generation pointer"),
        "{\"committedBytes\":8}"
    );
    let paths = std::fs::read_dir(plugin_root)
        .expect("user-data directory")
        .map(|entry| entry.expect("user-data entry").file_name())
        .collect::<Vec<_>>();
    assert_eq!(
        paths.len(),
        2,
        "atomic replacement must not leave temporary files"
    );
}

#[tokio::test]
async fn host_filesystem_callbacks_reject_invalid_user_data_paths_and_plugin_ids() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);

    let user_data_traversal = host
        .handle_host_callback(
            "openforge.fs.userData.writeTextFile",
            &json!({ "pluginId": "skill-usage", "path": "../escape.txt", "content": "no" }),
        )
        .await
        .expect_err("user data traversal should fail");
    assert!(user_data_traversal.contains("Path traversal detected"));

    let user_data_append_traversal = host
        .handle_host_callback(
            "openforge.fs.userData.appendTextFile",
            &json!({ "pluginId": "skill-usage", "path": "../escape.txt", "content": "no" }),
        )
        .await
        .expect_err("user data append traversal should fail");
    assert!(user_data_append_traversal.contains("Path traversal detected"));

    let invalid_plugin_id = host
        .handle_host_callback(
            "openforge.fs.userData.writeTextFile",
            &json!({ "pluginId": "../other-plugin", "path": "escape.txt", "content": "no" }),
        )
        .await
        .expect_err("invalid plugin id should fail");
    assert!(invalid_plugin_id.contains("invalid pluginId"));
}
