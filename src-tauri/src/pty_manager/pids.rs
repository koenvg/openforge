use log::{info, warn};
use std::fmt;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::managed_process::{terminate_managed_process_tree, ManagedProcessIdentity};
use super::{PtyError, PtyManager};

pub(super) const MANAGED_PROCESS_TERM_TIMEOUT: Duration = Duration::from_secs(2);
static NEXT_METADATA_TEMP_ID: AtomicU64 = AtomicU64::new(1);

pub(super) fn write_managed_process_identity(
    path: &Path,
    identity: &ManagedProcessIdentity,
) -> Result<(), PtyError> {
    let contents = serde_json::to_vec_pretty(identity).map_err(|error| {
        PtyError::CleanupFailed(format!("failed to serialize process identity: {error}"))
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| PtyError::CleanupFailed("invalid process metadata path".to_string()))?;
    let temporary_path = path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        NEXT_METADATA_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let write_result = (|| -> io::Result<()> {
        let mut temporary_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        temporary_file.write_all(&contents)?;
        temporary_file.sync_all()?;
        std::fs::hard_link(&temporary_path, path)?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&temporary_path);

    write_result.map_err(|error| {
        let detail = if error.kind() == io::ErrorKind::AlreadyExists {
            "existing recovery metadata was preserved; refusing to replace it".to_string()
        } else {
            error.to_string()
        };
        PtyError::CleanupFailed(format!(
            "failed to publish process identity at {}: {detail}",
            path.display()
        ))
    })
}

pub(super) async fn terminate_and_remove_managed_process(
    identity: &ManagedProcessIdentity,
    pid_file: &Path,
    context: &str,
) -> Result<(), PtyError> {
    terminate_managed_process_tree(identity, MANAGED_PROCESS_TERM_TIMEOUT)
        .await
        .map_err(|error| {
            warn!(
                "[PTY cleanup] {} failed; preserving recovery metadata at {}: {}",
                context,
                pid_file.display(),
                error
            );
            PtyError::CleanupFailed(format!("{context}: {error}"))
        })?;

    let contents = match std::fs::read_to_string(pid_file) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(PtyError::CleanupFailed(format!(
                "{context} terminated, but recovery metadata {} could not be read: {error}",
                pid_file.display()
            )))
        }
    };
    let current_identity: ManagedProcessIdentity =
        serde_json::from_str(&contents).map_err(|error| {
            PtyError::CleanupFailed(format!(
            "{context} terminated, but recovery metadata {} is not a verifiable identity: {error}",
            pid_file.display()
        ))
        })?;
    if current_identity != *identity {
        return Err(PtyError::CleanupFailed(format!(
            "{context} terminated, but recovery metadata {} belongs to a different process identity; preserving it",
            pid_file.display()
        )));
    }
    std::fs::remove_file(pid_file).map_err(|error| {
        PtyError::CleanupFailed(format!(
            "{context} terminated, but recovery metadata {} could not be removed: {error}",
            pid_file.display()
        ))
    })
}

fn process_exists(pid: i32) -> Result<bool, String> {
    if pid <= 1 {
        return Err(format!(
            "legacy process PID must be greater than 1, got {pid}"
        ));
    }
    // SAFETY: libc::kill with signal 0 performs an existence/permission probe and
    // does not deliver a signal. The guard above ensures the target is one positive,
    // non-system PID rather than kill's reserved 0 or -1 process-set targets.
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ESRCH) => Ok(false),
        Some(libc::EPERM) => Ok(true),
        _ => Err(format!("failed to probe legacy process PID {pid}: {error}")),
    }
}
fn remove_legacy_pid_metadata(path: &Path) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|error| {
        format!(
            "legacy PID metadata {} could not be removed: {error}",
            path.display()
        )
    })
}

impl PtyManager {
    /// Recovers verified managed PTY trees left behind by a previous sidecar.
    /// Metadata is removed only after the full tree exits; unverifiable or
    /// failed records remain on disk for diagnostics and a later retry.
    pub async fn cleanup_stale_pids(&self) -> Result<(), PtyError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        let mut failures = Vec::new();
        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !is_pty_pid_file_name(name) {
                continue;
            }

            let contents = match std::fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(error) => {
                    warn!(
                        "[PTY recovery] Failed to read {}; preserving metadata: {}",
                        path.display(),
                        error
                    );
                    failures.push(format!("{}: {error}", path.display()));
                    continue;
                }
            };

            if let Ok(identity) = serde_json::from_str::<ManagedProcessIdentity>(&contents) {
                let context = format!("startup recovery for {name}");
                match terminate_and_remove_managed_process(&identity, &path, &context).await {
                    Ok(()) => info!("[PTY recovery] Recovered managed process tree for {name}"),
                    Err(error) => failures.push(error.to_string()),
                }
                continue;
            }

            match contents.trim().parse::<i32>() {
                Ok(pid) if pid <= 1 => {
                    warn!(
                        "[PTY recovery] Removing invalid reserved PID metadata {}: {}",
                        path.display(),
                        pid
                    );
                    if let Err(error) = remove_legacy_pid_metadata(&path) {
                        warn!("[PTY recovery] {error}");
                        failures.push(error);
                    }
                }
                Ok(pid) => match process_exists(pid) {
                    Ok(true) => {
                        let message = format!(
                            "legacy PID metadata {} names live PID {} without a process start identity; refusing to signal it because the PID may have been reused",
                            path.display(),
                            pid
                        );
                        warn!("[PTY recovery] {}; preserving metadata", message);
                        failures.push(message);
                    }
                    Ok(false) => {
                        info!(
                            "[PTY recovery] Removing legacy metadata for an exited process: {}",
                            path.display()
                        );
                        if let Err(error) = remove_legacy_pid_metadata(&path) {
                            warn!("[PTY recovery] {error}");
                            failures.push(error);
                        }
                    }
                    Err(error) => {
                        warn!(
                            "[PTY recovery] Failed to probe PID from {}; preserving metadata: {}",
                            path.display(),
                            error
                        );
                        failures.push(format!("{}: {error}", path.display()));
                    }
                },
                Err(error) => {
                    warn!(
                        "[PTY recovery] Removing invalid PID metadata {}: {}",
                        path.display(),
                        error
                    );
                    if let Err(error) = remove_legacy_pid_metadata(&path) {
                        warn!("[PTY recovery] {error}");
                        failures.push(error);
                    }
                }
            }
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(PtyError::CleanupFailed(failures.join("; ")))
        }
    }

    // ============================================================================
    // Private Helper Methods
    // ============================================================================

    /// Returns the PID directory path
    pub(super) fn get_pid_dir(&self) -> Result<PathBuf, PtyError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            PtyError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        let pids_dir_name = if cfg!(debug_assertions) {
            "pids-dev"
        } else {
            "pids"
        };
        Ok(home.join(".openforge").join(pids_dir_name))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PtySessionKey<'a> {
    Agent {
        task_id: &'a str,
    },
    Shell {
        task_id: &'a str,
        terminal_index: u32,
    },
}

impl<'a> PtySessionKey<'a> {
    fn indexed_shell(task_id: &'a str, terminal_index: u32) -> Self {
        Self::Shell {
            task_id,
            terminal_index,
        }
    }

    fn parse(session_key: &'a str) -> Self {
        if let Some((task_id, shell_index)) = session_key.rsplit_once("-shell-") {
            if !task_id.is_empty() && shell_index.chars().all(|ch| ch.is_ascii_digit()) {
                if let Ok(terminal_index) = shell_index.parse::<u32>() {
                    return Self::indexed_shell(task_id, terminal_index);
                }
            }
        }

        Self::Agent {
            task_id: session_key,
        }
    }
}

impl fmt::Display for PtySessionKey<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent { task_id } => formatter.write_str(task_id),
            Self::Shell {
                task_id,
                terminal_index,
            } => write!(formatter, "{task_id}-shell-{terminal_index}"),
        }
    }
}

pub(crate) fn shell_session_key(task_id: &str, terminal_index: Option<u32>) -> String {
    PtySessionKey::indexed_shell(task_id, terminal_index.unwrap_or_default()).to_string()
}

#[cfg(test)]
pub(super) fn is_shell_session_key_for_task(session_key: &str, task_id: &str) -> bool {
    matches!(
        PtySessionKey::parse(session_key),
        PtySessionKey::Shell {
            task_id: shell_task_id,
            ..
        } if shell_task_id == task_id
    )
}

pub(super) fn pid_file_name_for_session_key(session_key: &str) -> String {
    match PtySessionKey::parse(session_key) {
        PtySessionKey::Agent { task_id } => format!("{}-pty.pid", task_id),
        PtySessionKey::Shell { .. } => format!("{}.pid", session_key),
    }
}

#[cfg(test)]
pub(super) fn shell_pid_file_name(task_id: &str, terminal_index: Option<u32>) -> String {
    pid_file_name_for_session_key(&shell_session_key(task_id, terminal_index))
}

fn is_pty_pid_file_name(name: &str) -> bool {
    managed_session_key_from_pid_file_name(name).is_some()
}

fn managed_session_key_from_pid_file_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".pid")?;

    if let Some(task_id) = stem.strip_suffix("-pty") {
        return (!task_id.is_empty()).then(|| task_id.to_string());
    }

    if let Some(task_id) = stem.strip_suffix("-claude") {
        return (!task_id.is_empty()).then(|| task_id.to_string());
    }

    if let Some(task_id) = stem.strip_suffix("-shell") {
        return (!task_id.is_empty()).then(|| shell_session_key(task_id, None));
    }

    match PtySessionKey::parse(stem) {
        PtySessionKey::Shell { .. } => Some(stem.to_string()),
        PtySessionKey::Agent { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;
    use sysinfo::{Pid, ProcessStatus, System};

    #[test]
    fn classifies_indexed_shell_session_keys() {
        assert_eq!(
            PtySessionKey::parse("task-1-shell-2"),
            PtySessionKey::Shell {
                task_id: "task-1",
                terminal_index: 2,
            }
        );
    }

    #[test]
    fn constructs_and_parses_indexed_shell_session_keys_through_typed_contract() {
        let session_key = PtySessionKey::indexed_shell("task-1", 2);

        assert_eq!(session_key.to_string(), "task-1-shell-2");
        assert_eq!(PtySessionKey::parse("task-1-shell-2"), session_key);
    }

    #[test]
    fn does_not_classify_agent_task_ids_with_shell_text_as_shells() {
        assert_eq!(
            PtySessionKey::parse("task-shell-feature"),
            PtySessionKey::Agent {
                task_id: "task-shell-feature",
            }
        );
    }

    #[test]
    fn derives_pid_file_names_from_session_keys() {
        assert_eq!(
            pid_file_name_for_session_key("task-1-shell-2"),
            "task-1-shell-2.pid"
        );
        assert_eq!(
            pid_file_name_for_session_key("task-shell-feature"),
            "task-shell-feature-pty.pid"
        );
    }

    #[test]
    fn classifies_managed_pid_files_through_one_parser() {
        assert!(is_pty_pid_file_name("task-1-shell-2.pid"));
        assert!(is_pty_pid_file_name("task-shell-feature-pty.pid"));
        assert!(is_pty_pid_file_name("task-1-claude.pid"));
        assert!(!is_pty_pid_file_name("task-1-shell-x.pid"));
    }

    fn process_is_alive(pid: i32) -> bool {
        let system = System::new_all();
        system
            .process(Pid::from(pid as usize))
            .is_some_and(|process| !matches!(process.status(), ProcessStatus::Zombie))
    }

    fn spawn_recovery_tree(descendant_pid_file: &Path) -> Child {
        let script = format!(
            "trap '' TERM; (trap '' TERM; exec sleep 30) & echo $! > '{}'; wait",
            descendant_pid_file.display()
        );
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: the pre_exec closure runs after fork and calls only libc::setsid,
        // an async-signal-safe operation, then immediately captures errno on failure.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        command.spawn().expect("recovery tree should spawn")
    }

    fn wait_for_parseable_pid(root: &mut Child, path: &Path) -> i32 {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Ok(contents) = std::fs::read_to_string(path) {
                if let Ok(pid) = contents.trim().parse() {
                    return pid;
                }
            }
            if Instant::now() >= deadline {
                super::super::managed_process::force_kill_unverified_spawn(root.id())
                    .expect("timed-out recovery process tree should accept SIGKILL");
                let _ = root.wait();
                panic!("descendant PID file did not contain a PID");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    async fn cleanup_with_read_only_pid_dir(
        manager: &PtyManager,
        pid_dir: &Path,
    ) -> Result<(), PtyError> {
        std::fs::set_permissions(pid_dir, std::fs::Permissions::from_mode(0o500))
            .expect("PID directory should become read-only");
        let result = manager.cleanup_stale_pids().await;
        std::fs::set_permissions(pid_dir, std::fs::Permissions::from_mode(0o700))
            .expect("PID directory permissions should be restored");
        result
    }

    #[tokio::test]
    async fn startup_recovery_reports_invalid_legacy_metadata_removal_failure() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let pid_file = temp_dir.path().join("invalid-pty.pid");
        std::fs::write(&pid_file, "not a PID").expect("legacy PID metadata should write");
        let mut manager = PtyManager::new();
        manager.set_pid_dir(temp_dir.path().to_path_buf());
        let result = cleanup_with_read_only_pid_dir(&manager, temp_dir.path()).await;
        let error = result.expect_err("metadata deletion failure should be reported");
        assert!(
            error.to_string().contains("could not be removed"),
            "unexpected cleanup error: {error}"
        );
        assert!(
            pid_file.exists(),
            "failed deletion should leave metadata observable"
        );
    }

    #[tokio::test]
    async fn startup_recovery_reports_exited_legacy_metadata_removal_failure() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let pid_file = temp_dir.path().join("exited-pty.pid");
        let mut exited_process = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .expect("short-lived process should spawn");
        let exited_pid = i32::try_from(exited_process.id()).expect("PID should fit in i32");
        exited_process
            .wait()
            .expect("short-lived process should exit");
        assert_eq!(process_exists(exited_pid), Ok(false));
        std::fs::write(&pid_file, exited_pid.to_string())
            .expect("legacy PID metadata should write");
        let mut manager = PtyManager::new();
        manager.set_pid_dir(temp_dir.path().to_path_buf());

        let result = cleanup_with_read_only_pid_dir(&manager, temp_dir.path()).await;

        let error = result.expect_err("metadata deletion failure should be reported");
        assert!(error.to_string().contains("could not be removed"));
        assert!(
            pid_file.exists(),
            "failed deletion should preserve metadata"
        );
    }

    #[tokio::test]
    async fn startup_recovery_removes_legacy_metadata_with_reserved_pid() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let pid_file = temp_dir.path().join("reserved-pty.pid");
        std::fs::write(&pid_file, "0").expect("legacy PID metadata should write");
        let mut manager = PtyManager::new();
        manager.set_pid_dir(temp_dir.path().to_path_buf());

        manager
            .cleanup_stale_pids()
            .await
            .expect("reserved legacy PID metadata should be discarded");

        assert!(!pid_file.exists(), "reserved PID metadata survived cleanup");
    }

    #[tokio::test]
    async fn startup_recovery_terminates_verified_root_and_descendant() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let descendant_pid_file = temp_dir.path().join("descendant.pid");
        let mut root = spawn_recovery_tree(&descendant_pid_file);
        let descendant_pid = wait_for_parseable_pid(&mut root, &descendant_pid_file);
        let identity = ManagedProcessIdentity::capture(root.id()).expect("identity should capture");
        let pid_file = temp_dir.path().join("startup-shell-0.pid");
        write_managed_process_identity(&pid_file, &identity).expect("identity should persist");
        let mut manager = PtyManager::new();
        manager.set_pid_dir(temp_dir.path().to_path_buf());

        manager
            .cleanup_stale_pids()
            .await
            .expect("verified stale tree should recover");
        let _ = root.try_wait();

        assert!(
            !pid_file.exists(),
            "successful recovery should remove metadata"
        );
        assert!(
            !process_is_alive(identity.root_pid),
            "stale root survived recovery"
        );
        assert!(
            !process_is_alive(descendant_pid),
            "stale descendant survived recovery"
        );
    }

    #[tokio::test]
    async fn startup_recovery_preserves_metadata_on_start_identity_mismatch() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let descendant_pid_file = temp_dir.path().join("descendant.pid");
        let mut root = spawn_recovery_tree(&descendant_pid_file);
        wait_for_parseable_pid(&mut root, &descendant_pid_file);
        let mut identity =
            ManagedProcessIdentity::capture(root.id()).expect("identity should capture");
        identity.root_start_time = identity.root_start_time.saturating_sub(1);
        let pid_file = temp_dir.path().join("mismatch-pty.pid");
        write_managed_process_identity(&pid_file, &identity).expect("identity should persist");
        let mut manager = PtyManager::new();
        manager.set_pid_dir(temp_dir.path().to_path_buf());

        let result = manager.cleanup_stale_pids().await;

        assert!(result.is_err(), "identity mismatch must fail closed");
        assert!(pid_file.exists(), "failed recovery must preserve metadata");
        assert!(
            process_is_alive(identity.root_pid),
            "mismatched PID was signaled"
        );
        super::super::managed_process::force_kill_unverified_spawn(root.id())
            .expect("mismatched recovery process tree should accept SIGKILL");
        let _ = root.try_wait();
    }
}
