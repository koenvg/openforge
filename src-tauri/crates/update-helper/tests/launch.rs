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

#[test]
fn startup_authority_belongs_to_the_launched_process_and_survives_helper_exit() {
    let fixture = common::Fixture::with_target_body("#!/bin/sh\nexec /bin/sleep 60\n");
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
