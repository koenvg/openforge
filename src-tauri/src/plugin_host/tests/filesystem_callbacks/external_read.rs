use super::super::super::*;
use serde_json::json;

#[tokio::test]
async fn host_filesystem_callbacks_scope_external_reads() {
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
async fn host_filesystem_callbacks_reject_external_paths_outside_the_selected_root() {
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
}
