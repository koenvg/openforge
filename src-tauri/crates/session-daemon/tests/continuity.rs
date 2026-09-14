use openforge_session_client::Client;
use openforge_session_protocol::{Error, ShellCommand};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

struct Fixture {
    root: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        Self {
            root: tempfile::Builder::new()
                .prefix("of-pty-")
                .tempdir_in("/tmp")
                .unwrap(),
        }
    }
    fn connect(&self) -> Client {
        Client::launch(
            std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            self.root.path(),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!(
                "daemon log: {}",
                std::fs::read_to_string(self.root.path().join("session-v1/daemon.log"))
                    .unwrap_or_default()
            );
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
    }
}

#[test]
fn indexed_shell_keeps_pid_state_and_ordered_io_after_controller_loss() {
    let fixture = Fixture::new();
    let first = fixture.connect();
    let command = ShellCommand {
        owner: openforge_session_host::TerminalOwner::Shell {
            task_id: "fixture".into(),
            index: Some(3),
        },
        command: openforge_session_host::PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![],
            cwd: fixture.root.path().into(),
            env: BTreeMap::from([("PRESERVED_VALUE".into(), "environment-kept".into())]),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let spawned = first.spawn("spawn-1", &command).unwrap();
    first
        .write(
            "input-1",
            &spawned.pty,
            1,
            b"local_value=kept; printf 'BEFORE:%s:%s:%s\\n' \"$$\" \"$PWD\" \"$PRESERVED_VALUE\"\n",
        )
        .unwrap();
    wait_for_text(&first, &spawned.pty, "environment-kept");
    let second = fixture.connect();
    assert!(matches!(
        first.write("stale", &spawned.pty, 2, b"exit\n"),
        Err(Error::StaleController)
    ));
    let retried = second.spawn("spawn-1", &command).unwrap();
    assert_eq!(retried.pty, spawned.pty);
    assert_eq!(retried.pid, spawned.pid);
    assert_eq!(second.inventory().unwrap().sessions.len(), 1);
    second.resize("resize-1", &spawned.pty, 2, 101, 37).unwrap();
    second
        .write(
            "input-2",
            &spawned.pty,
            3,
            b"printf 'AFTER:%s:%s:' \"$$\" \"$local_value\"; stty size\n",
        )
        .unwrap();
    let text = wait_for_text(
        &second,
        &spawned.pty,
        &format!("AFTER:{}:kept:37 101", spawned.pid),
    );
    assert!(text.contains("BEFORE:"));
    assert!(text.contains(fixture.root.path().to_str().unwrap()));
    let cursor = second.inventory().unwrap().cursor;
    second.write("exit", &spawned.pty, 4, b"exit 17\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let inventory = second.inventory().unwrap();
        let events = second.events(cursor).unwrap();
        if inventory.sessions[0].exit_code == Some(17)
            && events
                .events
                .iter()
                .any(|event| event.is_exit(&spawned.pty))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "exit state or event was lost during reconciliation"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(second.spawn("spawn-1", &command).unwrap().pty, spawned.pty);
}
#[test]
fn shell_exit_is_retained() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let shell = client
        .spawn(
            "early-exit",
            &ShellCommand {
                owner: openforge_session_host::TerminalOwner::Shell {
                    task_id: "exit".into(),
                    index: Some(0),
                },
                command: openforge_session_host::PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec!["-c".into(), "trap '' HUP; sleep 30 & exit 7".into()],
                    cwd: fixture.root.path().into(),
                    env: BTreeMap::new(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let session = client
            .inventory()
            .unwrap()
            .sessions
            .into_iter()
            .find(|s| s.pty == shell.pty)
            .unwrap();
        if session.exit_code == Some(7) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "root exit was hidden behind a descendant's PTY descriptor"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn lost_spawn_reply_is_reconciled_without_creating_another_shell() {
    use openforge_session_client::runtime::RuntimeDirectory;
    use openforge_session_protocol::{write_frame, Command, Envelope, Request, VERSION};
    let fixture = Fixture::new();
    let first = fixture.connect();
    let command = ShellCommand {
        owner: openforge_session_host::TerminalOwner::Shell {
            task_id: "lost".into(),
            index: Some(0),
        },
        command: openforge_session_host::PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![],
            cwd: fixture.root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let runtime = RuntimeDirectory::open(fixture.root.path()).unwrap();
    let mut stream = std::os::unix::net::UnixStream::connect(runtime.socket_path()).unwrap();
    write_frame(
        &mut stream,
        &Envelope {
            version: VERSION,
            body: Request {
                token: runtime.credentials().token.clone(),
                command: Command::Spawn {
                    controller: first.controller().clone(),
                    operation: openforge_session_host::OperationId::parse("lost-spawn").unwrap(),
                    command: command.clone(),
                },
            },
        },
    )
    .unwrap();
    drop(stream);
    let second = fixture.connect();
    let retry = second.spawn("lost-spawn", &command).unwrap();
    assert_eq!(second.inventory().unwrap().sessions.len(), 1);
    assert_eq!(second.inventory().unwrap().sessions[0].pty, retry.pty);
    assert!(matches!(
        first.terminate("stale-stop", &retry.pty),
        Err(Error::StaleController)
    ));
    let mut foreign = retry.pty.clone();
    foreign.installation =
        openforge_session_host::InstallationId::parse("other-installation").unwrap();
    assert!(matches!(
        second.terminate("foreign-stop", &foreign),
        Err(Error::StalePty)
    ));
    assert_eq!(second.inventory().unwrap().sessions[0].exit_code, None);
}

#[test]
fn output_overflow_reports_a_gap_and_keeps_authority_recovery_available() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let cursor = client.inventory().unwrap().cursor;
    let shell = client
        .spawn(
            "burst",
            &ShellCommand {
                owner: openforge_session_host::TerminalOwner::Shell {
                    task_id: "burst".into(),
                    index: Some(0),
                },
                command: openforge_session_host::PreparedCommand {
                    program: "/bin/sh".into(),
                    args: vec![
                        "-c".into(),
                        "head -c 700000 /dev/zero; printf GAPDONE; sleep 30".into(),
                    ],
                    cwd: fixture.root.path().into(),
                    env: BTreeMap::new(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
        )
        .unwrap();
    wait_for_text(&client, &shell.pty, "GAPDONE");
    let events = client.events(cursor).unwrap();
    assert!(events.gap);
    assert!(events.retained_bytes <= 512 * 1024);
    let recovery = client.recover(&shell.pty).unwrap();
    assert!(recovery.portable_vt.windows(7).any(|s| s == b"GAPDONE"));
}

#[test]
fn exhausted_receipts_remain_retryable_and_reserve_capacity_for_scoped_stop() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let command = ShellCommand {
        owner: openforge_session_host::TerminalOwner::Shell {
            task_id: "capacity".into(),
            index: Some(0),
        },
        command: openforge_session_host::PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![],
            cwd: fixture.root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let shell = client.spawn("capacity-spawn", &command).unwrap();
    for sequence in 1..1024 {
        client
            .write(&format!("write-{sequence}"), &shell.pty, sequence, b"")
            .unwrap();
    }
    assert!(matches!(
        client.write("overflow", &shell.pty, 1024, b"not-written"),
        Err(Error::Capacity)
    ));
    let replacement = fixture.connect();
    let inventory = replacement.inventory().unwrap();
    assert_eq!(inventory.capacity.operation_receipts, 1024);
    assert_eq!(inventory.capacity.operation_limit, 1024);
    assert_eq!(inventory.capacity.live_limit, 32);
    assert_eq!(
        replacement.spawn("capacity-spawn", &command).unwrap().pty,
        shell.pty
    );
    replacement.terminate("reserved-stop", &shell.pty).unwrap();
}

#[test]
fn scoped_stop_cleans_a_descendant_that_detached_into_another_session() {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let script = "import os,time\npid=os.fork()\nif pid == 0:\n os.setsid()\n print('DETACHED='+str(os.getpid()), flush=True)\n time.sleep(60)\nelse:\n time.sleep(60)\n";
    let shell = client
        .spawn(
            "detached",
            &ShellCommand {
                owner: openforge_session_host::TerminalOwner::Shell {
                    task_id: "detached".into(),
                    index: Some(0),
                },
                command: openforge_session_host::PreparedCommand {
                    program: "/usr/bin/python3".into(),
                    args: vec!["-c".into(), script.into()],
                    cwd: fixture.root.path().into(),
                    env: BTreeMap::new(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            },
        )
        .unwrap();
    let text = wait_for_text(&client, &shell.pty, "DETACHED=");
    let pid: usize = text
        .split("DETACHED=")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .parse()
        .unwrap();
    client.terminate("detached-stop", &shell.pty).unwrap();
    let processes = sysinfo::System::new_all();
    assert!(
        !processes
            .process(sysinfo::Pid::from(pid))
            .is_some_and(|process| process.status() != sysinfo::ProcessStatus::Zombie),
        "detached fixture descendant survived scoped stop"
    );
}

fn wait_for_text(
    client: &Client,
    pty: &openforge_session_protocol::PtyIdentity,
    expected: &str,
) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = client.recover(pty).unwrap();
        let text = String::from_utf8_lossy(&snapshot.compatibility_replay).into_owned();
        if text.contains(expected) {
            return text;
        }
        assert!(
            Instant::now() < deadline,
            "missing {expected:?} in {text:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
