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
