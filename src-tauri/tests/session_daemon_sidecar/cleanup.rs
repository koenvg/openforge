use super::*;
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use std::{
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener, process::CommandExt},
};

/// A missing socket is not absence: a detached image may still hold launch authority.
pub(super) fn stop(root: &std::path::Path) -> Result<(), String> {
    match fs::symlink_metadata(root.join("session-v1")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let runtime = RuntimeDirectory::open_existing(root).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut client = None;
    let mut shutdown_requested = false;
    let mut last_error = String::new();
    loop {
        // Hold launch authority while checking lifetime authority so an in-flight
        // image cannot move between them and make two independent probes look free.
        match runtime.claim_launch() {
            Ok(_launch) => match runtime.claim() {
                Ok(_lifetime) => return Ok(()),
                Err(openforge_session_protocol::Error::AlreadyRunning) => {}
                Err(error) => return Err(error.to_string()),
            },
            Err(openforge_session_protocol::Error::AlreadyRunning) => {}
            Err(error) => return Err(error.to_string()),
        }
        if !shutdown_requested {
            if client.is_none() {
                match Client::connect(root) {
                    Ok(connected) => {
                        connected
                            .enable_operation_retirement()
                            .map_err(|error| error.to_string())?;
                        for session in connected
                            .inventory()
                            .map_err(|error| error.to_string())?
                            .sessions
                        {
                            connected
                                .terminate_ordered(&session.pty)
                                .map_err(|error| error.to_string())?;
                        }
                        client = Some(connected);
                    }
                    Err(error @ openforge_session_protocol::Error::Transport(_)) => {
                        last_error = error.to_string();
                    }
                    Err(error) => return Err(error.to_string()),
                }
            }
            if let Some(client) = &client {
                match client.shutdown_empty() {
                    Ok(()) => {
                        shutdown_requested = true;
                        last_error = "shutdown acknowledged, authority still held".into();
                    }
                    Err(error) => last_error = error.to_string(),
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "fixture daemon cleanup authority remains unknown: {last_error}"
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
/// Runs only as an owned delayed-launch executable, never as a normal contract test.
#[test]
#[ignore = "subprocess helper for the owned delayed-start cleanup regression"]
fn delayed_daemon_entry() {
    let Some(root) = std::env::var_os("OPENFORGE_CLEANUP_TEST_ROOT") else {
        return;
    };
    let mut gate = std::os::unix::net::UnixStream::connect(
        std::env::var_os("OPENFORGE_CLEANUP_TEST_GATE").unwrap(),
    )
    .unwrap();
    gate.write_all(b"entered").unwrap();
    let mut release = [0];
    // A lost gate cancels this owned launch without signalling any process.
    if gate.read(&mut release).unwrap_or(0) != 1 || release != [1] {
        return;
    }
    drop(gate);
    let error = Command::new(std::env::var_os("OPENFORGE_CLEANUP_TEST_DAEMON").unwrap())
        .arg(root)
        .exec();
    panic!("exec owned delayed daemon: {error}");
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn fixture_drop_waits_for_daemon_that_becomes_ready_after_startup_timeout() {
    let gate_root = tempfile::Builder::new()
        .prefix("of-cleanup-gate-")
        .tempdir_in("/tmp")
        .unwrap();
    let gate_path = gate_root.path().join("gate.sock");
    let listener = UnixListener::bind(&gate_path).unwrap();
    let mut fixture = Fixture::new();
    let root = fixture.daemon_root();
    let delayed = fixture.root.path().join("delayed-daemon");
    let daemon = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    assert!(daemon.is_file(), "build Session Daemon first");
    fs::write(
        &delayed,
        format!(
            "#!/bin/sh\nexport OPENFORGE_CLEANUP_TEST_ROOT=\"$1\"\nexport OPENFORGE_CLEANUP_TEST_GATE='{}'\nexport OPENFORGE_CLEANUP_TEST_DAEMON='{}'\nexec '{}' --ignored --exact cleanup::delayed_daemon_entry --nocapture\n",
            gate_path.display(),
            daemon.display(),
            std::env::current_exe().unwrap().display(),
        ),
    )
    .unwrap();
    fs::set_permissions(&delayed, fs::Permissions::from_mode(0o700)).unwrap();
    fixture.provider_env.push((
        "OPENFORGE_SESSION_DAEMON_PATH".into(),
        delayed.to_string_lossy().into(),
    ));
    let (_, startup_log) = fixture
        .start_once("first")
        .expect_err("gate must prevent readiness");
    assert!(
        startup_log.contains("daemon startup timed out"),
        "{startup_log}"
    );
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut gate = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(
                    Instant::now() < deadline,
                    "owned delayed launch never entered"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("accept owned delayed launch: {error}"),
        }
    };
    gate.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut entered = [0; 7];
    gate.read_exact(&mut entered).unwrap();
    assert_eq!(&entered, b"entered");
    let runtime = RuntimeDirectory::open_existing(&root).unwrap();
    assert!(!runtime.socket_path().exists());
    assert!(matches!(
        runtime.claim_launch(),
        Err(openforge_session_protocol::Error::AlreadyRunning)
    ));
    // Keep passive descriptors so deletion cannot hide a still-held lifetime lock.
    let launch = fs::File::open(runtime.path().join("launch.lock")).unwrap();
    let owner = fs::File::open(runtime.path().join("daemon.lock")).unwrap();
    let mut daemon_log = fs::File::open(runtime.path().join("daemon.log")).unwrap();
    let (started_tx, started) = std::sync::mpsc::channel();
    let (done_tx, done) = std::sync::mpsc::channel();
    let cleanup = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        drop(fixture);
        done_tx.send(()).unwrap();
    });
    started.recv().unwrap();
    let premature = done.recv_timeout(Duration::from_millis(200)).is_ok();
    // Always release and join before asserting, including on the red implementation.
    gate.write_all(&[1]).unwrap();
    cleanup.join().unwrap();
    assert!(
        !premature,
        "cleanup completed while delayed launch still held authority"
    );
    assert!(
        !root.exists(),
        "successful cleanup must remove the private fixture"
    );
    let mut log = String::new();
    daemon_log.read_to_string(&mut log).unwrap();
    assert!(
        log.contains("session daemon ready"),
        "delayed daemon never became ready: {log}"
    );
    launch.try_lock().unwrap();
    owner.try_lock().unwrap();
    assert!(Client::connect(&root).is_err());
}

#[test]
fn fixture_drop_retains_evidence_when_launch_authority_never_becomes_ready() {
    retains_evidence_with_authority(true);
}

#[test]
fn fixture_drop_retains_evidence_when_lifetime_owner_has_no_socket() {
    retains_evidence_with_authority(false);
}

fn retains_evidence_with_authority(launch: bool) {
    let fixture = Fixture::new();
    let root = fixture.daemon_root();
    let runtime = RuntimeDirectory::open(&root).unwrap();
    let authority = if launch {
        runtime.claim_launch().unwrap()
    } else {
        runtime.claim().unwrap()
    };
    drop(fixture);
    assert!(
        root.exists(),
        "unknown cleanup authority must retain evidence"
    );
    assert!(runtime.path().join("credentials.json").exists());
    drop(authority);
    // This test owns the authority, and removes evidence only after both locks are free.
    let _launch = runtime.claim_launch().unwrap();
    let _lifetime = runtime.claim().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fixture_drop_removes_runtime_when_both_authorities_are_free() {
    let fixture = Fixture::new();
    let root = fixture.daemon_root();
    RuntimeDirectory::open(&root).unwrap();
    drop(fixture);
    assert!(!root.exists());
}

#[test]
fn fixture_drop_removes_fixture_that_never_launched_a_daemon() {
    let fixture = Fixture::new();
    let root = fixture.daemon_root();
    drop(fixture);
    assert!(!root.exists());
}
