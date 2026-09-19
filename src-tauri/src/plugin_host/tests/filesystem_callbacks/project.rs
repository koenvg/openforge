use super::super::super::*;
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
