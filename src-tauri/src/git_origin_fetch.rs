//! Bounded `git fetch origin`.
//!
//! A fetch has no bound of its own: an unreachable remote or a dead ssh socket
//! leaves it hanging indefinitely, every caller awaiting it hangs too, and the
//! child survives the sidecar being SIGKILLed at the end of its shutdown budget.
//! This module owns the timeout, the signalling, and the per-repository
//! serialization that keep that from happening.

use crate::git_worktree::git_command;
use dashmap::{DashMap, DashSet};
use log::warn;
use once_cell::sync::Lazy;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// How long a fetch may run before it is signalled. Long enough for a
/// large-but-healthy fetch, short enough that a broken network degrades to stale
/// refs instead of a frozen UI.
pub(crate) const ORIGIN_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// A fetch this recent is treated as the current state of origin rather than
/// repeated. Two fetches racing in one repository fight over
/// `refs/remotes/origin/*` locks, and the loser reports failure even though the
/// remote answered fine.
const ORIGIN_FETCH_FRESHNESS: Duration = Duration::from_secs(3);

/// How long a signalled fetch gets to exit on its own before it is killed. git
/// unlinks its lockfiles on SIGTERM; a stale `refs/remotes/origin/*.lock` breaks
/// every later fetch in that repository until someone deletes it by hand.
const ORIGIN_FETCH_TERMINATION_GRACE: Duration = Duration::from_millis(1_000);

/// ssh invocation used for git network access when nothing else pins one. Plain
/// ssh waits on the kernel's TCP timeout, so a dead socket blocks for minutes.
const BOUNDED_SSH_COMMAND: &str =
    "ssh -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=2";

/// Process groups of fetches that are currently running, so shutdown can signal
/// them instead of leaving them to be orphaned to pid 1.
static ACTIVE_FETCH_PROCESS_GROUPS: Lazy<DashSet<u32>> = Lazy::new(DashSet::new);

/// Per-repository fetch serialization, holding the instant the last fetch there
/// succeeded.
static ORIGIN_FETCH_STATE: Lazy<DashMap<String, Arc<Mutex<Option<Instant>>>>> =
    Lazy::new(DashMap::new);

fn origin_fetch_state(repo_path: &Path) -> Arc<Mutex<Option<Instant>>> {
    // Keyed the way this crate keys its worktree locks: on the path as given.
    // Callers pass the project path recorded in the database, so spellings do
    // not drift in practice.
    let key = repo_path.to_string_lossy().to_string();
    ORIGIN_FETCH_STATE
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(None)))
        .clone()
}

/// Decides whether git should be handed [`BOUNDED_SSH_COMMAND`]. Anything the
/// user has already pinned wins: it may name a specific ssh binary, key, or
/// proxy jump, and replacing it turns a working fetch into a failing one.
fn ssh_command_override(
    env_command: Option<&str>,
    config_command: Option<&str>,
) -> Option<&'static str> {
    let pinned = [env_command, config_command]
        .into_iter()
        .flatten()
        .any(|command| !command.trim().is_empty());
    if pinned {
        None
    } else {
        Some(BOUNDED_SSH_COMMAND)
    }
}

/// `GIT_SSH_COMMAND` overrides git's own `core.sshCommand`, so both have to be
/// consulted before deciding to set it.
async fn configured_ssh_command(repo_path: &Path) -> Option<String> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("config")
        .arg("--get")
        .arg("core.sshCommand")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Fetches origin, reporting whether the remote actually answered so callers that
/// need to know (the pre-flight branch inspection) can flag a comparison as
/// possibly stale. Never fails the caller: every call site treats origin as a
/// refresh, not a requirement.
pub(crate) async fn fetch_origin(repo_path: &Path, timeout: Duration) -> bool {
    let state = origin_fetch_state(repo_path);
    let mut last_success = state.lock().await;

    if last_success.is_some_and(|at| at.elapsed() < ORIGIN_FETCH_FRESHNESS) {
        return true;
    }

    let succeeded = run_fetch(repo_path, timeout).await;
    if succeeded {
        *last_success = Some(Instant::now());
    }
    succeeded
}

/// Refreshes origin without making the caller wait for it. Whoever reads the
/// repository's refs next sees the result; this read sees what is already on
/// disk.
pub(crate) fn spawn_background_origin_refresh(repo_path: &Path) {
    let state = origin_fetch_state(repo_path);
    if state.try_lock().is_err() {
        // A fetch for this repository is already running. Queueing another is how
        // reopening the dialog against an unresponsive remote stacked up twelve of
        // them.
        return;
    }

    let repo_path = repo_path.to_path_buf();
    tokio::spawn(async move {
        let _ = fetch_origin(&repo_path, ORIGIN_FETCH_TIMEOUT).await;
    });
}

async fn run_fetch(repo_path: &Path, timeout: Duration) -> bool {
    #[cfg(all(test, unix))]
    let _serialized = hanging_fetch_test_support::PROCESS_WIDE_FETCH_LOCK
        .lock()
        .await;
    let mut command = git_command();
    command
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .stdin(Stdio::null())
        // Discarded rather than piped: nothing reads this output, and an
        // unconsumed pipe would let a chatty fetch block on a full buffer.
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Reaps the child if this future is dropped mid-fetch.
        .kill_on_drop(true);

    if let Some(ssh_command) = ssh_command_override(
        std::env::var("GIT_SSH_COMMAND").ok().as_deref(),
        configured_ssh_command(repo_path).await.as_deref(),
    ) {
        command.env("GIT_SSH_COMMAND", ssh_command);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            warn!("Warning: git fetch origin could not run: {}", e);
            return false;
        }
    };

    let Some(pid) = child.id() else {
        warn!("Warning: git fetch origin exited before it could be tracked");
        return false;
    };
    let mut tracked = TrackedFetch::register(pid);

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => {
            tracked.disarm();
            if !status.success() {
                warn!("Warning: git fetch origin failed status={}", status);
                return false;
            }
            true
        }
        Ok(Err(e)) => {
            tracked.disarm();
            warn!("Warning: git fetch origin could not complete: {}", e);
            false
        }
        Err(_) => {
            warn!(
                "Warning: git fetch origin timed out after {:?}; signalling its process group",
                timeout
            );
            signal_process_group(pid, libc::SIGTERM);
            if tokio::time::timeout(ORIGIN_FETCH_TERMINATION_GRACE, child.wait())
                .await
                .is_err()
            {
                signal_process_group(pid, libc::SIGKILL);
            }
            tracked.disarm();
            false
        }
    }
}

/// Signals every running fetch's process group with SIGTERM, reporting how many
/// were reached.
pub fn terminate_active_git_fetches() -> usize {
    signal_active_git_fetches(libc::SIGTERM)
}

/// Kills whatever survived [`terminate_active_git_fetches`].
pub fn kill_active_git_fetches() -> usize {
    signal_active_git_fetches(libc::SIGKILL)
}

fn signal_active_git_fetches(signal: i32) -> usize {
    ACTIVE_FETCH_PROCESS_GROUPS
        .iter()
        .filter(|pid| signal_process_group(**pid, signal))
        .count()
}

/// Keeps a running fetch's process group reachable from shutdown, and takes the
/// group down if the fetch is abandoned before it finishes — a dropped request
/// future kills git itself but leaves the ssh child it spawned behind.
struct TrackedFetch {
    pid: u32,
    finished: bool,
}

impl TrackedFetch {
    fn register(pid: u32) -> Self {
        ACTIVE_FETCH_PROCESS_GROUPS.insert(pid);
        Self {
            pid,
            finished: false,
        }
    }

    /// Marks the fetch as dealt with, so dropping it does not signal a pid that
    /// has already been reaped and could have been recycled.
    fn disarm(&mut self) {
        self.finished = true;
    }
}

impl Drop for TrackedFetch {
    fn drop(&mut self) {
        ACTIVE_FETCH_PROCESS_GROUPS.remove(&self.pid);
        if !self.finished {
            signal_process_group(self.pid, libc::SIGTERM);
        }
    }
}

/// Signals the process group led by `pid`, reporting whether the signal was
/// delivered. Callers spawn git with its own process group, so the group id is
/// the child's pid and one signal reaches git and the ssh child it spawned.
#[cfg(unix)]
fn signal_process_group(pid: u32, signal: i32) -> bool {
    // SAFETY: signalling the process group of a child this crate spawned with
    // `process_group(0)`, so the group leader id equals that child's pid.
    unsafe { libc::kill(-(pid as i32), signal) == 0 }
}

#[cfg(not(unix))]
fn signal_process_group(_pid: u32, _signal: i32) -> bool {
    // No process groups on Windows; `kill_on_drop` covers the spawned child.
    false
}

// ============================================================================
// Test Support
// ============================================================================

/// Fixtures for tests that need a fetch which never returns.
#[cfg(all(test, unix))]
pub(crate) mod hanging_fetch_test_support {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command as StdCommand;

    /// Serializes every fetch process in the test binary. Shutdown sweeps read a
    /// process-wide registry, so `run_fetch` takes this before spawning a child and
    /// prevents unrelated parallel tests from changing the registry mid-assertion.
    pub(crate) static PROCESS_WIDE_FETCH_LOCK: Mutex<()> = Mutex::const_new(());

    fn run_git(repo_path: &Path, args: &[&str]) {
        let output = StdCommand::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .expect("git command should run");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    pub(crate) fn init_repo(repo_path: &Path) {
        std::fs::create_dir_all(repo_path).expect("repo directory should be created");
        run_git(repo_path, &["init", "-b", "main"]);
        run_git(repo_path, &["config", "user.email", "test@example.com"]);
        run_git(repo_path, &["config", "user.name", "Test User"]);
        // Never sign fixture commits: a developer's global commit.gpgsign=true
        // would otherwise fail these commits when gpg is unavailable.
        run_git(repo_path, &["config", "commit.gpgsign", "false"]);
        std::fs::write(repo_path.join("README.md"), "local repo\n")
            .expect("fixture file should be written");
        run_git(repo_path, &["add", "README.md"]);
        run_git(repo_path, &["commit", "-m", "initial"]);
    }

    /// Creates a repository whose `origin` is a git `ext::` transport that never
    /// returns, so fetching hangs the way it does through a dead ssh socket.
    /// Returns the file the hanging helper writes its pid to, so tests can assert
    /// the process tree was killed rather than leaked.
    pub(crate) fn init_repo_with_hanging_origin(repo_path: &Path) -> PathBuf {
        init_repo(repo_path);

        let pid_file = repo_path.join("hanging-fetch.pid");
        let helper = repo_path.join("hanging-fetch.sh");
        std::fs::write(
            &helper,
            format!(
                "#!/bin/sh\necho $$ > \"{}\"\nexec sleep 600\n",
                pid_file.display()
            ),
        )
        .expect("hanging fetch helper should be written");
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755))
            .expect("hanging fetch helper should be executable");

        run_git(
            repo_path,
            &[
                "remote",
                "add",
                "origin",
                &format!("ext::{}", helper.display()),
            ],
        );
        // git refuses the `ext::` transport unless the repository opts in.
        run_git(repo_path, &["config", "protocol.ext.allow", "always"]);

        pid_file
    }

    pub(crate) async fn wait_for_recorded_pid(pid_file: &Path) -> i32 {
        for _ in 0..500 {
            if let Ok(contents) = std::fs::read_to_string(pid_file) {
                if let Ok(pid) = contents.trim().parse::<i32>() {
                    return pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the hanging fetch helper never recorded its pid");
    }

    fn process_is_alive(pid: i32) -> bool {
        // SAFETY: signal 0 performs permission and existence checks only.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    pub(crate) async fn assert_process_exits(pid: i32) {
        for _ in 0..500 {
            if !process_is_alive(pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process {pid} survived: the hung git process tree was leaked, not killed");
    }

    /// Signals one fixture's fetch group instead of sweeping every fetch in the
    /// process, so tests outside this lock are left alone.
    pub(crate) fn terminate_fetch_process_group(pid: u32) -> bool {
        signal_process_group(pid, libc::SIGTERM)
    }

    /// The process group a fixture helper belongs to, which is the group git was
    /// spawned into.
    pub(crate) fn process_group_of(pid: i32) -> u32 {
        // SAFETY: a plain query for the process group of a live pid.
        let group = unsafe { libc::getpgid(pid) };
        assert!(group > 0, "helper process should report its process group");
        group as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pinned_ssh_command_is_never_replaced() {
        assert_eq!(
            ssh_command_override(Some("ssh -i /keys/deploy"), None),
            None,
            "GIT_SSH_COMMAND must win: overriding it can break authentication outright"
        );
        assert_eq!(
            ssh_command_override(None, Some("ssh -i /keys/deploy")),
            None,
            "core.sshCommand must win too, since GIT_SSH_COMMAND would override it"
        );
        assert_eq!(
            ssh_command_override(Some("   "), Some("")),
            Some(BOUNDED_SSH_COMMAND),
            "blank settings pin nothing"
        );
        assert_eq!(ssh_command_override(None, None), Some(BOUNDED_SSH_COMMAND));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_fetch_that_never_returns_is_bounded_and_its_process_tree_killed() {
        use hanging_fetch_test_support::*;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        let pid_file = init_repo_with_hanging_origin(&repo_path);

        let fetch_repo_path = repo_path.clone();
        // Generous next to the milliseconds the helper needs to record its pid,
        // and still far below the 600s hang it stands in for.
        let fetch =
            tokio::spawn(
                async move { fetch_origin(&fetch_repo_path, Duration::from_secs(3)).await },
            );

        let helper_pid = wait_for_recorded_pid(&pid_file).await;
        let succeeded = tokio::time::timeout(Duration::from_secs(30), fetch)
            .await
            .expect("a fetch that never returns must be bounded by the timeout")
            .expect("fetch task should not panic");

        assert!(!succeeded, "a timed-out fetch must report failure");
        assert_process_exits(helper_pid).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_abandoned_fetch_takes_its_process_tree_with_it() {
        use hanging_fetch_test_support::*;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        let pid_file = init_repo_with_hanging_origin(&repo_path);

        let fetch_repo_path = repo_path.clone();
        let fetch =
            tokio::spawn(async move { fetch_origin(&fetch_repo_path, ORIGIN_FETCH_TIMEOUT).await });
        let helper_pid = wait_for_recorded_pid(&pid_file).await;
        let fetch_process_group = process_group_of(helper_pid);

        // Stands in for the request future being dropped: a renderer reload or an
        // aborted HTTP request cancels the fetch without it ever timing out.
        fetch.abort();

        assert_process_exits(helper_pid).await;
        assert!(
            !ACTIVE_FETCH_PROCESS_GROUPS.contains(&fetch_process_group),
            "an abandoned fetch must not stay registered"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_signals_the_process_group_of_a_running_fetch() {
        use hanging_fetch_test_support::*;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let repo_path = temp.path().join("repo");
        let pid_file = init_repo_with_hanging_origin(&repo_path);

        let fetch_repo_path = repo_path.clone();
        let fetch =
            tokio::spawn(
                async move { fetch_origin(&fetch_repo_path, Duration::from_secs(600)).await },
            );

        let helper_pid = wait_for_recorded_pid(&pid_file).await;
        let fetch_process_group = process_group_of(helper_pid);
        assert!(
            ACTIVE_FETCH_PROCESS_GROUPS.contains(&fetch_process_group),
            "a running fetch must be tracked so shutdown can find it"
        );
        assert_eq!(
            terminate_active_git_fetches(),
            1,
            "shutdown must report the fetch it signalled"
        );

        let succeeded = tokio::time::timeout(Duration::from_secs(30), fetch)
            .await
            .expect("signalling the process group must unblock the awaiting fetch")
            .expect("fetch task should not panic");
        assert!(!succeeded, "a signalled fetch must report failure");
        assert_process_exits(helper_pid).await;
    }

    #[tokio::test]
    async fn a_recent_fetch_is_reused_instead_of_repeated() {
        use hanging_fetch_test_support::*;

        let temp = tempfile::tempdir().expect("tempdir should be created");
        let origin_path = temp.path().join("origin");
        let clone_path = temp.path().join("clone");
        init_repo(&origin_path);
        clone_repo(&origin_path, &clone_path);

        assert!(
            fetch_origin(&clone_path, ORIGIN_FETCH_TIMEOUT).await,
            "fetching a reachable origin should succeed"
        );

        // Point origin at nothing: a second fetch inside the freshness window must
        // not run, so it cannot fail either.
        std::fs::remove_dir_all(&origin_path).expect("origin should be removable");
        assert!(
            fetch_origin(&clone_path, ORIGIN_FETCH_TIMEOUT).await,
            "a fetch moments after a successful one should be reused, not repeated"
        );
    }

    fn clone_repo(origin_path: &Path, clone_path: &Path) {
        let output = std::process::Command::new("git")
            .arg("clone")
            .arg(origin_path)
            .arg(clone_path)
            .output()
            .expect("git clone should run");
        assert!(
            output.status.success(),
            "git clone failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
