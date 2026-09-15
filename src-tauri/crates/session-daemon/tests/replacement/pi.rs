//! Optional real Pi tool call driven by a deterministic loopback model; no external inference.
use super::*;

#[test]
#[ignore = "requires OPENFORGE_REPLACEMENT_NODE and OPENFORGE_REPLACEMENT_PI pointing to installed executables"]
fn real_pi_rpc_bash_and_tool_child_survive_replacement() {
    let node = PathBuf::from(
        std::env::var_os("OPENFORGE_REPLACEMENT_NODE").expect("explicit Node executable"),
    );
    let pi = std::fs::canonicalize(
        std::env::var_os("OPENFORGE_REPLACEMENT_PI").expect("explicit Pi CLI"),
    )
    .unwrap();
    assert!(node.is_file() && pi.is_file());
    let (mut fixture, client) = Fixture::new();
    assert!(client.capabilities().unwrap().supports_replacement);
    let root = fixture.root.path();
    let config = root.join("pi-config");
    std::fs::create_dir(&config).unwrap();
    let script = root.join("pi-child.sh");
    let bash_pid = root.join("bash.pid");
    let child_pid = root.join("child.pid");
    let release = root.join("release");
    let counter = root.join("counter");
    std::fs::write(&script, "printf '%s\\n' \"$$\" > \"$1\"\ni=0\nwhile [ ! -f \"$2\" ]; do i=$((i+1)); printf 'PI_CHILD_TICK:%s\\n' \"$i\"; sleep 0.05; done\nprintf '%s\\n' \"$i\" > \"$3\"\nprintf 'PI_CHILD_FINISHED:%s\\n' \"$i\"\n").unwrap();
    let bash = format!(
        "printf '%s\\n' \"$$\" > '{}'; /bin/sh '{}' '{}' '{}' '{}'; printf 'BASH_FINISHED\\n'",
        bash_pid.display(),
        script.display(),
        child_pid.display(),
        release.display(),
        counter.display()
    );
    let provider = super::model_provider::Provider::new(bash);
    std::fs::write(config.join("models.json"), json!({"providers":{"replacement-fixture":{"baseUrl":format!("http://127.0.0.1:{}/v1", provider.port),"api":"openai-completions","apiKey":"fixture","models":[{"id":"fixture"}]}}}).to_string()).unwrap();
    let command = ShellCommand {
        owner: TerminalOwner::Agent {
            task_id: "real-pi-replacement".into(),
        },
        command: PreparedCommand {
            program: node.to_string_lossy().into_owned(),
            args: vec![
                pi.to_string_lossy().into_owned(),
                "--mode".into(),
                "rpc".into(),
                "--no-session".into(),
                "--provider".into(),
                "replacement-fixture".into(),
                "--model".into(),
                "fixture".into(),
            ],
            cwd: root.into(),
            env: BTreeMap::from([
                ("HOME".into(), root.to_string_lossy().into_owned()),
                (
                    "PATH".into(),
                    format!("{}:/usr/bin:/bin", node.parent().unwrap().display()),
                ),
                (
                    "PI_CODING_AGENT_DIR".into(),
                    config.to_string_lossy().into_owned(),
                ),
                ("PI_OFFLINE".into(), "1".into()),
                ("PI_TELEMETRY".into(), "0".into()),
                ("SHELL".into(), "/bin/bash".into()),
            ]),
        },
        columns: 240,
        rows: 60,
        image_protocol: None,
    };
    let session = client.spawn("pi", &command).unwrap();
    fixture
        .tracked
        .push(managed_process::ManagedProcessIdentity::capture(session.pid).unwrap());
    let input = format!(
        "{}\n",
        json!({"id":"live-tool","type":"prompt","message":"Run the fixture tool."})
    );
    client
        .write("start-tool", &session.pty, 1, input.as_bytes())
        .unwrap();
    let bash = wait_pid(&bash_pid);
    let child = wait_pid(&child_pid);
    for pid in [bash, child] {
        fixture
            .tracked
            .push(managed_process::ManagedProcessIdentity::capture(pid).unwrap());
    }
    let identities = fixture.tracked.clone();
    assert_eq!(
        std::fs::canonicalize(executable(session.pid)).unwrap(),
        std::fs::canonicalize(&node).unwrap()
    );
    let runtime = RuntimeDirectory::open(root).unwrap();
    let credential = std::fs::read_dir(runtime.path())
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| entry.file_name().to_string_lossy().starts_with("agent-"))
        .unwrap()
        .path();
    let original_credential = std::fs::read(&credential).unwrap();
    let executor = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    let mut current = client;
    for (index, image) in [
        env!("CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"),
        env!("CARGO_BIN_EXE_openforge-session-daemon"),
    ]
    .into_iter()
    .enumerate()
    {
        let operation = OperationId::parse(format!("replace-live-pi-{index}")).unwrap();
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &current,
                current.controller(),
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: image.into(),
                },
            ))
            .unwrap();
        let started = Instant::now();
        executor
            .block_on(openforge_session_host::PtyHost::replacement(
                &current,
                current.controller(),
                operation,
                ReplacementPhase::Commit,
            ))
            .unwrap();
        eprintln!(
            "live Pi replacement {index}: commit-to-ready upper bound {} ms",
            started.elapsed().as_millis()
        );
        for identity in &identities {
            assert_eq!(
                &managed_process::ManagedProcessIdentity::capture(identity.root_pid as u32)
                    .unwrap(),
                identity
            );
        }
        assert!(
            std::fs::read(&credential).unwrap() == original_credential,
            "agent credential bytes changed"
        );
        assert_eq!(current.capabilities().unwrap().pid, fixture.daemon.id());
        assert_eq!(
            std::fs::read(executable(fixture.daemon.id())).unwrap(),
            std::fs::read(image).unwrap()
        );
        current = Client::connect(root).unwrap();
    }
    let fresh = Client::connect(root).unwrap();
    assert_eq!(fresh.spawn("pi", &command).unwrap().pid, session.pid);
    fresh
        .write(
            "state-after",
            &session.pty,
            2,
            b"{\"id\":\"state-after\",\"type\":\"get_state\"}\n",
        )
        .unwrap();
    wait_text(
        &fresh,
        &session.pty,
        "\"command\":\"get_state\",\"success\":true",
    );
    std::fs::write(release, b"release").unwrap();
    wait_text(&fresh, &session.pty, "PI_CHILD_FINISHED:");
    let count: u64 = std::fs::read_to_string(counter)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(
        count > 10,
        "the child must produce output during replacement"
    );
    wait_text(&fresh, &session.pty, "MODEL_DONE");
    assert_eq!(provider.completed(), 2);
}

fn wait_pid(path: &Path) -> u32 {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(value) = std::fs::read_to_string(path) {
            if let Ok(pid) = value.trim().parse() {
                return pid;
            }
        }
        assert!(
            Instant::now() < deadline,
            "real Pi bash process did not start"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
