use super::*;

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
    fixture.start("first");
    let instance = fixture.invoke("pty_spawn_shell", json!({
        "taskId": "T-proof", "terminalIndex": 3, "cwd": fixture.root.path(), "cols": 80, "rows": 24,
    }));
    fixture.write("stty -echo; kept=alive; printf 'RESTART-PID=%s\\n' \"$$\"\n");
    let before = fixture.output("RESTART-PID=");
    let pid = regex::Regex::new(r"RESTART-PID=(\d+)").unwrap()
        .captures(&before).unwrap()[1].parse::<i32>().unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.invoke("prepare_app_restart", json!({ "operationId": operation, "intent": "restart" }));
    fixture.invoke("detach_app_restart", json!({ "operationId": operation }));
    stop_sidecar(&mut fixture);
    // SAFETY: signal zero only checks the shell PID obtained from this fixture.
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
    fixture.provider_env.push(("OPENFORGE_RESTART_OPERATION".into(), operation.clone()));
    fixture.start("second");
    let restored = fixture.invoke("get_pty_buffer", json!({ "shellSessionKey": fixture.shell_key }));
    assert_eq!(restored["instanceId"], instance);
    assert_eq!(restored["isLive"], true);
    fixture.invoke("commit_app_restart", json!({ "operationId": operation }));
    fixture.invoke("commit_app_restart", json!({ "operationId": operation }));
    fixture.write("printf 'RESTORED=%s\\n' \"$kept\"\n");
    assert!(fixture.output("RESTORED=alive").contains("RESTORED=alive"));
    stop_sidecar(&mut fixture);
    let deadline = Instant::now() + Duration::from_secs(5);
    while fixture.root.path().join("session-v1/control.sock").exists() {
        assert!(Instant::now() < deadline, "normal Quit left the daemon running");
        std::thread::sleep(Duration::from_millis(20));
    }
    // SAFETY: signal zero does not modify the fixture process.
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0);
}
