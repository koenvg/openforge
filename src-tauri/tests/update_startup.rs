#![cfg(target_os = "macos")]
use std::{
    io::Write,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[test]
fn update_sidecar_refuses_eof_and_forged_admission_before_any_domain_access() {
    for input in [b"".as_slice(), b"{}".as_slice()] {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("sidecar");
        std::fs::copy(env!("CARGO_BIN_EXE_openforge"), &executable).unwrap();
        let data = root.path().join("must-not-be-created");
        // The malformed fixture command is deliberate. Even the pre-gate binary
        // exits before database/CLI/keychain initialization, making RED safe.
        let mut child = Command::new(&executable)
            .args(["desktop-test-fixture", "--openforge-update-startup"])
            .env_clear()
            .env("HOME", root.path())
            .env("OPENFORGE_APP_DATA_DIR", &data)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(input).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if child.try_wait().unwrap().is_none() {
            let _ = child.kill();
            let _ = child.wait();
            panic!("owned Sidecar did not refuse startup within the fresh-image limit");
        }
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("[update-startup] refused"),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !data.exists(),
            "unauthorized startup must not create application data"
        );
    }
}
