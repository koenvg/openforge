use super::super::{ManagedRecovery, TerminalSessions};
use super::PtySession;

/// Owns legacy native teardown until success. Dropping an unfinished operation
/// returns the entire session, including its child reaper, to in-memory recovery.
/// This does not cover spawn-stage ownership or the release Session Daemon.
pub(in super::super::super) struct RetainedCleanup {
    sessions: TerminalSessions,
    session_key: String,
    recovery: Option<ManagedRecovery>,
}

impl RetainedCleanup {
    pub(in super::super) fn new(
        sessions: &TerminalSessions,
        session_key: &str,
        recovery: ManagedRecovery,
    ) -> Self {
        Self {
            sessions: sessions.clone(),
            session_key: session_key.to_string(),
            recovery: Some(recovery),
        }
    }

    pub(in super::super) fn current(
        sessions: &TerminalSessions,
        session_key: &str,
        session: PtySession,
    ) -> Self {
        Self::new(
            sessions,
            session_key,
            ManagedRecovery {
                recovery_key: session_key.to_string(),
                session,
            },
        )
    }

    pub(in super::super) fn recovery_mut(&mut self) -> &mut ManagedRecovery {
        // Only complete consumes the recovery, and it also consumes this guard.
        self.recovery
            .as_mut()
            .expect("unfinished cleanup owns a recovery")
    }

    pub(in super::super) fn session_mut(&mut self) -> &mut PtySession {
        &mut self.recovery_mut().session
    }

    pub(in super::super) fn complete(mut self) {
        self.recovery.take();
    }
}

impl Drop for RetainedCleanup {
    fn drop(&mut self) {
        if let Some(recovery) = self.recovery.take() {
            // Drop cannot await. This registry lock is held only for synchronous
            // map operations, never during process termination or other awaits.
            self.sessions
                .restore_managed_recovery(&self.session_key, recovery);
        }
    }
}
