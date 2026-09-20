use openforge_session_client::Client;
use openforge_session_host::{PreparedCommand, TerminalOwner};
use openforge_session_protocol::ShellCommand;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

#[test]
fn local_termination_authenticates_without_sidecar_and_stops_only_selected_installation() {
    let root = tempfile::Builder::new()
        .prefix("of-recovery-")
        .tempdir_in("/tmp")
        .unwrap();
    let other_root = tempfile::Builder::new()
        .prefix("of-other-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon"));
    let client = Client::launch(executable, root.path()).unwrap();
    let other = Client::launch(executable, other_root.path()).unwrap();
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "recovery".into(),
            index: Some(0),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![],
            cwd: root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    client.spawn("recovery-shell", &command).unwrap();
    let result = Command::new(executable)
        .arg("--terminate-sessions")
        .arg(root.path())
        .output()
        .unwrap();
    // Always clean up the isolated fixture, including on the red run.
    let survived = other.inventory().is_ok();
    other.shutdown_empty().unwrap();
    let remaining = Client::connect(root.path());
    let terminated = remaining.is_err();
    if let Ok(cleanup) = remaining {
        cleanup
            .terminate_owned_sessions(std::time::Duration::from_secs(3))
            .unwrap();
    }
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(survived);
    assert!(terminated);
}

#[test]
fn stale_controller_cannot_terminate_and_expired_credentials_do_not_guess_ownership() {
    use openforge_session_protocol::Error;
    use std::time::Duration;
    let root = tempfile::Builder::new()
        .prefix("of-auth-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon"));
    let first = Client::launch(executable, root.path()).unwrap();
    let current = Client::connect(root.path()).unwrap();
    assert!(matches!(
        first.terminate_owned_sessions(Duration::ZERO),
        Err(Error::StaleController)
    ));
    let credentials_path = root.path().join("session-v1/credentials.json");
    let original = std::fs::read(&credentials_path).unwrap();
    let mut credentials: serde_json::Value = serde_json::from_slice(&original).unwrap();
    credentials["token"] = serde_json::json!("0".repeat(64));
    std::fs::write(&credentials_path, serde_json::to_vec(&credentials).unwrap()).unwrap();
    let result = Command::new(executable)
        .arg("--terminate-sessions")
        .arg(root.path())
        .output()
        .unwrap();
    std::fs::write(&credentials_path, original).unwrap();
    assert!(!result.status.success());
    assert!(current.inventory().is_ok());
    Client::connect(root.path())
        .unwrap()
        .terminate_owned_sessions(Duration::from_secs(3))
        .unwrap();
}

#[test]
fn readiness_timeout_leaves_delayed_host_available_for_later_attachment() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};
    let root = tempfile::Builder::new()
        .prefix("of-delay-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = env!("CARGO_BIN_EXE_openforge-session-daemon");
    let delayed = root.path().join("delayed-daemon");
    std::fs::write(
        &delayed,
        format!("#!/bin/sh\n/bin/sleep 6\nexec '{executable}' \"$@\"\n"),
    )
    .unwrap();
    std::fs::set_permissions(&delayed, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(Client::launch(&delayed, root.path()).is_err());
    // A retry during delayed readiness must not execute another daemon image.
    let retry = Client::launch(&delayed, root.path());
    let deadline = Instant::now() + Duration::from_secs(5);
    let attached = loop {
        if let Ok(client) = Client::connect(root.path()) {
            break Some(client);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if let Some(client) = &attached {
        client.shutdown_empty().unwrap();
    }
    assert!(matches!(
        retry,
        Err(openforge_session_protocol::Error::AlreadyRunning)
    ));
    assert!(
        attached.is_some(),
        "readiness deadline must not kill a delayed daemon"
    );
}

#[test]
fn local_termination_does_not_create_replacement_credentials_when_authentication_is_missing() {
    let root = tempfile::Builder::new()
        .prefix("of-missing-auth-")
        .tempdir_in("/tmp")
        .unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_openforge-session-daemon"))
        .arg("--terminate-sessions")
        .arg(root.path())
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("session-v1").exists());
}

#[test]
fn launch_retry_does_not_replace_a_live_daemons_missing_credentials() {
    let root = tempfile::Builder::new()
        .prefix("of-lost-auth-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon"));
    let client = Client::launch(executable, root.path()).unwrap();
    let path = root.path().join("session-v1/credentials.json");
    let original = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    let retried = Client::launch(executable, root.path());
    let recreated = path.exists();
    std::fs::write(&path, original).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    client.shutdown_empty().unwrap();
    assert!(retried.is_err());
    assert!(
        !recreated,
        "missing authentication requires reauthentication, not a new identity"
    );
}
