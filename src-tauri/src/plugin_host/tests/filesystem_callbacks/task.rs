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
