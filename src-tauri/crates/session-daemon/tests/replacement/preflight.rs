use super::*;

#[test]
fn updater_preflight_borrows_controller_without_fencing_the_live_sidecar() {
    let (fixture, sidecar) = Fixture::new();
    let original = sidecar.controller().clone();
    let maintenance =
        openforge_session_client::MaintenanceClient::attach(fixture.root.path(), original.clone())
            .unwrap();
    assert_eq!(maintenance.inventory().unwrap().controller, original);
    assert_eq!(sidecar.inventory().unwrap().controller, original);
    assert_eq!(
        maintenance.capabilities().unwrap().pid,
        sidecar.capabilities().unwrap().pid
    );

    let mut foreign = original.clone();
    foreign.installation = InstallationId::parse("foreign-installation").unwrap();
    assert!(matches!(
        openforge_session_client::MaintenanceClient::attach(fixture.root.path(), foreign),
        Err(Error::ForeignInstallation)
    ));
    assert_eq!(sidecar.inventory().unwrap().controller, original);

    let next = Client::connect(fixture.root.path()).unwrap();
    assert!(matches!(
        maintenance.inventory(),
        Err(Error::StaleController)
    ));
    assert!(matches!(
        openforge_session_client::MaintenanceClient::attach(fixture.root.path(), original),
        Err(Error::StaleController)
    ));
    assert!(next.inventory().is_ok());
}

#[test]
fn updater_maintenance_activates_a_distinct_image_without_replacing_the_pty_owner() {
    let (mut fixture, sidecar) = Fixture::new();
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "updater".into(),
            index: Some(0),
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
    let session = sidecar.spawn("updater-shell", &command).unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let maintenance = openforge_session_client::MaintenanceClient::attach(
        fixture.root.path(),
        sidecar.controller().clone(),
    )
    .unwrap();
    let before = maintenance.capabilities().unwrap();
    let operation = OperationId::parse("updater-activation").unwrap();
    let prepared = maintenance
        .prepare(
            operation.clone(),
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2")),
        )
        .unwrap();
    assert_eq!(prepared.state, ReplacementState::Prepared);
    assert_eq!(sidecar.inventory().unwrap().sessions[0].pid, session.pid);
    assert_ne!(
        prepared.target_version.as_ref().unwrap(),
        &before.image_version
    );
    let activated = maintenance.activate(operation.clone()).unwrap();
    assert_eq!(activated.state, ReplacementState::Activated);
    assert_eq!(
        Some(&activated.actual_version),
        prepared.target_version.as_ref()
    );
    let next = Client::connect(fixture.root.path()).unwrap();
    let observation = openforge_session_client::MaintenanceClient::observe_replacement(
        fixture.root.path(),
        &sidecar.controller().installation,
        &operation,
    )
    .unwrap();
    assert_eq!(observation.0.pid, before.pid);
    assert_eq!(observation.0.image_version, activated.actual_version);
    assert_eq!(observation.1.operation, operation);
    assert_eq!(observation.1.state, ReplacementState::Activated);
    assert_eq!(next.inventory().unwrap().controller, *next.controller());
    assert!(matches!(sidecar.inventory(), Err(Error::StaleController)));
    assert!(matches!(
        openforge_session_client::MaintenanceClient::observe_replacement(
            fixture.root.path(),
            &InstallationId::parse("foreign-installation").unwrap(),
            &operation,
        ),
        Err(Error::ForeignInstallation)
    ));
    assert_eq!(next.controller().lifetime, sidecar.controller().lifetime);
    assert_eq!(next.capabilities().unwrap().pid, before.pid);
    assert_eq!(next.inventory().unwrap().sessions[0].pty, session.pty);
    assert_eq!(next.inventory().unwrap().sessions[0].pid, session.pid);
    next.write("after-update", &session.pty, 1, b"updater-kept-pty\n")
        .unwrap();
    wait_text(&next, &session.pty, "updater-kept-pty");
}

#[test]
fn supported_large_image_keeps_replacement_available() {
    // The image contract accepts up to 128 MiB, including non-code file contents.
    // Trailing zeroes leave the signed Mach-O code identity unchanged.
    let source = tempfile::Builder::new()
        .prefix("of-large-image-")
        .tempdir_in("/tmp")
        .unwrap();
    let image = source.path().join("large-daemon");
    std::fs::copy(env!("CARGO_BIN_EXE_openforge-session-daemon"), &image).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&image)
        .unwrap()
        .set_len(120 * 1024 * 1024)
        .unwrap();
    let (_fixture, client) = Fixture::with_executable(&image);
    assert!(
        client.capabilities().unwrap().supports_replacement,
        "a supported image within the size limit must pass the bounded startup preflight"
    );
}

#[test]
fn markerless_compatible_image_reaches_prepared() {
    let (fixture, client) = Fixture::new();
    let image = fixture.root.path().join("markerless-image");
    assert!(std::process::Command::new("cc")
        .args(["-arch", "arm64", "-Wall", "-Wextra", "-Werror"])
        .arg(format!("-DPROTOCOL_VERSION={VERSION}"))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/replacement/markerless.c"))
        .arg("-o")
        .arg(&image)
        .status()
        .unwrap()
        .success());
    let operation = OperationId::parse("markerless-probe").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare { executable: image },
        )
        .unwrap();
    fixture.status(operation.as_str(), "prepared");
}

#[test]
fn incompatible_probe_lends_no_descriptors_or_environment_and_leaves_no_child() {
    let (mut fixture, client) = Fixture::new();
    let command = ShellCommand {
        owner: TerminalOwner::Shell {
            task_id: "probe".into(),
            index: None,
        },
        command: PreparedCommand {
            program: "/bin/sleep".into(),
            args: vec!["120".into()],
            cwd: fixture.root.path().into(),
            env: BTreeMap::new(),
        },
        columns: 80,
        rows: 24,
        image_protocol: None,
    };
    let session = client.spawn("live-shell", &command).unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let marker = fixture.root.path().join("probe-child");
    let image = fixture.root.path().join("incompatible-image");
    assert!(std::process::Command::new("cc")
        .args(["-arch", "arm64", "-Wall", "-Wextra", "-Werror"])
        .arg(format!("-DMARKER=\"{}\"", marker.display()))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/replacement/probe.c"))
        .arg("-o")
        .arg(&image)
        .status()
        .unwrap()
        .success());
    let operation = OperationId::parse("incompatible-probe").unwrap();
    client
        .replacement_phase(
            operation.clone(),
            ReplacementPhase::Prepare { executable: image },
        )
        .unwrap();
    fixture.status(operation.as_str(), "failed");
    let fields: Vec<i32> = std::fs::read_to_string(marker)
        .unwrap()
        .split_whitespace()
        .map(|value| value.parse().unwrap())
        .collect();
    assert_eq!(fields.len(), 3);
    let child = fields[0];
    // Track the deliberately leaked fixture child before any assertion can unwind.
    // SAFETY: signal zero observes this fixture-reported PID without signalling it.
    if unsafe { libc::kill(child, 0) } == 0 {
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(child as u32).unwrap());
    }
    assert_eq!(
        fields[1], 0,
        "the metadata image inherited a protected descriptor"
    );
    assert_eq!(
        fields[2], 0,
        "the metadata image inherited the source environment"
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    // SAFETY: signal zero only observes the fixture child.
    while unsafe { libc::kill(child, 0) } == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    // SAFETY: signal zero only observes the fixture child.
    assert_ne!(
        unsafe { libc::kill(child, 0) },
        0,
        "the rejected metadata image left a descendant"
    );
    assert_eq!(client.inventory().unwrap().sessions[0].pid, session.pid);
    assert_eq!(client.capabilities().unwrap().pid, fixture.daemon.id());
}

#[test]
fn modified_target_or_recovery_cache_refuses_commit_and_keeps_serving() {
    use std::os::unix::fs::PermissionsExt;
    for damage_target in [true, false] {
        let (mut fixture, client) = Fixture::new();
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "cache".into(),
                index: None,
            },
            command: PreparedCommand {
                program: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    "while IFS= read -r line; do printf 'echo:%s\\n' \"$line\"; done".into(),
                ],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client.spawn("shell", &command).unwrap();
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
        let executor = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let operation = OperationId::parse("cache-change").unwrap();
        let target = env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2");
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &client,
                client.controller(),
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: target.into(),
                },
            ))
            .unwrap();
        let expected = std::fs::read(target).unwrap();
        let runtime = RuntimeDirectory::open(fixture.root.path()).unwrap();
        let path = std::fs::read_dir(runtime.path().join("images"))
            .unwrap()
            .map(Result::unwrap)
            .map(|entry| entry.path())
            .find(|path| (std::fs::read(path).unwrap() == expected) == damage_target)
            .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::write(path, b"changed cached image").unwrap();
        assert!(executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &client,
                client.controller(),
                operation.clone(),
                ReplacementPhase::Commit
            ))
            .is_err());
        assert_eq!(
            fixture.status(operation.as_str(), "failed")["state"]["stage"],
            "checkpoint"
        );
        assert_eq!(client.inventory().unwrap().sessions[0].pid, session.pid);
        client
            .write("after-refusal", &session.pty, 1, b"still-serving\n")
            .unwrap();
        wait_text(&client, &session.pty, "echo:still-serving");
        assert_eq!(client.capabilities().unwrap().pid, fixture.daemon.id());
    }
}
