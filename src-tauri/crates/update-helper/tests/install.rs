use openforge_update_helper::InstallTransaction;
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn serializes_installers_and_releases_ownership_when_the_owner_exits() {
    let root = tempfile::tempdir().unwrap();
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let destination = root.path().join("Installed.app");
    let state = root.path().join("transaction");
    let first = InstallTransaction::open(&state, "installation-one", &destination).unwrap();
    assert!(InstallTransaction::open(&state, "installation-one", &destination).is_err());
    drop(first);
    assert!(InstallTransaction::open(&state, "installation-one", &destination).is_ok());
}

mod common;

#[test]
fn rechecks_authorized_bytes_before_replacing_the_complete_bundle() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    fs::write(
        fixture
            .bundle
            .join("Contents/MacOS/openforge-update-helper"),
        "tampered",
    )
    .unwrap();
    assert!(transaction.replace("operation-one").is_err());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

#[test]
fn restores_the_old_bundle_after_an_interrupted_install_and_refuses_replay() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "new"
    );
    drop(transaction);
    let mut recovery =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    assert_eq!(
        recovery.recover("operation-one").unwrap(),
        openforge_update_helper::Phase::RolledBack
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    assert!(recovery.replace("operation-one").is_err());
    assert!(recovery
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .is_err());
    assert!(recovery.recover("stale-operation").is_err());
}

#[test]
fn never_rolls_back_after_target_launch_could_have_migrated_the_database() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    transaction.begin_launch("operation-one").unwrap();
    drop(transaction);
    let mut recovery =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    assert!(recovery
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "new"
    );
}

#[test]
fn separate_state_roots_cannot_race_to_replace_the_same_installation() {
    let fixture = common::Fixture::new();
    let _owner =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    let other = fixture.state.with_file_name("other-transaction");
    assert!(InstallTransaction::open(&other, "installation-one", &fixture.destination).is_err());
}

#[test]
fn a_different_state_root_cannot_bypass_pending_recovery_after_owner_exit() {
    let fixture = common::Fixture::new();
    let mut owner =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    owner
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    drop(owner);
    let other = fixture.state.with_file_name("other-transaction");
    assert!(InstallTransaction::open(&other, "installation-one", &fixture.destination).is_err());
}

#[test]
fn refuses_recovery_storage_inside_the_bundle_that_will_be_replaced() {
    let fixture = common::Fixture::new();
    assert!(InstallTransaction::open(
        &fixture.destination.join("transaction"),
        "installation-one",
        &fixture.destination
    )
    .is_err());
    assert!(!fixture.destination.join("transaction").exists());
}

#[test]
fn authentication_changes_after_preparation_cannot_authorize_replacement() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    let path = fixture.authorization.join("operation-one.json");
    let bytes = fs::read_to_string(&path)
        .unwrap()
        .replace("local-build", "published");
    fs::write(path, bytes).unwrap();
    assert!(transaction
        .replace("operation-one")
        .unwrap_err()
        .contains("authentication"));
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

#[test]
fn altered_recovery_records_fail_closed_without_replacing_or_rolling_back() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.replace("operation-one").unwrap();
    let path = fixture.state.join("current.json");
    let bytes = fs::read_to_string(&path)
        .unwrap()
        .replace("operation-one", "operation-two");
    fs::write(path, bytes).unwrap();
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("authentication"));
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "new"
    );
}

#[test]
fn cancelled_authorization_cannot_be_replayed_even_when_staged_bytes_still_exist() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.recover("operation-one").unwrap();
    assert!(fixture.bundle.exists());
    assert!(transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .is_err());
}

#[test]
fn a_dangling_recovery_record_is_not_treated_as_an_absent_operation() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    fs::remove_file(fixture.state.join("current.json")).unwrap();
    std::os::unix::fs::symlink("missing", fixture.state.join("current.json")).unwrap();
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("unsafe recovery"));
}

#[test]
fn commit_requires_launch_and_keeps_the_post_launch_rollback_fence() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert!(transaction.commit("operation-one").is_err());
    transaction.replace("operation-one").unwrap();
    assert!(transaction.commit("operation-one").is_err());
    transaction.begin_launch("operation-one").unwrap();
    transaction.commit("operation-one").unwrap();
    drop(transaction);
    let mut reopened =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    reopened.commit("operation-one").unwrap();
    assert!(reopened
        .recover("operation-one")
        .unwrap_err()
        .contains("migrated"));
    assert!(reopened.commit("another-operation").is_err());
    fs::write(
        fixture.destination.join("Contents/MacOS/openforge-sidecar"),
        "changed after launch",
    )
    .unwrap();
    assert!(reopened.commit("operation-one").is_err());
}

#[test]
fn rollback_acknowledgement_rechecks_the_restored_source() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.recover("operation-one").unwrap();
    fs::write(
        fixture.destination.join("Contents/MacOS/openforge-sidecar"),
        "changed after rollback",
    )
    .unwrap();
    assert!(transaction
        .recover("operation-one")
        .unwrap_err()
        .contains("recovered installation changed"));
}

#[test]
fn recovers_a_missing_app_left_by_an_older_non_exchanging_installer() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    fs::rename(
        &fixture.destination,
        fixture.state.join("previous-operation-one.app"),
    )
    .unwrap();
    transaction.recover("operation-one").unwrap();
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    assert!(fixture.bundle.exists());
}
