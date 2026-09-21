use super::*;

fn shell(root: &Path, index: u32) -> ShellCommand {
    ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "retirement-upgrade".into(),
            index: Some(index),
        },
        command: PreparedCommand {
            program: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                "while IFS= read -r line; do printf 'received:%s\\n' \"$line\"; done".into(),
            ],
            env: BTreeMap::new(),
            cwd: root.into(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    }
}

#[test]
fn current_daemon_attachment_needs_no_replacement_image() {
    let (fixture, client) = Fixture::new();
    let pid = client.capabilities().unwrap().pid;
    let attached = client
        .with_operation_retirement(Path::new("/nonexistent/not-needed"))
        .unwrap();
    assert_eq!(attached.capabilities().unwrap().pid, pid);
    attached
        .set_terminal_color_profile_ordered(TerminalColorProfile::default())
        .unwrap();
    attached.flush_operation_receipts().unwrap();
    assert_eq!(
        attached
            .inventory()
            .unwrap()
            .capacity
            .retained_request_bytes,
        0
    );
    let session = attached
        .spawn_ordered(&shell(fixture.root.path(), 0))
        .unwrap();
    attached.terminate_ordered(&session.pty).unwrap();
}

#[test]
fn replacement_preserves_retired_and_unacknowledged_operation_results() {
    let (mut fixture, client) = Fixture::new();
    client.enable_operation_retirement().unwrap();
    let session = client
        .spawn_ordered(&shell(fixture.root.path(), 0))
        .unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    client.flush_operation_receipts().unwrap();
    let stream = client
        .inventory()
        .unwrap()
        .capacity
        .operation_window
        .unwrap()
        .stream;
    let retired = OperationId::ordered(stream, 1).unwrap();
    let pending = OperationId::ordered(stream, 2).unwrap();
    client
        .write(pending.as_str(), &session.pty, 1, b"once\n")
        .unwrap();
    let maintenance = OperationId::parse("retirement-compatible-replacement").unwrap();
    client
        .replacement_phase(
            maintenance.clone(),
            ReplacementPhase::Prepare {
                executable: PathBuf::from(env!(
                    "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                )),
            },
        )
        .unwrap();
    fixture.status(maintenance.as_str(), "prepared");
    let _ = client.replacement_phase(maintenance.clone(), ReplacementPhase::Commit);
    fixture.status(maintenance.as_str(), "activated");
    let next = Client::connect(fixture.root.path()).unwrap();
    let inventory = next.inventory().unwrap();
    assert_eq!(inventory.sessions[0].pty, session.pty);
    assert_eq!(
        inventory.capacity.operation_window.unwrap().retired_through,
        1
    );
    assert!(matches!(
        next.spawn(retired.as_str(), &shell(fixture.root.path(), 0)),
        Err(Error::OperationExpired)
    ));
    next.write(pending.as_str(), &session.pty, 1, b"once\n")
        .unwrap();
    next.write(
        OperationId::ordered(stream, 3).unwrap().as_str(),
        &session.pty,
        2,
        b"next\n",
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let replay = next.recover(&session.pty).unwrap();
        let text = String::from_utf8_lossy(&replay.compatibility_replay);
        if text.contains("received:next") {
            assert_eq!(text.matches("received:once").count(), 1);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "replacement did not resume terminal output"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    next.terminate(
        OperationId::ordered(stream, 4).unwrap().as_str(),
        &session.pty,
    )
    .unwrap();
}

#[test]
#[ignore = "requires OPENFORGE_LEGACY_DAEMON pointing to a pre-retirement build"]
fn exhausted_legacy_daemon_upgrades_on_attachment_without_restarting_ptys() {
    let legacy = PathBuf::from(
        std::env::var_os("OPENFORGE_LEGACY_DAEMON").expect("build the baseline daemon first"),
    );
    let (mut fixture, client) = Fixture::with_executable(&legacy);
    let session = client
        .spawn("legacy-spawn", &shell(fixture.root.path(), 0))
        .unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    for sequence in 1..=1023 {
        client
            .resize(
                &format!("legacy-{sequence}"),
                &session.pty,
                sequence,
                80,
                24,
            )
            .unwrap();
    }
    assert!(matches!(
        client.write("exhausted", &session.pty, 1024, b"blocked\n"),
        Err(Error::Capacity)
    ));
    let controller = client.controller().clone();
    let pid = client.capabilities().unwrap().pid;
    let attached = client
        .with_operation_retirement(Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")))
        .unwrap();
    assert_eq!(attached.capabilities().unwrap().pid, pid);
    let inventory = attached.inventory().unwrap();
    assert_eq!(inventory.controller.lifetime, controller.lifetime);
    assert_eq!(inventory.sessions[0].pty, session.pty);
    assert_eq!(inventory.sessions[0].pid, session.pid);
    assert_eq!(inventory.capacity.operation_receipts, 0);
    attached
        .write_ordered(&session.pty, 1024, b"after-upgrade\n")
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let replay = attached.recover(&session.pty).unwrap();
        if String::from_utf8_lossy(&replay.compatibility_replay).contains("received:after-upgrade")
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "preserved terminal stopped producing output"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(
        attached.spawn("legacy-spawn", &shell(fixture.root.path(), 0)),
        Err(Error::OperationExpired)
    ));
    let next = attached
        .spawn_ordered(&shell(fixture.root.path(), 1))
        .unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(next.pid).unwrap());
    let rollback = OperationId::parse("refuse-legacy-rollback").unwrap();
    attached
        .replacement_phase(
            rollback.clone(),
            ReplacementPhase::Prepare { executable: legacy },
        )
        .unwrap();
    fixture.status(rollback.as_str(), "prepared");
    attached
        .replacement_phase(rollback.clone(), ReplacementPhase::Commit)
        .unwrap();
    fixture.status(rollback.as_str(), "failed");
    assert_eq!(attached.capabilities().unwrap().pid, pid);
    attached
        .write_ordered(&session.pty, 1025, b"after-refused-rollback\n")
        .unwrap();
    attached.terminate_ordered(&next.pty).unwrap();
    attached.terminate_ordered(&session.pty).unwrap();
}

#[test]
#[ignore = "requires OPENFORGE_LEGACY_DAEMON pointing to a pre-retirement build"]
fn incompatible_attachment_upgrade_keeps_legacy_sessions_running() {
    let legacy = PathBuf::from(
        std::env::var_os("OPENFORGE_LEGACY_DAEMON").expect("build the baseline daemon first"),
    );
    let (mut fixture, client) = Fixture::with_executable(&legacy);
    let session = client
        .spawn("legacy-spawn", &shell(fixture.root.path(), 0))
        .unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let observer = client.clone();
    assert!(client
        .with_operation_retirement(Path::new("/bin/echo"))
        .is_err());
    let inventory = observer.inventory().unwrap();
    assert_eq!(inventory.sessions[0].pty, session.pty);
    assert_eq!(inventory.sessions[0].pid, session.pid);
    assert!(inventory.sessions[0].exit_code.is_none());
    observer
        .write("still-serving", &session.pty, 1, b"still-serving\n")
        .unwrap();
}
