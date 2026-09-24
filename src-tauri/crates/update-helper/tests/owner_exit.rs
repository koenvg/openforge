#![cfg(all(target_os = "macos", feature = "test-fixtures"))]

use std::{
    fs,
    io::Read,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn owner_fixture() {
    let Some(root) = std::env::var_os("OWNER_FIXTURE_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let executable = root.join("private-target");
    fs::copy(
        env!("CARGO_BIN_EXE_openforge-update-target-fixture"),
        &executable,
    )
    .unwrap();
    let mut child = Command::new(executable)
        .arg("--watch-parent")
        .env_clear()
        .env("OPENFORGE_ELECTRON_USER_DATA_DIR", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    // The test kills this owner, not an observed/grandchild PID. If abandoned,
    // EOF releases our actual child. The target also has its own 10s expiry.
    let _ = std::io::stdin().read(&mut [0_u8; 1]);
    let _ = child.kill();
    let _ = child.wait();
}

fn running(pid: &str) -> bool {
    let output = Command::new("/bin/ps")
        .args(["-p", pid, "-o", "stat="])
        .env_clear()
        .output()
        .unwrap();
    let state = String::from_utf8(output.stdout).unwrap();
    !state.trim().is_empty() && !state.trim().starts_with('Z')
}

#[test]
fn owned_backend_exits_with_its_actual_host_without_signalling_other_processes() {
    let root = tempfile::tempdir().unwrap();
    let owner = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "owner_fixture", "--nocapture"])
            .env_clear()
            .env("OWNER_FIXTURE_ROOT", root.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let mut other = OwnedChild(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let marker = root.path().join("owner-watch-ready");
    let ready = Instant::now() + Duration::from_secs(10);
    while !marker.exists() && Instant::now() < ready {
        std::thread::sleep(Duration::from_millis(20));
    }
    let pid = fs::read_to_string(marker).expect("private target did not become ready");
    assert!(running(&pid));
    drop(owner);
    let deadline = Instant::now() + Duration::from_secs(2);
    while running(&pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    let exited_with_owner = !running(&pid);
    // Never signal this orphan by PID. Even a red guard test must leave no owned
    // fixture behind: its explicit fixture lifetime bounds cleanup independently.
    let cleanup = Instant::now() + Duration::from_secs(12);
    while running(&pid) && Instant::now() < cleanup {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(exited_with_owner, "backend survived its owning host");
    assert!(!running(&pid), "private target did not finish cleanup");
    assert!(
        !root.path().join("quit-cleanup-ran").exists(),
        "owner loss ran Quit cleanup"
    );
    assert!(other.0.try_wait().unwrap().is_none());
}
