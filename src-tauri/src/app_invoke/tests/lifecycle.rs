use super::*;

#[tokio::test]
async fn resume_startup_sessions_command_is_compatibility_noop() {
    let (state, path) = test_state("app_invoke_resume_startup_sessions");
    let mut receiver = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    invoke_ok(&state, "resume_startup_sessions", json!({})).await;

    assert!(receiver.try_recv().is_err());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_agent_lifecycle_followups() {
    let (state, path) = test_state("app_invoke_agent_lifecycle_followups");
    let (pi_task_id, claude_task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
            .expect("create project");
        let pi_task = db
            .create_task("pi task", "doing", Some(&project.id), None, None)
            .expect("create pi task");
        let claude_task = db
            .create_task("claude task", "doing", Some(&project.id), None, None)
            .expect("create claude task");
        db.create_agent_session(
            "session-pi",
            &pi_task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.create_agent_session(
            "session-claude",
            &claude_task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create claude session");
        db.set_agent_session_pty_instance_id("session-claude", 7)
            .expect("store claude pty instance");
        (pi_task.id, claude_task.id)
    };

    let status = invoke_ok(
        &state,
        "get_session_status",
        json!({ "sessionId": "session-pi" }),
    )
    .await;
    assert_eq!(status["id"], "session-pi");
    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": claude_task_id, "success": false, "ptyInstanceId": 7 }),
    )
    .await;
    invoke_ok(
        &state,
        "abort_implementation",
        json!({ "taskId": pi_task_id }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-claude")
            .expect("get claude")
            .expect("claude exists")
            .status,
        "interrupted"
    );
    assert_eq!(
        db.get_agent_session("session-pi")
            .expect("get pi")
            .expect("pi exists")
            .status,
        "interrupted"
    );

    let _ = std::fs::remove_file(path);
}

use once_cell::sync::Lazy;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::Mutex as TokioMutex;

static PROVIDER_PATH_ENV_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));
static PROVIDER_TEST_SANDBOX: Lazy<ProviderTestSandbox> = Lazy::new(ProviderTestSandbox::new);

struct ProviderTestSandbox {
    _temp: tempfile::TempDir,
    bin_dir: PathBuf,
    log_path: PathBuf,
}

impl ProviderTestSandbox {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("provider sandbox should be created");
        let bin_dir = temp.path().join("bin");
        fs::create_dir(&bin_dir).expect("fake bin dir should be created");
        let log_path = temp.path().join("provider.log");
        install_fake_provider(&bin_dir, "pi", &log_path);
        install_fake_provider(&bin_dir, "opencode", &log_path);
        Self {
            _temp: temp,
            bin_dir,
            log_path,
        }
    }

    fn clear_log(&self) {
        let _ = fs::remove_file(&self.log_path);
    }
}

struct PathEnvGuard {
    original_path: Option<OsString>,
}

impl PathEnvGuard {
    fn prepend(path: &Path) -> Self {
        let original_path = std::env::var_os("PATH");
        let mut paths = vec![path.to_path_buf()];
        if let Some(original_path) = original_path.as_ref() {
            paths.extend(std::env::split_paths(original_path));
        }
        let joined = std::env::join_paths(paths).expect("test PATH should be joinable");
        std::env::set_var("PATH", joined);
        Self { original_path }
    }
}

impl Drop for PathEnvGuard {
    fn drop(&mut self) {
        match self.original_path.as_ref() {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
    }
}

fn install_fake_provider(bin_dir: &Path, command: &str, log_path: &Path) {
    let script = format!(
        "#!/bin/sh\n{{\n  printf 'provider={command}\\n'\n  printf 'cwd=%s\\n' \"$PWD\"\n  i=0\n  for arg in \"$@\"; do\n    i=$((i + 1))\n    printf 'arg%s=%s\\n' \"$i\" \"$arg\"\n  done\n}} >> '{}'\nexit 0\n",
        log_path.display()
    );
    let path = bin_dir.join(command);
    fs::write(&path, script).expect("fake provider should be written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .expect("fake provider should be executable");
    }
}

async fn wait_for_provider_log(log_path: &Path) -> String {
    for _ in 0..50 {
        if let Ok(contents) = fs::read_to_string(log_path) {
            if !contents.is_empty() {
                return contents;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!(
        "fake provider log should be written at {}",
        log_path.display()
    );
}

fn provider_repo_dir() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().expect("tempdir should succeed");
    let repo_dir = temp.path().join("repo");
    fs::create_dir(&repo_dir).expect("repo dir should be created");
    (temp, repo_dir)
}

#[tokio::test]
async fn start_implementation_starts_configured_pi_provider_through_app_invoke_boundary() {
    let _env_lock = PROVIDER_PATH_ENV_LOCK.lock().await;
    let (state, path) = test_state("app_invoke_start_pi_provider_boundary");
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let _path_guard = PathEnvGuard::prepend(&sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Pi Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("disable worktrees");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task(
            "Start through Pi provider",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(response["task_id"], task_id);
    assert_eq!(
        response["workspace_path"],
        repo_dir.to_string_lossy().as_ref()
    );
    assert_eq!(response["port"], 0);

    let log = wait_for_provider_log(&sandbox.log_path).await;
    assert!(log.contains("provider=pi"), "got provider log: {log}");
    let canonical_repo_dir = fs::canonicalize(&repo_dir).expect("repo dir should canonicalize");
    assert!(
        log.contains(&format!("cwd={}", canonical_repo_dir.display())),
        "got provider log: {log}"
    );
    assert!(
        log.contains("Start through Pi provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    let db = crate::db::acquire_db(&state.db);
    let task = db
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.status, "doing");
    let session = db
        .get_latest_session_for_ticket(&task_id)
        .expect("get latest session")
        .expect("session should be recorded");
    assert_eq!(session.provider, "pi");
    assert_eq!(session.status, "running");
    assert!(session.pty_instance_id.is_some());
    let workspace = db
        .get_task_workspace_for_task(&task_id)
        .expect("get task workspace")
        .expect("workspace should be recorded");
    assert_eq!(workspace.provider_name, "pi");
    assert_eq!(workspace.kind, "project_dir");
    assert_eq!(workspace.status, "active");
    drop(db);

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_passes_task_agent_to_configured_opencode_provider() {
    let _env_lock = PROVIDER_PATH_ENV_LOCK.lock().await;
    let (state, path) = test_state("app_invoke_start_opencode_agent_boundary");
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let _path_guard = PathEnvGuard::prepend(&sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "OpenCode Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("disable worktrees");
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set provider");
        let task = db
            .create_task(
                "Start through OpenCode provider",
                "backlog",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        let conn = db.connection();
        conn.lock()
            .expect("lock connection")
            .execute(
                "UPDATE tasks SET agent = ?1 WHERE id = ?2",
                rusqlite::params!["rust-specialist", &task.id],
            )
            .expect("set task agent");
        task.id
    };

    invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let log = wait_for_provider_log(&sandbox.log_path).await;
    assert!(log.contains("provider=opencode"), "got provider log: {log}");
    assert!(log.contains("arg1=--agent"), "got provider log: {log}");
    assert!(
        log.contains("arg2=rust-specialist"),
        "got provider log: {log}"
    );
    assert!(log.contains("--prompt"), "got provider log: {log}");
    assert!(
        log.contains("Start through OpenCode provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    let db = crate::db::acquire_db(&state.db);
    let session = db
        .get_latest_session_for_ticket(&task_id)
        .expect("get latest session")
        .expect("session should be recorded");
    assert_eq!(session.provider, "opencode");
    assert_eq!(session.status, "running");
    assert!(session.pty_instance_id.is_some());
    drop(db);

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_reports_missing_task() {
    let (state, path) = test_state("app_invoke_start_implementation");

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": "missing-task", "repoPath": "/tmp" }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_blocks_in_progress_start_claim() {
    let (state, path) = test_state("app_invoke_start_blocks_in_progress_claim");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Start Claim Project", "/tmp/openforge-start-claim")
            .expect("create project");
        db.create_task("Starting already", "backlog", Some(&project.id), None, None)
            .expect("create task")
            .id
    };
    let _claim = state
        .start_implementation_claims
        .try_claim(&task_id)
        .expect("first start claim should be acquired");
    let cloned_state = state.clone();
    assert!(cloned_state
        .start_implementation_claims
        .try_claim(&task_id)
        .is_none());

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("in-progress start should block duplicate start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("start in progress"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_blocks_active_agent_session() {
    let (state, path) = test_state("app_invoke_start_blocks_active_session");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Active Session Project", "/tmp/openforge-active-session")
            .expect("create project");
        let task = db
            .create_task("Already running", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "session-active",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create session");
        task.id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("active session should block duplicate start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("active agent session"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_blocks_unmet_dependencies() {
    let (state, path) = test_state("app_invoke_start_blocks_dependencies");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Dependency Project", "/tmp/openforge-dependencies")
            .expect("create project");
        let prerequisite = db
            .create_task("Prerequisite", "backlog", Some(&project.id), None, None)
            .expect("create prerequisite");
        let task = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.set_task_dependencies(&task.id, &[prerequisite.id])
            .expect("set dependency");
        task.id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("unmet dependency should block start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("not done"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_reports_invalid_workspace_cwd_as_bad_request() {
    let (state, path) = test_state("app_invoke_start_invalid_workspace_cwd");
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let missing_workspace = temp_dir.path().join("Missing Project");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Invalid Workspace Project",
                missing_workspace.to_str().expect("utf8 path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("disable worktrees");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task(
            "Start with missing cwd",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("create task")
        .id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": missing_workspace.to_string_lossy() }),
    )
    .await
    .expect_err("invalid workspace cwd should be rejected before spawning an agent PTY");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("workspace cwd") && err.1.contains("Missing Project"),
        "error should identify the inaccessible workspace cwd, got: {}",
        err.1
    );
    assert!(
        !err.1.contains("Failed to spawn"),
        "invalid workspace errors should not be reported as generic spawn failures, got: {}",
        err.1
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_opencode_pty_run() {
    let (state, path) = test_state("finalize_opencode_success");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode", 9)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true, "ptyInstanceId": 9 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "completed"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_ignores_missing_pty_exit_instance() {
    let (state, path) = test_state("finalize_ignores_missing_pty_exit");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode-missing-instance",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode-missing-instance", 42)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode-missing-instance")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "running"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_ignores_stale_pty_exit_instance() {
    let (state, path) = test_state("finalize_ignores_stale_pty_exit");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-opencode-current",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-opencode-current", 42)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false, "ptyInstanceId": 41 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-opencode-current")
            .expect("get opencode")
            .expect("opencode exists")
            .status,
        "running"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn finalize_agent_session_does_not_override_paused_lifecycle_state() {
    let (state, path) = test_state("finalize_does_not_override_paused");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Paused agent task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-paused-opencode",
            &task.id,
            None,
            "implementing",
            "paused",
            "opencode",
        )
        .expect("create session");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    let session = db
        .get_agent_session("session-paused-opencode")
        .expect("get opencode")
        .expect("opencode exists");
    assert_eq!(session.status, "paused");
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}
