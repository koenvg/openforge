use std::sync::atomic::Ordering;

use super::super::super::{
    PtyError, PtyManager, PtyProcessDiagnosticSession, TerminalSessionLifecycleState,
};

impl PtyManager {
    pub async fn interrupt_claude(&self, task_id: &str) -> Result<(), PtyError> {
        let sessions = self.terminal_sessions.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let pid = session
            .child
            .process_id()
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        unsafe {
            libc::kill(pid as i32, libc::SIGINT);
        }

        Ok(())
    }

    pub async fn check_claude_frozen(&self, task_id: &str) -> Option<u64> {
        let pid = {
            let sessions = self.terminal_sessions.sessions.lock().await;
            let session = sessions.get(task_id)?;
            session.child.process_id()?
        };

        let is_alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        if !is_alive {
            return None;
        }

        let times = self.terminal_sessions.last_output.lock().await;
        let last_output_ms = times.get(task_id)?.load(Ordering::Relaxed);

        let now_ms = crate::unix_timestamp::milliseconds(std::time::SystemTime::now()).ok()?;

        frozen_seconds(last_output_ms, now_ms)
    }

    /// Returns the keys of all active PTY sessions.
    pub async fn get_session_keys(&self) -> Vec<String> {
        let sessions = self.terminal_sessions.sessions.lock().await;
        sessions.keys().cloned().collect()
    }

    /// Returns read-only snapshots of live, cleaning, and recovery-owned PTY roots.
    pub async fn process_diagnostic_sessions(&self) -> Vec<PtyProcessDiagnosticSession> {
        let mut diagnostics: Vec<PtyProcessDiagnosticSession> = {
            let sessions = self.terminal_sessions.sessions.lock().await;
            sessions
                .iter()
                .map(|(session_key, session)| PtyProcessDiagnosticSession {
                    session_key: session_key.clone(),
                    task_id: session
                        .kind
                        .task_id_for_session_key(session_key)
                        .to_string(),
                    session_kind: session.kind.diagnostic_kind().to_string(),
                    lifecycle_state: TerminalSessionLifecycleState::Live,
                    pid: session.child.process_id(),
                    pty_instance_id: session.instance_id,
                    pid_file_name: session.pid_file_name.clone(),
                })
                .collect()
        };
        let recoveries = self.terminal_sessions.managed_recoveries.lock().await;
        for (base_key, entries) in recoveries.iter() {
            diagnostics.extend(entries.iter().map(|recovery| {
                PtyProcessDiagnosticSession {
                    session_key: recovery.recovery_key.clone(),
                    task_id: recovery
                        .session
                        .kind
                        .task_id_for_session_key(base_key)
                        .to_string(),
                    session_kind: recovery.session.kind.diagnostic_kind().to_string(),
                    lifecycle_state: TerminalSessionLifecycleState::ManagedRecovery,
                    pid: recovery.session.child.process_id(),
                    pty_instance_id: recovery.session.instance_id,
                    pid_file_name: recovery.session.pid_file_name.clone(),
                }
            }));
        }
        drop(recoveries);
        let cleaning_sessions = self.terminal_sessions.cleaning_sessions.lock().await;
        diagnostics.extend(cleaning_sessions.iter().map(
            |((session_key, _instance_id), cleaning)| PtyProcessDiagnosticSession {
                session_key: session_key.clone(),
                task_id: cleaning.task_id.clone(),
                session_kind: cleaning.session_kind.clone(),
                lifecycle_state: TerminalSessionLifecycleState::Cleaning,
                pid: cleaning.pid,
                pty_instance_id: cleaning.instance_id,
                pid_file_name: cleaning.pid_file_name.clone(),
            },
        ));
        diagnostics.sort_by(|left, right| {
            left.task_id
                .cmp(&right.task_id)
                .then_with(|| left.session_key.cmp(&right.session_key))
                .then_with(|| left.pty_instance_id.cmp(&right.pty_instance_id))
        });
        diagnostics
    }
}

pub(in super::super::super) fn frozen_seconds(last_output_ms: u64, now_ms: u64) -> Option<u64> {
    if last_output_ms == 0 {
        return None;
    }
    let elapsed_secs = now_ms.saturating_sub(last_output_ms) / 1000;
    if elapsed_secs >= 15 {
        Some(elapsed_secs)
    } else {
        None
    }
}
