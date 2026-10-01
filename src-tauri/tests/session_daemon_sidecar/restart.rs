use super::*;

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn preparation_fences_mutations_but_allows_reads_and_cancel_restores_writes() {
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    fixture.start("preparation-fence");
    let instance = fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.invoke(
        "prepare_app_restart",
        json!({
            "operationId": operation, "intent": "update",
        }),
    );
    let persisted: Value = serde_json::from_slice(
        &fs::read(fixture.daemon_root().join("session-v1/restart.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(persisted["operationId"], operation);
    assert_eq!(persisted["phase"], "prepared");
    assert_eq!(persisted["intent"], "update");
    let response = fixture
        .http
        .post(format!("http://127.0.0.1:{}/app/invoke", fixture.port))
        .bearer_auth(&fixture.token)
        .json(&json!({ "command": "pty_write", "payload": {
            "shellSessionKey": fixture.shell_key, "data": "printf 'BLOCKED\\n'\n",
        }}))
        .send()
        .unwrap();
    assert!(!response.status().is_success());
    assert!(response.text().unwrap().contains("restart preparing"));
    let snapshot = fixture.invoke(
        "get_pty_buffer",
        json!({
            "shellSessionKey": fixture.shell_key,
        }),
    );
    assert_eq!(snapshot["instanceId"], instance);
    assert_eq!(snapshot["isLive"], true);
    fixture.invoke("cancel_app_restart", json!({ "operationId": operation }));
    fixture.invoke("cancel_app_restart", json!({ "operationId": operation }));
    let persisted: Value = serde_json::from_slice(
        &fs::read(fixture.daemon_root().join("session-v1/restart.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(persisted["phase"], "cancelled");
    fixture.write("printf 'CANCEL_RESTORED\\n'\n");
    assert!(fixture
        .output("CANCEL_RESTORED")
        .contains("CANCEL_RESTORED"));
    stop_sidecar(&mut fixture);
}

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn cold_installation_creates_private_daemon_root() {
    use std::os::unix::fs::PermissionsExt;
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    fixture.default_daemon_root = true;
    assert!(!fixture.daemon_root().exists());
    fixture.start("cold-installation");
    fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    assert_eq!(
        fs::metadata(fixture.daemon_root())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    fixture.write("printf 'COLD_INSTALLATION_READY\\n'\n");
    assert!(fixture
        .output("COLD_INSTALLATION_READY")
        .contains("COLD_INSTALLATION_READY"));
    stop_sidecar(&mut fixture);
}

fn stop_sidecar(fixture: &mut Fixture) {
    let child = fixture.child.as_mut().unwrap();
    // SAFETY: this PID belongs to the isolated child created by Fixture.
    assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGTERM) }, 0);
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline, "Sidecar did not finish shutdown");
        std::thread::sleep(Duration::from_millis(20));
    }
    fixture.child = None;
}

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn authorized_restart_preserves_shell_but_normal_quit_stops_daemon() {
    let mut fixture = Fixture::new();
    // With no test caller selector, use the same all-session ownership as production.
    fixture
        .provider_env
        .push(("OPENFORGE_SESSION_DAEMON_SHELL_KEY".into(), String::new()));
    fixture.start("first");
    let instance = fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    fixture.write("stty -echo; kept=alive; printf 'RESTART-PID''=%s\\n' \"$$\"\n");
    let before = fixture.output("RESTART-PID=");
    let pid = regex::Regex::new(r"RESTART-PID=(\d+)")
        .unwrap()
        .captures(&before)
        .unwrap()[1]
        .parse::<i32>()
        .unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.invoke(
        "prepare_app_restart",
        json!({ "operationId": operation, "intent": "restart" }),
    );
    fixture.invoke("detach_app_restart", json!({ "operationId": operation }));
    stop_sidecar(&mut fixture);
    fixture
        .provider_env
        .push(("OPENFORGE_RESTART_OPERATION".into(), operation.clone()));
    fixture.start("second");
    let restored = fixture.invoke(
        "get_pty_buffer",
        json!({ "shellSessionKey": fixture.shell_key }),
    );
    assert_eq!(restored["instanceId"], instance);
    assert_eq!(restored["isLive"], true);
    fixture.invoke("commit_app_restart", json!({ "operationId": operation }));
    fixture.invoke("commit_app_restart", json!({ "operationId": operation }));
    fixture.write("printf 'RESTORED=%s\\n' \"$kept\"\n");
    assert!(fixture.output("RESTORED=alive").contains("RESTORED=alive"));
    stop_sidecar(&mut fixture);
    let deadline = Instant::now() + Duration::from_secs(5);
    while fixture.root.path().join("session-v1/control.sock").exists() {
        assert!(
            Instant::now() < deadline,
            "normal Quit left the daemon running"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // SAFETY: signal zero does not modify the fixture process.
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0);
}

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn lost_detach_request_can_recover_prepared_sessions_without_respawn() {
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    fixture.start("prepared");
    let instance = fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.invoke(
        "prepare_app_restart",
        json!({ "operationId": operation, "intent": "restart" }),
    );
    // Simulate a lost detach request and Sidecar failure before its acknowledgement.
    stop_sidecar(&mut fixture);
    fixture
        .provider_env
        .push(("OPENFORGE_RESTART_OPERATION".into(), operation.clone()));
    fixture.start("recovered-preparation");
    let restored = fixture.invoke(
        "get_pty_buffer",
        json!({ "shellSessionKey": fixture.shell_key }),
    );
    assert_eq!(restored["instanceId"], instance);
    assert_eq!(restored["isLive"], true);
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    assert_eq!(
        inventory["daemonRoot"],
        fixture.daemon_root().to_str().unwrap()
    );
    fixture.invoke("commit_app_restart", json!({ "operationId": operation }));
    stop_sidecar(&mut fixture);
}

#[test]
#[ignore = "requires built Session Daemon; run the session-daemon contract command"]
fn preparation_never_recreates_missing_live_daemon_credentials() {
    use std::os::unix::fs::PermissionsExt;
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    fixture.start("authentication-loss");
    fixture.invoke("get_restart_terminal_inventory", json!({}));
    let path = fixture.daemon_root().join("session-v1/credentials.json");
    let credentials = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    let response = fixture.http.post(format!("http://127.0.0.1:{}/app/invoke", fixture.port))
        .bearer_auth(&fixture.token).json(&json!({ "command": "prepare_app_restart", "payload": { "operationId": operation, "intent": "restart" } }))
        .send().unwrap();
    let recreated = path.exists();
    fs::write(&path, credentials).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    fixture.invoke("cancel_app_restart", json!({ "operationId": operation }));
    stop_sidecar(&mut fixture);
    assert!(!response.status().is_success());
    assert!(!recreated);
}
