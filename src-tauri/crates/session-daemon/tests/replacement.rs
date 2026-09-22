#![cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
))]
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::*;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    os::unix::{net::UnixStream, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    time::{Duration, Instant},
};

// A replacement preparation may wait for two cold executable startups.
// These are fixture waits, not the helper's execution deadline.
const STARTUP_WAIT: Duration = Duration::from_secs(30); // 10s startup + 20s loader startup
const STATUS_WAIT: Duration = Duration::from_secs(55); // 15s status + two 20s startups
#[path = "replacement/http.rs"]
mod http;
#[path = "replacement/input.rs"]
mod input;
#[allow(dead_code)]
#[path = "../../../src/pty_manager/managed_process.rs"]
mod managed_process;
#[path = "replacement/model_provider.rs"]
mod model_provider;
#[path = "replacement/notifications.rs"]
mod notifications;
#[path = "replacement/operation_retention.rs"]
mod operation_retention;
#[path = "replacement/pi.rs"]
mod pi;
#[path = "replacement/preflight.rs"]
mod preflight;

struct Fixture {
    root: tempfile::TempDir,
    daemon: Child,
    tracked: Vec<managed_process::ManagedProcessIdentity>,
}
impl Fixture {
    fn new() -> (Self, Client) {
        Self::with_executable(Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")))
    }
    fn with_executable(executable: &Path) -> (Self, Client) {
        let root = tempfile::Builder::new()
            .prefix("of-rx-")
            .tempdir_in("/tmp")
            .unwrap();
        let mut command = std::process::Command::new(executable);
        command
            .arg(root.path())
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(std::fs::File::create(root.path().join("fixture.log")).unwrap());
        // SAFETY: setsid is async-signal-safe; only the test-owned daemon's session changes.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let daemon = command.spawn().unwrap();
        let fixture = Self {
            root,
            daemon,
            tracked: Vec::new(),
        };
        let deadline = Instant::now() + STARTUP_WAIT;
        loop {
            if let Ok(client) = Client::connect(fixture.root.path()) {
                return (fixture, client);
            }
            assert!(Instant::now() < deadline, "test daemon did not start");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn rpc(&self, command: Value) -> Result<Value, Error> {
        let runtime = RuntimeDirectory::open(self.root.path())?;
        let mut stream = UnixStream::connect(runtime.socket_path())
            .map_err(openforge_session_client::runtime::io_error)?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write_frame(
            &mut stream,
            &Envelope {
                version: VERSION,
                body: json!({"token":runtime.credentials().token,"command":command}),
            },
        )?;
        read_frame::<_, Result<Value, Error>>(&mut stream)?
    }
    fn status(&self, operation: &str, wanted: &str) -> Value {
        let deadline = Instant::now() + STATUS_WAIT;
        let mut last = String::new();
        loop {
            let response = self.rpc(json!({"kind":"replacementStatus","operation":operation}));
            last.clone_from(&format!("{response:?}"));
            if let Ok(response) = response {
                let status = &response["value"];
                let state = status["state"]["kind"].as_str().unwrap();
                if state == wanted {
                    return status.clone();
                }
                assert_ne!(state, "failed", "replacement failed: {status}");
            }
            assert!(
                Instant::now() < deadline,
                "replacement did not reach {wanted}: {last}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            if let Ok(log) = std::fs::read_to_string(self.root.path().join("fixture.log")) {
                for line in log.lines().filter(|line| {
                    line.contains("daemon")
                        || line.contains("initialization")
                        || line.contains("rollback")
                        || line.contains("recovery")
                        || line.contains("preflight")
                        || line.contains("replacement unavailable")
                }) {
                    eprintln!("fixture daemon: {line}");
                }
            }
        }
        if let Ok(client) = Client::connect(self.root.path()) {
            if let Ok(inventory) = client.inventory() {
                for session in inventory.sessions {
                    let _ = client
                        .terminate(&format!("cleanup-{}", session.pty.instance), &session.pty);
                }
            }
            let _ = client.shutdown_empty();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.daemon.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.daemon.try_wait().ok().flatten().is_none() {
            let _ = self.daemon.kill();
        }
        let _ = self.daemon.wait();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        for identity in &self.tracked {
            let result = runtime.block_on(
                managed_process::terminate_managed_process_tree_with_root_reaper(
                    identity,
                    Duration::from_millis(100),
                    |_| {},
                ),
            );
            assert!(
                result.is_ok(),
                "test-owned process cleanup failed: {result:?}"
            );
        }
    }
}

#[test]
fn repeated_real_images_keep_daemon_and_shell_pids_pty_identity_state_and_retry_receipts() {
    let (mut fixture, mut client) = Fixture::new();
    eprintln!("fixture progress: daemon {} connected", fixture.daemon.id());
    let caps = fixture
        .rpc(json!({"kind":"capabilities"}))
        .expect("daemon must expose replacement capability");
    assert_eq!(caps["value"]["supportsReplacement"], true);
    assert_eq!(caps["value"]["pid"], fixture.daemon.id());
    let executor = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    eprintln!("fixture progress: canonical connect start");
    let connection = executor
        .block_on(openforge_session_host::PtyHost::connect(
            &client,
            &client.controller().installation,
        ))
        .unwrap();
    eprintln!("fixture progress: canonical connect complete");
    assert!(
        connection.supports_replacement,
        "the canonical client adapter must advertise the daemon capability"
    );
    client = client.with_controller(connection.controller);
    let command = ShellCommand {
        owner: TerminalOwner::Shell { task_id: "replacement".into(), index: Some(3) },
        command: PreparedCommand { program: "/bin/sh".into(), args: vec!["-c".into(), "value=kept; while IFS= read -r line; do printf 'STATE:%s:%s:%s:' \"$$\" \"$value\" \"$line\"; tty; done".into()], cwd: fixture.root.path().into(), env: BTreeMap::new() },
        columns: 80, rows: 24, image_protocol: None,
    };
    let session = client.spawn("spawn", &command).unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    client.write("first", &session.pty, 1, b"before\n").unwrap();
    wait_text(
        &client,
        &session.pty,
        &format!("STATE:{}:kept:before:", session.pid),
    );
    let initial_recovery = client.recover(&session.pty).unwrap();
    let tty = String::from_utf8_lossy(&initial_recovery.portable_vt)
        .split("/dev/ttys")
        .nth(1)
        .unwrap()
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    assert!(!tty.is_empty());
    let mut receipts = Vec::new();
    for (index, image) in [
        env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"),
        env!("CARGO_BIN_EXE_openforge-session-daemon"),
    ]
    .into_iter()
    .enumerate()
    {
        let operation = format!("replace-{index}");
        eprintln!("fixture progress: prepare {index} start");
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &client,
                client.controller(),
                OperationId::parse(&operation).unwrap(),
                ReplacementPhase::Prepare {
                    executable: image.into(),
                },
            ))
            .unwrap();
        fixture.status(&operation, "prepared");
        eprintln!("fixture progress: commit {index} start");
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &client,
                client.controller(),
                OperationId::parse(&operation).unwrap(),
                ReplacementPhase::Commit,
            ))
            .unwrap();
        eprintln!("fixture progress: commit {index} complete");
        receipts.push(fixture.status(&operation, "activated"));
        let actual = executable(fixture.daemon.id());
        assert!(
            std::fs::read(actual).unwrap() == std::fs::read(image).unwrap(),
            "kernel still runs a different image"
        );
        assert!(matches!(client.inventory(), Err(Error::StaleController)));
        client = Client::connect(fixture.root.path()).unwrap();
        let retried = client.spawn("spawn", &command).unwrap();
        assert_eq!(retried.pid, session.pid);
        assert_eq!(retried.pty, session.pty);
        client.write("first", &session.pty, 1, b"before\n").unwrap();
        client
            .write(
                &format!("after-{index}"),
                &session.pty,
                2 + index as u64,
                format!("after-{index}\n").as_bytes(),
            )
            .unwrap();
        wait_text(
            &client,
            &session.pty,
            &format!("STATE:{}:kept:after-{index}:/dev/ttys{tty}", session.pid),
        );
        assert_eq!(
            fixture.rpc(json!({"kind":"capabilities"})).unwrap()["value"]["pid"],
            fixture.daemon.id()
        );
    }
    for receipt in receipts {
        let operation = receipt["operation"].as_str().unwrap();
        assert_eq!(
            fixture.status(operation, "activated"),
            receipt,
            "a later replacement must not rewrite an earlier operation's outcome"
        );
    }
}
#[test]
fn failed_exec_and_controlled_initialization_report_failure_without_losing_the_owner() {
    for (image, stage) in [
        (
            env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-exec-fails"),
            "exec",
        ),
        (
            env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-init-fails"),
            "initialization",
        ),
    ] {
        let (mut fixture, client) = Fixture::new();
        let original = client.capabilities().unwrap();
        let command = ShellCommand {
            owner: TerminalOwner::Shell { task_id: "failure".into(), index: None },
            command: PreparedCommand { program: "/bin/sh".into(), args: vec!["-c".into(), "value=kept; while IFS= read -r line; do printf 'STATE:%s:%s:%s\\n' \"$$\" \"$value\" \"$line\"; done".into()], cwd: fixture.root.path().into(), env: BTreeMap::new() },
            columns: 80, rows: 24, image_protocol: None,
        };
        let session = client.spawn("spawn", &command).unwrap();
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
        client
            .write("before", &session.pty, 1, b"before\n")
            .unwrap();
        wait_text(
            &client,
            &session.pty,
            &format!("STATE:{}:kept:before", session.pid),
        );
        let executor = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let operation = OperationId::parse("failed-replacement").unwrap();
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &client,
                client.controller(),
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: image.into(),
                },
            ))
            .unwrap();
        assert!(
            executor
                .block_on(openforge_session_host::PtyHost::replacement(
                    &client,
                    client.controller(),
                    operation.clone(),
                    ReplacementPhase::Commit
                ))
                .is_err(),
            "failed activation must never return success"
        );
        let status = fixture.status(operation.as_str(), "failed");
        assert_eq!(status["state"]["stage"], stage);
        assert_eq!(status["actualVersion"], original.image_version);
        assert_eq!(
            client.capabilities().unwrap().image_version,
            original.image_version
        );
        assert_eq!(client.capabilities().unwrap().pid, original.pid);
        assert!(
            std::fs::read(executable(original.pid)).unwrap()
                == std::fs::read(env!("CARGO_BIN_EXE_openforge-session-daemon")).unwrap()
        );
        if stage == "exec" {
            assert!(client.inventory().is_ok());
        } else {
            assert!(matches!(client.inventory(), Err(Error::StaleController)));
        }
        let fresh = Client::connect(fixture.root.path()).unwrap();
        let retried = fresh.spawn("spawn", &command).unwrap();
        assert_eq!(retried.pid, session.pid);
        assert_eq!(retried.pty, session.pty);
        fresh.write("before", &session.pty, 1, b"before\n").unwrap();
        fresh.write("after", &session.pty, 2, b"after\n").unwrap();
        wait_text(
            &fresh,
            &session.pty,
            &format!("STATE:{}:kept:after", session.pid),
        );
    }
}

fn wait_text(client: &Client, pty: &PtyIdentity, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !client.recover(pty).is_ok_and(|snapshot| {
        snapshot
            .portable_vt
            .windows(expected.len())
            .any(|bytes| bytes == expected.as_bytes())
    }) {
        assert!(
            Instant::now() < deadline,
            "expected PTY output did not arrive"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut libc::c_void, capacity: u32) -> i32;
}
fn executable(pid: u32) -> PathBuf {
    let mut buffer = [0u8; 4096];
    // SAFETY: buffer is writable for exactly the supplied capacity; pid is test-owned.
    assert!(
        unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) } > 0
    );
    Path::new(
        std::ffi::CStr::from_bytes_until_nul(&buffer)
            .unwrap()
            .to_str()
            .unwrap(),
    )
    .into()
}
