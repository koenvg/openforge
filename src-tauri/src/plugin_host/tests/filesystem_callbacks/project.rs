use super::super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn project_and_task_image_preview_callbacks_return_metadata_above_limit() {
    let (database, _db_dir) = crate::db::test_helpers::make_test_db("plugin_image_preview_limits");
    let project_dir = tempfile::tempdir().expect("project dir");
    let workspace_dir = tempfile::tempdir().expect("workspace dir");
    let project = database
        .create_project("Image limits", project_dir.path().to_str().unwrap())
        .expect("project fixture");
    let task = database
        .create_task("Image limits", "doing", Some(&project.id), None, None)
        .expect("task fixture");
    database
        .create_task_workspace_record(
            &task.id,
            &project.id,
            workspace_dir.path().to_str().unwrap(),
            project_dir.path().to_str().unwrap(),
            "git_worktree",
            Some("image-limits"),
            "pi",
        )
        .expect("workspace fixture");
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    for (method, payload, root, size) in [
        (
            "openforge.fs.readFile",
            json!({ "projectId": project.id, "path": "image.png" }),
            project_dir.path(),
            26_214_401,
        ),
        (
            "openforge.fs.task.readFile",
            json!({ "taskId": task.id, "path": "image.png" }),
            workspace_dir.path(),
            26_214_402,
        ),
    ] {
        let path = root.join("image.png");
        std::fs::File::create(&path)
            .expect("image fixture")
            .set_len(size)
            .expect("oversized image");
        let oversized = host
            .handle_host_callback(method, &payload)
            .await
            .expect("oversized image callback");
        assert_eq!(
            oversized,
            json!({ "type": "large-file", "content": "", "mimeType": "image/png", "size": size }),
        );

        std::fs::write(&path, [0_u8, 1, 2, 3]).expect("small image");
        let small = host
            .handle_host_callback(method, &payload)
            .await
            .expect("small image callback");
        assert_eq!(
            small,
            json!({ "type": "image", "content": "AAECAw==", "mimeType": "image/png", "size": 4 }),
        );
    }
}

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
    #[cfg(unix)]
    let _outside_dir = {
        use std::os::unix::ffi::OsStrExt;

        let outside_dir = tempfile::tempdir().expect("outside dir");
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, "outside").expect("outside fixture");
        std::fs::write(project_dir.path().join("actual.txt"), "inside").expect("inside fixture");
        std::os::unix::fs::symlink("actual.txt", project_dir.path().join("linked.txt"))
            .expect("inside symlink");
        std::os::unix::fs::symlink(&outside_file, project_dir.path().join("escape.txt"))
            .expect("outside symlink");
        let fifo = project_dir.path().join("preview.txt");
        let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_bytes()).expect("fifo path");
        // SAFETY: fifo_path is NUL-terminated and the mode is a valid permission mask.
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
        outside_dir
    };
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

    #[cfg(unix)]
    {
        let linked = host
            .handle_host_callback(
                "openforge.fs.readFile",
                &json!({ "projectId": project.id, "path": "linked.txt" }),
            )
            .await
            .expect("inside-root symlink remains readable");
        assert_eq!(linked["content"], "inside");

        let outside = host
            .handle_host_callback(
                "openforge.fs.readFile",
                &json!({ "projectId": project.id, "path": "escape.txt" }),
            )
            .await
            .expect_err("outside-root symlink must fail");
        assert!(outside.contains("Path traversal detected"));

        let special = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            host.handle_host_callback(
                "openforge.fs.readFile",
                &json!({ "projectId": project.id, "path": "preview.txt" }),
            ),
        )
        .await
        .expect("special-file rejection must not wait for a writer")
        .expect_err("special file must fail");
        assert!(special.contains("not a regular file"));
    }
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
async fn project_document_callback_returns_ready_and_unavailable_without_changing_metadata() {
    let (database, _db_dir) = crate::db::test_helpers::make_test_db("document_callback");
    let root = tempfile::tempdir().unwrap();
    let project = database
        .create_project("PDF", root.path().to_str().unwrap())
        .unwrap();
    std::fs::write(root.path().join("a.pdf"), b"%PDF-1.7").unwrap();
    std::fs::write(root.path().join("empty.pdf"), b"").unwrap();
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);
    let request = json!({"projectId": project.id, "path": "a.pdf"});
    let document = host
        .handle_host_callback("openforge.fs.readDocument", &request)
        .await
        .unwrap();
    assert_eq!(document["status"], "ready");
    assert_eq!(document["data"], "JVBERi0xLjc=");
    assert_eq!(document["size"], 8);
    let metadata = host
        .handle_host_callback("openforge.fs.readFile", &request)
        .await
        .unwrap();
    assert_eq!(metadata["content"], "");
    assert_eq!(metadata["type"], "document");
    let unavailable = host
        .handle_host_callback(
            "openforge.fs.readDocument",
            &json!({"projectId": project.id, "path": "empty.pdf"}),
        )
        .await
        .unwrap();
    assert_eq!(
        unavailable,
        json!({"status":"unavailable", "reason":"invalid-document", "size":0,"maxBytes":16_777_216})
    );
    let error = host
        .handle_host_callback(
            "openforge.fs.readDocument",
            &json!({"projectId": project.id, "path": "../a.pdf"}),
        )
        .await
        .unwrap_err();
    assert!(error.starts_with("DOCUMENT_PREVIEW_BAD_REQUEST:"));
}
