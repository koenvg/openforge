//! Explicitly opted-in live-provider demonstration. Credentials stay in a private temporary HOME.
use super::*;
use std::os::unix::fs::PermissionsExt;

#[test]
#[ignore = "requires built binaries and explicit OPENFORGE_LIVE_PI_AUTH opt-in"]
fn installed_pi_preserves_its_current_bash_tool_across_sidecar_replacement() {
    let Some(auth_path) = std::env::var_os("OPENFORGE_LIVE_PI_AUTH") else {
        eprintln!("SKIPPED live Pi demonstration: OPENFORGE_LIVE_PI_AUTH is not set");
        return;
    };
    let settings_path =
        std::env::var_os("OPENFORGE_LIVE_PI_SETTINGS").expect("explicit Pi settings path");
    let mut fixture = Fixture::new();
    let agent_dir = fixture.root.path().join("home/.pi/agent");
    fs::create_dir_all(&agent_dir).unwrap();
    fs::set_permissions(&agent_dir, fs::Permissions::from_mode(0o700)).unwrap();
    fs::copy(auth_path, agent_dir.join("auth.json")).unwrap();
    fs::set_permissions(
        agent_dir.join("auth.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let source: Value = serde_json::from_slice(&fs::read(settings_path).unwrap()).unwrap();
    let mut settings = json!({"extensions":[], "packages":[]});
    for key in ["defaultProvider", "defaultModel", "defaultThinkingLevel"] {
        if let Some(value) = source.get(key) {
            settings[key] = value.clone();
        }
    }
    fs::write(
        agent_dir.join("settings.json"),
        serde_json::to_vec(&settings).unwrap(),
    )
    .unwrap();
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
        json!({"name":"Live Pi proof", "path":repo}),
    );
    fixture.invoke(
        "set_project_config",
        json!({"projectId":project["id"], "key":"ai_provider", "value":"pi"}),
    );
    let prompt = "This is an isolated process-preservation proof. Do not inspect files or change code. Use the bash tool exactly once to run this exact command: printf '%s' \"$$\" > tool-started; sleep 20; \"$HOME/.openforge/bin/openforge\" project list > tool-cli.json; printf done > tool-finished. Wait for the tool to finish, then reply DONE. Do not run any other tools.";
    let task = fixture.invoke("create_task", json!({"initialPrompt":prompt,"status":"backlog","projectId":project["id"],"worktreeSource":"disabled"}));
    let task_id = task["id"].as_str().unwrap().to_string();
    fixture.pi_key = Some(task_id.clone());
    fixture.shell_key = task_id.clone();
    fixture.replace();
    fixture.invoke(
        "start_implementation",
        json!({"taskId":task_id,"repoPath":repo}),
    );
    let deadline = Instant::now() + Duration::from_secs(120);
    let tool_pid: u32 = loop {
        if let Ok(pid) = fs::read_to_string(repo.join("tool-started")) {
            if let Ok(pid) = pid.parse() {
                break pid;
            }
        }
        assert!(
            Instant::now() < deadline,
            "installed Pi did not start the requested tool"
        );
        std::thread::sleep(Duration::from_millis(100));
    };
    let diagnostics = || -> Value {
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
    };
    let before = diagnostics();
    let tree = before["ptyProcessTrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tree| tree["taskId"] == task_id)
        .unwrap();
    let pi_pid = tree["rootPid"].clone();
    let instance = tree["ptyInstanceId"].clone();
    let old_sidecar = fixture.child.as_ref().unwrap().id();
    fixture.replace();
    let buffer = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":task_id}));
    assert_eq!(buffer["instanceId"], instance);
    assert_eq!(buffer["isLive"], true);
    let after: Value = fixture
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
    assert!(after["ptyProcessTrees"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tree| tree["rootPid"] == pi_pid && tree["ptyInstanceId"] == instance));
    assert!(
        Command::new("kill")
            .args(["-0", &tool_pid.to_string()])
            .status()
            .unwrap()
            .success(),
        "original tool PID must remain live"
    );
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let session = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
        if repo.join("tool-finished").exists() && session["status"] == "completed" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "Pi did not finish the preserved turn: {session}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let projects: Value =
        serde_json::from_slice(&fs::read(repo.join("tool-cli.json")).unwrap()).unwrap();
    assert!(projects
        .as_array()
        .unwrap()
        .iter()
        .any(|project| project["name"] == "Live Pi proof"));
    eprintln!("LIVE PI DEMONSTRATION: provider={} model={} Pi={} tool={} instance={} Sidecar={} -> {}; original turn completed and CLI succeeded", settings["defaultProvider"], settings["defaultModel"], pi_pid, tool_pid, instance, old_sidecar, fixture.child.as_ref().unwrap().id());
}
