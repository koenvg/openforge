//! Failure-path ownership for native PTY tests. Never scans installation PID directories.

use super::PtyManager;
use futures::FutureExt;
use std::{collections::HashSet, panic::AssertUnwindSafe, path::PathBuf};

pub(crate) struct NativePtyFixtureCleanup {
    manager: PtyManager,
    recovery_dir: Option<tempfile::TempDir>,
}

impl NativePtyFixtureCleanup {
    pub(crate) fn new(manager: &mut PtyManager) -> Self {
        let recovery_dir = tempfile::Builder::new()
            .prefix("openforge-test-pty-")
            .tempdir()
            .expect("private PTY recovery directory should create");
        manager.set_pid_dir(recovery_dir.path().join("pids"));
        Self {
            manager: manager.clone(),
            recovery_dir: Some(recovery_dir),
        }
    }

    pub(crate) fn pid_dir(&self) -> PathBuf {
        self.manager.get_pid_dir().expect("fixture PID directory")
    }

    pub(crate) fn finish(&mut self) -> Result<(), String> {
        let Some(recovery_dir) = self.recovery_dir.take() else {
            return Ok(());
        };
        // Drop may run inside a current-thread runtime, during unwind, on task abort,
        // or after the test runtime has shut down. A joined thread gives cleanup its
        // own executor and does not leave teardown to a cancelled runtime task.
        let result = std::thread::scope(|scope| {
            std::thread::Builder::new()
                .name("native-pty-fixture-cleanup".into())
                .spawn_scoped(scope, || {
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .map_err(|error| format!("cleanup runtime: {error}"))?;
                    runtime.block_on(async {
                        AssertUnwindSafe(self.cleanup_owned_sessions())
                            .catch_unwind()
                            .await
                            .unwrap_or_else(|_| Err("PTY fixture cleanup panicked".into()))
                    })
                })
                .map_err(|error| format!("cleanup thread: {error}"))?
                .join()
                .unwrap_or_else(|_| Err("PTY fixture cleanup thread panicked".into()))
        });
        if let Err(error) = result {
            let path = recovery_dir.keep();
            return Err(format!(
                "{error}; private PTY recovery metadata retained at {}",
                path.display()
            ));
        }
        Ok(())
    }

    async fn cleanup_owned_sessions(&self) -> Result<(), String> {
        let mut keys: HashSet<String> =
            self.manager.sessions.lock().await.keys().cloned().collect();
        keys.extend(self.manager.terminal_sessions.managed_recovery_keys().await);
        keys.extend(
            self.manager
                .process_diagnostic_sessions()
                .await
                .into_iter()
                .filter(|session| {
                    session.lifecycle_state == super::TerminalSessionLifecycleState::Cleaning
                })
                .map(|session| session.session_key),
        );
        keys.extend(
            self.manager
                .agent_spawn_generations
                .lock()
                .await
                .keys()
                .cloned(),
        );
        keys.extend(
            self.manager
                .pending_shell_spawns
                .iter()
                .map(|entry| entry.key().clone()),
        );
        let mut failures = Vec::new();
        for key in keys {
            // Canonical managed cleanup uses the in-memory identity, verifies
            // process start identity before signalling, and retains failures.
            if let Err(error) = self.manager.try_cleanup_native_fixture_pty(&key).await {
                failures.push(format!("{key}: {error}"));
            }
        }
        // EOF finalizers and interrupted cleanup futures can own a process outside
        // the registered/recovery maps. Remaining records mean completion is not
        // established. Preserve them, but never trust or signal disk-only identities.
        let pid_dir = self.pid_dir();
        match std::fs::read_dir(&pid_dir) {
            Ok(mut entries) => match entries.next() {
                Some(Ok(_)) => failures.push(format!(
                    "private PTY metadata remains at {}; cleanup completion is unknown",
                    pid_dir.display()
                )),
                Some(Err(error)) => failures.push(format!("reading private PTY metadata: {error}")),
                None => {}
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => failures.push(format!("reading private PTY metadata: {error}")),
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }
}

impl Drop for NativePtyFixtureCleanup {
    fn drop(&mut self) {
        if let Err(error) = self.finish() {
            // A second panic would mask an assertion failure or turn task
            // cancellation into a panic. Success paths can check finish explicitly.
            eprintln!("native PTY fixture cleanup failed: {error}");
        }
    }
}
