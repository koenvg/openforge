use super::*;

#[test]
fn reopening_owned_runtime_never_creates_rotates_or_reclaims_credentials() {
    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let _ownership = runtime.claim().unwrap();
    let path = runtime.path().join("credentials.json");
    let before = fs::read(&path).unwrap();
    let reopened = RuntimeDirectory::reopen(root.path(), runtime.credentials()).unwrap();
    assert_eq!(reopened.credentials().token, runtime.credentials().token);
    assert_eq!(fs::read(&path).unwrap(), before);

    let changed = Credentials {
        installation: runtime.credentials().installation.clone(),
        token: "f".repeat(64),
    };
    fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert!(RuntimeDirectory::reopen(root.path(), runtime.credentials()).is_err());
    assert_eq!(
        fs::read(&path).unwrap(),
        serde_json::to_vec(&changed).unwrap()
    );
    fs::remove_file(&path).unwrap();
    assert!(RuntimeDirectory::reopen(root.path(), runtime.credentials()).is_err());
    assert!(!path.exists());

    let missing = tempfile::tempdir().unwrap();
    assert!(RuntimeDirectory::reopen(missing.path(), runtime.credentials()).is_err());
    assert!(!missing.path().join("session-v1").exists());
}
