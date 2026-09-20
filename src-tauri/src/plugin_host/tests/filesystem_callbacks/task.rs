use super::super::super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn host_filesystem_callbacks_route_to_resolved_task_workspace() {
    let (database, _temp_dir) =
        crate::db::test_helpers::make_test_db("plugin_host_task_filesystem_callbacks");
    let project_dir = tempfile::tempdir().expect("project dir");
    let container = tempfile::tempdir().expect("workspace container");
    let workspace_path = container.path().join("workspace");
    std::fs::create_dir_all(workspace_path.join("src")).expect("create workspace src");
    std::fs::write(
        workspace_path.join("src/main.ts"),
        "export const task = true",
    )
    .expect("write source fixture");
    std::fs::write(workspace_path.join("image.png"), [0x89, b'P', b'N', b'G'])
        .expect("write image fixture");
    std::fs::write(project_dir.path().join("README.md"), "project checkout")
        .expect("write project fixture");
    std::fs::write(container.path().join("secret.txt"), "outside")
        .expect("write traversal fixture");
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;

        std::fs::write(workspace_path.join("actual.txt"), "inside").expect("inside fixture");
        std::os::unix::fs::symlink("actual.txt", workspace_path.join("linked.txt"))
            .expect("inside symlink");
        std::os::unix::fs::symlink(
            container.path().join("secret.txt"),
            workspace_path.join("escape.txt"),
        )
        .expect("outside symlink");
        let fifo = workspace_path.join("preview.txt");
        let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_bytes()).expect("fifo path");
        // SAFETY: fifo_path is NUL-terminated and the mode is a valid permission mask.
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
    }
    let repo = git2::Repository::init(&workspace_path).expect("init workspace repo");
    let mut index = repo.index().expect("workspace index");
    index
        .add_path(std::path::Path::new("src/main.ts"))
        .expect("add source fixture");
    index.write().expect("write workspace index");

    let project = database
        .create_project("Plugin Host", &project_dir.path().to_string_lossy())
        .expect("project fixture");
    let task = database
        .create_task("Workspace files", "doing", Some(&project.id), None, None)
        .expect("task fixture");
    database
        .create_task_workspace_record(
            &task.id,
            &project.id,
            workspace_path.to_str().expect("workspace path is UTF-8"),
            project_dir.path().to_str().expect("project path is UTF-8"),
            "git_worktree",
            Some("task-files"),
            "pi",
        )
        .expect("task workspace fixture");
    let invalid_search_task = database
        .create_task(
            "Invalid search workspace",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("invalid search task fixture");
    database
        .create_task_workspace_record(
            &invalid_search_task.id,
            &project.id,
            project_dir.path().to_str().expect("project path is UTF-8"),
            project_dir.path().to_str().expect("project path is UTF-8"),
            "git_worktree",
            Some("invalid-search"),
            "pi",
        )
        .expect("invalid search workspace fixture");
    let missing_workspace_task = database
        .create_task("Missing workspace", "doing", Some(&project.id), None, None)
        .expect("missing workspace task fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    let dir = host
        .handle_host_callback(
            "openforge.fs.task.readDir",
            &json!({ "taskId": task.id, "path": "src" }),
        )
        .await
        .expect("read task dir callback");
    assert!(dir
        .as_array()
        .expect("task dir entries")
        .iter()
        .any(|entry| entry["name"] == "main.ts"));

    let file = host
        .handle_host_callback(
            "openforge.fs.task.readFile",
            &json!({ "taskId": task.id, "path": "image.png" }),
        )
        .await
        .expect("read task file callback");
    assert_eq!(file["type"], "image");
    assert_eq!(file["mimeType"], "image/png");

    #[cfg(unix)]
    {
        let linked = host
            .handle_host_callback(
                "openforge.fs.task.readFile",
                &json!({ "taskId": task.id, "path": "linked.txt" }),
            )
            .await
            .expect("inside-root symlink remains readable");
        assert_eq!(linked["content"], "inside");

        let outside = host
            .handle_host_callback(
                "openforge.fs.task.readFile",
                &json!({ "taskId": task.id, "path": "escape.txt" }),
            )
            .await
            .expect_err("outside-root symlink must fail");
        assert!(outside.contains("Path traversal detected"));

        let special = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            host.handle_host_callback(
                "openforge.fs.task.readFile",
                &json!({ "taskId": task.id, "path": "preview.txt" }),
            ),
        )
        .await
        .expect("special-file rejection must not wait for a writer")
        .expect_err("special file must fail");
        assert!(special.contains("not a regular file"));
    }
    let search = host
        .handle_host_callback(
            "openforge.fs.task.searchFiles",
            &json!({ "taskId": task.id, "query": "main", "limit": 5 }),
        )
        .await
        .expect("search task files callback");
    assert_eq!(search, json!(["src/main.ts"]));

    let missing_workspace = host
        .handle_host_callback(
            "openforge.fs.task.readFile",
            &json!({ "taskId": missing_workspace_task.id, "path": "README.md" }),
        )
        .await
        .expect_err("missing Task workspace must not fall back to Project checkout");
    assert!(missing_workspace.contains("No workspace found"));

    let invalid_search = host
        .handle_host_callback(
            "openforge.fs.task.searchFiles",
            &json!({ "taskId": invalid_search_task.id, "query": "readme", "limit": 5 }),
        )
        .await
        .expect_err("invalid Task workspace repository must fail search");
    assert!(invalid_search.contains("Failed to search Task workspace repository"));

    let traversal = host
        .handle_host_callback(
            "openforge.fs.task.readFile",
            &json!({ "taskId": task.id, "path": "../secret.txt" }),
        )
        .await
        .expect_err("task workspace traversal must fail");
    assert!(traversal.contains("Path traversal detected"));
}

#[cfg(unix)]
#[tokio::test]
async fn task_document_callback_returns_exact_limit_bytes_and_sanitized_failures() {
    use base64::Engine;
    let (database, _db_dir) = crate::db::test_helpers::make_test_db("task_document_callback");
    let project_root = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let project = database
        .create_project("PDF", project_root.path().to_str().unwrap())
        .unwrap();
    let task = database
        .create_task("PDF", "doing", Some(&project.id), None, None)
        .unwrap();
    database
        .create_task_workspace_record(
            &task.id,
            &project.id,
            root.path().to_str().unwrap(),
            project_root.path().to_str().unwrap(),
            "git_worktree",
            None,
            "pi",
        )
        .unwrap();
    std::fs::write(project_root.path().join("max.PDF"), b"%PDF-project").unwrap();
    let mut bytes = vec![42; 16_777_216];
    bytes[..8].copy_from_slice(b"%PDF-1.7");
    std::fs::write(root.path().join("max.PDF"), &bytes).unwrap();
    std::fs::write(root.path().join("empty.pdf"), b"").unwrap();
    std::os::unix::fs::symlink("max.PDF", root.path().join("link.pdf")).unwrap();
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);
    let result = host
        .handle_host_callback(
            "openforge.fs.task.readDocument",
            &json!({"taskId": task.id, "path": "max.PDF"}),
        )
        .await
        .unwrap();
    assert_eq!(result["size"], 16_777_216);
    assert_eq!(result["data"].as_str().unwrap().len(), 22_369_624);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(result["data"].as_str().unwrap())
            .unwrap(),
        bytes
    );
    let unavailable = host
        .handle_host_callback(
            "openforge.fs.task.readDocument",
            &json!({"taskId": task.id, "path": "empty.pdf"}),
        )
        .await
        .unwrap();
    assert_eq!(
        unavailable,
        json!({"status":"unavailable","reason":"invalid-document","size":0,"maxBytes":16_777_216})
    );
    for (request, prefix) in [
        (
            json!({"taskId": task.id, "path":"link.pdf"}),
            "DOCUMENT_PREVIEW_FORBIDDEN:",
        ),
        (
            json!({"taskId": task.id, "path":"missing.pdf"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"taskId":"missing", "path":"max.PDF"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"task_id":task.id, "path":"max.PDF"}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
        (
            json!({"taskId":task.id, "path":"max.PDF", "root":project.path}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
    ] {
        let error = host
            .handle_host_callback("openforge.fs.task.readDocument", &request)
            .await
            .unwrap_err();
        assert!(error.starts_with(prefix), "{error}");
        assert!(!error.contains(root.path().to_str().unwrap()));
    }
}
