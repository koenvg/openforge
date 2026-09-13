use super::super::super::{PtyManager, PtyProcessDiagnosticSession, TerminalSessionLifecycleState};
use super::PtySessionKind;

impl PtyManager {
    pub async fn agent_pty_pid(&self, task_id: &str, pty_instance_id: Option<u64>) -> Option<u32> {
        if let Some(bridge) = self
            .daemon_shells
            .as_ref()
            .filter(|bridge| bridge.owns_agent(task_id))
        {
            let session = bridge.for_key(task_id).session().await.ok()??;
            return (session.exit_code.is_none()
                && pty_instance_id
                    .is_none_or(|instance| instance == session.pty.instance.value()))
            .then_some(session.pid);
        }
        let sessions = self.terminal_sessions.sessions.lock().await;
        let session = sessions.get(task_id)?;
        if !matches!(session.kind, PtySessionKind::Agent) {
            return None;
        }
        if pty_instance_id.is_some_and(|instance| session.instance_id != instance) {
            return None;
        }
        session.child.process_id()
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
