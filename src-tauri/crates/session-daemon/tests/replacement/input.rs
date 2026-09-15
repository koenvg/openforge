use super::*;

#[test]
fn accepted_backpressured_input_keeps_exact_suffix_and_original_unknown_receipt() {
    let (mut fixture, client) = Fixture::new();
    let root = fixture.root.path();
    let ready = root.join("reader-ready");
    let release = root.join("reader-release");
    let received = root.join("received.bin");
    let mut random = 0x1234_5678u32;
    let input: Vec<u8> = (0..64 * 1024).map(|_| { random ^= random << 13; random ^= random >> 17; random ^= random << 5; random as u8 }).collect();
    let sentinel = b"next-sequence-after-retained-input";
    let script = format!("stty raw -echo; printf ready > '{}'; while [ ! -f '{}' ]; do sleep 0.02; done; dd bs=1 count={} of='{}' 2>/dev/null; printf INPUT_DONE; sleep 120", ready.display(), release.display(), input.len() + sentinel.len(), received.display());
    let command = ShellCommand {
        owner: TerminalOwner::Shell { task_id: "backpressure".into(), index: None },
        command: PreparedCommand { program: "/bin/sh".into(), args: vec!["-c".into(), script], cwd: root.into(), env: BTreeMap::new() },
        columns: 80, rows: 24, image_protocol: None,
    };
    let session = client.spawn("reader", &command).unwrap();
    fixture.tracked.push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.is_file() { assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(10)); }
    assert_eq!(client.write("accepted", &session.pty, 1, &input), Err(Error::OutcomeUnknown), "fixture must actually backpressure the accepted write");
    let executor = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
    let operation = OperationId::parse("replace-input").unwrap();
    executor.block_on(openforge_session_host::PtyHost::replacement(&client, client.controller(), operation.clone(), ReplacementPhase::Prepare { executable: env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2").into() })).unwrap();
    executor.block_on(openforge_session_host::PtyHost::replacement(&client, client.controller(), operation, ReplacementPhase::Commit)).unwrap();
    let fresh = Client::connect(root).unwrap();
    assert_eq!(fresh.spawn("reader", &command).unwrap().pid, session.pid);
    assert_eq!(fresh.write("accepted", &session.pty, 1, &input), Err(Error::OutcomeUnknown));
    std::fs::write(release, b"go").unwrap();
    assert_eq!(fresh.write("accepted", &session.pty, 1, &input), Err(Error::OutcomeUnknown));
    assert!(matches!(fresh.write("sentinel", &session.pty, 2, sentinel), Ok(()) | Err(Error::OutcomeUnknown)));
    wait_text(&fresh, &session.pty, "INPUT_DONE");
    let expected = [input.as_slice(), sentinel].concat();
    assert!(std::fs::read(received).unwrap() == expected, "accepted input was lost, reordered or duplicated");
    assert_eq!(fresh.write("accepted", &session.pty, 1, &input), Err(Error::OutcomeUnknown));
}
