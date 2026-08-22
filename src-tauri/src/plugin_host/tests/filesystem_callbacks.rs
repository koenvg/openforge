use super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_filesystem_callbacks_route_to_project_services() {
    let (database, _path) =
        crate::db::test_helpers::make_test_db("plugin_host_filesystem_callbacks");
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

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

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

    host.handle_host_callback(
        "openforge.fs.writeFile",
        &json!({ "projectId": project.id, "path": "generated.txt", "content": "" }),
    )
    .await
    .expect("clear project file");
    assert_eq!(
        std::fs::read_to_string(project_dir.path().join("generated.txt")).expect("cleared file"),
        ""
    );

    let missing_content = host
        .handle_host_callback(
            "openforge.fs.writeFile",
            &json!({ "projectId": project.id, "path": "generated.txt" }),
        )
        .await
        .expect_err("missing project file content should fail");
    assert_eq!(
        missing_content,
        "plugin host callback missing string param: content"
    );
}

#[tokio::test]
async fn host_filesystem_callbacks_scope_user_data_and_external_reads() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let external_root = tempfile::tempdir().expect("external root");
    let sessions_dir = external_root.path().join("2026");
    std::fs::create_dir(&sessions_dir).expect("sessions dir");
    let session_content = "{}\n".repeat(400_000);
    std::fs::write(sessions_dir.join("session.jsonl"), &session_content).expect("session fixture");
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

    let external_dir = host
        .handle_host_callback(
            "openforge.fs.external.readDir",
            &json!({ "pluginId": "skill-usage", "root": external_root.path(), "path": "2026" }),
        )
        .await
        .expect("read external directory");
    assert_eq!(external_dir[0]["path"], "2026/session.jsonl");

    let external_file = host
        .handle_host_callback(
            "openforge.fs.external.readTextFile",
            &json!({ "pluginId": "skill-usage", "root": external_root.path(), "path": "2026/session.jsonl" }),
        )
        .await
        .expect("read external file");
    assert_eq!(external_file.as_str(), Some(session_content.as_str()));
}

#[tokio::test]
async fn host_filesystem_callbacks_reject_paths_outside_the_selected_root() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let external_parent = tempfile::tempdir().expect("external parent");
    let external_root = external_parent.path().join("sessions");
    std::fs::create_dir(&external_root).expect("external root");
    std::fs::write(external_parent.path().join("secret.txt"), "secret").expect("outside fixture");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);

    let relative_root = host
        .handle_host_callback(
            "openforge.fs.external.readDir",
            &json!({ "pluginId": "skill-usage", "root": "." }),
        )
        .await
        .expect_err("relative external root should fail");
    assert!(relative_root.contains("root must be absolute"));

    let external_traversal = host
        .handle_host_callback(
            "openforge.fs.external.readTextFile",
            &json!({ "pluginId": "skill-usage", "root": external_root, "path": "../secret.txt" }),
        )
        .await
        .expect_err("external traversal should fail");
    assert!(external_traversal.contains("Path traversal detected"));

    let user_data_traversal = host
        .handle_host_callback(
            "openforge.fs.userData.writeTextFile",
            &json!({ "pluginId": "skill-usage", "path": "../escape.txt", "content": "no" }),
        )
        .await
        .expect_err("user data traversal should fail");
    assert!(user_data_traversal.contains("Path traversal detected"));

    let invalid_plugin_id = host
        .handle_host_callback(
            "openforge.fs.userData.writeTextFile",
            &json!({ "pluginId": "../other-plugin", "path": "escape.txt", "content": "no" }),
        )
        .await
        .expect_err("invalid plugin id should fail");
    assert!(invalid_plugin_id.contains("invalid pluginId"));
}
