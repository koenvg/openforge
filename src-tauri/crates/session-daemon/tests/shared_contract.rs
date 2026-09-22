use openforge_session_client::Client;
use openforge_session_host::{contracts, InstallationId};

const REPLACEMENT_FIXTURES: bool = cfg!(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
));
struct Fixture {
    root: tempfile::TempDir,
    client: Client,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("of-contract-")
            .tempdir_in("/tmp")
            .unwrap();
        let client = Client::launch(
            std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            root.path(),
        )
        .unwrap();
        Self { root, client }
    }
    fn installation(&self) -> InstallationId {
        self.client.controller().installation.clone()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let client = Client::connect(self.root.path()).unwrap();
        for session in client.inventory().unwrap().sessions {
            client
                .terminate(
                    &format!("cleanup-{}", session.pty.instance.value()),
                    &session.pty,
                )
                .unwrap();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while client.shutdown_empty().is_err() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

#[tokio::test]
async fn daemon_satisfies_shared_spawn_retry_contract() {
    let fixture = Fixture::new();
    contracts::spawn_retry_contract(
        &fixture.client,
        &fixture.installation(),
        fixture.root.path(),
        REPLACEMENT_FIXTURES,
    )
    .await;
    let inventory = Client::connect(fixture.root.path())
        .unwrap()
        .inventory()
        .unwrap();
    assert!(!inventory.sessions.is_empty());
    for session in inventory.sessions {
        assert_eq!(
            serde_json::to_value(session).unwrap()["cwd"],
            fixture
                .root
                .path()
                .canonicalize()
                .unwrap()
                .to_str()
                .unwrap(),
            "inventory retains the immutable spawn directory for discovery after reconnect"
        );
    }
}

#[tokio::test]
async fn daemon_satisfies_shared_ordered_io_contract() {
    let fixture = Fixture::new();
    contracts::ordered_io_contract(
        &fixture.client,
        &fixture.installation(),
        fixture.root.path(),
        REPLACEMENT_FIXTURES,
    )
    .await;
}
