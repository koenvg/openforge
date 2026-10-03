use super::support::{executable, wait_text, Fixture};
use openforge_session_client::Client;
use openforge_session_protocol::*;
use std::collections::BTreeMap;
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
            command: PreparedCommand { program: "/bin/sh".into(), args: vec!["-c".into(), "value=kept; while IFS= read -r line; do printf 'STATE:%s:%s:%s\\n' \"$$\" \"$value\" \"$line\"; done".into()], cwd: fixture.root().into(), env: BTreeMap::new() },
            columns: 80, rows: 24, image_protocol: None,
        };
        let session = client.spawn("spawn", &command).unwrap();
        fixture.track_process(session.pid);
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
        let fresh = Client::connect(fixture.root()).unwrap();
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
