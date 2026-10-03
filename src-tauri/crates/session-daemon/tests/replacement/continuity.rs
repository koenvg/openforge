use super::support::{executable, wait_text, Fixture};
use openforge_session_client::Client;
use openforge_session_protocol::*;
use serde_json::json;
use std::collections::BTreeMap;
#[test]
fn repeated_real_images_keep_daemon_and_shell_pids_pty_identity_state_and_retry_receipts() {
    let (mut fixture, mut client) = Fixture::new();
    eprintln!(
        "fixture progress: daemon {} connected",
        fixture.daemon_pid()
    );
    let caps = fixture
        .rpc(json!({"kind":"capabilities"}))
        .expect("daemon must expose replacement capability");
    assert_eq!(caps["value"]["supportsReplacement"], true);
    assert_eq!(caps["value"]["pid"], fixture.daemon_pid());
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
        command: PreparedCommand { program: "/bin/sh".into(), args: vec!["-c".into(), "value=kept; while IFS= read -r line; do printf 'STATE:%s:%s:%s:' \"$$\" \"$value\" \"$line\"; tty; printf 'TTY-END:%s\\n' \"$line\"; done".into()], cwd: fixture.root().into(), env: BTreeMap::new() },
        columns: 80, rows: 24, image_protocol: None,
    };
    let session = client.spawn("spawn", &command).unwrap();
    fixture.track_process(session.pid);
    client.write("first", &session.pty, 1, b"before\n").unwrap();
    wait_text(
        &client,
        &session.pty,
        &format!("STATE:{}:kept:before:", session.pid),
    );
    // The prefix and tty result are separate writes; wait for the complete response.
    wait_text(&client, &session.pty, "TTY-END:before");
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
        let actual = executable(fixture.daemon_pid());
        assert!(
            std::fs::read(actual).unwrap() == std::fs::read(image).unwrap(),
            "kernel still runs a different image"
        );
        assert!(matches!(client.inventory(), Err(Error::StaleController)));
        client = Client::connect(fixture.root()).unwrap();
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
            fixture.daemon_pid()
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
