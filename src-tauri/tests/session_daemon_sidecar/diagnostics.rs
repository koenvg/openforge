use super::*;
use openforge_session_client::runtime::RuntimeDirectory;
use std::{collections::BTreeMap, path::Path};

const DAEMON_LOG: &str = "daemon diagnostic first line\ndaemon diagnostic last line\n";
const FIRST_LOG: &str = "first sidecar diagnostic\n";
const SECOND_LOG: &str = "second sidecar diagnostic\n";

fn evidence(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(root: &Path, directory: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root).unwrap().into(),
                    fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    collect(root, root, &mut files);
    files
}

#[test]
#[ignore = "subprocess helper for retained-fixture diagnostics"]
fn retained_fixture_entry() {
    let Some(parent) = std::env::var_os("OPENFORGE_DIAGNOSTIC_TEST_PARENT") else {
        return;
    };
    let mut fixture = Fixture::new();
    fixture.root = tempfile::tempdir_in(parent).unwrap();
    fixture.default_daemon_root =
        std::env::var("OPENFORGE_DIAGNOSTIC_TEST_DEFAULT_ROOT").as_deref() == Ok("1");
    let root = fixture.root.path().to_path_buf();
    fs::create_dir_all(fixture.daemon_root()).unwrap();
    let runtime = RuntimeDirectory::open(&fixture.daemon_root()).unwrap();
    // Create both lock files without launching a daemon or leaving authority held.
    drop(runtime.claim_launch().unwrap());
    drop(runtime.claim().unwrap());
    fs::write(runtime.path().join("daemon.log"), DAEMON_LOG).unwrap();
    fs::write(root.join("first.log"), FIRST_LOG).unwrap();
    fs::write(root.join("second.log"), SECOND_LOG).unwrap();
    fs::write(root.join("third.log"), "additional stage evidence\n").unwrap();
    fs::write(root.join("database.sqlite"), [0, 255, 128, 1]).unwrap();
    if fixture.default_daemon_root {
        fs::create_dir(root.join("session-v1")).unwrap();
        fs::write(root.join("session-v1/daemon.log"), "wrong-root decoy\n").unwrap();
    }
    let before = evidence(&root);
    // The fixture is consumed by unwinding; no client state is reused afterward.
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _fixture = fixture;
        panic!("trigger retained-fixture diagnostics");
    }));
    assert!(panic.is_err());
    assert!(
        root.is_dir(),
        "panicking fixture must retain its entire root"
    );
    assert_eq!(
        evidence(&root),
        before,
        "retained evidence must be unchanged"
    );
}

#[test]
fn fixture_drop_reports_and_preserves_evidence_for_both_private_roots() {
    for default_root in [false, true] {
        let parent = tempfile::tempdir_in("/tmp").unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "diagnostics::retained_fixture_entry",
                "--nocapture",
            ])
            .env("OPENFORGE_DIAGNOSTIC_TEST_PARENT", parent.path())
            .env(
                "OPENFORGE_DIAGNOSTIC_TEST_DEFAULT_ROOT",
                if default_root { "1" } else { "0" },
            )
            .output()
            .unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            output.status.success(),
            "default root={default_root}: {stderr}"
        );
        assert!(
            stderr.contains(&format!("daemon log: {DAEMON_LOG}")),
            "default root={default_root}: {stderr}"
        );
        assert!(
            stderr.contains(&format!("first log: {FIRST_LOG}")),
            "{stderr}"
        );
        assert!(
            stderr.contains(&format!("second log: {SECOND_LOG}")),
            "{stderr}"
        );
        assert!(!stderr.contains("wrong-root decoy"), "{stderr}");
        let roots: Vec<_> = fs::read_dir(parent.path()).unwrap().collect();
        assert_eq!(roots.len(), 1, "exactly one fixture must be retained");
        let root = roots.into_iter().next().unwrap().unwrap().path();
        assert!(
            stderr.contains(&format!(
                "retained fixture for diagnosis: {}",
                root.display()
            )),
            "{stderr}"
        );
    }
}
