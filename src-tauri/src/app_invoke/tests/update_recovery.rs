//! Real backend reconnects through the IPC boundary, with private per-process startup inputs.
use super::*;
use std::{fs, path::Path, process::Command};

struct OwnedChild(std::process::Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
fn committed_update_reconnect_requires_fresh_restoration_before_mutations() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-update-reconnect-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let operation = uuid::Uuid::new_v4().to_string();
    for phase in ["source", "commit", "recover", "ordinary"] {
        run_child(fixture.0.path(), &operation, phase);
    }
}

fn run_child(root: &Path, operation: &str, phase: &str) {
    let log = root.join(format!("{phase}.log"));
    let output = fs::File::create(&log).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "app_invoke::tests::update_recovery::committed_update_reconnect_child",
            "--ignored",
            "--nocapture",
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", root)
        .env("TMPDIR", root)
        .env("SHELL", "/bin/sh")
        .env("OPENFORGE_RESTART_CONTRACT_ROOT", root)
        .env("OPENFORGE_RESTART_CONTRACT_PHASE", phase)
        .env("OPENFORGE_RESTART_CONTRACT_OPERATION", operation)
        .stdout(output.try_clone().unwrap())
        .stderr(output);
    if matches!(phase, "commit" | "recover") {
        command.env("OPENFORGE_RESTART_OPERATION", operation);
    }
    let mut child = OwnedChild(command.spawn().unwrap());
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "owned backend fixture timed out: {phase}"
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(
        status.success(),
        "{phase}: {}",
        fs::read_to_string(log).unwrap()
    );
    assert!(
        root.join(format!("{phase}.done")).is_file(),
        "fixture did not run: {phase}"
    );
}

#[tokio::test]
#[ignore = "child of the committed update reconnect contract"]
async fn committed_update_reconnect_child() {
    let Some(root) = std::env::var_os("OPENFORGE_RESTART_CONTRACT_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let phase = std::env::var("OPENFORGE_RESTART_CONTRACT_PHASE").unwrap();
    let operation = std::env::var("OPENFORGE_RESTART_CONTRACT_OPERATION").unwrap();
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let (mut state, _db) = test_state("committed-update-reconnect");
    state
        .pty_manager
        .as_mut()
        .unwrap()
        .enable_installation_daemon(root.clone(), executable);
    let key = "T-update-shell-0";
    if phase == "source" {
        let instance = invoke_ok(
            &state,
            "pty_spawn_shell",
            json!({
                "taskId": "T-update", "terminalIndex": 0, "cwd": root, "cols": 80, "rows": 24,
            }),
        )
        .await;
        fs::write(root.join("original-session.json"), instance.to_string()).unwrap();
        invoke_ok(
            &state,
            "prepare_app_restart",
            json!({
                "operationId": operation, "intent": "update",
            }),
        )
        .await;
        invoke_ok(
            &state,
            "detach_app_restart",
            json!({ "operationId": operation }),
        )
        .await;
    } else {
        let original: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("original-session.json")).unwrap()).unwrap();
        let replay = invoke_ok(&state, "get_pty_buffer", json!({ "shellSessionKey": key })).await;
        assert_eq!(replay["instanceId"], original);
        assert_eq!(replay["isLive"], true);
        if phase == "recover" {
            // The previous backend committed, but its host never recorded that acknowledgement.
            // This lifetime must stay fenced until the host completes its own restoration.
            let rejected = invoke(&state, "pty_spawn_shell", json!({
                "taskId": "T-must-not-start", "terminalIndex": 0, "cwd": root, "cols": 80, "rows": 24,
            })).await.unwrap_err();
            assert!(rejected.1.contains("not executed"), "{rejected:?}");
        }
        if phase != "ordinary" {
            invoke_ok(
                &state,
                "commit_app_restart",
                json!({ "operationId": operation }),
            )
            .await;
            invoke_ok(
                &state,
                "commit_app_restart",
                json!({ "operationId": operation }),
            )
            .await;
        }
        invoke_ok(
            &state,
            "pty_write",
            json!({ "shellSessionKey": key, "data": "true\n" }),
        )
        .await;
    }
    fs::write(root.join(format!("{phase}.done")), b"done").unwrap();
}
