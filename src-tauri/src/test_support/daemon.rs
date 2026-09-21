//! Isolated daemon lifetime for host-boundary tests. Never uses app discovery.
use std::path::PathBuf;

pub(crate) struct DaemonFixture {
    pub root: tempfile::TempDir,
    pub executable: PathBuf,
}

impl DaemonFixture {
    pub fn new() -> Self {
        let executable = std::env::var_os("OPENFORGE_TEST_DAEMON")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_exe()
                    .expect("test executable")
                    .parent()
                    .and_then(std::path::Path::parent)
                    .expect("Cargo target directory")
                    .join("openforge-session-daemon")
            });
        let root = tempfile::Builder::new()
            .prefix("of-consumer-")
            .tempdir_in("/tmp")
            .expect("isolated runtime root");
        openforge_session_client::Client::launch(&executable, root.path())
            .expect("build the Session Daemon before running consumer contracts");
        Self { root, executable }
    }

    pub fn shells(&self) -> crate::pty_manager::PtyManager {
        let mut manager = crate::pty_manager::PtyManager::new();
        manager.set_pid_dir(self.root.path().join("legacy-pids"));
        manager.enable_daemon_shell(self.root.path().into(), self.executable.clone(), "*".into());
        manager
    }
}

impl Drop for DaemonFixture {
    fn drop(&mut self) {
        let cleanup = (|| -> Result<(), String> {
            let client = openforge_session_client::Client::connect(self.root.path())
                .map_err(|error| error.to_string())?;
            client
                .enable_operation_retirement()
                .map_err(|error| error.to_string())?;
            for session in client
                .inventory()
                .map_err(|error| error.to_string())?
                .sessions
            {
                client
                    .terminate_ordered(&session.pty)
                    .map_err(|error| error.to_string())?;
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while client.shutdown_empty().is_err() {
                if std::time::Instant::now() >= deadline {
                    return Err("daemon did not stop".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(())
        })();
        if let Err(error) = cleanup {
            self.root.disable_cleanup(true);
            eprintln!(
                "daemon cleanup failed: {error}; retained {}",
                self.root.path().display()
            );
            assert!(std::thread::panicking(), "daemon cleanup failed");
        }
    }
}
