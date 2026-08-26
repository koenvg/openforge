use super::*;

#[tokio::test]
async fn resume_startup_sessions_command_is_compatibility_noop() {
    let (state, _temp_dir) = test_state("app_invoke_resume_startup_sessions");
    let mut receiver = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    invoke_ok(&state, "resume_startup_sessions", json!({})).await;

    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn handles_agent_lifecycle_followups() {
    let (state, _temp_dir) = test_state("app_invoke_agent_lifecycle_followups");
    let claude_task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
            .expect("create project");
        let claude_task = db
            .create_task("claude task", "doing", Some(&project.id), None, None)
            .expect("create claude task");
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
        claude_task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": claude_task_id, "success": false, "ptyInstanceId": 7 }),
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
}

use once_cell::sync::Lazy;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Output},
    time::Duration,
};
use tokio::sync::Mutex as TokioMutex;

static PROVIDER_TEST_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));
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
        install_fake_provider(&bin_dir, "codex", &log_path);
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

fn configure_provider_test_path(state: &mut crate::http_server::AppState, provider_bin_dir: &Path) {
    let provider_path = std::env::join_paths(
        std::iter::once(provider_bin_dir.to_path_buf()).chain(
            std::env::var_os("PATH")
                .as_ref()
                .into_iter()
                .flat_map(std::env::split_paths),
        ),
    )
    .expect("provider test PATH should be joinable");
    let pty_manager = state
        .pty_manager
        .as_mut()
        .expect("PTY manager should exist");
    pty_manager.set_test_environment_variable("PATH", provider_path.to_string_lossy());
    #[cfg(windows)]
    pty_manager.set_test_environment_variable("PATHEXT", windows_provider_test_pathext());
}

#[cfg(windows)]
fn windows_provider_test_pathext() -> String {
    let mut extensions: Vec<String> = std::env::var_os("PATHEXT")
        .as_ref()
        .and_then(|value| value.to_str())
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(str::to_string)
        .collect();
    if !extensions
        .iter()
        .any(|extension| extension.eq_ignore_ascii_case(".CMD"))
    {
        extensions.push(".CMD".to_string());
    }
    extensions.join(";")
}

const PROVIDER_RECORD_COMPLETE: &str = "openforge-provider-record=complete";
const PROVIDER_LOG_READY: &str = "openforge-provider-log=ready";

#[cfg(unix)]
fn install_fake_provider(bin_dir: &Path, command: &str, log_path: &Path) {
    let script = format!(
        "#!/bin/sh\n{{\n  printf 'provider={command}\\n'\n  printf 'cwd=%s\\n' \"$PWD\"\n  i=0\n  for arg in \"$@\"; do\n    i=$((i + 1))\n    printf 'arg%s=%s\\n' \"$i\" \"$arg\"\n  done\n  printf '{PROVIDER_RECORD_COMPLETE}\\n'\n}} >> '{}'\nprintf '{PROVIDER_LOG_READY}\\n'\n# Keep the fake provider alive until the test tears down its PTY. This prevents\n# an immediate child exit from racing PTY session registration on macOS.\nIFS= read -r _\nexit 0\n",
        log_path.display()
    );
    let path = bin_dir.join(command);
    fs::write(&path, script).expect("fake provider should be written");
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
        .expect("fake provider should be executable");
}

#[cfg(windows)]
fn install_fake_provider(bin_dir: &Path, command: &str, log_path: &Path) {
    let escaped_log_path = log_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command \"$log = '{}'; Add-Content -LiteralPath $log -Value 'provider={}'; Add-Content -LiteralPath $log -Value ('cwd=' + (Get-Location).Path); $i = 0; foreach ($arg in $args) {{ $i += 1; Add-Content -LiteralPath $log -Value ('arg' + $i + '=' + $arg) }}; Add-Content -LiteralPath $log -Value '{}'\" -- %*\r\necho {PROVIDER_LOG_READY}\r\nrem Keep the fake provider alive until the test tears down its PTY.\r\nset /p \"OPENFORGE_PROVIDER_RELEASE=\" >nul\r\nexit /b 0\r\n",
        escaped_log_path, command, PROVIDER_RECORD_COMPLETE
    );
    fs::write(bin_dir.join(format!("{command}.cmd")), script)
        .expect("fake provider should be written");
}

fn provider_log_has_complete_record(
    contents: &str,
    provider: &str,
    required_content: &str,
) -> bool {
    let provider_line = format!("provider={provider}");
    contents
        .match_indices(PROVIDER_RECORD_COMPLETE)
        .any(|(complete_marker_index, _)| {
            let completed_prefix = &contents[..complete_marker_index];
            let record_start = completed_prefix.rfind("provider=").unwrap_or(0);
            let record = &completed_prefix[record_start..];
            record.contains(&provider_line) && record.contains(required_content)
        })
}

async fn wait_for_provider_log_record(
    log_path: &Path,
    provider: &str,
    required_content: &str,
) -> String {
    let mut last_contents = String::new();
    for _ in 0..50 {
        if let Ok(contents) = fs::read_to_string(log_path) {
            if provider_log_has_complete_record(&contents, provider, required_content) {
                return contents;
            }
            last_contents = contents;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!(
        "fake provider log at {} should contain completed {provider:?} record with {required_content:?}, got: {last_contents}",
        log_path.display()
    );
}

async fn read_provider_log_after_ready(
    events: &mut tokio::sync::broadcast::Receiver<crate::app_events::AppEventEnvelope>,
    task_id: &str,
    log_path: &Path,
) -> String {
    let output_event_name = format!("pty-output-{task_id}");
    let mut output = String::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = events
                .recv()
                .await
                .expect("provider PTY event channel should remain open");
            if event.event_name != output_event_name {
                continue;
            }
            if let Some(data) = event.payload["data"].as_str() {
                output.push_str(data);
            }
            if output.contains(PROVIDER_LOG_READY) {
                break;
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!("provider PTY should confirm its log is ready, got PTY output: {output:?}")
    });

    fs::read_to_string(log_path).unwrap_or_else(|error| {
        panic!(
            "provider log at {} should be readable after the ready signal: {error}",
            log_path.display()
        )
    })
}

#[test]
fn provider_log_requires_prompt_in_completed_invocation_record() {
    let incomplete_record = "provider=codex\ncwd=/repo\narg1=Start through Codex provider\n";
    assert!(!provider_log_has_complete_record(
        incomplete_record,
        "codex",
        "Start through Codex provider"
    ));

    let complete_record = format!("{incomplete_record}{PROVIDER_RECORD_COMPLETE}\n");
    assert!(provider_log_has_complete_record(
        &complete_record,
        "codex",
        "Start through Codex provider"
    ));
}

fn provider_repo_dir() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().expect("tempdir should succeed");
    let repo_dir = temp.path().join("repo");
    fs::create_dir(&repo_dir).expect("repo dir should be created");
    (temp, repo_dir)
}

fn git(repo_path: &Path, args: &[&str]) -> Output {
    StdCommand::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .expect("git command should run")
}

fn assert_git_success(repo_path: &Path, args: &[&str]) {
    let output = git(repo_path, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_committed_repo(repo_path: &Path) {
    fs::create_dir_all(repo_path).expect("repo dir should be created");
    assert_git_success(repo_path, &["init", "-b", "main"]);
    assert_git_success(repo_path, &["config", "user.email", "test@example.com"]);
    assert_git_success(repo_path, &["config", "user.name", "Test User"]);
    fs::write(repo_path.join("README.md"), "main branch\n").expect("fixture file should write");
    assert_git_success(repo_path, &["add", "README.md"]);
    assert_git_success(repo_path, &["commit", "-m", "initial"]);
}

#[tokio::test]
async fn start_implementation_starts_configured_pi_provider_through_app_invoke_boundary() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_pi_provider_boundary");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Pi Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start through Pi provider",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
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
    assert!(response["session_id"]
        .as_str()
        .is_some_and(|session_id| !session_id.is_empty()));
    assert_eq!(
        response["workspace_path"],
        repo_dir.to_string_lossy().as_ref()
    );
    assert_eq!(response["port"], 0);

    let log =
        wait_for_provider_log_record(&sandbox.log_path, "pi", "Start through Pi provider").await;
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

    {
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
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_uses_authoritative_project_path_and_publishes_canonical_event() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_project_temp, project_repo_dir) = provider_repo_dir();
    let (_spoofed_temp, spoofed_repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_authoritative_project_path");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Authoritative Project",
                project_repo_dir.to_str().expect("utf8 project repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start from authoritative project state",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": spoofed_repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(
        response["workspace_path"],
        project_repo_dir.to_string_lossy().as_ref()
    );
    let log = wait_for_provider_log_record(
        &sandbox.log_path,
        "pi",
        "Start from authoritative project state",
    )
    .await;
    let canonical_project_repo =
        fs::canonicalize(&project_repo_dir).expect("project repo should canonicalize");
    assert!(
        log.contains(&format!("cwd={}", canonical_project_repo.display())),
        "provider must launch from the Project path saved in the database, got: {log}"
    );
    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("task event should arrive")
        .expect("task event should be readable");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["action"], "updated");
    assert_eq!(event.payload["task_id"], task_id);

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_rejects_stale_non_backlog_task_state() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_rejects_stale_state");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Stale State Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Do not start stale state",
            "doing",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let error = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await
    .expect_err("only backlog Tasks may start an Implementation Run");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("backlog"), "got: {}", error.1);
    assert!(
        fs::read_to_string(&sandbox.log_path)
            .ok()
            .is_none_or(|log| !log.contains("Do not start stale state")),
        "provider must not launch for stale Task state"
    );
}

#[tokio::test]
async fn start_implementation_injects_plugin_configured_review_workflow() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_plugin_review_workflow");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Plugin Review Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        let contribution = crate::agent_lifecycle::StartPromptContribution {
            owner_plugin_id: None,
            id: "plugin-review-workflow".to_string(),
            enabled: true,
            content: "<plugin_review>Task {{taskId}}\n## Plugin Template\n- Preserve plugin-owned reviewer brief</plugin_review>".to_string(),
            order: 0,
        };
        db.set_project_config(
            &project.id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            &serde_json::to_string(&vec![contribution]).expect("serialize contribution"),
        )
        .expect("set start prompt contribution");
        db.create_task_with_worktree_source(
            "Start with plugin prompt contribution",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
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
    let log = wait_for_provider_log_record(
        &sandbox.log_path,
        "pi",
        "Start with plugin prompt contribution",
    )
    .await;
    assert!(
        log.contains("<openforge_start_prompt_contribution id=\"plugin-review-workflow\">")
            && log.contains("Task "),
        "plugin start prompt contribution should be injected, got provider log: {log}"
    );
    assert!(
        log.contains("## Plugin Template"),
        "got provider log: {log}"
    );
    assert!(
        log.contains("Preserve plugin-owned reviewer brief"),
        "got provider log: {log}"
    );

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_materializes_pasted_image_references_for_provider_prompt() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir, app_dir) =
        test_state_with_backend_app("app_invoke_start_materializes_image_references");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Image Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Inspect [image#1]\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let log = wait_for_provider_log_record(&sandbox.log_path, "pi", "Inspect [image#1]").await;
    assert!(log.contains("provider=pi"), "got provider log: {log}");
    assert!(
        !log.contains("data:image/png;base64"),
        "provider prompt should not include raw data URI, got provider log: {log}"
    );

    let image_path = app_dir
        .path()
        .join("task-image-attachments")
        .join(&task_id)
        .join("image-1.png");
    assert_eq!(
        fs::read(&image_path).expect("materialized image file"),
        b"image-bytes"
    );
    assert!(
        log.contains(image_path.to_string_lossy().as_ref()),
        "provider prompt should include materialized file path, got provider log: {log}"
    );

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_passes_task_agent_to_configured_opencode_provider() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_opencode_agent_boundary");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "OpenCode Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set provider");
        let task = db
            .create_task_with_worktree_source(
                "Start through OpenCode provider",
                "backlog",
                Some(&project.id),
                None,
                None,
                crate::db::TaskWorktreeOptions {
                    source: Some("disabled"),
                    branch: None,
                },
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

    let mut provider_events = state
        .app_event_tx
        .as_ref()
        .expect("provider event sender")
        .subscribe();

    invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let log =
        read_provider_log_after_ready(&mut provider_events, &task_id, &sandbox.log_path).await;
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

    {
        let db = crate::db::acquire_db(&state.db);
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .expect("get latest session")
            .expect("session should be recorded");
        assert_eq!(session.provider, "opencode");
        assert_eq!(session.status, "running");
        assert!(session.pty_instance_id.is_some());
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_starts_configured_codex_provider_through_app_invoke_boundary() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let (_temp, repo_dir) = provider_repo_dir();
    let (mut state, _temp_dir) = test_state("app_invoke_start_codex_provider_boundary");
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Codex Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "codex")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start through Codex provider",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let mut provider_events = state
        .app_event_tx
        .as_ref()
        .expect("provider event sender")
        .subscribe();

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

    let log =
        read_provider_log_after_ready(&mut provider_events, &task_id, &sandbox.log_path).await;
    assert!(log.contains("provider=codex"), "got provider log: {log}");
    assert!(
        log.contains("Start through Codex provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .expect("get latest session")
            .expect("session should be recorded");
        assert_eq!(session.provider, "codex");
        assert_eq!(session.status, "running");
        assert!(session.pty_instance_id.is_some());
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get task workspace")
            .expect("workspace should be recorded");
        assert_eq!(workspace.provider_name, "codex");
        assert_eq!(workspace.kind, "project_dir");
        assert_eq!(workspace.status, "active");
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_uses_persisted_existing_worktree_branch() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let worktree_root = temp.path().join("worktrees");
    let repo_dir = temp.path().join("repo");
    init_committed_repo(&repo_dir);
    assert_git_success(&repo_dir, &["checkout", "-b", "feature/open-pr"]);
    fs::write(repo_dir.join("README.md"), "feature branch\n").expect("fixture file should write");
    assert_git_success(&repo_dir, &["commit", "-am", "feature change"]);
    assert_git_success(&repo_dir, &["checkout", "main"]);
    let (mut state, _temp_dir) = test_state("app_invoke_start_existing_branch_worktree");
    state.task_start_worktree_root = Some(worktree_root.clone());
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Continue existing PR",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
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

    let workspace_path = response["workspace_path"]
        .as_str()
        .expect("workspace path should be string");
    assert!(
        Path::new(workspace_path).starts_with(&worktree_root),
        "existing-branch workspace must use the injected worktree root"
    );
    let branch_output = git(
        Path::new(workspace_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
    );
    assert!(branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&branch_output.stdout).trim(),
        "feature/open-pr"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let worktree = db
            .get_worktree_for_task(&task_id)
            .expect("get worktree")
            .expect("worktree should exist");
        assert_eq!(worktree.branch_name, "feature/open-pr");
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get task workspace")
            .expect("workspace should exist");
        assert_eq!(workspace.branch_name.as_deref(), Some("feature/open-pr"));
    }

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;
    let workspace_dir = std::path::PathBuf::from(workspace_path);
    wait_for_background_cleanup("existing-branch worktree must be removed", || {
        !workspace_dir.exists()
    })
    .await;
    assert!(
        git(
            &repo_dir,
            &["show-ref", "--verify", "refs/heads/feature/open-pr"]
        )
        .status
        .success(),
        "deleting a task created from an existing branch must not delete that branch"
    );
}

#[tokio::test]
async fn start_implementation_replaces_stale_existing_branch_worktree_path() {
    let _provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
    let sandbox = &*PROVIDER_TEST_SANDBOX;
    sandbox.clear_log();
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let worktree_root = temp.path().join("worktrees");
    let repo_dir = temp.path().join("repo");
    init_committed_repo(&repo_dir);
    assert_git_success(&repo_dir, &["checkout", "-b", "feature/open-pr"]);
    fs::write(repo_dir.join("README.md"), "feature branch\n").expect("fixture file should write");
    assert_git_success(&repo_dir, &["commit", "-am", "feature change"]);
    assert_git_success(&repo_dir, &["checkout", "main"]);
    let (mut state, _temp_dir) =
        test_state("app_invoke_start_existing_branch_replaces_stale_worktree");
    state.task_start_worktree_root = Some(worktree_root.clone());
    configure_provider_test_path(&mut state, &sandbox.bin_dir);
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Continue existing PR",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create task")
        .id
    };
    let stale_worktree_path = worktree_root.join("repo").join(&task_id);
    let stale_worktree_path_str = stale_worktree_path.to_string_lossy().to_string();
    let stale_branch = crate::git_worktree::task_branch_name(&task_id);
    assert_git_success(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-b",
            &stale_branch,
            &stale_worktree_path_str,
            "main",
        ],
    );
    let stale_branch_output = git(&stale_worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert!(stale_branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&stale_branch_output.stdout).trim(),
        stale_branch
    );

    let response = invoke_ok(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let workspace_path = response["workspace_path"]
        .as_str()
        .expect("workspace path should be string");
    assert_eq!(workspace_path, stale_worktree_path_str);
    let branch_output = git(
        Path::new(workspace_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
    );
    assert!(branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&branch_output.stdout).trim(),
        "feature/open-pr"
    );

    let db = crate::db::acquire_db(&state.db);
    let workspace = db
        .get_task_workspace_for_task(&task_id)
        .expect("get workspace")
        .expect("workspace should exist");
    assert_eq!(workspace.branch_name.as_deref(), Some("feature/open-pr"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_existing_branch_starts_keep_worktree_roots_isolated() {
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Barrier,
    };

    let process_home = std::env::var_os("HOME");
    let temp_a = tempfile::tempdir().expect("first tempdir should be created");
    let temp_b = tempfile::tempdir().expect("second tempdir should be created");
    let repo_a = temp_a.path().join("repo");
    let repo_b = temp_b.path().join("repo");
    let worktree_root_a = temp_a.path().join("worktrees");
    let worktree_root_b = temp_b.path().join("worktrees");
    let sandbox_a = ProviderTestSandbox::new();
    let sandbox_b = ProviderTestSandbox::new();
    let (mut state_a, _db_temp_a) = test_state("parallel_existing_branch_start_a");
    let (mut state_b, _db_temp_b) = test_state("parallel_existing_branch_start_b");
    state_a.task_start_worktree_root = Some(worktree_root_a.clone());
    state_b.task_start_worktree_root = Some(worktree_root_b.clone());
    configure_provider_test_path(&mut state_a, &sandbox_a.bin_dir);
    configure_provider_test_path(&mut state_b, &sandbox_b.bin_dir);

    let prepare_task = |state: &crate::http_server::AppState, repo_dir: &Path, prompt: &str| {
        init_committed_repo(repo_dir);
        assert_git_success(repo_dir, &["checkout", "-b", "feature/open-pr"]);
        fs::write(repo_dir.join("README.md"), "feature branch\n")
            .expect("fixture file should write");
        assert_git_success(repo_dir, &["commit", "-am", "feature change"]);
        assert_git_success(repo_dir, &["checkout", "main"]);

        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Parallel Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            prompt,
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create task")
        .id
    };
    let task_a = prepare_task(&state_a, &repo_a, "Parallel existing branch A");
    let task_b = prepare_task(&state_b, &repo_b, "Parallel existing branch B");

    let stop_home_observer = Arc::new(AtomicBool::new(false));
    let home_changed = Arc::new(AtomicBool::new(false));
    let home_observations = Arc::new(AtomicUsize::new(0));
    let observer_ready = Arc::new(Barrier::new(2));
    let home_observer = {
        let expected_home = process_home.clone();
        let stop = Arc::clone(&stop_home_observer);
        let changed = Arc::clone(&home_changed);
        let observations = Arc::clone(&home_observations);
        let ready = Arc::clone(&observer_ready);
        std::thread::spawn(move || {
            ready.wait();
            while !stop.load(Ordering::Acquire) {
                observations.fetch_add(1, Ordering::Relaxed);
                if std::env::var_os("HOME") != expected_home {
                    changed.store(true, Ordering::Release);
                }
                std::thread::yield_now();
            }
        })
    };
    observer_ready.wait();

    let (response_a, response_b) = tokio::join!(
        invoke(
            &state_a,
            "start_implementation",
            json!({ "taskId": task_a, "repoPath": repo_a.to_string_lossy() }),
        ),
        invoke(
            &state_b,
            "start_implementation",
            json!({ "taskId": task_b, "repoPath": repo_b.to_string_lossy() }),
        ),
    );

    stop_home_observer.store(true, Ordering::Release);
    home_observer.join().expect("HOME observer should stop");
    assert!(
        home_observations.load(Ordering::Relaxed) > 0,
        "HOME observer should sample while both starts are in flight"
    );
    assert!(
        !home_changed.load(Ordering::Acquire),
        "task starts must never expose a temporary process HOME"
    );

    let response_a = response_a.expect("first concurrent task start should succeed");
    let response_b = response_b.expect("second concurrent task start should succeed");
    let workspace_a = Path::new(
        response_a["workspace_path"]
            .as_str()
            .expect("first workspace path should be a string"),
    );
    let workspace_b = Path::new(
        response_b["workspace_path"]
            .as_str()
            .expect("second workspace path should be a string"),
    );
    assert!(workspace_a.starts_with(&worktree_root_a));
    assert!(workspace_b.starts_with(&worktree_root_b));
    assert!(!workspace_a.starts_with(&worktree_root_b));
    assert!(!workspace_b.starts_with(&worktree_root_a));
    assert_eq!(std::env::var_os("HOME"), process_home);

    let manager_a = state_a.pty_manager.as_ref().expect("first PTY manager");
    let manager_b = state_b.pty_manager.as_ref().expect("second PTY manager");
    let (kill_a, kill_b) = tokio::join!(manager_a.kill_pty(&task_a), manager_b.kill_pty(&task_b));
    kill_a.expect("first provider should stop");
    kill_b.expect("second provider should stop");
}

#[tokio::test]
async fn start_implementation_reports_missing_task() {
    let (state, _temp_dir) = test_state("app_invoke_start_implementation");

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": "missing-task", "repoPath": "/tmp" }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));
}

#[tokio::test]
async fn start_implementation_blocks_in_progress_start_claim() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_in_progress_claim");
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
        .task_claims
        .try_claim(
            &task_id,
            crate::http_server::TaskOperation::StartImplementation,
        )
        .expect("first start claim should be acquired");
    let cloned_state = state.clone();
    assert!(cloned_state
        .task_claims
        .try_claim(
            &task_id,
            crate::http_server::TaskOperation::StartImplementation,
        )
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
}

#[tokio::test]
async fn start_implementation_blocks_active_agent_session() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_active_session");
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
}

#[tokio::test]
async fn start_implementation_blocks_unmet_dependencies() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_dependencies");
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
}

#[tokio::test]
async fn start_implementation_reports_invalid_workspace_cwd_as_bad_request() {
    let (state, _temp_dir) = test_state("app_invoke_start_invalid_workspace_cwd");
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
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start with missing cwd",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
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
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_opencode_pty_run() {
    let (state, _temp_dir) = test_state("finalize_opencode_success");
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
}

#[tokio::test]
async fn finalize_agent_session_completes_successful_codex_pty_run() {
    let (state, _temp_dir) = test_state("finalize_codex_success");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Codex task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-codex",
            &task.id,
            None,
            "implementing",
            "running",
            "codex",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-codex", 11)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": true, "ptyInstanceId": 11 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-codex")
            .expect("get codex")
            .expect("codex exists")
            .status,
        "completed"
    );
    drop(db);
    let event = events.try_recv().expect("status event should be emitted");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "completed");
    assert_eq!(event.payload["provider"], "codex");
}

#[tokio::test]
async fn finalize_agent_session_interrupts_failed_codex_pty_run() {
    let (state, _temp_dir) = test_state("finalize_codex_failure");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .create_task("Codex task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "session-codex-failed",
            &task.id,
            None,
            "implementing",
            "running",
            "codex",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("session-codex-failed", 12)
            .expect("store pty instance");
        task.id
    };

    invoke_ok(
        &state,
        "finalize_agent_session",
        json!({ "taskId": task_id, "success": false, "ptyInstanceId": 12 }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    let session = db
        .get_agent_session("session-codex-failed")
        .expect("get codex")
        .expect("codex exists");
    assert_eq!(session.status, "interrupted");
    assert_eq!(session.error_message.as_deref(), Some("PTY process exited"));
}

#[tokio::test]
async fn finalize_agent_session_ignores_missing_pty_exit_instance() {
    let (state, _temp_dir) = test_state("finalize_ignores_missing_pty_exit");
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
}

#[tokio::test]
async fn finalize_agent_session_ignores_stale_pty_exit_instance() {
    let (state, _temp_dir) = test_state("finalize_ignores_stale_pty_exit");
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
}

#[tokio::test]
async fn finalize_agent_session_does_not_override_paused_lifecycle_state() {
    let (state, _temp_dir) = test_state("finalize_does_not_override_paused");
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
}

// ============================================================================
// remove_branch propagation + safety on teardown (AVIV-102)
// ============================================================================

fn git_stdout_lifecycle(repo_path: &Path, args: &[&str]) -> String {
    let output = git(repo_path, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn branch_exists_lifecycle(repo_path: &Path, branch: &str) -> bool {
    git(
        repo_path,
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .status
    .success()
}

/// Marks branch <branch> as fully pushed: points origin/<branch> at its tip and
/// configures the upstream so teardown treats it as safe to delete.
fn mark_branch_pushed(repo_path: &Path, branch: &str) {
    let sha = git_stdout_lifecycle(repo_path, &["rev-parse", &format!("refs/heads/{branch}")]);
    let _ = git(
        repo_path,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/openforge.git",
        ],
    );
    assert_git_success(
        repo_path,
        &["update-ref", &format!("refs/remotes/origin/{branch}"), &sha],
    );
    assert_git_success(
        repo_path,
        &[
            "branch",
            &format!("--set-upstream-to=origin/{branch}"),
            branch,
        ],
    );
}

/// Creates a committed repo, a "doing" task with an OpenForge worktree on its
/// `openforge/<task>` branch, and persists the worktree record. When `safe` the
/// branch is marked fully pushed so teardown may delete it. Returns the task id,
/// branch name, and worktree path.
async fn setup_owned_worktree_task(
    state: &crate::http_server::AppState,
    repo_dir: &Path,
    worktree_dir: &Path,
    safe: bool,
) -> (String, String) {
    init_committed_repo(repo_dir);
    let (project_id, task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Cleanup Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        let task = db
            .create_task("owned branch task", "doing", Some(&project.id), None, None)
            .expect("create task");
        (project.id, task.id)
    };
    let branch = crate::git_worktree::task_branch_name(&task_id);
    crate::git_worktree::create_worktree(repo_dir, worktree_dir, &branch, "origin/main")
        .await
        .expect("create worktree");
    {
        let db = crate::db::acquire_db(&state.db);
        db.create_worktree_record(
            &task_id,
            &project_id,
            repo_dir.to_str().expect("utf8 repo path"),
            worktree_dir.to_str().expect("utf8 worktree path"),
            &branch,
        )
        .expect("create worktree record");
    }
    if safe {
        mark_branch_pushed(repo_dir, &branch);
    }
    (task_id, branch)
}

#[tokio::test]
async fn update_task_status_to_done_is_rejected_and_preserves_worktree() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_done_rejected_keeps_worktree");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    // 'done' is a legacy, recognized-but-unreachable status (AVIV-118): assigning
    // it hides the task from every board surface with no reopen path. The write
    // boundary rejects it, so the status update never runs.
    let rejected = invoke(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "done" }),
    )
    .await
    .expect_err("move to Done should be rejected");
    assert_eq!(rejected.0, StatusCode::BAD_REQUEST);

    // The task keeps its board-visible status...
    {
        let db = crate::db::acquire_db(&state.db);
        assert_eq!(
            db.get_task(&task_id)
                .expect("get task")
                .expect("task exists")
                .status,
            "doing"
        );
    }
    // ...and, because nothing was written, the worktree and branch survive
    // untouched (no accidental cleanup on the rejected path).
    assert!(
        branch_exists_lifecycle(&repo_dir, &branch),
        "rejecting a move to Done must not delete the branch"
    );
    assert!(
        worktree_dir.exists(),
        "rejecting a move to Done must not remove the worktree directory"
    );
    let db = crate::db::acquire_db(&state.db);
    assert!(
        db.get_worktree_for_task(&task_id)
            .expect("get worktree")
            .is_some(),
        "the worktree record must survive a rejected move to Done"
    );
    drop(db);
}

/// Polls until `condition` holds, panicking after a generous deadline. Used to
/// observe the background worktree cleanup that delete_task no longer awaits.
async fn wait_for_background_cleanup(description: &str, mut condition: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !condition() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for background cleanup: {description}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

#[tokio::test]
async fn delete_task_deletes_owned_branch_when_safe() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_deletes_owned_branch");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;

    wait_for_background_cleanup(
        "safe owned branch must be deleted after a task is completed",
        || !branch_exists_lifecycle(&repo_dir, &branch),
    )
    .await;
}

#[tokio::test]
async fn delete_task_publishes_deleted_event_before_worktree_cleanup_finishes() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_event_before_cleanup");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    // Hold the per-repo worktree lock so the worktree/branch cleanup cannot run
    // yet. delete_task must still return, complete the row, and publish the
    // deleted event: cleanup is background work.
    let repo_lock = crate::git_worktree::acquire_lock(&repo_dir);
    let cleanup_gate = repo_lock.lock().await;

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        invoke_ok(&state, "delete_task", json!({ "id": task_id })),
    )
    .await
    .expect("delete_task must return while worktree cleanup is still pending");

    let completed = crate::db::acquire_db(&state.db)
        .get_task(&task_id)
        .expect("get task")
        .expect("completed task record should remain before worktree cleanup runs");
    assert_eq!(
        completed.status, "done",
        "the task row must be marked done before worktree cleanup runs"
    );
    let envelope = events
        .try_recv()
        .expect("task-changed{deleted} must be published before cleanup finishes");
    assert_eq!(envelope.event_name, "task-changed");
    assert_eq!(envelope.payload["action"], "deleted");
    assert_eq!(envelope.payload["task_id"], task_id.as_str());
    assert!(
        worktree_dir.exists(),
        "worktree removal must happen in the background, after the deleted event"
    );
    assert!(
        branch_exists_lifecycle(&repo_dir, &branch),
        "branch cleanup must happen in the background, after the deleted event"
    );

    drop(cleanup_gate);
    wait_for_background_cleanup("worktree directory and branch must be removed", || {
        !worktree_dir.exists() && !branch_exists_lifecycle(&repo_dir, &branch)
    })
    .await;
}

#[tokio::test]
async fn delete_task_rejects_duplicate_delete_while_cleanup_in_flight() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_duplicate_guard");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    let repo_lock = crate::git_worktree::acquire_lock(&repo_dir);
    let cleanup_gate = repo_lock.lock().await;

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        invoke_ok(&state, "delete_task", json!({ "id": task_id })),
    )
    .await
    .expect("delete_task must return while worktree cleanup is still pending");

    let err = invoke(&state, "delete_task", json!({ "id": task_id }))
        .await
        .expect_err("a second Complete while cleanup is in flight must be rejected");
    assert_eq!(err.0, StatusCode::CONFLICT);

    drop(cleanup_gate);
    wait_for_background_cleanup("cleanup must finish after the gate is released", || {
        !worktree_dir.exists() && !branch_exists_lifecycle(&repo_dir, &branch)
    })
    .await;
}
