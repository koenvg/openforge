#![cfg(target_os = "macos")]
use openforge_update_helper::InstallTransaction;
use std::fs;

mod common;

#[test]
fn cold_install_requires_separate_build_and_interruption_approval() {
    let fixture = common::Fixture::new();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert!(transaction
        .install_cold("operation-one")
        .unwrap_err()
        .contains("cold installation was not approved"));
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

fn sleep_image(path: &std::path::Path) {
    fs::copy("/bin/sleep", path).unwrap();
    let result = std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(path)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
fn approve_cold_fixture(fixture: &common::Fixture) {
    approve_cold_fixture_at(fixture, fixture.destination.parent().unwrap());
}

fn approve_cold_fixture_at(fixture: &common::Fixture, daemon_root: &std::path::Path) {
    use ring::hmac;
    use serde_json::{json, Value};
    use std::os::unix::fs::PermissionsExt;
    let source_digest = openforge_update_helper::cold_source_sha256(&fixture.destination).unwrap();
    let path = fixture.authorization.join("operation-one.json");
    let envelope: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut payload: Value = serde_json::from_str(envelope["payload"].as_str().unwrap()).unwrap();
    payload["manifestSha256"] =
        json!(openforge_update_helper::cold_target_sha256(&fixture.bundle).unwrap());
    payload["coldInstall"] = json!({
        "daemonRoot": daemon_root,
        "electronUserData": fixture.destination.parent().unwrap(),
        "daemonInstallation": openforge_session_client::runtime::RuntimeDirectory::open(daemon_root).unwrap().credentials().installation.as_str(),
        "helperSha256": common::digest(&fs::read(fixture.bundle.join("Contents/MacOS/openforge-update-helper")).unwrap()),
        "installedManifestSha256": source_digest,
    });
    let payload = payload.to_string();
    let tag = hmac::sign(
        &hmac::Key::new(hmac::HMAC_SHA256, &[42_u8; 32]),
        &[
            b"openforge-update-authorization-v1\0".as_slice(),
            payload.as_bytes(),
        ]
        .concat(),
    );
    let mac: String = tag
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::write(&path, json!({"payload":payload, "mac":mac}).to_string()).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}

#[test]
fn renamed_source_actor_still_blocks_publication_when_identical_bytes_are_restored() {
    use std::os::unix::fs::DirBuilderExt;
    let fixture = common::Fixture::new();
    let root = fixture.destination.parent().unwrap();
    let daemon = root.join("runtime");
    fs::DirBuilder::new().mode(0o700).create(&daemon).unwrap();
    let executable = fixture.destination.join("Contents/MacOS/Open Forge");
    sleep_image(&executable);
    let replacement = root.join("Replacement.app");
    assert!(std::process::Command::new("/usr/bin/ditto")
        .arg(&fixture.destination)
        .arg(&replacement)
        .status()
        .unwrap()
        .success());
    approve_cold_fixture_at(&fixture, &daemon);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    let mut actor = std::process::Command::new(&executable)
        .arg("60")
        .spawn()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(actor.try_wait().unwrap().is_none());
    fs::rename(&fixture.destination, root.join("Moved.app")).unwrap();
    fs::rename(&replacement, &fixture.destination).unwrap();
    let result = transaction.install_cold("operation-one");
    let remained_alive = actor.try_wait().unwrap().is_none();
    let _ = actor.kill();
    let _ = actor.wait();
    assert!(remained_alive);
    assert!(
        result.is_err(),
        "a renamed source image must not be excluded by its new pathname"
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

#[cfg(feature = "test-fixtures")]
#[test]
fn the_verified_installer_itself_does_not_count_as_a_running_source_actor() {
    let fixture = common::Fixture::new();
    let root = fixture.destination.parent().unwrap();
    let executable = root.join("verified-installer");
    fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    let identifier = format!("org.openforge.fixture.{}", uuid::Uuid::new_v4());
    assert!(std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-", "--identifier", &identifier])
        .arg(&executable)
        .status()
        .unwrap()
        .success());
    for bundle in [&fixture.destination, &fixture.bundle] {
        fs::copy(
            &executable,
            bundle.join("Contents/MacOS/openforge-update-helper"),
        )
        .unwrap();
    }
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    drop(transaction);
    let result = std::process::Command::new(&executable)
        .args(["--exact", "cold_install_worker", "--nocapture"])
        .env("OPENFORGE_COLD_TEST_ROOT", root)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
}

#[test]
fn cancelling_an_unapproved_reservation_allows_retry_with_different_roots() {
    let fixture = common::Fixture::new();
    let first_root = fixture
        .destination
        .parent()
        .unwrap()
        .join("unapproved-profile");
    let reservation =
        InstallTransaction::reserve(&first_root, "unapproved-identity", &fixture.destination)
            .unwrap();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_err());
    drop(reservation);
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
    approve_cold_fixture(&fixture);
    let mut retry =
        InstallTransaction::reserve(&fixture.state, "installation-one", &fixture.destination)
            .unwrap()
            .bind()
            .unwrap();
    retry
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert_eq!(
        retry.install_cold("operation-one").unwrap(),
        openforge_update_helper::Phase::ColdCommitted
    );
}

#[cfg(feature = "test-fixtures")]
#[test]
fn unapproved_reservation_worker() {
    let Some(root) = std::env::var_os("OPENFORGE_UNAPPROVED_TEST_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let _reservation = InstallTransaction::reserve(
        &root.join("unapproved-profile"),
        "unapproved-identity",
        &root.join("Installed.app"),
    )
    .unwrap();
    fs::write(root.join("reserved"), b"reserved").unwrap();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[cfg(feature = "test-fixtures")]
#[test]
fn process_loss_before_approval_allows_retry_with_different_roots() {
    let fixture = common::Fixture::new();
    let root = fixture.destination.parent().unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "unapproved_reservation_worker", "--nocapture"])
        .env("OPENFORGE_UNAPPROVED_TEST_ROOT", root)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !root.join("reserved").exists() && std::time::Instant::now() < deadline {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let reserved = root.join("reserved").exists();
    let _ = child.kill();
    let _ = child.wait();
    assert!(reserved);
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
    let retry =
        InstallTransaction::reserve(&fixture.state, "installation-one", &fixture.destination)
            .unwrap();
    retry.bind().unwrap();
}

#[test]
fn identical_build_after_archive_recovers_the_recorded_operation_forward() {
    use ring::hmac;
    use serde_json::{json, Value};
    let fixture = common::Fixture::with_target_body("old");
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    drop(transaction);
    // An authenticated fixture left by process loss after archiving identical bytes.
    let journal = fixture.state.join("current.json");
    let envelope: Value = serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
    let mut record: Value = serde_json::from_str(envelope["payload"].as_str().unwrap()).unwrap();
    record["phase"] = json!("cold-replacing");
    record["exchangePath"] = json!(fixture.bundle);
    let payload = record.to_string();
    let key = fs::read(fixture.state.join("journal.key")).unwrap();
    let tag = hmac::sign(
        &hmac::Key::new(hmac::HMAC_SHA256, &key),
        &[
            b"openforge-update-journal-v1\0".as_slice(),
            payload.as_bytes(),
        ]
        .concat(),
    );
    let mac: String = tag
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::write(&journal, json!({"payload":payload,"mac":mac}).to_string()).unwrap();
    fs::rename(
        &fixture.bundle,
        fixture.state.join("previous-operation-one.app"),
    )
    .unwrap();
    let mut recovery =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    assert_eq!(
        recovery.install_cold("operation-one").unwrap(),
        openforge_update_helper::Phase::ColdCommitted
    );
    drop(recovery);
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
}
#[test]
fn approved_cold_install_publishes_the_complete_app_without_launch_or_rollback() {
    let fixture = common::Fixture::new();
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert_eq!(
        transaction.install_cold("operation-one").unwrap(),
        openforge_update_helper::Phase::ColdCommitted
    );
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "new"
    );
    assert!(fixture.state.join("previous-operation-one.app").exists());
    assert!(!fixture.bundle.exists());
    assert!(transaction.recover("operation-one").is_err());
}

#[test]
fn cold_install_refuses_a_live_owner_or_in_progress_daemon_launch() {
    for launch in [false, true] {
        let fixture = common::Fixture::new();
        approve_cold_fixture(&fixture);
        let runtime = openforge_session_client::runtime::RuntimeDirectory::open(
            fixture.destination.parent().unwrap(),
        )
        .unwrap();
        let _owner = if launch {
            runtime.claim_launch().unwrap()
        } else {
            runtime.claim().unwrap()
        };
        let mut transaction =
            InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination)
                .unwrap();
        transaction
            .prepare(&fixture.authorization, &fixture.staging, "operation-one")
            .unwrap();
        assert!(transaction.install_cold("operation-one").is_err());
        assert_eq!(
            fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar"))
                .unwrap(),
            "old"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn cold_install_refuses_the_actual_running_source_image() {
    let fixture = common::Fixture::new();
    let executable = fixture.destination.join("Contents/MacOS/Open Forge");
    sleep_image(&executable);
    approve_cold_fixture(&fixture);
    // The old fixture identity no longer applies, so this is checked before prepare.
    let mut child = std::process::Command::new(&executable)
        .arg("30")
        .spawn()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(child.try_wait().unwrap().is_none());
    let result = openforge_update_helper::assert_cold_source_stopped(&fixture.destination);
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(result.unwrap_err().contains("still running"));
}

#[test]
fn completed_cold_install_can_be_acknowledged_again_but_not_committed_as_a_live_update() {
    let fixture = common::Fixture::new();
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.install_cold("operation-one").unwrap();
    assert!(transaction.commit("operation-one").is_err());
    drop(transaction);
    let mut reopened =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    assert_eq!(
        reopened.install_cold("operation-one").unwrap(),
        openforge_update_helper::Phase::ColdCommitted
    );
}

#[cfg(feature = "test-fixtures")]
#[test]
fn cold_install_worker() {
    let Some(root) = std::env::var_os("OPENFORGE_COLD_TEST_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let mut transaction = InstallTransaction::open(
        &root.join("transaction"),
        "installation-one",
        &root.join("Installed.app"),
    )
    .unwrap();
    transaction.install_cold("operation-one").unwrap();
}

#[cfg(feature = "test-fixtures")]
#[test]
fn process_loss_at_each_cold_publication_boundary_recovers_forward_only() {
    for boundary in [
        "cold-before-exchange",
        "cold-after-exchange",
        "cold-after-archive",
    ] {
        let fixture = common::Fixture::new();
        approve_cold_fixture(&fixture);
        let mut transaction =
            InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination)
                .unwrap();
        transaction
            .prepare(&fixture.authorization, &fixture.staging, "operation-one")
            .unwrap();
        drop(transaction);
        fs::write(fixture.state.join(format!("pause-{boundary}")), b"pause").unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "cold_install_worker", "--nocapture"])
            .env(
                "OPENFORGE_COLD_TEST_ROOT",
                fixture.destination.parent().unwrap(),
            )
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let marker = fixture.state.join(format!("{boundary}-paused"));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !marker.exists() && std::time::Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let paused = marker.exists();
        let _ = child.kill();
        child.wait().unwrap();
        assert!(paused, "did not reach {boundary}");
        fs::write(fixture.state.join(format!("resume-{boundary}")), b"resume").unwrap();
        let mut recovery =
            InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination)
                .unwrap();
        assert!(recovery.recover("operation-one").is_err());
        assert_eq!(
            recovery.install_cold("operation-one").unwrap(),
            openforge_update_helper::Phase::ColdCommitted
        );
        assert_eq!(
            fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar"))
                .unwrap(),
            "new"
        );
    }
}

#[test]
fn cold_adoption_retains_legacy_symlinks_without_following_or_executing_them() {
    let fixture = common::Fixture::new();
    let link = "Contents/Resources/legacy-dependency";
    std::os::unix::fs::symlink(
        "/missing/publisher/build-machine/dependency",
        fixture.destination.join(link),
    )
    .unwrap();
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.install_cold("operation-one").unwrap();
    assert_eq!(
        fs::read_link(fixture.state.join("previous-operation-one.app").join(link)).unwrap(),
        std::path::PathBuf::from("/missing/publisher/build-machine/dependency")
    );
}

#[test]
fn ordinary_startup_is_admitted_only_after_the_cold_installer_releases_ownership() {
    let fixture = common::Fixture::new();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_err());
    transaction.install_cold("operation-one").unwrap();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_err());
    drop(transaction);
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_ok());
    fs::write(
        fixture
            .destination
            .join("Contents/Resources/app/dist-electron/main.js"),
        b"changed",
    )
    .unwrap();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_err());
}

#[test]
fn packaged_helper_exposes_cold_startup_without_accepting_an_approval_flag() {
    let fixture = common::Fixture::new();
    let helper = env!("CARGO_BIN_EXE_openforge-update-helper");
    let startup = std::process::Command::new(helper)
        .arg("--cold-startup")
        .arg(&fixture.destination)
        .arg(fixture.destination.parent().unwrap())
        .output()
        .unwrap();
    assert!(
        startup.status.success(),
        "{}",
        String::from_utf8_lossy(&startup.stderr)
    );
    let bypass = std::process::Command::new(helper)
        .args(["--cold-install", "--approved"])
        .output()
        .unwrap();
    assert!(!bypass.status.success());
}

#[test]
fn cold_install_does_not_discard_unverifiable_native_source_images() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = common::Fixture::new();
    let broken = fixture.destination.join("Contents/MacOS/unverifiable");
    fs::write(&broken, b"\xcf\xfa\xed\xfeinvalid-native-image").unwrap();
    fs::set_permissions(&broken, fs::Permissions::from_mode(0o755)).unwrap();
    approve_cold_fixture(&fixture);
    let executable = fixture.destination.parent().unwrap().join("removed-sleep");
    sleep_image(&executable);
    let mut process = std::process::Command::new(&executable)
        .arg("60")
        .spawn()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(process.try_wait().unwrap().is_none());
    fs::remove_file(&executable).unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    let result = transaction.install_cold("operation-one");
    let _ = process.kill();
    let _ = process.wait();
    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

#[test]
fn cold_install_refuses_a_session_host_running_from_the_runtime_release_store() {
    let fixture = common::Fixture::new();
    let release = fixture
        .destination
        .parent()
        .unwrap()
        .join("releases/source");
    fs::create_dir_all(&release).unwrap();
    let host = release.join("openforge-session-host");
    sleep_image(&host);
    approve_cold_fixture(&fixture);
    let mut process = std::process::Command::new(&host).arg("60").spawn().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(process.try_wait().unwrap().is_none());
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    let result = transaction.install_cold("operation-one");
    let _ = process.kill();
    let _ = process.wait();
    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
}

#[test]
fn cold_inspection_reports_both_artifact_identities_without_installation_or_authority() {
    let fixture = common::Fixture::new();
    let before = fs::read(fixture.authorization.join("operation-one.json")).unwrap();
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_openforge-update-helper"))
        .arg("--cold-inspect")
        .arg(&fixture.bundle)
        .arg(&fixture.destination)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(
        value["sourceSha256"],
        openforge_update_helper::cold_source_sha256(&fixture.destination).unwrap()
    );
    assert!(value["targetSha256"].as_str().unwrap().len() == 64);
    assert_eq!(
        fs::read(fixture.authorization.join("operation-one.json")).unwrap(),
        before
    );
    assert!(!fixture.state.exists());
}

#[test]
fn cold_install_command_refuses_an_unsealed_app_before_approval_or_installed_changes() {
    let fixture = common::Fixture::new();
    let root = fixture.destination.parent().unwrap();
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_openforge-update-helper"))
        .arg("--cold-install")
        .arg(&fixture.bundle)
        .arg(&fixture.destination)
        .arg(root.join("profile"))
        .arg(root.join("data"))
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("code signature"));
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    assert!(!root.join("profile").exists());
}

#[test]
fn cold_approval_cannot_be_used_as_a_session_preserving_update_grant() {
    let fixture = common::Fixture::new();
    approve_cold_fixture(&fixture);
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    assert!(transaction.replace("operation-one").is_err());
    assert_eq!(
        fs::read_to_string(fixture.destination.join("Contents/MacOS/openforge-sidecar")).unwrap(),
        "old"
    );
    transaction.install_cold("operation-one").unwrap();
}

#[test]
fn cold_startup_refuses_different_data_roots_or_recreated_runtime_credentials() {
    let fixture = common::Fixture::new();
    approve_cold_fixture(&fixture);
    let root = fixture.destination.parent().unwrap();
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.install_cold("operation-one").unwrap();
    drop(transaction);
    let other = root.join("other");
    fs::create_dir(&other).unwrap();
    assert!(
        openforge_update_helper::assert_cold_launch_roots(&fixture.destination, &other, root)
            .is_err()
    );
    let credentials = root.join("session-v1/credentials.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&credentials).unwrap()).unwrap();
    value["installation"] = serde_json::json!(uuid::Uuid::new_v4().to_string());
    fs::write(&credentials, value.to_string()).unwrap();
    assert!(openforge_update_helper::assert_cold_startup_allowed(&fixture.destination).is_err());
}

#[test]
fn packaged_startup_checks_the_same_nested_runtime_root_as_the_sidecar() {
    let fixture = common::Fixture::new();
    let profile = fixture.destination.parent().unwrap();
    let data = profile.join("app-data");
    fs::create_dir(&data).unwrap();
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(data.join("session-daemon"))
        .unwrap();
    approve_cold_fixture_at(&fixture, &data.join("session-daemon"));
    let mut transaction =
        InstallTransaction::open(&fixture.state, "installation-one", &fixture.destination).unwrap();
    transaction
        .prepare(&fixture.authorization, &fixture.staging, "operation-one")
        .unwrap();
    transaction.install_cold("operation-one").unwrap();
    drop(transaction);
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_openforge-update-helper"))
        .arg("--cold-startup")
        .arg(&fixture.destination)
        .arg(profile)
        .env("OPENFORGE_APP_DATA_DIR", &data)
        .env_remove("OPENFORGE_SESSION_DAEMON_ROOT")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
