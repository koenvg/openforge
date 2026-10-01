#![cfg(all(target_os = "macos", feature = "test-fixtures"))]
#[allow(
    dead_code,
    reason = "shared fixture constructors serve other integration binaries"
)]
mod common;

use openforge_update_helper::InstallTransaction;
use std::{
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct OwnedLauncher {
    child: Child,
    root: PathBuf,
    boundary: &'static str,
}

impl OwnedLauncher {
    fn start(fixture: &common::Fixture, boundary: &'static str) -> Self {
        Self {
            child: Command::new(env!("CARGO_BIN_EXE_openforge-update-target-fixture"))
                .arg("--owned-launch")
                .arg(&fixture.state)
                .arg(&fixture.destination)
                .env_clear()
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .spawn()
                .unwrap(),
            root: fixture.state.clone(),
            boundary,
        }
    }

    fn paused_pid(&self) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match std::fs::read_to_string(self.root.join(format!("{}-paused", self.boundary))) {
                Ok(pid) => return pid.parse().unwrap(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    assert!(
                        Instant::now() < deadline,
                        "launcher did not reach the record boundary"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        }
    }
}

impl Drop for OwnedLauncher {
    fn drop(&mut self) {
        // Release the fixture pause, then let the still-owned launcher reap its child.
        let _ = std::fs::write(
            self.root.join(format!("resume-{}", self.boundary)),
            b"resume",
        );
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

struct OwnedApp(Child);
impl Drop for OwnedApp {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn prepared_fixture(boundary: &str) -> common::Fixture {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_openforge-update-target-fixture")).unwrap();
    let fixture = common::Fixture::with_target_bytes(&bytes);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    std::fs::write(
        fixture.state.join(format!("pause-before-{boundary}")),
        b"pause",
    )
    .unwrap();
    fixture
}

#[test]
fn the_app_cannot_execute_before_its_process_identity_is_durable() {
    let fixture = prepared_fixture("launch-record");
    let launcher = OwnedLauncher::start(&fixture, "launch-record");
    let pid = launcher.paused_pid();
    let envelope: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.state.join("current.json")).unwrap())
            .unwrap();
    let record: serde_json::Value =
        serde_json::from_str(envelope["payload"].as_str().unwrap()).unwrap();
    assert!(record["launched"].is_null());
    // Observing this grandchild grants no signal authority. Its owner handles cleanup.
    let observed = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .env_clear()
        .output()
        .unwrap();
    let executable = String::from_utf8(observed.stdout).unwrap();
    assert!(
        observed.status.success() && executable.trim().ends_with("/openforge-update-helper"),
        "app executed before recording its birth: {executable}"
    );
}

#[test]
fn a_bootstrap_refuses_missing_authority_and_replayed_admission() {
    let fixture = prepared_fixture("launch-record");
    std::fs::remove_file(fixture.state.join("pause-before-launch-record")).unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    let target = OwnedApp(transaction.launch("operation-one").unwrap());
    let admission = serde_json::json!({
        "root": fixture.state,
        "installation": "installation-one",
        "destination": fixture.destination,
        "operation": "operation-one",
    });
    for (input, expected) in [
        (serde_json::json!({}), "invalid app bootstrap admission"),
        (admission, "stale app bootstrap challenge"),
    ] {
        let mut child = Command::new(
            fixture
                .destination
                .join("Contents/MacOS/openforge-update-helper"),
        )
        .arg(openforge_update_helper::APP_BOOTSTRAP_ARGUMENT)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
        let sent = child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&input).unwrap());
        let output = child.wait_with_output().unwrap();
        sent.unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8(output.stdout).unwrap().contains(expected));
    }
    transaction
        .verify_launch("operation-one", target.0.id())
        .unwrap();
}

#[test]
fn loss_before_process_recording_retires_the_unreleased_gate_not_an_unknown_app() {
    loss_at_gate_boundary("launch-record", false);
}

#[test]
fn loss_after_recording_preserves_known_birth_and_keeps_rollback_fenced() {
    loss_at_gate_boundary("launch-release", true);
}

fn loss_at_gate_boundary(boundary: &'static str, recorded: bool) {
    let fixture = prepared_fixture(boundary);
    let mut launcher = OwnedLauncher::start(&fixture, boundary);
    let bootstrap_pid = launcher.paused_pid();
    launcher.child.kill().unwrap();
    launcher.child.wait().unwrap();
    // Never signal the orphan. Its inherited stream closes when its actual owner exits.
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let observed = Command::new("/bin/ps")
            .args(["-p", &bootstrap_pid.to_string(), "-o", "stat="])
            .env_clear()
            .output()
            .unwrap();
        let status = String::from_utf8(observed.stdout).unwrap();
        if !observed.status.success() || status.trim().starts_with('Z') {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "unreleased bootstrap survived its owner"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    std::fs::remove_file(fixture.state.join(format!("pause-before-{boundary}"))).unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    let running = transaction.launched_process_running("operation-one");
    if recorded {
        assert!(!running.unwrap());
    } else {
        // Missing identity stays unknown; recovery needs separate unreleased-gate proof.
        assert!(running.is_err());
    }
    let mut requester = OwnedApp(
        Command::new(fixture.destination.join("Contents/MacOS/Open Forge"))
            .env_clear()
            .env("OPENFORGE_ELECTRON_USER_DATA_DIR", fixture._temp.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn()
            .unwrap(),
    );
    transaction
        .prepare_relaunch("operation-one", requester.0.id())
        .unwrap();
    assert!(transaction
        .verify_launch("operation-one", requester.0.id())
        .is_err());
    requester.0.kill().unwrap();
    requester.0.wait().unwrap();
    let target = OwnedApp(transaction.relaunch("operation-one").unwrap());
    transaction
        .verify_launch("operation-one", target.0.id())
        .unwrap();
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
}
