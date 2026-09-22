mod common;

use openforge_update_helper::{InstallTransaction, Phase};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn transaction_child() {
    let Some(root) = std::env::var_os("UPDATE_HELPER_FIXTURE_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let mut owner = InstallTransaction::open(
        &root.join("transaction"),
        "installation-one",
        &root.join("Installed.app"),
    )
    .unwrap();
    owner
        .prepare(
            &root.join("authorization"),
            &root.join("staged"),
            "operation-one",
        )
        .unwrap();
    owner.replace("operation-one").unwrap();
    println!("fixture-installed");
    std::io::stdout().flush().unwrap();
    // Only the parent owns this fixture. EOF also lets an abandoned child exit.
    let _ = std::io::stdin().read(&mut [0_u8; 1]);
}

#[test]
fn recovers_after_the_installing_process_is_killed_without_unlocking() {
    let fixture = common::Fixture::new();
    let mut child = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "transaction_child", "--nocapture"])
            .env_clear()
            .env(
                "UPDATE_HELPER_FIXTURE_ROOT",
                fixture.destination.parent().unwrap(),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let stdout = child.0.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if line.unwrap_or_default() == "fixture-installed" {
                let _ = send.send(());
                break;
            }
        }
    });
    let ready = receive.recv_timeout(Duration::from_secs(5));
    if ready.is_err() {
        drop(child);
        reader.join().unwrap();
        panic!("owned helper fixture did not reach installed state within five seconds");
    }
    reader.join().unwrap();
    assert!(
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).is_err()
    );
    drop(child);
    let mut recovery =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        Phase::RolledBack
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    // Recovery retains authorization and the staging root, but never reuses the consumed target.
    assert!(fixture.staging.is_dir());
    assert!(fixture.authorization.is_dir());
    assert!(!fixture.bundle.exists());
}
