use super::*;
use openforge_session_host::contracts::{ordered_io_contract, spawn_retry_contract};
use std::path::Path;

pub(super) fn installation() -> InstallationId {
    InstallationId::parse("contract-installation").unwrap()
}
pub(super) fn operation(id: &str) -> OperationId {
    OperationId::parse(id).unwrap()
}
pub(super) fn shell(cwd: &Path) -> SpawnRequest {
    openforge_session_host::contracts::shell(cwd)
}

#[tokio::test]
async fn deterministic_adapter_satisfies_ordered_io_contract() {
    ordered_io_contract(
        &deterministic::host(installation()),
        &installation(),
        Path::new("/tmp"),
        false,
    )
    .await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn existing_adapter_satisfies_ordered_io_contract() {
    let fixture = ExistingFixture::new();
    ordered_io_contract(
        &fixture.host(),
        &installation(),
        fixture.directory.path(),
        false,
    )
    .await;
}
#[tokio::test]
async fn deterministic_adapter_satisfies_spawn_retry_contract() {
    spawn_retry_contract(
        &deterministic::host(installation()),
        &installation(),
        Path::new("/tmp"),
        false,
    )
    .await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn existing_adapter_satisfies_spawn_retry_contract() {
    let fixture = ExistingFixture::new();
    spawn_retry_contract(
        &fixture.host(),
        &installation(),
        fixture.directory.path(),
        false,
    )
    .await;
}

pub(super) struct ExistingFixture {
    pub(super) manager: crate::pty_manager::PtyManager,
    pub(super) directory: tempfile::TempDir,
}
impl ExistingFixture {
    pub(super) fn host(&self) -> impl PtyHost {
        self.manager.host(
            installation(),
            crate::app_events::AppEventBus::new(256, 256),
        )
    }
    pub(super) fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let mut manager = crate::pty_manager::PtyManager::new();
        manager.set_pid_dir(directory.path().join("pids"));
        Self { manager, directory }
    }
}
impl Drop for ExistingFixture {
    fn drop(&mut self) {
        let manager = self.manager.clone();
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(manager.kill_all());
        })
        .join()
        .unwrap();
    }
}
