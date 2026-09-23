use openforge_session_client::Client;
use openforge_session_protocol::{PreparedCommand, ShellCommand, TerminalOwner};
use std::{
    path::Path,
    time::{Duration, Instant},
};

struct Fixture {
    root: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            root: tempfile::Builder::new()
                .prefix("of-capacity-scaling-")
                .tempdir_in("/tmp")
                .unwrap(),
        }
    }

    fn connect(&self) -> Client {
        let client = Client::launch(
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            self.root.path(),
        )
        .unwrap();
        client.enable_operation_retirement().unwrap();
        client
    }

    fn command(&self, index: usize) -> ShellCommand {
        ShellCommand {
            owner: if index.is_multiple_of(2) {
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
                cwd: self.root.path().into(),
                env: Default::default(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let result = (|| {
            let client = Client::connect(self.root.path())?;
            client.enable_operation_retirement()?;
            for session in client.inventory()?.sessions {
                if session.exit_code.is_none() {
                    client.terminate_ordered(&session.pty)?;
                }
            }
            client.flush_operation_receipts()?;
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                match client.shutdown_empty() {
                    Ok(()) => return Ok(()),
                    Err(openforge_session_protocol::Error::InvalidRequest)
                        if Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => return Err(error),
                }
            }
        })();
        if let Err(error) = result {
            self.root.disable_cleanup(true);
            eprintln!(
                "fixture cleanup failed at {}: {error}",
                self.root.path().display()
            );
            if !std::thread::panicking() {
                panic!("fixture-owned PTYs were not cleaned up");
            }
        }
    }
}

fn assert_concurrent_terminals(count: usize) {
    let fixture = Fixture::new();
    let client = fixture.connect();
    let mut sessions = Vec::with_capacity(count);
    for index in 0..count {
        let session = client
            .spawn_ordered(&fixture.command(index))
            .unwrap_or_else(|error| panic!("terminal {index} of {count} was refused: {error}"));
        sessions.push(session);
    }
    client.flush_operation_receipts().unwrap();
    let inventory = client.inventory().unwrap();
    assert_eq!(inventory.capacity.live_sessions, count);
    assert_eq!(inventory.sessions.len(), count);
    let resources = inventory
        .capacity
        .resources
        .as_ref()
        .expect("resource diagnostics");
    assert!(resources.open_descriptors < resources.descriptor_limit);
    assert!(resources.occupied_processes < resources.process_limit);
    assert!(resources.available_memory_bytes > resources.spawn_memory_reserve_bytes);

    for (index, session) in sessions.iter().enumerate() {
        let marker = format!("SCALE-MARKER-{index}");
        client.resize_ordered(&session.pty, 1, 90, 30).unwrap();
        client
            .write_ordered(&session.pty, 2, format!("{marker}\n").as_bytes())
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let recovery = client.recover(&session.pty).unwrap();
            if recovery
                .portable_vt
                .windows(marker.len())
                .any(|window| window == marker.as_bytes())
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "no recovery for terminal {index}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

#[test]
fn the_thirty_third_terminal_is_independently_usable() {
    assert_concurrent_terminals(33);
}

#[test]
fn a_provisioned_daemon_keeps_256_mixed_terminals_usable() {
    assert_concurrent_terminals(256);
}

#[test]
fn settled_exits_do_not_exhaust_the_daemon_lifetime() {
    use openforge_session_protocol::{Event, OperationId};
    let fixture = Fixture::new();
    let client = fixture.connect();
    let first_window = client
        .inventory()
        .unwrap()
        .capacity
        .operation_window
        .unwrap();
    let mut first = None;
    let mut cursor = client.inventory().unwrap().cursor;
    for index in 0..129 {
        let mut command = fixture.command(index);
        command.command.program = "/bin/sh".into();
        command.command.args = vec![
            "-c".into(),
            format!("printf 'EXIT-MARKER-{index}\\n'; exit 0"),
        ];
        let session = client
            .spawn_ordered(&command)
            .unwrap_or_else(|error| panic!("spawn after {index} settled exits failed: {error}"));
        if first.is_none() {
            first = Some(session.pty.clone());
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let events = client.events(cursor).unwrap();
            if events
                .events
                .iter()
                .any(|event| matches!(event, Event::Exited { pty, .. } if *pty == session.pty))
            {
                cursor = events.cursor;
                break;
            }
            assert!(Instant::now() < deadline, "exit {index} did not settle");
            std::thread::sleep(Duration::from_millis(20));
        }
        client.flush_operation_receipts().unwrap();
    }
    let reconnected = Client::connect(fixture.root.path()).unwrap();
    reconnected.enable_operation_retirement().unwrap();
    let first = first.unwrap();
    assert!(
        reconnected.recover(&first).is_err(),
        "old exited recovery should expire once history is full"
    );
    let last = reconnected
        .inventory()
        .unwrap()
        .sessions
        .last()
        .cloned()
        .unwrap();
    assert_eq!(last.exit_code, Some(0));
    assert!(matches!(
        reconnected.spawn(
            OperationId::ordered(first_window.stream, 1)
                .unwrap()
                .as_str(),
            &fixture.command(0),
        ),
        Err(openforge_session_protocol::Error::OperationExpired)
    ));
}
