#![cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
))]
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_host::CapacityKind;
use openforge_session_protocol::*;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    os::unix::{net::UnixStream, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    time::{Duration, Instant},
};

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

// Image probes and hundreds of PTYs compete for macOS process/descriptor headroom.
static FIXTURE_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct Fixture {
    root: tempfile::TempDir,
    daemon: Child,
    tracked: Vec<managed_process::ManagedProcessIdentity>,
    _serial: std::sync::MutexGuard<'static, ()>,
}
impl Fixture {
    fn new() -> (Self, Client) {
        Self::with_executable(Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")))
    }
    fn with_executable(executable: &Path) -> (Self, Client) {
        Self::with_executable_and_limit(executable, None, None, None)
    }
    fn with_fd_limit(limit: libc::rlim_t) -> (Self, Client) {
        Self::with_executable_and_limit(
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            Some(limit),
            None,
            None,
        )
    }
    fn with_checkpoint_budget(limit: usize) -> (Self, Client) {
        Self::with_executable_and_limit(
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            None,
            Some(limit),
            None,
        )
    }
    fn with_checkpoint_deadline_ms(limit: u64) -> (Self, Client) {
        Self::with_executable_and_limit(
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            None,
            None,
            Some(limit),
        )
    }
    fn with_executable_and_limit(
        executable: &Path,
        fd_limit: Option<libc::rlim_t>,
        checkpoint_limit: Option<usize>,
        checkpoint_deadline_ms: Option<u64>,
    ) -> (Self, Client) {
        let serial = FIXTURE_SERIAL
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
        if let Some(limit) = checkpoint_limit {
            command.env("OPENFORGE_TEST_CHECKPOINT_BYTE_LIMIT", limit.to_string());
        }
        if let Some(limit) = checkpoint_deadline_ms {
            command.env("OPENFORGE_TEST_CHECKPOINT_DEADLINE_MS", limit.to_string());
        }
        // SAFETY: setsid is async-signal-safe; only the test-owned daemon's session changes.
        unsafe {
            command.pre_exec(move || {
                if let Some(limit) = fd_limit {
                    let mut current = std::mem::zeroed::<libc::rlimit>();
                    if libc::getrlimit(libc::RLIMIT_NOFILE, &mut current) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    current.rlim_cur = limit.min(current.rlim_max);
                    if libc::setrlimit(libc::RLIMIT_NOFILE, &current) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
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
            _serial: serial,
        };
        let deadline = Instant::now() + Duration::from_secs(10);
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
        let deadline = Instant::now() + Duration::from_secs(15);
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
fn descriptor_pressure_refuses_only_the_new_spawn() {
    let (mut fixture, client) = Fixture::with_fd_limit(128);
    client.enable_operation_retirement().unwrap();
    let mut oldest = None;
    let mut admitted = 0;
    for index in 0..64 {
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "fd-admission".into(),
                index: Some(index),
            },
            command: PreparedCommand {
                program: "/bin/cat".into(),
                args: vec![],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        match client.spawn_ordered(&command) {
            Ok(session) => {
                fixture
                    .tracked
                    .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
                oldest.get_or_insert(session.pty);
                admitted += 1;
            }
            Err(Error::CapacityExceeded(CapacityKind::FileDescriptors)) => break,
            Err(error) => panic!("admission {index} failed without capacity diagnosis: {error}"),
        }
    }
    assert!(
        admitted > 0 && admitted < 64,
        "unexpected admitted count {admitted}"
    );
    let oldest = oldest.unwrap();
    client
        .write_ordered(&oldest, 1, b"pressure-survivor\n")
        .unwrap();
    wait_text(&client, &oldest, "pressure-survivor");
    assert_eq!(client.inventory().unwrap().capacity.live_sessions, admitted);
}

#[test]
fn checkpoint_descriptor_pressure_preserves_running_terminal() {
    let (mut fixture, client) = Fixture::with_fd_limit(85);
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "descriptor-pressure".into(),
            index: None,
        },
        command: PreparedCommand {
            program: "/bin/cat".into(),
            args: vec![],
            cwd: fixture.root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let session = client.spawn("spawn-pressure", &command).unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let operation = OperationId::parse("replace-under-pressure").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: PathBuf::from(env!(
                    "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                )),
            },
        )
        .unwrap();
    fixture.status(operation.as_str(), "prepared");
    client
        .replacement_phase(operation.clone(), ReplacementPhase::Commit)
        .unwrap();
    let status = fixture.status(operation.as_str(), "failed");
    assert_eq!(status["state"]["stage"], "checkpoint");
    let after = client.inventory().unwrap();
    assert_eq!(after.capacity.live_sessions, 1);
    assert_eq!(after.sessions[0].pid, session.pid);
    client
        .write("after-pressure", &session.pty, 1, b"still-here\n")
        .unwrap();
    wait_text(&client, &session.pty, "still-here");
}

#[test]
fn oversized_checkpoint_refuses_before_exec_without_dropping_any_terminal() {
    let (mut fixture, client) = Fixture::with_checkpoint_budget(1024);
    let mut sessions = Vec::new();
    for index in 0..3 {
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "dense-checkpoint".into(),
                index: Some(index),
            },
            command: PreparedCommand {
                program: "/bin/cat".into(),
                args: vec![],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client
            .spawn(&format!("dense-spawn-{index}"), &command)
            .unwrap();
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
        client
            .write(
                &format!("dense-write-{index}"),
                &session.pty,
                1,
                format!("DENSE-{index}-{}\n", "x".repeat(512)).as_bytes(),
            )
            .unwrap();
        wait_text(&client, &session.pty, &format!("DENSE-{index}"));
        sessions.push(session);
    }
    let operation = OperationId::parse("oversized-checkpoint").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: PathBuf::from(env!(
                    "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                )),
            },
        )
        .unwrap();
    fixture.status(operation.as_str(), "prepared");
    client
        .replacement_phase(operation.clone(), ReplacementPhase::Commit)
        .unwrap();
    let status = fixture.status(operation.as_str(), "failed");
    assert_eq!(status["state"]["stage"], "checkpoint");
    let log = std::fs::read_to_string(fixture.root.path().join("fixture.log")).unwrap();
    assert!(
        log.contains("session checkpoint capacity refused: checkpoint bytes"),
        "wrong refusal: {log}"
    );
    let inventory = client.inventory().unwrap();
    assert_eq!(inventory.capacity.live_sessions, sessions.len());
    assert_eq!(
        inventory.capacity.resources.unwrap().checkpoint_byte_limit,
        1024
    );
    for (index, original) in sessions.iter().enumerate() {
        let retained = inventory
            .sessions
            .iter()
            .find(|session| session.pty == original.pty)
            .unwrap();
        assert_eq!(retained.pid, original.pid);
        client
            .write(
                &format!("dense-after-{index}"),
                &original.pty,
                2,
                format!("AFTER-DENSE-{index}\n").as_bytes(),
            )
            .unwrap();
        wait_text(&client, &original.pty, &format!("AFTER-DENSE-{index}"));
    }
}

#[test]
fn checkpoint_timeout_reopens_busy_readers_without_losing_input() {
    let (mut fixture, client) = Fixture::with_checkpoint_deadline_ms(1);
    client.enable_operation_retirement().unwrap();
    let mut sessions = Vec::new();
    for index in 0..33 {
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "timeout".into(),
                index: Some(index),
            },
            command: PreparedCommand {
                program: "/bin/cat".into(),
                args: vec![],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client.spawn_ordered(&command).unwrap();
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
        client
            .write_ordered(&session.pty, 1, format!("BEFORE-{index}\n").as_bytes())
            .unwrap();
        sessions.push(session);
    }
    client.flush_operation_receipts().unwrap();
    let operation = OperationId::parse("timeout-checkpoint").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: PathBuf::from(env!(
                    "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                )),
            },
        )
        .unwrap();
    fixture.status(operation.as_str(), "prepared");
    for (index, session) in sessions.iter().enumerate() {
        client
            .write_ordered(&session.pty, 2, format!("INFLIGHT-{index}\n").as_bytes())
            .unwrap();
    }
    client
        .replacement_phase(operation.clone(), ReplacementPhase::Commit)
        .unwrap();
    let status = fixture.status(operation.as_str(), "failed");
    assert_eq!(status["state"]["stage"], "checkpoint");
    let log = std::fs::read_to_string(fixture.root.path().join("fixture.log")).unwrap();
    assert!(
        log.contains("session checkpoint capacity refused: checkpoint time"),
        "wrong refusal: {log}"
    );
    let inventory = client.inventory().unwrap();
    assert_eq!(inventory.capacity.live_sessions, sessions.len());
    for (index, original) in sessions.iter().enumerate() {
        assert_eq!(
            inventory
                .sessions
                .iter()
                .find(|session| session.pty == original.pty)
                .unwrap()
                .pid,
            original.pid
        );
        wait_text(&client, &original.pty, &format!("INFLIGHT-{index}"));
    }
    for index in [0, 16, 32] {
        client
            .write_ordered(
                &sessions[index].pty,
                3,
                format!("SURVIVED-{index}\n").as_bytes(),
            )
            .unwrap();
        wait_text(&client, &sessions[index].pty, &format!("SURVIVED-{index}"));
    }
}

#[test]
fn settled_exits_keep_replacement_checkpoint_consistent() {
    let (fixture, client) = Fixture::new();
    client.enable_operation_retirement().unwrap();
    let mut cursor = client.inventory().unwrap().cursor;
    let mut oldest = None;
    let mut newest = None;
    for index in 0..129 {
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "turnover".into(),
                index: Some(index),
            },
            command: PreparedCommand {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), format!("printf 'DONE-{index}\\n'; exit 0")],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client.spawn_ordered(&command).unwrap();
        if oldest.is_none() {
            oldest = Some(session.pty.clone());
        }
        newest = Some(session.pty.clone());
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let events = client.events(cursor).unwrap();
            if events
                .events
                .iter()
                .any(|event| event.is_exit(&session.pty))
            {
                cursor = events.cursor;
                break;
            }
            assert!(Instant::now() < deadline, "exit {index} never settled");
            std::thread::sleep(Duration::from_millis(20));
        }
        client.flush_operation_receipts().unwrap();
    }
    let operation = OperationId::parse("replace-after-turnover").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare {
                executable: PathBuf::from(env!(
                    "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                )),
            },
        )
        .unwrap();
    fixture.status(operation.as_str(), "prepared");
    let commit = client.replacement_phase(operation.clone(), ReplacementPhase::Commit);
    assert!(commit.is_ok() || matches!(&commit, Err(Error::Transport(_) | Error::OutcomeUnknown)));
    fixture.status(operation.as_str(), "activated");
    let reconnected = Client::connect(fixture.root.path()).unwrap();
    assert!(reconnected.recover(&oldest.unwrap()).is_err());
    assert!(reconnected.recover(&newest.unwrap()).is_ok());
    assert!(reconnected.inventory().unwrap().sessions.len() <= 128);
}

#[test]
fn many_live_sessions_survive_image_replacement() {
    for count in [33, 256] {
        let (mut fixture, client) = Fixture::new();
        client.enable_operation_retirement().unwrap();
        let mut sessions = Vec::with_capacity(count);
        for index in 0..count {
            let command = ShellCommand {
                owner: if index % 2 == 0 {
                    TerminalOwner::Shell {
                        task_id: format!("scale-{index}"),
                        index: Some(0),
                    }
                } else {
                    TerminalOwner::Agent {
                        task_id: format!("scale-{index}"),
                    }
                },
                command: PreparedCommand {
                    program: "/bin/cat".into(),
                    args: vec![],
                    cwd: fixture.root.path().into(),
                    env: BTreeMap::new(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            };
            let session = client
                .spawn_ordered(&command)
                .unwrap_or_else(|error| panic!("spawn {index} of {count} failed: {error}"));
            fixture
                .tracked
                .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
            sessions.push(session);
        }
        // Leave output in flight on many readers when the image handoff begins.
        for (index, session) in sessions.iter().enumerate() {
            client
                .write_ordered(&session.pty, 1, format!("BEFORE-{index}\n").as_bytes())
                .unwrap();
        }
        for index in [0, count / 2, count - 1] {
            wait_text(&client, &sessions[index].pty, &format!("BEFORE-{index}"));
        }
        client.flush_operation_receipts().unwrap();
        let usage = client.inventory().unwrap().capacity.resources.unwrap();
        eprintln!(
            "{count} PTYs: descriptors={}/{}, processes={}/{}, reclaimable_memory={} bytes, spawn_reserve={} bytes, checkpoint_limit={} bytes",
            usage.open_descriptors,
            usage.descriptor_limit,
            usage.occupied_processes,
            usage.process_limit,
            usage.available_memory_bytes,
            usage.spawn_memory_reserve_bytes,
            usage.checkpoint_byte_limit
        );
        let operation = OperationId::parse(format!("replace-{count}")).unwrap();
        client
            .replacement_phase(
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: PathBuf::from(env!(
                        "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                    )),
                },
            )
            .unwrap();
        fixture.status(operation.as_str(), "prepared");
        let started = Instant::now();
        let commit = client.replacement_phase(operation.clone(), ReplacementPhase::Commit);
        assert!(
            commit.is_ok() || matches!(&commit, Err(Error::Transport(_) | Error::OutcomeUnknown)),
            "unexpected replacement refusal: {commit:?}"
        );
        fixture.status(operation.as_str(), "activated");
        let log = std::fs::read_to_string(fixture.root.path().join("fixture.log")).unwrap();
        let metrics = log
            .lines()
            .rev()
            .find_map(|line| line.strip_prefix("session handoff metrics: "))
            .expect("bounded checkpoint and pause metrics");
        let numbers: Vec<usize> = metrics
            .split(',')
            .map(|value| value.parse().unwrap())
            .collect();
        assert_eq!(numbers.len(), 3);
        assert!(numbers[0] > count, "checkpoint body omitted live state");
        assert_eq!(numbers[1], count + 4, "unexpected inherited FD inventory");
        assert!(numbers[2] < 10_000, "handoff pause exceeded ten seconds");
        eprintln!(
            "{count} PTYs: checkpoint={} bytes, inherited={} FDs, pause={}ms",
            numbers[0], numbers[1], numbers[2]
        );
        eprintln!("replacement of {count} PTYs took {:?}", started.elapsed());
        let next = Client::connect(fixture.root.path()).unwrap();
        next.enable_operation_retirement().unwrap();
        let inventory = next.inventory().unwrap();
        assert_eq!(inventory.capacity.live_sessions, count);
        for (index, original) in sessions.iter().enumerate() {
            let restored = inventory
                .sessions
                .iter()
                .find(|session| session.pty == original.pty)
                .unwrap();
            assert_eq!(restored.pid, original.pid, "process {index} restarted");
            assert_eq!(restored.owner, original.owner);
        }
        for (index, original) in sessions.iter().enumerate() {
            wait_text(&next, &original.pty, &format!("BEFORE-{index}"));
        }
        for index in [0, count / 2, count - 1] {
            let pty = &sessions[index].pty;
            next.resize_ordered(pty, 2, 90, 30).unwrap();
            next.write_ordered(pty, 3, format!("AFTER-{index}\n").as_bytes())
                .unwrap();
            wait_text(&next, pty, &format!("AFTER-{index}"));
        }
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
            "expected PTY output {expected} did not arrive"
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
