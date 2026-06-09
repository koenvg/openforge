use super::lifecycle::{
    resolve_entrypoint, BUN_PATH_ENV, ENTRYPOINT_ENV, SIDECAR_EXITED_EVENT, SIDECAR_FAILED_EVENT,
};
use super::*;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tempfile::tempdir;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static PLUGIN_HOST_ENV_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

struct EnvVarRestore {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarRestore {
    fn set_path(key: &'static str, value: &std::path::Path) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }

    fn remove(key: &'static str) -> Self {
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        Self { key, previous }
    }
}

impl Drop for EnvVarRestore {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

async fn lock_plugin_host_env() -> tokio::sync::MutexGuard<'static, ()> {
    PLUGIN_HOST_ENV_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

fn build_plugin_host() -> PluginHost {
    PluginHost::new(AppHandle::new())
}

#[tokio::test]
async fn resolve_entrypoint_prefers_packaged_resource_bundle_over_source_and_legacy_app_data() {
    let temp = tempdir().expect("tempdir should create");
    let resource_dir = temp.path().join("resources");
    let app_data_dir = temp.path().join("app-data");
    let bundled_entrypoint = resource_dir.join("plugin-host").join("index.js");
    let legacy_app_data_entrypoint = app_data_dir.join("plugin-host").join("index.ts");
    fs::create_dir_all(
        bundled_entrypoint
            .parent()
            .expect("resource parent should exist"),
    )
    .expect("resource dir should create");
    fs::create_dir_all(
        legacy_app_data_entrypoint
            .parent()
            .expect("app data parent should exist"),
    )
    .expect("app data dir should create");
    fs::write(&bundled_entrypoint, "console.log('bundled plugin host')")
        .expect("bundled entrypoint should write");
    fs::write(
        &legacy_app_data_entrypoint,
        "console.log('legacy plugin host')",
    )
    .expect("legacy entrypoint should write");

    let _env_lock = lock_plugin_host_env().await;
    let _entrypoint_env = EnvVarRestore::remove(ENTRYPOINT_ENV);
    let app = AppHandle::with_app_paths(app_data_dir, resource_dir);

    assert_eq!(
        resolve_entrypoint(&app).expect("entrypoint should resolve"),
        bundled_entrypoint
    );
}

#[tokio::test]
async fn host_storage_callback_round_trips_through_plugin_storage_table() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_storage_callback");
    for plugin_id in ["backend-plugin", "other-plugin"] {
        database
            .install_plugin(&crate::db::PluginRow {
                id: plugin_id.to_string(),
                name: plugin_id.to_string(),
                version: "1.0.0".to_string(),
                api_version: 1,
                description: String::new(),
                permissions: "[]".to_string(),
                contributes: "{}".to_string(),
                frontend_entry: "index.js".to_string(),
                backend_entry: None,
                install_path: "/tmp/plugin".to_string(),
                source_kind: "test".to_string(),
                source_spec: plugin_id.to_string(),
                package_metadata: "{}".to_string(),
                installed_at: 0,
                is_builtin: false,
            })
            .expect("install plugin fixture");
    }
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app);

    host.handle_host_callback(
        "openforge.storage.set",
        &json!({
            "pluginId": "backend-plugin",
            "scope": "project",
            "scopeId": "P-1",
            "key": "repo",
            "value": { "owner": "acme" }
        }),
    )
    .await
    .expect("set storage callback");

    let value = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "backend-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get storage callback");
    assert_eq!(value, json!({ "owner": "acme" }));

    let isolated = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "other-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get isolated storage callback");
    assert_eq!(isolated, Value::Null);

    host.handle_host_callback(
        "openforge.storage.delete",
        &json!({
            "pluginId": "backend-plugin",
            "scope": "project",
            "scopeId": "P-1",
            "key": "repo"
        }),
    )
    .await
    .expect("delete storage callback");

    let deleted = host
        .handle_host_callback(
            "openforge.storage.get",
            &json!({
                "pluginId": "backend-plugin",
                "scope": "project",
                "scopeId": "P-1",
                "key": "repo"
            }),
        )
        .await
        .expect("get deleted storage callback");
    assert_eq!(deleted, Value::Null);
}

#[tokio::test]
async fn host_core_callbacks_route_to_app_services() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_core_callbacks");
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
    database
        .set_config("theme", "light")
        .expect("config fixture");
    database
        .set_project_config(&project.id, "github_default_repo", "acme/old")
        .expect("project config fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    app.manage(crate::pty_manager::PtyManager::new());
    let host = PluginHost::new(app);

    let projects = host
        .handle_host_callback("openforge.projects.list", &Value::Null)
        .await
        .expect("list projects callback");
    assert_eq!(projects.as_array().expect("projects").len(), 1);

    let project_value = host
        .handle_host_callback(
            "openforge.projects.get",
            &json!({ "projectId": project.id }),
        )
        .await
        .expect("get project callback");
    assert_eq!(project_value["name"], "Plugin Host");

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

    assert_eq!(
        host.handle_host_callback("openforge.attention.listProjects", &Value::Null)
            .await
            .expect("attention callback"),
        json!([])
    );
    assert_eq!(
        host.handle_host_callback("openforge.config.get", &json!({ "key": "theme" }))
            .await
            .expect("config get callback"),
        json!("light")
    );
    host.handle_host_callback(
        "openforge.config.set",
        &json!({ "key": "theme", "value": "dark" }),
    )
    .await
    .expect("config set callback");
    assert_eq!(
        host.handle_host_callback(
            "openforge.projectConfig.get",
            &json!({ "projectId": project.id, "key": "github_default_repo" }),
        )
        .await
        .expect("project config get callback"),
        json!("acme/old")
    );
    host.handle_host_callback(
        "openforge.projectConfig.set",
        &json!({ "projectId": project.id, "key": "github_default_repo", "value": "acme/new" }),
    )
    .await
    .expect("project config set callback");
    assert_eq!(
        host.handle_host_callback(
            "openforge.system.openUrl",
            &json!({ "url": "https://example.com" })
        )
        .await
        .expect("open url callback"),
        Value::Null
    );
    assert_eq!(
        host.handle_host_callback(
            "openforge.notifications.notify",
            &json!({ "title": "Done" })
        )
        .await
        .expect("notification callback"),
        Value::Null
    );
}

#[tokio::test]
async fn plugin_host_global_command_callback_routes_github_sync_backend_bridge() {
    let (database, _path) = crate::db::test_helpers::make_test_db(
        "plugin_host_global_command_github_sync_bridge",
    );
    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app.clone());

    let review_prs = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({ "qualifiedId": "openforge.getReviewPrs", "payload": null }),
        )
        .await
        .expect("global command callback");
    assert_eq!(review_prs, json!([]));

    let unsupported = host
        .handle_host_callback(
            "openforge.commands.invokeGlobal",
            &json!({ "qualifiedId": "openforge.notAGithubSyncCommand", "payload": null }),
        )
        .await
        .expect_err("unsupported global command should fail");
    assert!(unsupported.contains("unsupported plugin host global command id"));
}

#[tokio::test]
async fn plugin_host_task_callbacks_create_start_and_read_state() {
    let (database, _path) = crate::db::test_helpers::make_test_db("plugin_host_task_callbacks");
    let project_dir = tempfile::tempdir().expect("project dir");
    let project = database
        .create_project("Plugin Tasks", &project_dir.path().to_string_lossy())
        .expect("project fixture");
    let dependency = database
        .create_task("Dependency", "done", Some(&project.id), None, None)
        .expect("dependency fixture");

    let app = AppHandle::new();
    app.manage(Arc::new(Mutex::new(database)));
    let host = PluginHost::new(app.clone());

    let created = host
        .handle_host_callback(
            "openforge.tasks.create",
            &json!({
                "initialPrompt": "Scheduled backend task",
                "projectId": project.id,
                "dependsOn": [dependency.id],
                "labelNames": ["scheduled"]
            }),
        )
        .await
        .expect("task create callback");
    let task_id = created["id"].as_str().expect("created task id").to_string();
    assert_eq!(created["initial_prompt"], "Scheduled backend task");
    assert_eq!(created["status"], "backlog");
    assert_eq!(created["project_id"], project.id);
    assert_eq!(created["depends_on"], json!([dependency.id]));
    assert_eq!(created["labels"][0]["name"], "scheduled");

    let project_tasks = host
        .handle_host_callback("openforge.tasks.list", &json!({ "projectId": project.id }))
        .await
        .expect("task list callback");
    assert!(project_tasks
        .as_array()
        .expect("project tasks")
        .iter()
        .any(|task| task["id"] == task_id));

    let fetched = host
        .handle_host_callback("openforge.tasks.get", &json!({ "taskId": task_id }))
        .await
        .expect("task get callback");
    assert_eq!(fetched["id"], task_id);

    assert_eq!(
        host.handle_host_callback(
            "openforge.tasks.updateSummary",
            &json!({ "taskId": task_id, "summary": "Scheduler handoff" }),
        )
        .await
        .expect("task summary callback"),
        Value::Null
    );
    assert_eq!(
        host.handle_host_callback(
            "openforge.tasks.updateStatus",
            &json!({ "taskId": task_id, "status": "doing" }),
        )
        .await
        .expect("task status callback"),
        Value::Null
    );

    {
        let db_state = app
            .try_state::<Arc<Mutex<crate::db::Database>>>()
            .expect("database state");
        let db = crate::db::acquire_db(db_state.inner().as_ref());
        let task = db
            .get_task(&task_id)
            .expect("get updated task")
            .expect("task exists");
        assert_eq!(task.summary.as_deref(), Some("Scheduler handoff"));
        assert_eq!(task.status, "doing");
        db.create_task_workspace_record(
            &task_id,
            &project.id,
            project_dir.path().to_str().expect("workspace path"),
            project_dir.path().to_str().expect("repo path"),
            "project_dir",
            None,
            "pi",
        )
        .expect("workspace fixture");
        db.create_agent_session(
            "session-1",
            &task_id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("session fixture");
    }

    let workspace = host
        .handle_host_callback(
            "openforge.tasks.getWorkspace",
            &json!({ "taskId": task_id }),
        )
        .await
        .expect("workspace callback");
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(
        workspace["workspace_path"],
        project_dir.path().to_string_lossy().as_ref()
    );

    let latest_session = host
        .handle_host_callback(
            "openforge.tasks.getLatestSession",
            &json!({ "taskId": task_id }),
        )
        .await
        .expect("latest session callback");
    assert_eq!(latest_session["id"], "session-1");
    assert_eq!(latest_session["ticket_id"], task_id);

    let start_error = host
        .handle_host_callback(
            "openforge.tasks.startImplementation",
            &json!({ "taskId": task_id }),
        )
        .await
        .expect_err("start should route through app lifecycle and report unavailable PTY manager");
    assert!(
        start_error.contains("PTY manager is not available"),
        "unexpected start error: {start_error}"
    );
}

#[test]
fn new_host_starts_stopped() {
    let host = build_plugin_host();

    assert_eq!(host.get_state(), SidecarState::Stopped);
    assert!(!host.is_sidecar_running());
}

#[test]
fn stop_transition_reaches_stopped() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);
    host.mark_stopping_for_test();
    assert_eq!(host.get_state(), SidecarState::Stopping);

    host.complete_stop_for_test();
    assert_eq!(host.get_state(), SidecarState::Stopped);
    assert!(!host.is_sidecar_running());
}

#[test]
fn unexpected_exit_marks_host_crashed() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);

    let delay = host.handle_unexpected_exit_for_test();

    assert_eq!(host.get_state(), SidecarState::Crashed);
    assert_eq!(delay, Some(Duration::from_secs(1)));
}

#[test]
fn retries_use_exponential_backoff_then_stop() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);

    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(1))
    );
    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(2))
    );
    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(4))
    );
    assert_eq!(host.handle_unexpected_exit_for_test(), None);
    assert_eq!(host.get_state(), SidecarState::Crashed);
}

#[test]
fn health_check_depends_on_running_state() {
    let host = build_plugin_host();

    assert!(!host.is_sidecar_running());

    host.mark_running_for_test(1234);

    assert!(host.is_sidecar_running());
}

#[test]
fn sidecar_lifecycle_events_publish_to_backend_app_event_stream() {
    let (sender, mut receiver) = tokio::sync::broadcast::channel(8);
    let host = PluginHost::with_app_event_sender(AppHandle::new(), Some(sender));

    host.mark_running_for_test(4321);
    host.emit_sidecar_exited(Some(1), None, Some(4321));
    host.emit_sidecar_failed(Some("boom".to_string()));

    let exited = receiver.try_recv().expect("exit event should publish");
    assert_eq!(exited.event_name, SIDECAR_EXITED_EVENT);
    assert_eq!(exited.payload["code"], 1);
    assert_eq!(exited.payload["pid"], 4321);

    let failed = receiver.try_recv().expect("failure event should publish");
    assert_eq!(failed.event_name, SIDECAR_FAILED_EVENT);
    assert_eq!(failed.payload["error"], "boom");
}

#[tokio::test]
async fn invoke_backend_round_trips_through_real_sidecar_stdio() {
    let temp = tempdir().expect("tempdir should create");
    let sidecar_path = temp.path().join("sidecar.cjs");
    let backend_path = temp.path().join("backend.mjs");
    let bun_shim_path = temp.path().join("bun-shim");

    fs::write(
        &sidecar_path,
        r#"const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const backends = new Map();
async function loadBackend(path) {
  if (backends.has(path)) return backends.get(path);
  const mod = await import(pathToFileURL(path).href);
  backends.set(path, mod);
  return mod;
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const mod = await loadBackend(request.params.backendPath);
  const result = await mod[request.params.command](request.params.payload);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
rl.on('close', () => process.exit(0));"#,
    )
    .expect("sidecar should write");
    fs::write(
        &backend_path,
        "export async function ping(payload) { return { echoed: payload.message }; }",
    )
    .expect("backend should write");
    fs::write(
        &bun_shim_path,
        "#!/bin/sh\nif [ \"$1\" = \"run\" ]; then shift; fi\nexec node \"$@\"\n",
    )
    .expect("bun shim should write");
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&bun_shim_path)
            .expect("metadata should read")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&bun_shim_path, permissions).expect("permissions should set");
    }

    let _env_lock = lock_plugin_host_env().await;
    let _bun_env = EnvVarRestore::set_path(BUN_PATH_ENV, &bun_shim_path);
    let _entrypoint_env = EnvVarRestore::set_path(ENTRYPOINT_ENV, &sidecar_path);

    let host = build_plugin_host();
    host.start_sidecar().await.expect("sidecar should start");
    let result = host
        .invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "hello" }),
        )
        .await
        .expect("invoke should succeed");
    host.stop_sidecar().await.expect("sidecar should stop");

    assert_eq!(result["echoed"], "hello");
}

#[tokio::test]
async fn concurrent_first_invoke_calls_wait_for_transport_readiness() {
    let temp = tempdir().expect("tempdir should create");
    let sidecar_path = temp.path().join("sidecar.cjs");
    let backend_path = temp.path().join("backend.mjs");
    let bun_shim_path = temp.path().join("bun-shim");

    fs::write(
        &sidecar_path,
        r#"const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const backends = new Map();
async function loadBackend(path) {
  if (backends.has(path)) return backends.get(path);
  const mod = await import(pathToFileURL(path).href);
  backends.set(path, mod);
  return mod;
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const mod = await loadBackend(request.params.backendPath);
  const result = await mod[request.params.command](request.params.payload);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
rl.on('close', () => process.exit(0));"#,
    )
    .expect("sidecar should write");
    fs::write(
        &backend_path,
        "export async function ping(payload) { return { echoed: payload.message }; }",
    )
    .expect("backend should write");
    fs::write(
        &bun_shim_path,
        "#!/bin/sh\nif [ \"$1\" = \"run\" ]; then shift; fi\nexec node \"$@\"\n",
    )
    .expect("bun shim should write");
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&bun_shim_path)
            .expect("metadata should read")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&bun_shim_path, permissions).expect("permissions should set");
    }

    let _env_lock = lock_plugin_host_env().await;
    let _bun_env = EnvVarRestore::set_path(BUN_PATH_ENV, &bun_shim_path);
    let _entrypoint_env = EnvVarRestore::set_path(ENTRYPOINT_ENV, &sidecar_path);

    let host = build_plugin_host();
    let (first, second) = tokio::join!(
        host.invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "hello" }),
        ),
        host.invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "world" }),
        )
    );
    host.stop_sidecar().await.expect("sidecar should stop");

    assert_eq!(
        first.expect("first invoke should succeed")["echoed"],
        "hello"
    );
    assert_eq!(
        second.expect("second invoke should succeed")["echoed"],
        "world"
    );
}
