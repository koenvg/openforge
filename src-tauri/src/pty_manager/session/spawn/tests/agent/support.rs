//! Shared scripted provider for agent PTY tests.

use crate::pty_manager::session::lifecycle::PtySessions;
use crate::pty_manager::session::provider_adapter::AgentPtyProviderAdapter;
use crate::pty_manager::PtyError;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

pub(super) const CONCURRENT_SPAWN_TIMEOUT: Duration = Duration::from_secs(15);

pub(super) struct LockCheckingAgentAdapter {
    pub(super) sessions: PtySessions,
    pub(super) prepared_tx: Option<mpsc::Sender<()>>,
    pub(super) command_release_rx: Option<mpsc::Receiver<()>>,
    pub(super) script: &'static str,
    pub(super) check_lock: bool,
}

impl LockCheckingAgentAdapter {
    fn assert_sessions_unlocked(&self, phase: &str) {
        if self.check_lock {
            assert!(
                self.sessions.try_lock().is_ok(),
                "sessions mutex should not be held during {phase}"
            );
        }
    }
}

impl AgentPtyProviderAdapter for LockCheckingAgentAdapter {
    fn label(&self) -> &'static str {
        "LockChecking"
    }

    fn command_name(&self) -> &'static str {
        "/bin/sh"
    }

    fn command_args(&self) -> Vec<String> {
        self.assert_sessions_unlocked("command argument construction");
        if let Some(release_rx) = &self.command_release_rx {
            release_rx
                .recv_timeout(CONCURRENT_SPAWN_TIMEOUT)
                .expect("test should release provider command construction");
        }
        // Keep test PTYs single-process so cleanup never waits on an orphan reaper.
        vec!["-lc".to_string(), format!("{}; exec sleep 5", self.script)]
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        self.assert_sessions_unlocked("provider preparation");
        if let Some(prepared_tx) = self.prepared_tx.take() {
            let _ = prepared_tx.send(());
        }
        Ok(())
    }

    fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
        self.assert_sessions_unlocked("provider environment construction");
        HashMap::new()
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }
}
