//! Real CLI interface proof with no credentials. Authenticated running-tool proofs remain separate.
use super::*;

#[test]
#[ignore = "requires built binaries and OPENFORGE_LIVE_PROVIDER_BIN"]
fn installed_claude_preserves_its_existing_interface() {
    preserves_installed_interface("claude-code", "claude");
}

#[test]
#[ignore = "requires built binaries and OPENFORGE_LIVE_PROVIDER_BIN"]
fn installed_codex_preserves_its_existing_interface() {
    preserves_installed_interface("codex", "codex");
}

fn diagnostics(fixture: &Fixture) -> Value {
    fixture
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
        .unwrap()
}

fn preserves_installed_interface(provider: &str, executable: &str) {
    let Some(bin) = std::env::var_os("OPENFORGE_LIVE_PROVIDER_BIN") else {
        eprintln!(
            "SKIPPED installed {provider} demonstration: OPENFORGE_LIVE_PROVIDER_BIN is not set"
        );
        return;
    };
    let bin = PathBuf::from(bin).canonicalize().unwrap();
    assert!(bin.join(executable).is_file());
    let version = Command::new(bin.join(executable))
        .arg("--version")
        .output()
        .unwrap();
    assert!(version.status.success());
    let mut fixture = Fixture::new();
    fixture.provider_bin = Some(bin);
    let repo = fixture.root.path().join("repo");
    fs::create_dir(&repo).unwrap();
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&repo)
        .status()
        .unwrap()
        .success());
    fixture.start("setup");
    let project = fixture.invoke(
        "create_project",
        json!({"name":"Isolated installed provider proof","path":repo}),
    );
    fixture.invoke(
        "set_project_config",
        json!({"projectId":project["id"],"key":"ai_provider","value":provider}),
    );
    let task = fixture.invoke("create_task", json!({"initialPrompt":"Wait for user input. Do not run tools.","status":"backlog","projectId":project["id"],"worktreeSource":"disabled"}));
    let key = task["id"].as_str().unwrap().to_string();
    fixture
        .agent_selection
        .push((executable.into(), key.clone()));
    fixture.shell_key = key.clone();
    fixture.replace();
    fixture.invoke(
        "start_implementation",
        json!({"taskId":key,"repoPath":repo}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    let before = loop {
        let buffer = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":key}));
        let replay = buffer["snapshot"]["compatibilityData"]
            .as_str()
            .unwrap_or_default();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(replay)
            .unwrap();
        if bytes.len() > 100 {
            assert_eq!(
                buffer["isLive"],
                true,
                "real provider exited: {}",
                String::from_utf8_lossy(&bytes)
            );
            eprintln!(
                "{provider} initial interface: {}",
                String::from_utf8_lossy(&bytes)
            );
            break buffer;
        }
        assert!(
            Instant::now() < deadline,
            "real provider did not render an interface: {buffer}"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    let memory = diagnostics(&fixture);
    let tree = memory["ptyProcessTrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tree| tree["taskId"] == key)
        .unwrap();
    let pid = tree["rootPid"].clone();
    let old_sidecar = fixture.child.as_ref().unwrap().id();
    fixture.replace();
    let after = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":key}));
    assert_eq!(after["isLive"], true);
    assert_eq!(after["instanceId"], before["instanceId"]);
    assert!(after["snapshot"]["compatibilityData"]
        .as_str()
        .is_some_and(|data| !data.is_empty()));
    let memory = diagnostics(&fixture);
    assert!(memory["ptyProcessTrees"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tree| tree["taskId"] == key && tree["rootPid"] == pid));
    fixture.invoke(
        "pty_resize",
        json!({"shellSessionKey":key,"cols":91,"rows":33}),
    );
    fixture.invoke("pty_kill", json!({"shellSessionKey":key}));
    eprintln!("{}: PID {pid}, PTY {} survived Sidecar {old_sidecar} -> {}. No credentials supplied; authenticated tool execution not demonstrated.", String::from_utf8_lossy(&version.stdout).trim(), before["instanceId"], fixture.child.as_ref().unwrap().id());
}
