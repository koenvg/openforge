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
    if std::env::var_os("UPDATE_HELPER_FIXTURE_RECOVER").is_some() {
        owner.recover("operation-one").unwrap();
    }
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

#[cfg(feature = "test-fixtures")]
enum RecoveryCheck {
    Restored,
    TamperedSource,
    RedirectedStaging,
}

#[cfg(feature = "test-fixtures")]
fn interrupted_move(boundary: &str, installed: &str, check: RecoveryCheck) {
    let fixture = common::Fixture::new();
    fs::create_dir(&fixture.state).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&fixture.state, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(fixture.state.join(format!("pause-{boundary}")), b"pause").unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "transaction_child", "--nocapture"])
        .env_clear()
        .env(
            "UPDATE_HELPER_FIXTURE_ROOT",
            fixture.destination.parent().unwrap(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if boundary == "rollback-first-move" {
        command.env("UPDATE_HELPER_FIXTURE_RECOVER", "1");
    }
    let child = OwnedChild(command.spawn().unwrap());
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    while !fixture.state.join(format!("{boundary}-paused")).exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "owned replacement fixture did not pause"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        fixture.destination.is_dir(),
        "the installed app disappeared during {boundary}"
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        installed
    );
    // Signal and reap only the installer we spawned, never an observed PID.
    drop(child);
    fs::remove_file(fixture.state.join(format!("pause-{boundary}"))).unwrap();
    let mut recovery =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    if matches!(check, RecoveryCheck::RedirectedStaging) {
        let redirected = fixture.staging.with_file_name("redirected-staging");
        fs::rename(&fixture.staging, &redirected).unwrap();
        std::os::unix::fs::symlink(&redirected, &fixture.staging).unwrap();
        assert!(recovery
            .recover("operation-one")
            .unwrap_err()
            .contains("app exchange staging changed"));
        assert_eq!(
            fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar"))
                .unwrap(),
            "new"
        );
        return;
    }
    if matches!(check, RecoveryCheck::TamperedSource) {
        fs::write(
            fixture.bundle.join("Contents/MacOS/openforge-sidecar"),
            "tampered",
        )
        .unwrap();
        assert!(recovery
            .recover("operation-one")
            .unwrap_err()
            .contains("recovery bundle changed"));
        assert_eq!(
            fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar"))
                .unwrap(),
            "new"
        );
        return;
    }
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        Phase::RolledBack
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        Phase::RolledBack
    );
}

#[cfg(feature = "test-fixtures")]
#[test]
fn replacement_keeps_the_app_present_if_the_installer_dies_before_archiving_the_source() {
    interrupted_move("replace-first-move", "new", RecoveryCheck::Restored);
}

#[cfg(feature = "test-fixtures")]
#[test]
fn rollback_keeps_the_app_present_if_the_installer_dies_before_archiving_the_target() {
    interrupted_move("rollback-first-move", "old", RecoveryCheck::Restored);
}

#[cfg(feature = "test-fixtures")]
#[test]
fn changed_source_at_the_exchange_path_cannot_authorize_rollback() {
    interrupted_move("replace-first-move", "new", RecoveryCheck::TamperedSource);
}

#[cfg(feature = "test-fixtures")]
#[test]
fn redirected_staging_cannot_supply_the_retained_source() {
    interrupted_move(
        "replace-first-move",
        "new",
        RecoveryCheck::RedirectedStaging,
    );
}
