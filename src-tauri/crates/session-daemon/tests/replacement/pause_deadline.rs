use super::*;

#[test]
fn slow_paused_stages_refuse_before_exec_and_resume_old_io_and_receipts() {
    for stages in [
        "credential:3000",
        "invalid-credential",
        "header:1500",
        "encode:1500",
        "target-probe:1500",
        "recovery-probe:1500",
        "file:1500",
        "pre-exec:1500",
        "encode:300,target-probe:300,recovery-probe:300,file:300",
    ] {
        let (mut fixture, client) = Fixture::with_executable_and_limit(
            Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon")),
            None,
            None,
            Some(1000),
            Some(stages),
        );
        let original = client.capabilities().unwrap();
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "pause-deadline".into(),
                index: None,
            },
            command: PreparedCommand {
                program: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    "while IFS= read -r line; do printf 'ONCE:%s\\n' \"$line\"; done".into(),
                ],
                cwd: fixture.root.path().into(),
                env: BTreeMap::new(),
            },
            columns: 80,
            rows: 24,
            image_protocol: None,
        };
        let session = client.spawn("spawn", &command).unwrap();
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
        client
            .write("before", &session.pty, 1, b"before\n")
            .unwrap();
        wait_text(&client, &session.pty, "ONCE:before");
        if stages == "invalid-credential" {
            let runtime = RuntimeDirectory::open(fixture.root.path()).unwrap();
            let path = std::fs::read_dir(runtime.path())
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with("agent-")
                        && path
                            .extension()
                            .is_some_and(|extension| extension == "json")
                })
                .expect("spawned terminal credential");
            std::fs::write(path, b"{}").unwrap();
        }
        let operation = OperationId::parse("slow-stage").unwrap();
        client
            .replacement_phase(
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2").into(),
                },
            )
            .unwrap();
        fixture.status(operation.as_str(), "prepared");
        let started = Instant::now();
        client
            .replacement_phase(operation.clone(), ReplacementPhase::Commit)
            .unwrap();
        let status = fixture.status(operation.as_str(), "failed");
        assert!(
            started.elapsed() < Duration::from_millis(1300),
            "{stages}: pause lasted {:?}",
            started.elapsed()
        );
        assert_eq!(status["state"]["stage"], "checkpoint");
        assert_eq!(status["actualVersion"], original.image_version);
        if matches!(
            stages,
            "credential:3000" | "header:1500" | "encode:1500" | "file:1500" | "pre-exec:1500"
        ) {
            assert!(
                matches!(
                    client.replacement_phase(
                        OperationId::parse("while-worker-active").unwrap(),
                        ReplacementPhase::Prepare {
                            executable: env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2")
                                .into(),
                        },
                    ),
                    Err(Error::Capacity)
                ),
                "abandoned worker did not bound replacement admission"
            );
        }
        let caps = client.capabilities().unwrap();
        assert_eq!(caps.pid, original.pid);
        assert_eq!(caps.image_version, original.image_version);
        assert_eq!(
            std::fs::read(executable(original.pid)).unwrap(),
            std::fs::read(env!("CARGO_BIN_EXE_openforge-session-daemon")).unwrap()
        );
        let retried = client.spawn("spawn", &command).unwrap();
        assert_eq!(retried.pid, session.pid);
        assert_eq!(retried.pty, session.pty);
        client
            .write("before", &session.pty, 1, b"before\n")
            .unwrap();
        client.write("after", &session.pty, 2, b"after\n").unwrap();
        wait_text(&client, &session.pty, "ONCE:after");
        let recovery = client.recover(&session.pty).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&recovery.portable_vt)
                .matches("ONCE:before")
                .count(),
            1,
            "retry repeated input after refusal"
        );
        assert_eq!(client.inventory().unwrap().sessions[0].pty, session.pty);
        if stages == "credential:3000" {
            assert!(
                matches!(
                    client.replacement_phase(
                        OperationId::parse("after-resumed-io").unwrap(),
                        ReplacementPhase::Prepare {
                            executable: env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2")
                                .into(),
                        },
                    ),
                    Err(Error::Capacity)
                ),
                "old I/O was not proven while credential work remained alive"
            );
            std::thread::sleep(Duration::from_millis(1600));
        }
        std::thread::sleep(Duration::from_millis(800));
        assert!(
            !std::fs::read_dir(fixture.root.path().join("session-v1"))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("replacement-")),
            "late file stage leaked its checkpoint"
        );
    }
}
