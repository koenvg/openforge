use openforge_session_client::{releases::ReleaseStore, runtime::RuntimeDirectory};
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
};

fn bundle() -> tempfile::TempDir {
    let bundle = tempfile::tempdir().unwrap();
    fs::write(bundle.path().join("openforge-session-daemon"), b"daemon").unwrap();
    fs::set_permissions(
        bundle.path().join("openforge-session-daemon"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fs::write(bundle.path().join("hook.js"), b"hook").unwrap();
    fs::write(bundle.path().join("manifest.json"), serde_json::to_vec(&serde_json::json!({
        "format": 1, "architecture": std::env::consts::ARCH, "protocol": 3, "stateFormat": 1,
        "files": [
            {"path": "openforge-session-daemon", "sha256": "f77b12a53ece5f6b7050800bbdbf8cc5ebe87f1b1387cf739f243e43e2ce886b", "executable": true},
            {"path": "hook.js", "sha256": "0648298b48be031996277ae472115a46e7964d2ac3882e61b84351f3c3f8a547", "executable": false}
        ]
    })).unwrap()).unwrap();
    bundle
}

#[test]
fn staged_release_survives_bundle_removal_and_reuses_immutable_content() {
    let root = tempfile::tempdir().unwrap();
    let bundle = bundle();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let release = store.stage(bundle.path()).unwrap();
    assert_eq!(
        store.stage(bundle.path()).unwrap().executable(),
        release.executable()
    );
    drop(bundle);
    assert_eq!(fs::read(release.executable()).unwrap(), b"daemon");
    assert_eq!(
        fs::read(release.directory().join("hook.js")).unwrap(),
        b"hook"
    );
    assert_eq!(
        fs::metadata(release.executable())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o500
    );
}

#[test]
fn cleanup_preserves_leases_and_durable_session_checkpoint_and_operation_references() {
    let root = tempfile::tempdir().unwrap();
    let bundle = bundle();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let release = store.stage(bundle.path()).unwrap();
    assert!(store.cleanup(&runtime).unwrap().is_empty());
    for key in ["session-test", "checkpoint-test", "operation-test"] {
        store.retain(&release, key).unwrap();
    }
    let id = release.id().to_owned();
    drop(release);
    for key in ["session-test", "checkpoint-test", "operation-test"] {
        assert!(store.cleanup(&runtime).unwrap().is_empty());
        store.release_reference(&runtime, key).unwrap();
    }
    assert_eq!(store.cleanup(&runtime).unwrap(), vec![id]);
}

#[test]
fn cleanup_refuses_foreign_installations_and_unknown_artifacts() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let foreign = RuntimeDirectory::open(other.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    assert!(store.cleanup(&foreign).is_err());
    let release = store.stage(bundle().path()).unwrap();
    let unknown = release.directory().join("unowned.txt");
    fs::write(&unknown, b"do not delete").unwrap();
    drop(release);
    assert!(store.cleanup(&runtime).is_err());
    assert!(unknown.exists());
}

#[test]
fn staging_refuses_corrupt_symlinked_or_incompatible_assets() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    for variant in [
        "corrupt",
        "symlink",
        "protocol",
        "state",
        "architecture",
        "traversal",
    ] {
        let bundle = bundle();
        let manifest_path = bundle.path().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        match variant {
            "corrupt" => fs::write(bundle.path().join("hook.js"), b"changed").unwrap(),
            "symlink" => {
                fs::remove_file(bundle.path().join("hook.js")).unwrap();
                symlink("openforge-session-daemon", bundle.path().join("hook.js")).unwrap();
            }
            "protocol" => manifest["protocol"] = 999.into(),
            "state" => manifest["stateFormat"] = 999.into(),
            "architecture" => manifest["architecture"] = "unsupported".into(),
            "traversal" => manifest["files"][1]["path"] = "../hook.js".into(),
            _ => unreachable!(),
        }
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(store.stage(bundle.path()).is_err(), "{variant}");
    }
}

#[test]
fn cached_executable_without_execute_permission_is_not_a_usable_fallback() {
    let root = tempfile::tempdir().unwrap();
    let bundle = bundle();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let release = store.stage(bundle.path()).unwrap();
    fs::set_permissions(release.executable(), fs::Permissions::from_mode(0o400)).unwrap();
    assert!(store.stage(bundle.path()).is_err());
}

#[test]
fn cleanup_cannot_release_references_or_remove_releases_while_daemon_owns_runtime() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let release = store.stage(bundle().path()).unwrap();
    store.retain(&release, "session-live").unwrap();
    let path = release.executable();
    drop(release);
    let _daemon = runtime.claim().unwrap();
    assert!(store.cleanup(&runtime).unwrap().is_empty());
    assert!(store.release_reference(&runtime, "session-live").is_err());
    assert!(path.exists());
}

#[test]
fn existing_unowned_store_is_not_adopted() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let releases = runtime.path().join("releases");
    fs::create_dir(&releases).unwrap();
    fs::set_permissions(&releases, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(releases.join("foreign-artifact"), b"keep").unwrap();
    assert!(ReleaseStore::open(&runtime).is_err());
    assert!(!releases.join("owner").exists());
}

#[test]
fn current_and_recovery_versions_coexist_until_their_independent_references_complete() {
    let root = tempfile::tempdir().unwrap();
    let source = bundle();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let recovery = store.stage(source.path()).unwrap();
    store.retain(&recovery, "checkpoint-recovery").unwrap();
    let manifest_path = source.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["files"][0]["sha256"] =
        "4bed99b7a3e453d9409c0dfe04c25d739c363cf36720b9eab462cdb1eba67aa7".into();
    fs::write(source.path().join("openforge-session-daemon"), b"daemon2").unwrap();
    fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let current = store.stage(source.path()).unwrap();
    store.retain(&current, "session-current").unwrap();
    drop(source);
    assert_ne!(current.directory(), recovery.directory());
    assert_eq!(fs::read(recovery.executable()).unwrap(), b"daemon");
    assert_eq!(fs::read(current.executable()).unwrap(), b"daemon2");
    let old = recovery.id().to_owned();
    drop(recovery);
    store
        .release_reference(&runtime, "checkpoint-recovery")
        .unwrap();
    assert_eq!(store.cleanup(&runtime).unwrap(), vec![old]);
    assert!(current.executable().exists());
}
