#![cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
))]
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::{Error, OperationId, ReplacementPhase};
use std::{
    path::Path,
    time::{Duration, Instant},
};
#[path = "../../../tests/support/startup_gate.rs"]
mod startup_gate;
use startup_gate::StartupGate;

struct Fixture {
    root: tempfile::TempDir,
    gate: Option<StartupGate>,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("of-startup-")
            .tempdir_in("/tmp")
            .unwrap();
        let gate = Some(StartupGate::new(root.path()));
        Self { root, gate }
    }
    fn executable() -> &'static Path {
        Path::new(env!(
            "CARGO_BIN_EXE_openforge-session-daemon-fixture-startup"
        ))
    }
    fn launch(&self) -> Client {
        Client::launch(Self::executable(), self.root.path()).unwrap()
    }
    fn release(&mut self, allowed: bool) {
        self.gate.take().unwrap().finish(allowed);
    }
    fn wait_for_replacement(&self, client: &Client) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !client.capabilities().unwrap().supports_replacement {
            assert!(
                Instant::now() < deadline,
                "validated bootstrap never became available"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.gate.take());
        let cleanup = (|| -> Result<(), Error> {
            match Client::connect(self.root.path()) {
                Ok(client) => client.shutdown_empty()?,
                Err(Error::Transport(_)) => {}
                Err(error) => return Err(error),
            }
            let runtime = RuntimeDirectory::open_existing(self.root.path())?;
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(_launch) = runtime.claim_launch() {
                    if let Ok(_owner) = runtime.claim() {
                        return Ok(());
                    }
                }
                if Instant::now() >= deadline {
                    return Err(Error::AlreadyRunning);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })();
        if let Err(error) = cleanup {
            self.root.disable_cleanup(true);
            eprintln!(
                "retained startup fixture {}: {error}",
                self.root.path().display()
            );
            if !std::thread::panicking() {
                panic!("startup fixture cleanup is unknown");
            }
        }
    }
}

#[test]
fn ordinary_launch_and_reattachment_serve_before_image_preflight_is_ready() {
    let mut fixture = Fixture::new();
    let first = fixture.launch();
    fixture.gate.as_ref().unwrap().wait_until_entered();
    let client = Client::connect(fixture.root.path()).unwrap();
    assert_eq!(first.controller().lifetime, client.controller().lifetime);
    assert!(matches!(first.inventory(), Err(Error::StaleController)));
    assert!(client.inventory().unwrap().sessions.is_empty());
    client.register_sidecar(None).unwrap();
    assert!(!client.capabilities().unwrap().supports_replacement);
    assert!(matches!(
        client.replacement_phase(
            OperationId::parse("before-validation").unwrap(),
            ReplacementPhase::Prepare {
                executable: Fixture::executable().into()
            },
        ),
        Err(Error::UnsupportedReplacement)
    ));
    fixture.release(true);
    fixture.wait_for_replacement(&client);
    assert!(client.inventory().unwrap().sessions.is_empty());
}

#[test]
fn empty_shutdown_cancels_and_reaps_a_bootstrap_probe_still_waiting_for_readiness() {
    let fixture = Fixture::new();
    let client = fixture.launch();
    let gate = fixture.gate.as_ref().unwrap();
    gate.wait_until_entered();
    assert!(!client.capabilities().unwrap().supports_replacement);
    client.shutdown_empty().unwrap();
    // Passive peer EOF confirms the owned helper closed, without observing or signalling a PID.
    gate.wait_until_disconnected();
}

#[test]
fn refused_bootstrap_never_enables_replacement_but_keeps_ordinary_serving() {
    let mut fixture = Fixture::new();
    let client = fixture.launch();
    fixture.gate.as_ref().unwrap().wait_until_entered();
    fixture.release(false);
    let images = RuntimeDirectory::open_existing(fixture.root.path())
        .unwrap()
        .path()
        .join("images");
    let deadline = Instant::now() + Duration::from_secs(5);
    while std::fs::read_dir(&images).unwrap().next().is_some() {
        assert!(
            Instant::now() < deadline,
            "refused bootstrap retained its temporary image"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!client.capabilities().unwrap().supports_replacement);
    assert!(matches!(
        client.replacement_phase(
            OperationId::parse("after-refusal").unwrap(),
            ReplacementPhase::Prepare {
                executable: Fixture::executable().into()
            },
        ),
        Err(Error::UnsupportedReplacement)
    ));
    client.register_sidecar(None).unwrap();
    assert!(client.inventory().unwrap().sessions.is_empty());
}
