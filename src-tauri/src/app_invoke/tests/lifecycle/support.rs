use super::*;

use once_cell::sync::Lazy;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Output},
    time::Duration,
};
use tokio::sync::{Mutex as TokioMutex, MutexGuard as TokioMutexGuard};

static PROVIDER_TEST_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));
static PROVIDER_TEST_SANDBOX: Lazy<ProviderTestSandbox> = Lazy::new(ProviderTestSandbox::new);

pub(super) struct ProviderTestSandbox {
    _temp: tempfile::TempDir,
    pub(super) bin_dir: PathBuf,
    log_path: PathBuf,
}

impl ProviderTestSandbox {
    pub(super) fn new() -> Self {
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

pub(super) struct ProviderLifecycleFixture {
    state: crate::http_server::AppState,
    _db_temp_dir: tempfile::TempDir,
    app_dir: Option<tempfile::TempDir>,
    _provider_test_lock: TokioMutexGuard<'static, ()>,
}

impl ProviderLifecycleFixture {
    pub(super) async fn new(name: &str) -> Self {
        Self::build(name, false).await
    }

    pub(super) async fn with_backend_app(name: &str) -> Self {
        Self::build(name, true).await
    }

    async fn build(name: &str, with_backend_app: bool) -> Self {
        let provider_test_lock = PROVIDER_TEST_LOCK.lock().await;
        let sandbox = &*PROVIDER_TEST_SANDBOX;
        sandbox.clear_log();

        let (mut state, db_temp_dir, app_dir) = if with_backend_app {
            let (state, db_temp_dir, app_dir) = test_state_with_backend_app(name);
            (state, db_temp_dir, Some(app_dir))
        } else {
            let (state, db_temp_dir) = test_state(name);
            (state, db_temp_dir, None)
        };
        configure_provider_test_path(&mut state, &sandbox.bin_dir);

        Self {
            state,
            _db_temp_dir: db_temp_dir,
            app_dir,
            _provider_test_lock: provider_test_lock,
        }
    }

    pub(super) fn state(&self) -> &crate::http_server::AppState {
        &self.state
    }

    pub(super) fn state_mut(&mut self) -> &mut crate::http_server::AppState {
        &mut self.state
    }

    pub(super) fn log_path(&self) -> &Path {
        &PROVIDER_TEST_SANDBOX.log_path
    }

    pub(super) fn app_dir(&self) -> &tempfile::TempDir {
        self.app_dir
            .as_ref()
            .expect("provider fixture should own a backend app directory")
    }
}

pub(super) fn configure_provider_test_path(
    state: &mut crate::http_server::AppState,
    provider_bin_dir: &Path,
) {
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

pub(super) const PROVIDER_RECORD_COMPLETE: &str = "openforge-provider-record=complete";
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

pub(super) fn provider_log_has_complete_record(
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

pub(super) async fn wait_for_provider_log_record(
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

pub(super) async fn read_provider_log_after_ready(
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

pub(super) fn provider_repo_dir() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().expect("tempdir should succeed");
    let repo_dir = temp.path().join("repo");
    fs::create_dir(&repo_dir).expect("repo dir should be created");
    (temp, repo_dir)
}

pub(super) fn git(repo_path: &Path, args: &[&str]) -> Output {
    StdCommand::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .expect("git command should run")
}

pub(super) fn assert_git_success(repo_path: &Path, args: &[&str]) {
    let output = git(repo_path, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

pub(super) fn init_committed_repo(repo_path: &Path) {
    fs::create_dir_all(repo_path).expect("repo dir should be created");
    assert_git_success(repo_path, &["init", "-b", "main"]);
    assert_git_success(repo_path, &["config", "user.email", "test@example.com"]);
    assert_git_success(repo_path, &["config", "user.name", "Test User"]);
    fs::write(repo_path.join("README.md"), "main branch\n").expect("fixture file should write");
    assert_git_success(repo_path, &["add", "README.md"]);
    assert_git_success(repo_path, &["commit", "-m", "initial"]);
}

pub(super) async fn wait_for_background_cleanup(
    description: &str,
    mut condition: impl FnMut() -> bool,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !condition() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for background cleanup: {description}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}
