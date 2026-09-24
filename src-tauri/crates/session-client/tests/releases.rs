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
        "format": 1, "architecture": std::env::consts::ARCH,
        "protocol": 4, "stateFormat": 1,
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

#[test]
fn published_staging_rejects_a_manifest_signed_by_an_untrusted_publisher() {
    use openforge_session_client::releases::PublisherTrust;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let source = bundle();
    let signer = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
    let trusted = Ed25519KeyPair::from_seed_unchecked(&[8; 32]).unwrap();
    let trust =
        PublisherTrust::new(vec![trusted.public_key().as_ref().try_into().unwrap()]).unwrap();
    let manifest = fs::read(source.path().join("manifest.json")).unwrap();
    let mut message = b"openforge-session-release-v1\0".to_vec();
    message.extend_from_slice(&manifest);
    let signature = signer.sign(&message);

    assert!(store
        .stage_published(source.path(), &trust, signature.as_ref())
        .is_err());
    let entries: Vec<_> = fs::read_dir(runtime.path().join("releases"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries, vec!["owner"]);
}

#[test]
fn published_staging_accepts_an_independently_signed_manifest_without_enabling_replacement() {
    use openforge_session_client::releases::PublisherTrust;

    // Node's crypto.sign generated these protocol-4 Ed25519 vectors with test seed [7; 32].
    // The signed JSON uses recursively sorted object keys, matching serde_json::Value.
    // These keys are fixtures, never installed publisher configuration.
    assert_eq!(
        openforge_session_protocol::VERSION,
        4,
        "regenerate the independent signed vectors after a protocol change"
    );
    let public_key = hex_bytes("ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c");
    let (signature, expected_id) = match std::env::consts::ARCH {
        "aarch64" => (
            "0c0efbc0f3dae2db163109fded4a372cff3ae55c822b14772a4f2122115caed66b80e8352ea8bd80aacf033b68e4943354fc09c911cde1bc2ed30eb3ae83e104",
            "3cf6431b18b6c370700dc1c5b0468db784bdf5fbae83f505736fc95bf7575bc1",
        ),
        "x86_64" => (
            "de399f7364b1a1e4502cac5172bded18efc5fde021d45132d209b221937798117242d3ab2923027c4fe40b55373e9787e3502daa85f815b6305c29438b8acf0f",
            "0b68364a5fdaaf2368405993f87854c329be55346c64c23a6fcaed7e1e7c3496",
        ),
        _ => return,
    };
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let source = bundle();
    let trust = PublisherTrust::new(vec![public_key.try_into().unwrap()]).unwrap();
    let release = store
        .stage_published(source.path(), &trust, &hex_bytes(signature))
        .unwrap();

    assert_eq!(release.id(), expected_id);
    drop(source);
    assert_eq!(fs::read(release.executable()).unwrap(), b"daemon");
    assert!(store.preflight(&runtime, &release, Some(&release)).is_err());
}

#[test]
fn published_staging_rejects_a_correctly_signed_protocol_three_release() {
    use openforge_session_client::releases::PublisherTrust;
    use openforge_session_protocol::Error;

    // Preserve the independently generated protocol-3 vectors as compatibility refusals.
    // A valid publisher signature must not make an obsolete protocol compatible.
    let signature = match std::env::consts::ARCH {
        "aarch64" => "868ba7030830688532c93180c990275a5403cc4bf1d7b7f59b57d642dba1cbd1c139efecfbe63e5a4daf7c0264e7302a3e544dba7c5a8de214bc138716b17f06",
        "x86_64" => "796230561f47e2e0b8dd76456ae9323f37ae765ea73dd39eb2d6fa50ef8348307d1e17b17e2e6e2e6cbc97e5e71675470106149e6ad9ded30dfc18faef9ad00d",
        _ => return,
    };
    let source = bundle();
    let path = source.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["protocol"] = 3.into();
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let trust = PublisherTrust::new(vec![hex_bytes(
        "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c",
    )
    .try_into()
    .unwrap()])
    .unwrap();
    assert!(matches!(
        store.stage(source.path()),
        Err(Error::UnsupportedReplacement)
    ));
    assert!(matches!(
        store.stage_published(source.path(), &trust, &hex_bytes(signature)),
        Err(Error::UnsupportedReplacement)
    ));
}

fn hex_bytes(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

#[test]
fn published_staging_never_downgrades_missing_or_invalid_signatures_to_integrity_only() {
    use openforge_session_client::releases::PublisherTrust;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    let signer = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
    let trust =
        PublisherTrust::new(vec![signer.public_key().as_ref().try_into().unwrap()]).unwrap();
    for variant in [
        "missing",
        "truncated",
        "corrupt-signature",
        "wrong-context",
        "changed-manifest",
        "changed-file",
        "changed-cache",
    ] {
        let root = tempfile::tempdir().unwrap();
        let runtime = RuntimeDirectory::open(root.path()).unwrap();
        let store = ReleaseStore::open(&runtime).unwrap();
        let source = bundle();
        let manifest_path = source.path().join("manifest.json");
        let manifest = fs::read(&manifest_path).unwrap();
        let mut message = b"openforge-session-release-v1\0".to_vec();
        message.extend_from_slice(&manifest);
        let mut signature = signer.sign(&message).as_ref().to_vec();
        match variant {
            "missing" => signature.clear(),
            "truncated" => {
                signature.pop();
            }
            "corrupt-signature" => signature[0] ^= 1,
            "wrong-context" => signature = signer.sign(&manifest).as_ref().to_vec(),
            "changed-manifest" => {
                let mut changed = manifest.clone();
                changed.push(b' ');
                fs::write(&manifest_path, changed).unwrap();
            }
            "changed-file" => fs::write(source.path().join("hook.js"), b"tampered").unwrap(),
            "changed-cache" => {
                let release = store
                    .stage_published(source.path(), &trust, &signature)
                    .unwrap();
                fs::set_permissions(release.executable(), fs::Permissions::from_mode(0o700))
                    .unwrap();
                fs::write(release.executable(), b"tampered").unwrap();
                fs::set_permissions(release.executable(), fs::Permissions::from_mode(0o500))
                    .unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            store
                .stage_published(source.path(), &trust, &signature)
                .is_err(),
            "{variant}"
        );
    }
}

#[test]
fn published_staging_accepts_rotated_pinned_keys_but_requires_a_configured_trust_root() {
    use openforge_session_client::releases::PublisherTrust;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    assert!(PublisherTrust::new(vec![]).is_err());
    assert!(PublisherTrust::new(vec![[0; 32]; 17]).is_err());
    let previous = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
    let current = Ed25519KeyPair::from_seed_unchecked(&[8; 32]).unwrap();
    let trust = PublisherTrust::new(vec![
        previous.public_key().as_ref().try_into().unwrap(),
        current.public_key().as_ref().try_into().unwrap(),
    ])
    .unwrap();
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let source = bundle();
    let mut message = b"openforge-session-release-v1\0".to_vec();
    message.extend_from_slice(&fs::read(source.path().join("manifest.json")).unwrap());
    for signer in [&previous, &current] {
        let release = store
            .stage_published(source.path(), &trust, signer.sign(&message).as_ref())
            .unwrap();
        assert_eq!(fs::read(release.executable()).unwrap(), b"daemon");
    }
}

#[test]
fn production_publisher_trust_is_pinned_and_rejects_fixture_keys() {
    use openforge_session_client::releases::PublisherTrust;
    use ring::signature::Ed25519KeyPair;

    let trust = PublisherTrust::production().unwrap();
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let store = ReleaseStore::open(&runtime).unwrap();
    let source = bundle();
    let fixture_key = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
    let mut message = b"openforge-session-release-v1\0".to_vec();
    message.extend_from_slice(&fs::read(source.path().join("manifest.json")).unwrap());
    assert!(store
        .stage_published(source.path(), &trust, fixture_key.sign(&message).as_ref())
        .is_err());
}
