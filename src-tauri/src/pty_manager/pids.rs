use log::info;
use std::io;
use std::path::PathBuf;

use super::{PtyError, PtyManager};

impl PtyManager {
    /// Cleans up stale PID files for processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), PtyError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Process PTY PID files, including legacy task-scoped shell PIDs
            // and indexed shell PIDs like task-shell-0.pid.
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !is_pty_pid_file_name(name) {
                    continue;
                }
            } else {
                continue;
            }

            let pid_str = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let pid: i32 = match pid_str.trim().parse() {
                Ok(p) => p,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };

            let is_running = unsafe {
                libc::kill(pid, 0) == 0 // Signal 0 checks process existence
            };

            if !is_running {
                info!(
                    "[cleanup] Removing stale PTY PID file (process dead): {:?}",
                    path
                );
                let _ = std::fs::remove_file(&path);
            } else {
                // Process is alive — verify it's actually opencode before killing
                let is_opencode = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|output| {
                        let cmd = String::from_utf8_lossy(&output.stdout);
                        cmd.contains("opencode")
                    })
                    .unwrap_or(false);

                if is_opencode {
                    info!(
                        "[cleanup] Killing orphaned opencode PTY process (PID: {})",
                        pid
                    );
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    // Brief wait for graceful shutdown
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    // Check if still running, force kill if needed
                    let still_running = unsafe { libc::kill(pid, 0) == 0 };
                    if still_running {
                        info!("[cleanup] Force killing PTY process (PID: {})", pid);
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                } else {
                    info!("[cleanup] PID {} is not opencode (PID reuse), removing stale PTY file: {:?}", pid, path);
                }
                let _ = std::fs::remove_file(&path);
            }
        }

        Ok(())
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
pub(super) enum PtySessionKeyKind<'a> {
    Agent {
        task_id: &'a str,
    },
    Shell {
        task_id: &'a str,
        terminal_index: u32,
    },
}

pub(super) fn shell_session_key(task_id: &str, terminal_index: Option<u32>) -> String {
    if let Some(idx) = terminal_index {
        format!("{}-shell-{}", task_id, idx)
    } else {
        format!("{}-shell-0", task_id)
    }
}

pub(super) fn classify_pty_session_key(session_key: &str) -> PtySessionKeyKind<'_> {
    if let Some((task_id, shell_index)) = session_key.rsplit_once("-shell-") {
        if !task_id.is_empty() && shell_index.chars().all(|ch| ch.is_ascii_digit()) {
            if let Ok(terminal_index) = shell_index.parse::<u32>() {
                return PtySessionKeyKind::Shell {
                    task_id,
                    terminal_index,
                };
            }
        }
    }

    PtySessionKeyKind::Agent {
        task_id: session_key,
    }
}

#[cfg(test)]
pub(super) fn is_shell_session_key_for_task(session_key: &str, task_id: &str) -> bool {
    matches!(
        classify_pty_session_key(session_key),
        PtySessionKeyKind::Shell {
            task_id: shell_task_id,
            ..
        } if shell_task_id == task_id
    )
}

pub(super) fn pid_file_name_for_session_key(session_key: &str) -> String {
    match classify_pty_session_key(session_key) {
        PtySessionKeyKind::Agent { task_id } => format!("{}-pty.pid", task_id),
        PtySessionKeyKind::Shell { .. } => format!("{}.pid", session_key),
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

    match classify_pty_session_key(stem) {
        PtySessionKeyKind::Shell { .. } => Some(stem.to_string()),
        PtySessionKeyKind::Agent { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_indexed_shell_session_keys() {
        assert_eq!(
            classify_pty_session_key("task-1-shell-2"),
            PtySessionKeyKind::Shell {
                task_id: "task-1",
                terminal_index: 2,
            }
        );
    }

    #[test]
    fn does_not_classify_agent_task_ids_with_shell_text_as_shells() {
        assert_eq!(
            classify_pty_session_key("task-shell-feature"),
            PtySessionKeyKind::Agent {
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
}
