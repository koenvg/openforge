use super::*;
use std::os::unix::fs::PermissionsExt;

fn proof_record(fixture: &Fixture, sequence: usize) -> Value {
    let marker = format!("PI-PROOF-{sequence} ");
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
fn pi_and_running_tool_survive_sidecar_replacement_and_downtime_notifications() {
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
    fs::write(bin.join("pi"), include_str!("pi-fixture.cjs")).unwrap();
    fs::set_permissions(bin.join("pi"), fs::Permissions::from_mode(0o700)).unwrap();
    fixture.provider_bin = Some(bin);
    fixture.start("setup");
    let project = fixture.invoke(
        "create_project",
        json!({"name":"Pi preservation proof", "path":repo}),
    );
    fixture.invoke(
        "set_project_config",
        json!({"projectId":project["id"], "key":"ai_provider", "value":"pi"}),
    );
    let task = fixture.invoke("create_task", json!({
        "initialPrompt":"Keep the current tool running", "status":"backlog", "projectId":project["id"], "worktreeSource":"disabled",
    }));
    let task_id = task["id"].as_str().unwrap().to_string();
    fixture.pi_key = Some(task_id.clone());
    fixture.shell_key = task_id.clone();
    fixture.replace();
    let started = fixture.invoke(
        "start_implementation",
        json!({"taskId":task_id, "repoPath":repo}),
    );
    assert!(started["session_id"].is_string());
    let before = proof_record(&fixture, 0);
    assert_eq!(before["controllerTokenAbsent"], true);
    let instance = before["instance"].as_str().unwrap().parse::<u64>().unwrap();
    let initial_inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    let old_fence = json!({"controller":initial_inventory["controller"], "instanceId":instance});
    for (sequence, (kind, expected, stage)) in [
        ("requested_permission", "paused", "permission"),
        ("ended", "completed", "completion"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut old = fixture.child.take().unwrap();
        let old_pid = old.id();
        old.kill().unwrap();
        old.wait().unwrap();
        fs::write(repo.join("notification-kind"), kind).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(status) = fs::read_to_string(repo.join(format!("accepted-{kind}"))) {
                assert_eq!(status, "202");
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Pi fixture did not send the downtime hook"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        fixture.start(stage);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let session = fixture.invoke("get_latest_session", json!({"taskId":task_id}));
            if session["status"] == expected {
                assert_eq!(session["id"], started["session_id"]);
                assert_eq!(session["pty_instance_id"], instance);
                break;
            }
            assert!(
                Instant::now() < deadline,
                "did not restore {expected}: {session}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        fixture.write("ping\n");
        let after = proof_record(&fixture, sequence + 1);
        assert_eq!(
            after, before,
            "Pi and tool PIDs, cwd, environment, and allocation must survive"
        );
        fixture.invoke(
            "pty_resize",
            json!({"shellSessionKey":task_id, "cols":91 + sequence, "rows":33}),
        );
        fixture.write("geometry\ncli\n");
        fixture.output(&format!("PI-GEOMETRY 33 {}", 91 + sequence));
        fixture.output(&format!(
            "PI-CLI-{sequence} {{\"status\":0,\"found\":true}}"
        ));
        eprintln!(
            "Pi fixture {} and tool {} survived Sidecar {old_pid} -> {} with {expected}",
            before["pid"],
            before["toolPid"],
            fixture.child.as_ref().unwrap().id()
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
    assert!(
        diagnostics["ptyProcessTrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tree| tree["taskId"] == task_id
                && tree["rootPid"] == before["pid"]
                && tree["ptyInstanceId"] == instance),
        "daemon Pi must be visible in process diagnostics: {diagnostics}"
    );
    assert_eq!(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .count(),
        1,
        "no provider resume invocation"
    );
    let response = fixture.http.post(format!("http://127.0.0.1:{}/app/invoke", fixture.port))
        .bearer_auth(&fixture.token).json(&json!({"command":"pty_write", "payload":{"shellSessionKey":task_id,"data":"stale","fence":old_fence}})).send().unwrap();
    assert!(
        !response.status().is_success(),
        "stale controller must not deliver input"
    );
    fixture.invoke("pty_kill", json!({"shellSessionKey":task_id}));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let replay = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":task_id}));
        if replay["isLive"] == false {
            assert_eq!(replay["instanceId"], instance);
            assert!(replay["snapshot"].is_object());
            break;
        }
        assert!(Instant::now() < deadline, "Pi did not stop");
        std::thread::sleep(Duration::from_millis(20));
    }
    fixture.replace();
    let retained = fixture.invoke("get_pty_buffer", json!({"shellSessionKey":task_id}));
    assert_eq!(
        retained["isLive"], false,
        "retained exits must not resume from history"
    );
    assert_eq!(retained["instanceId"], instance);
    assert_eq!(
        fs::read_to_string(repo.join("invocations.jsonl"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}
