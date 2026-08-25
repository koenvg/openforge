//! Publication and persistence of newly spawned PTY sessions.

use log::info;
use std::path::Path;

use super::super::super::managed_process::ManagedProcessIdentity;
use super::super::super::pids::write_managed_process_identity;
use super::super::super::{PtyError, PtyManager};
use super::super::lifecycle::PtySession;

pub(super) struct SessionRegistrationRequest<'a> {
    pub(super) session_key: &'a str,
    pub(super) generation: u64,
    pub(super) session: PtySession,
    pub(super) replacement_label: &'a str,
    pub(super) stale_error: PtyError,
}

impl PtyManager {
    pub(super) async fn register_spawned_session(
        &self,
        request: SessionRegistrationRequest<'_>,
    ) -> Result<(), PtyError> {
        let SessionRegistrationRequest {
            session_key,
            generation,
            session,
            replacement_label,
            stale_error,
        } = request;
        let mut pending_session = Some(session);
        let replaced_session = {
            let generations = self.agent_spawn_generations.lock().await;
            let registration_is_stale = generations
                .get(session_key)
                .map(|current| *current != generation)
                .unwrap_or(true);
            if registration_is_stale {
                None
            } else {
                self.sessions.lock().await.insert(
                    session_key.to_string(),
                    pending_session.take().expect("pending PTY session"),
                )
            }
        };

        if let Some(stale_session) = pending_session {
            self.terminate_or_retain_unregistered_session(session_key, stale_session)
                .await?;
            return Err(stale_error);
        }

        if let Some(mut replaced_session) = replaced_session {
            info!("[PTY] Replacing existing {replacement_label} PTY for session {session_key}");
            self.terminate_session_process(session_key, &mut replaced_session)
                .await?;
            self.clear_session_tracking(session_key).await;
        }
        Ok(())
    }

    pub(super) async fn persist_session_identity(
        &self,
        session_key: &str,
        pid_file: &Path,
        managed_process: &ManagedProcessIdentity,
    ) -> Result<(), PtyError> {
        if let Err(error) = write_managed_process_identity(pid_file, managed_process) {
            if let Some(failed_session) = self.sessions.lock().await.remove(session_key) {
                self.terminate_or_retain_unregistered_session(session_key, failed_session)
                    .await?;
            }
            self.clear_session_tracking(session_key).await;
            return Err(error);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/registration.rs"]
mod tests;
