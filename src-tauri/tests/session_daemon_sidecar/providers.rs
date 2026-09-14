use super::*;
use std::os::unix::fs::PermissionsExt;

pub(super) fn record(fixture: &Fixture, sequence: usize) -> Value {
    let marker = format!("PROVIDER-PROOF-{sequence} ");
    let output = fixture.output(&marker);
    let record = output
        .lines()
        .rev()
        .find_map(|line| line.split_once(&marker).map(|(_, value)| value))
        .unwrap();
    serde_json::from_str(record.trim()).unwrap()
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn claude_code_keeps_agent_and_tool_through_replacement() {
    preserves_provider("claude-code", "claude", false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn codex_keeps_agent_and_tool_through_replacement() {
    preserves_provider("codex", "codex", false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn claude_code_retains_exit_during_replacement() {
    preserves_provider("claude-code", "claude", true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn codex_retains_exit_during_replacement() {
    preserves_provider("codex", "codex", true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn opencode_keeps_agent_and_tool_through_replacement() {
    preserves_provider("opencode", "opencode", false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn grok_keeps_agent_and_tool_through_replacement() {
    preserves_provider("grok", "grok", false);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn opencode_retains_exit_during_replacement() {
    preserves_provider("opencode", "opencode", true);
}

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn grok_retains_exit_during_replacement() {
    preserves_provider("grok", "grok", true);
}

fn preserves_provider(provider: &str, executable: &str, exit_during_downtime: bool) {
    let mut fixture = Fixture::new();
    let repo = fixture.root.path().join("repo");
    fs::create_dir(&repo).unwrap();
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&repo)
        .status()
        .unwrap()
        .success());
    let bin = fixture.root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    fs::write(bin.join(executable), include_str!("provider-fixture.cjs")).unwrap();
    fs::write(
        bin.join("provider-hooks.cjs"),
        include_str!("provider-hooks.cjs"),
    )
    .unwrap();
    fs::set_permissions(bin.join(executable), fs::Permissions::from_mode(0o700)).unwrap();
    fixture.provider_bin = Some(bin);
    if matches!(provider, "opencode" | "grok") {
        // Synthetic credentials only. Never import the developer's auth into the proof.
        fixture
            .provider_env
            .push(("XAI_API_KEY".into(), "fixture-auth-only".into()));
    }
    fixture.start("setup");
    let project = fixture.invoke(
        "create_project",
        json!({"name":"Provider preservation proof", "path":repo}),
    );
    fixture.invoke(
        "set_project_config",
        json!({"projectId":project["id"], "key":"ai_provider", "value":provider}),
    );
    let task = fixture.invoke("create_task", json!({"initialPrompt":"Keep the current tool running", "status":"backlog", "projectId":project["id"], "worktreeSource":"disabled", "permissionMode":"plan"}));
    let task_id = task["id"].as_str().unwrap().to_string();
    fixture
        .agent_selection
        .push((executable.into(), task_id.clone()));
    fixture.shell_key = task_id.clone();
    fixture.replace();
    let started = fixture.invoke(
        "start_implementation",
        json!({"taskId":task_id, "repoPath":repo, "terminalImageProtocol":"iterm2"}),
    );
    assert!(started["session_id"].is_string());
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    assert_eq!(
        inventory["sessions"].as_array().unwrap().len(),
        1,
        "provider must be daemon-owned before replacement"
    );
    let before = record(&fixture, 0);
    let instance = before["instance"].as_str().unwrap().parse::<u64>().unwrap();
    assert_eq!(inventory["sessions"][0]["instanceId"], instance);
    assert!(before["tty"].as_str().unwrap().starts_with("/dev/"));
    assert_eq!(before["controllerTokenAbsent"], true);
    assert_eq!(before["task"], task_id);
    assert_eq!(before["provider"], provider);
    if matches!(provider, "opencode" | "grok") {
        assert_eq!(before["auth"], "fixture-auth-only");
        assert_eq!(before["term"], "xterm-256color");
        assert_eq!(before["termProgram"], "vscode");
        assert_eq!(
            before["imageSession"],
            Value::Null,
            "unsupported images stay disabled"
        );
        assert_eq!(
            PathBuf::from(before["cwd"].as_str().unwrap()),
            repo.canonicalize().unwrap()
        );
    }
    if provider == "claude-code" {
        assert_eq!(before["claudeTask"], task_id);
    }
    let arguments: Vec<String> = serde_json::from_str(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert!(arguments
        .iter()
        .any(|arg| arg.contains("Keep the current tool running")));
    assert!(!arguments.iter().any(|arg| matches!(
        arg.as_str(),
        "--resume" | "resume" | "--continue" | "--session"
    )));
    if provider == "claude-code" {
        assert!(arguments
            .windows(2)
            .any(|args| args == ["--permission-mode", "plan"]));
        let settings = arguments
            .windows(2)
            .find(|args| args[0] == "--settings")
            .unwrap();
        assert!(PathBuf::from(&settings[1]).is_file());
        let trust: Value = serde_json::from_slice(
            &fs::read(fixture.root.path().join("home/.claude.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            trust[repo.canonicalize().unwrap().to_str().unwrap()]["hasTrustDialogAccepted"],
            true
        );
    } else if provider == "codex" {
        assert!(arguments
            .windows(2)
            .any(|args| args == ["--profile", "openforge-lifecycle"]));
        assert!(fixture
            .root
            .path()
            .join("home/.codex/openforge-lifecycle.config.toml")
            .is_file());
    } else if provider == "opencode" {
        assert!(!arguments.iter().any(|arg| arg == "--agent"));
        assert!(arguments.iter().any(|arg| arg == "--prompt"));
        assert!(!arguments.iter().any(|arg| arg == "--permission-mode"));
    } else if provider == "grok" {
        assert!(arguments
            .windows(2)
            .any(|args| args == ["--permission-mode", "plan"]));
        assert_eq!(arguments[arguments.len() - 2], "--");
    }
    let old_fence = json!({"controller":inventory["controller"], "instanceId":instance});
    // Seed stale history while the Sidecar is absent, leaving the live allocation authoritative.
    let mut old = fixture.child.take().unwrap();
    old.kill().unwrap();
    old.wait().unwrap();
    let db = rusqlite::Connection::open(fixture.root.path().join("openforge_dev.db")).unwrap();
    db.execute(
        "UPDATE agent_sessions SET updated_at=1 WHERE ticket_id=?1",
        [&task_id],
    )
    .unwrap();
    db.execute("INSERT INTO agent_sessions(id,ticket_id,stage,status,provider,pty_instance_id,created_at,updated_at) VALUES('stale-provider',?1,'implementing','running',?2,?3,0,1)", rusqlite::params![task_id,provider,i64::try_from(instance + 1).unwrap()]).unwrap();
    drop(db);
    fixture.start("stale-history");
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let stale = fixture.invoke("get_session_status", json!({"sessionId":"stale-provider"}));
        if stale["status"] == "interrupted" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "stale allocation must not remain running: {stale}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let current = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
    assert_eq!(
        current["status"], "running",
        "live allocation must not be marked interrupted"
    );
    assert_eq!(current["id"], started["session_id"]);
    fixture.write("ping\n");
    assert_eq!(
        record(&fixture, 1),
        before,
        "agent, tool, PTY, cwd and launch environment must survive"
    );
    fixture.invoke(
        "pty_resize",
        json!({"shellSessionKey":task_id, "cols":91, "rows":33}),
    );
    fixture.write("geometry\ncli\n");
    fixture.output("PROVIDER-GEOMETRY 33 91");
    fixture.output("PROVIDER-CLI {\"status\":0,\"found\":true}");
    let response = fixture.http.post(format!("http://127.0.0.1:{}/app/invoke", fixture.port)).bearer_auth(&fixture.token)
        .json(&json!({"command":"pty_write","payload":{"shellSessionKey":task_id,"data":"approve\n","fence":old_fence}})).send().unwrap();
    assert!(
        !response.status().is_success(),
        "stale input must be rejected"
    );
    assert!(!repo.join("approved").exists());
    let mut notifications = vec![
        ("requested_permission", "paused"),
        ("became_busy", "running"),
        ("became_idle", "completed"),
        ("ended", "completed"),
    ];
    if matches!(provider, "opencode" | "grok") {
        notifications.insert(1, ("input_wait", "paused"));
    }
    for (sequence, (kind, expected)) in notifications.into_iter().enumerate() {
        let mut old = fixture.child.take().unwrap();
        old.kill().unwrap();
        old.wait().unwrap();
        fs::write(repo.join("notification-kind"), kind).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(status) = fs::read_to_string(repo.join(format!("accepted-{kind}"))) {
                assert_eq!(
                    status,
                    "202",
                    "{kind}: {}",
                    fs::read_to_string(repo.join("notification-error")).unwrap_or_default()
                );
                break;
            }
            assert!(
                Instant::now() < deadline,
                "{provider} hook was not accepted during downtime"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        fixture.start(kind);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let session = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
            if session["status"] == expected {
                assert_eq!(session["id"], started["session_id"]);
                assert_eq!(session["provider"], provider);
                assert_eq!(session["pty_instance_id"], instance);
                if provider == "claude-code" {
                    assert_eq!(session["claude_session_id"], "claude-code-native-session");
                }
                if provider == "opencode" {
                    assert_eq!(session["opencode_session_id"], "ses_opencode_native");
                }
                if provider == "grok" {
                    assert_eq!(session["grok_session_id"], "grok-native-session");
                }
                break;
            }
            assert!(
                Instant::now() < deadline,
                "{provider} failed to restore {expected}: {session}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        fixture.write("ping\n");
        assert_eq!(record(&fixture, sequence + 2), before);
        assert!(
            !repo.join("approved").exists(),
            "permissions must never be auto-approved"
        );
    }
    let diagnostics: Value = fixture
        .http
        .get(format!(
            "http://127.0.0.1:{}/debug/process-memory",
            fixture.port
        ))
        .bearer_auth(&fixture.token)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert!(diagnostics["ptyProcessTrees"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tree| tree["taskId"] == task_id
            && tree["rootPid"] == before["pid"]
            && tree["ptyInstanceId"] == instance));
    assert_eq!(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .count(),
        1,
        "replacement must not resume or duplicate a provider"
    );
    if exit_during_downtime {
        let mut old = fixture.child.take().unwrap();
        old.kill().unwrap();
        old.wait().unwrap();
        fs::write(repo.join("exit-now"), "exit").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Command::new("kill")
            .args(["-0", &before["pid"].to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
        {
            assert!(
                Instant::now() < deadline,
                "provider did not exit during downtime"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        fixture.start("retained-exit");
    } else {
        fixture.invoke("pty_kill", json!({"shellSessionKey":task_id}));
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let replay = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":task_id}));
        if replay["isLive"] == false {
            assert_eq!(replay["instanceId"], instance);
            assert!(
                replay["snapshot"].is_object(),
                "completed replay remains available"
            );
            break;
        }
        assert!(Instant::now() < deadline, "provider did not stop");
        std::thread::sleep(Duration::from_millis(20));
    }
    fixture.replace();
    let retained = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":task_id}));
    assert_eq!(retained["isLive"], false);
    assert_eq!(retained["instanceId"], instance);
    assert_eq!(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .count(),
        1,
        "retained exits must not trigger history resume"
    );
    eprintln!("{provider}: agent {} tool {} PTY {instance} survived replacement, permission/input waiting and completion; retained exit={exit_during_downtime}", before["pid"], before["toolPid"]);
}
