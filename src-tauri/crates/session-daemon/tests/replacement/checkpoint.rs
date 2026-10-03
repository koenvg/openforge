use super::support::{wait_text, Fixture, FixtureOptions};
use openforge_session_protocol::*;
use std::{collections::BTreeMap, path::PathBuf};
#[test]
fn checkpoint_descriptor_pressure_preserves_running_terminal() {
    let (mut fixture, client) = Fixture::with_options(FixtureOptions {
        fd_limit: Some(85),
        ..Default::default()
    });
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "descriptor-pressure".into(),
            index: None,
        },
        command: PreparedCommand {
            program: "/bin/cat".into(),
            args: vec![],
            cwd: fixture.root().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let session = client.spawn("spawn-pressure", &command).unwrap();
    fixture.track_process(session.pid);
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
    let (mut fixture, client) = Fixture::with_options(FixtureOptions {
        checkpoint_byte_limit: Some(1024),
        ..Default::default()
    });
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
                cwd: fixture.root().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client
            .spawn(&format!("dense-spawn-{index}"), &command)
            .unwrap();
        fixture.track_process(session.pid);
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
    let log = std::fs::read_to_string(fixture.root().join("fixture.log")).unwrap();
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
    let (mut fixture, client) = Fixture::with_options(FixtureOptions {
        checkpoint_deadline_ms: Some(1),
        ..Default::default()
    });
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
                cwd: fixture.root().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client.spawn_ordered(&command).unwrap();
        fixture.track_process(session.pid);
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
    let log = std::fs::read_to_string(fixture.root().join("fixture.log")).unwrap();
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
