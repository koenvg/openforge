use super::support::Fixture;
use openforge_session_client::Client;
use openforge_session_protocol::*;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::{Duration, Instant},
};
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
                cwd: fixture.root().into(),
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
    let reconnected = Client::connect(fixture.root()).unwrap();
    assert!(reconnected.recover(&oldest.unwrap()).is_err());
    assert!(reconnected.recover(&newest.unwrap()).is_ok());
    assert!(reconnected.inventory().unwrap().sessions.len() <= 128);
}
