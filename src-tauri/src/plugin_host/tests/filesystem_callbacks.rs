use super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_filesystem_callbacks_route_to_project_services() {
    let (database, _temp_dir) =
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
async fn host_filesystem_callbacks_stream_external_text_in_byte_bounded_chunks() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let external_root = tempfile::tempdir().expect("external root");
    let content = "ab🙂cd\n";
    std::fs::write(external_root.path().join("session.jsonl"), content).expect("session fixture");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);
    let mut offset = 0;
    let mut reconstructed = String::new();

    loop {
        let chunk = host
            .handle_host_callback(
                "openforge.fs.external.readTextFileChunk",
                &json!({
                    "pluginId": "skill-usage",
                    "root": external_root.path(),
                    "path": "session.jsonl",
                    "offset": offset,
                    "maxBytes": 4,
                }),
            )
            .await
            .expect("read external text chunk");
        let chunk_content = chunk["content"].as_str().expect("chunk content");
        assert!(chunk_content.len() <= 4);
        reconstructed.push_str(chunk_content);
        offset = chunk["nextOffset"].as_u64().expect("next offset");
        if chunk["eof"].as_bool().expect("eof flag") {
            break;
        }
    }

    assert_eq!(reconstructed, content);
    assert_eq!(offset, content.len() as u64);
}

#[tokio::test]
async fn host_filesystem_callbacks_stat_and_identity_bind_external_ranges() {
    let app_data_dir = tempfile::tempdir().expect("app data dir");
    let resource_dir = tempfile::tempdir().expect("resource dir");
    let external_root = tempfile::tempdir().expect("external root");
    let path = external_root.path().join("collector.jsonl");
    std::fs::write(&path, "old\nab🙂cd\n").expect("collector fixture");
    let app = AppHandle::with_app_paths(
        app_data_dir.path().to_path_buf(),
        resource_dir.path().to_path_buf(),
    );
    let host = PluginHost::new(app);

    let first_stat = host
        .handle_host_callback(
            "openforge.fs.external.stat",
            &json!({
                "pluginId": "skill-usage",
                "root": external_root.path(),
                "path": "collector.jsonl",
            }),
        )
        .await
        .expect("stat external file");
    let second_stat = host
        .handle_host_callback(
            "openforge.fs.external.stat",
            &json!({
                "pluginId": "skill-usage",
                "root": external_root.path(),
                "path": "collector.jsonl",
            }),
        )
        .await
        .expect("stat external file again");
    assert_eq!(first_stat, second_stat);
    assert_eq!(first_stat["sizeBytes"], 13);
    assert!(first_stat["identity"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert!(first_stat["modifiedAtMs"].as_u64().is_some());

    let chunk = host
        .handle_host_callback(
            "openforge.fs.external.readTextFileChunk",
            &json!({
                "pluginId": "skill-usage",
                "root": external_root.path(),
                "path": "collector.jsonl",
                "expectedIdentity": first_stat["identity"],
                "offset": 4,
                "maxBytes": 6,
            }),
        )
        .await
        .expect("read identity-bound range");
    assert_eq!(chunk["content"], "ab🙂");
    assert_eq!(chunk["nextOffset"], 10);
    assert_eq!(chunk["eof"], false);

    let stale_identity = host
        .handle_host_callback(
            "openforge.fs.external.readTextFileChunk",
            &json!({
                "pluginId": "skill-usage",
                "root": external_root.path(),
                "path": "collector.jsonl",
                "expectedIdentity": "stale",
                "offset": 4,
                "maxBytes": 6,
            }),
        )
        .await
        .expect_err("stale identity should fail");
    assert!(stale_identity.contains("external file identity changed"));
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

    let external_stat_traversal = host
        .handle_host_callback(
            "openforge.fs.external.stat",
            &json!({ "pluginId": "skill-usage", "root": &external_root, "path": "../secret.txt" }),
        )
        .await
        .expect_err("external stat traversal should fail");
    assert!(external_stat_traversal.contains("Path traversal detected"));

    let external_chunk_traversal = host
        .handle_host_callback(
            "openforge.fs.external.readTextFileChunk",
            &json!({
                "pluginId": "skill-usage",
                "root": &external_root,
                "path": "../secret.txt",
                "offset": 0,
                "maxBytes": 4,
            }),
        )
        .await
        .expect_err("external chunk traversal should fail");
    assert!(external_chunk_traversal.contains("Path traversal detected"));

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            external_parent.path().join("secret.txt"),
            external_root.join("linked-secret.txt"),
        )
        .expect("outside-root symlink fixture");
        let external_chunk_symlink = host
            .handle_host_callback(
                "openforge.fs.external.readTextFileChunk",
                &json!({
                    "pluginId": "skill-usage",
                    "root": &external_root,
                    "path": "linked-secret.txt",
                    "offset": 0,
                    "maxBytes": 4,
                }),
            )
            .await
            .expect_err("external chunk symlink escape should fail");
        assert!(external_chunk_symlink.contains("Path traversal detected"));
        let external_stat_symlink = host
            .handle_host_callback(
                "openforge.fs.external.stat",
                &json!({
                    "pluginId": "skill-usage",
                    "root": &external_root,
                    "path": "linked-secret.txt",
                }),
            )
            .await
            .expect_err("external stat symlink escape should fail");
        assert!(external_stat_symlink.contains("Path traversal detected"));
    }

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
