pub(super) struct DaemonFixture(pub(super) tempfile::TempDir);
impl Drop for DaemonFixture {
    fn drop(&mut self) {
        let cleanup = (|| -> Result<(), String> {
            let client = openforge_session_client::Client::connect(self.0.path())
                .map_err(|e| e.to_string())?;
            client
                .enable_operation_retirement()
                .map_err(|e| e.to_string())?;
            for session in client.inventory().map_err(|e| e.to_string())?.sessions {
                client
                    .terminate_ordered(&session.pty)
                    .map_err(|e| e.to_string())?;
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while client.shutdown_empty().is_err() {
                if std::time::Instant::now() >= deadline {
                    return Err("fixture daemon did not stop".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(())
        })();
        if let Err(error) = cleanup {
            self.0.disable_cleanup(true);
            eprintln!(
                "daemon fixture cleanup failed: {error}; retained {}",
                self.0.path().display()
            );
            assert!(std::thread::panicking(), "daemon fixture cleanup failed");
        }
    }
}
