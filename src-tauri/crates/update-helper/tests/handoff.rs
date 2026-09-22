#![cfg(target_os = "macos")]

mod common;

use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

struct Helper {
    child: Child,
    lines: mpsc::Receiver<String>,
    _copy: tempfile::TempDir,
}

impl Helper {
    fn start() -> Self {
        let copy = tempfile::tempdir().unwrap();
        let executable = copy.path().join("helper");
        fs::copy(env!("CARGO_BIN_EXE_openforge-update-helper"), &executable).unwrap();
        let mut child = Command::new(executable)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if send.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            lines,
            _copy: copy,
        }
    }

    fn response(&self, seconds: u64) -> Value {
        serde_json::from_str(
            &self
                .lines
                .recv_timeout(Duration::from_secs(seconds))
                .unwrap(),
        )
        .unwrap()
    }

    fn send(&mut self, value: Value) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{value}").unwrap();
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn request(fixture: &common::Fixture, challenge: &Value) -> String {
    let envelope: Value = serde_json::from_slice(
        &fs::read(fixture.authorization.join("operation-one.json")).unwrap(),
    )
    .unwrap();
    let grant: Value = serde_json::from_str(envelope["payload"].as_str().unwrap()).unwrap();
    json!({"version":1, "challenge":challenge, "action":"prepare",
        "root":fixture.state, "destination":fixture.destination,
        "authorization":fixture.authorization, "staging":fixture.staging,
        "manifestSha256":grant["manifestSha256"], "installation":"installation-one", "operation":"operation-one"})
    .to_string()
}

#[test]
fn unauthenticated_handoff_cannot_acquire_or_change_an_installation() {
    let fixture = common::Fixture::new();
    let mut helper = Helper::start();
    let hello = helper.response(10);
    assert_eq!(hello["version"], 1);
    assert_eq!(hello["challenge"].as_str().unwrap().len(), 64);
    helper.send(json!({"payload":request(&fixture, &hello["challenge"]), "mac":"00".repeat(32)}));
    assert_eq!(helper.response(5)["status"], "refused");
    assert!(!fixture.state.exists());
    let lock: PathBuf = fixture
        .destination
        .parent()
        .unwrap()
        .join(".Installed.app.openforge-update.lock");
    assert!(!lock.exists());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

fn signed(payload: String) -> Value {
    use ring::hmac;
    let tag = hmac::sign(
        &hmac::Key::new(hmac::HMAC_SHA256, &[42; 32]),
        &[
            b"openforge-update-handoff-v1\0".as_slice(),
            payload.as_bytes(),
        ]
        .concat(),
    );
    let mac: String = tag.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    json!({"payload":payload,"mac":mac})
}

#[test]
fn authenticated_install_waits_for_its_live_host_and_retains_recovery_if_killed() {
    let fixture = common::Fixture::new();
    let mut helper = Helper::start();
    let hello = helper.response(10);
    helper.send(signed(request(&fixture, &hello["challenge"])));
    assert_eq!(helper.response(5)["status"], "prepared");
    helper.send(signed(
        json!({"version":1,"challenge":hello["challenge"],
        "action":"install","operation":"operation-one"})
        .to_string(),
    ));
    assert_eq!(helper.response(5)["status"], "armed");
    assert!(helper.child.try_wait().unwrap().is_none());
    assert!(fixture.bundle.exists());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    drop(helper);
    let mut recovery = openforge_update_helper::InstallTransaction::open(
        &fixture.state,
        "installation-one",
        &fixture.destination,
    )
    .unwrap();
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        openforge_update_helper::Phase::RolledBack
    );
}

#[test]
fn signed_commands_from_another_helper_instance_are_not_replayable() {
    let fixture = common::Fixture::new();
    let first = Helper::start();
    let old = first.response(10);
    drop(first);
    let mut second = Helper::start();
    let fresh = second.response(10);
    assert_ne!(old["challenge"], fresh["challenge"]);
    second.send(signed(request(&fixture, &old["challenge"])));
    assert_eq!(second.response(5)["status"], "refused");
    assert!(!fixture.state.exists());
}

#[test]
fn losing_the_pipe_before_install_authority_cancels_without_replacement() {
    let fixture = common::Fixture::new();
    let mut helper = Helper::start();
    let hello = helper.response(10);
    helper.send(signed(request(&fixture, &hello["challenge"])));
    assert_eq!(helper.response(5)["status"], "prepared");
    drop(helper.child.stdin.take());
    assert_eq!(helper.response(5)["status"], "refused");
    drop(helper);
    let mut recovery = openforge_update_helper::InstallTransaction::open(
        &fixture.state,
        "installation-one",
        &fixture.destination,
    )
    .unwrap();
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        openforge_update_helper::Phase::RolledBack
    );
    assert!(fixture.bundle.exists());
}
