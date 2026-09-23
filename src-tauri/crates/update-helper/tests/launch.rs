#![cfg(target_os = "macos")]
mod common;

use openforge_update_helper::InstallTransaction;
use std::process::Child;

struct OwnedTarget(Child);
impl Drop for OwnedTarget {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(feature = "test-fixtures")]
#[test]
fn startup_authority_belongs_to_the_launched_process_and_survives_helper_exit() {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_openforge-update-target-fixture")).unwrap();
    let fixture = common::Fixture::with_target_bytes(&bytes);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert!(transaction
        .verify_launch("operation-one", std::process::id())
        .is_err());
    transaction.replace("operation-one").unwrap();
    let mut target = OwnedTarget(transaction.launch("operation-one").unwrap());
    transaction
        .verify_launch("operation-one", target.0.id())
        .unwrap();
    assert!(transaction
        .launched_process_running("operation-one")
        .unwrap());
    assert!(transaction
        .verify_launch("operation-one", std::process::id())
        .is_err());
    assert!(transaction
        .verify_launch("another-operation", target.0.id())
        .is_err());
    assert!(transaction.launch("operation-one").is_err());
    drop(transaction);

    let mut reopened =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    reopened
        .verify_launch("operation-one", target.0.id())
        .unwrap();
    std::fs::write(fixture.authorization.join("authorization.key"), [43_u8; 32]).unwrap();
    assert!(reopened
        .verify_launch("operation-one", target.0.id())
        .is_err());
    std::fs::write(fixture.authorization.join("authorization.key"), [42_u8; 32]).unwrap();
    reopened
        .verify_launch("operation-one", target.0.id())
        .unwrap();
    target.0.kill().unwrap();
    target.0.wait().unwrap();
    assert!(!reopened.launched_process_running("operation-one").unwrap());
    assert!(reopened
        .verify_launch("operation-one", target.0.id())
        .is_err());
    assert!(reopened.recover("operation-one").is_err());
}

#[cfg(feature = "test-fixtures")]
#[test]
fn an_exec_keeps_process_birth_but_loses_authorized_image_identity() {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_openforge-update-target-fixture")).unwrap();
    let fixture = common::Fixture::with_target_bytes(&bytes);
    std::fs::write(fixture._temp.path().join("exec-other-image"), "").unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    let target = OwnedTarget(transaction.launch("operation-one").unwrap());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        match transaction.verify_launch("operation-one", target.0.id()) {
            Err(error) => {
                assert!(
                    error.contains("running update image does not match"),
                    "{error}"
                );
                break;
            }
            Ok(()) => assert!(
                std::time::Instant::now() < deadline,
                "execed image retained launch authority"
            ),
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn process_birth_and_installed_bytes_do_not_authorize_another_running_image() {
    let fixture = common::Fixture::with_target_body("#!/bin/sh\nexec /bin/sleep 60\n");
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    let target = OwnedTarget(transaction.launch("operation-one").unwrap());
    assert!(
        transaction
            .verify_launch("operation-one", target.0.id())
            .is_err(),
        "the launched PID is insufficient when another executable is running"
    );
}

#[test]
fn a_failed_exec_does_not_remove_the_durable_domain_rollback_fence() {
    let fixture =
        common::Fixture::with_target_body("#!/openforge-update-fixture-missing-interpreter\n");
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    assert!(transaction
        .launch("operation-one")
        .unwrap_err()
        .contains("target launch failed"));
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
    // The gate durably recorded and then reaped the exact child even though exec failed.
    assert!(!transaction
        .launched_process_running("operation-one")
        .unwrap());
    assert!(transaction
        .relaunch("operation-one")
        .unwrap_err()
        .contains("target launch failed"));
    assert!(!transaction
        .launched_process_running("operation-one")
        .unwrap());
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
}

#[test]
fn an_old_launch_without_process_or_gate_evidence_remains_unknown() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    transaction.begin_launch("operation-one").unwrap();
    assert!(transaction
        .launched_process_running("operation-one")
        .is_err());
    assert!(transaction
        .relaunch("operation-one")
        .unwrap_err()
        .contains("missing authenticated target process"));
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
}

#[test]
fn launch_remeasures_installed_components_before_starting_a_process() {
    let fixture = common::Fixture::new();
    let relative = "Contents/MacOS/openforge-sidecar";
    let staged_bytes = std::fs::read(fixture.bundle.join(relative)).unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    std::fs::write(fixture.destination.join(relative), "changed before launch").unwrap();
    assert!(transaction
        .launch("operation-one")
        .unwrap_err()
        .contains("installed bundle changed"));
    std::fs::write(fixture.destination.join(relative), staged_bytes).unwrap();
    transaction.recover("operation-one").unwrap();
}

#[cfg(feature = "test-fixtures")]
#[test]
fn compatible_relaunch_replaces_dead_process_authority_without_allowing_rollback() {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_openforge-update-target-fixture")).unwrap();
    for committed in [false, true] {
        let fixture = common::Fixture::with_target_bytes(&bytes);
        let mut transaction =
            InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination)
                .unwrap();
        transaction
            .prepare(&fixture.authorization, &fixture.staging, "operation-one")
            .unwrap();
        transaction.replace("operation-one").unwrap();
        let mut first = OwnedTarget(transaction.launch("operation-one").unwrap());
        if committed {
            transaction.commit("operation-one").unwrap();
        }
        assert!(transaction
            .relaunch("operation-one")
            .unwrap_err()
            .contains("still running"));
        first.0.kill().unwrap();
        first.0.wait().unwrap();
        let key = fixture.authorization.join("authorization.key");
        std::fs::write(&key, [43_u8; 32]).unwrap();
        assert!(transaction.relaunch("operation-one").is_err());
        std::fs::write(&key, [42_u8; 32]).unwrap();
        let second = OwnedTarget(transaction.relaunch("operation-one").unwrap());
        assert_ne!(first.0.id(), second.0.id());
        transaction
            .verify_launch("operation-one", second.0.id())
            .unwrap();
        assert!(transaction
            .verify_launch("operation-one", first.0.id())
            .is_err());
        assert!(transaction
            .commit_from_process("operation-one", second.0.id(), None)
            .unwrap_err()
            .contains("missing admitted Sidecar"));
        assert!(transaction.recover("operation-one").is_err());
    }
}

#[cfg(feature = "test-fixtures")]
#[test]
fn relaunch_preparation_does_not_promote_a_compatible_requester_to_startup_authority() {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_openforge-update-target-fixture")).unwrap();
    let fixture = common::Fixture::with_target_bytes(&bytes);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    let mut first = OwnedTarget(transaction.launch("operation-one").unwrap());
    let requester = OwnedTarget(
        std::process::Command::new(fixture.destination.join("Contents/MacOS/Open Forge"))
            .env_clear()
            .env("OPENFORGE_ELECTRON_USER_DATA_DIR", fixture._temp.path())
            .spawn()
            .unwrap(),
    );
    assert!(transaction
        .prepare_relaunch("operation-one", requester.0.id())
        .unwrap_err()
        .contains("still running"));
    transaction
        .prepare_relaunch("operation-one", first.0.id())
        .unwrap();
    first.0.kill().unwrap();
    first.0.wait().unwrap();
    assert!(transaction
        .prepare_relaunch("operation-one", std::process::id())
        .is_err());
    transaction
        .prepare_relaunch("operation-one", requester.0.id())
        .unwrap();
    assert!(transaction
        .verify_launch("operation-one", requester.0.id())
        .is_err());
    assert!(!transaction
        .launched_process_running("operation-one")
        .unwrap());
}
