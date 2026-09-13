use super::*;
use std::os::unix::fs::PermissionsExt;

#[test]
#[ignore = "requires built Sidecar and Session Daemon"]
fn claude_and_codex_reconcile_together_and_stop_only_the_selected_task() {
    let mut fixture = Fixture::new();
    let bin = fixture.root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    for executable in ["claude", "codex"] {
        fs::write(bin.join(executable), include_str!("provider-fixture.cjs")).unwrap();
        fs::set_permissions(bin.join(executable), fs::Permissions::from_mode(0o700)).unwrap();
    }
    fixture.provider_bin = Some(bin);
    fixture.start("setup");
    let mut tasks = Vec::new();
    for (provider, executable) in [("claude-code", "claude"), ("codex", "codex")] {
        let repo = fixture.root.path().join(executable);
        fs::create_dir(&repo).unwrap();
        assert!(Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        let project = fixture.invoke("create_project", json!({"name":provider,"path":repo}));
        fixture.invoke(
            "set_project_config",
            json!({"projectId":project["id"],"key":"ai_provider","value":provider}),
        );
        let task = fixture.invoke("create_task", json!({"initialPrompt":"Keep both sessions alive","status":"backlog","projectId":project["id"],"worktreeSource":"disabled"}));
        let key = task["id"].as_str().unwrap().to_string();
        fixture
            .agent_selection
            .push((executable.into(), key.clone()));
        tasks.push((key, repo));
    }
    fixture.replace();
    let mut records = Vec::new();
    for (key, repo) in &tasks {
        fixture.invoke(
            "start_implementation",
            json!({"taskId":key,"repoPath":repo}),
        );
        fixture.shell_key = key.clone();
        records.push(providers::record(&fixture, 0));
    }
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    assert_eq!(inventory["sessions"].as_array().unwrap().len(), 2);
    let mut old = fixture.child.take().unwrap();
    old.kill().unwrap();
    old.wait().unwrap();
    let db = rusqlite::Connection::open(fixture.root.path().join("openforge_dev.db")).unwrap();
    db.execute("UPDATE agent_sessions SET updated_at=1", [])
        .unwrap();
    drop(db);
    fixture.start("both-preserved");
    for ((key, _), before) in tasks.iter().zip(&records) {
        fixture.shell_key = key.clone();
        fixture.write("ping\n");
        assert_eq!(providers::record(&fixture, 1), *before);
        let session = fixture.invoke("get_latest_session", json!({"taskId":key}));
        assert_eq!(session["status"], "running");
    }
    let current = fixture.invoke("get_restart_terminal_inventory", json!({}));
    let key = &tasks[0].0;
    let instance = records[0]["instance"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    for (command, extra) in [
        ("pty_write", json!({"data":"approve\n"})),
        ("pty_resize", json!({"cols":120,"rows":40})),
        ("pty_kill", json!({})),
    ] {
        let mut payload = extra;
        payload["shellSessionKey"] = json!(key);
        payload["fence"] = json!({"controller":current["controller"],"instanceId":instance+1});
        let response = fixture
            .http
            .post(format!("http://127.0.0.1:{}/app/invoke", fixture.port))
            .bearer_auth(&fixture.token)
            .json(&json!({"command":command,"payload":payload}))
            .send()
            .unwrap();
        assert!(
            !response.status().is_success(),
            "{command} must reject a stale PTY identity"
        );
    }
    fixture.invoke("pty_kill", json!({"shellSessionKey":key}));
    let deadline = Instant::now() + Duration::from_secs(10);
    while fixture.invoke("get_pty_buffer", json!({"shellSessionKey":key}))["isLive"] != false {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    fixture.shell_key = tasks[1].0.clone();
    fixture.write("ping\n");
    assert_eq!(
        providers::record(&fixture, 2),
        records[1],
        "stopping Claude must not stop Codex or its tool"
    );
    fixture.invoke("pty_kill", json!({"shellSessionKey":tasks[1].0}));
}
