use super::*;

use super::daemon_fixture::DaemonFixture;

#[tokio::test]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn exited_shell_recovers_final_output_after_sidecar_absence_without_respawn() {
    use base64::Engine;
    let fixture = DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-exit-ipc-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let key = "T-final-shell-0";
    let (mut first, _db) = test_state("daemon-exit-first");
    first.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable.clone(),
        key.into(),
    );
    let instance = invoke_ok(&first, "pty_spawn_shell", json!({"taskId":"T-final", "terminalIndex":0, "cwd":fixture.0.path(), "cols":80, "rows":24})).await;
    // The output marker does not occur literally in the echoed input.
    invoke_ok(&first, "pty_write", json!({"shellSessionKey":key, "data":"sleep 0.2; printf '\\106\\111\\116\\101\\114\\137\\117\\125\\124\\120\\125\\124\\n'; exit 7\n"})).await;
    drop(first);
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let (mut second, _db2) = test_state("daemon-exit-second");
    second.pty_manager.as_mut().unwrap().enable_daemon_shell(
        fixture.0.path().into(),
        executable,
        key.into(),
    );
    let deadline = tokio::time::Instant::now() + DAEMON_SHELL_CONTRACT_TIMEOUT;
    let replay = loop {
        let replay = invoke_ok(&second, "get_pty_buffer", json!({"shellSessionKey":key})).await;
        if replay["isLive"] == false {
            break replay;
        }
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    };
    assert_eq!(replay["instanceId"], instance);
    let data = replay["snapshot"]["data"].as_str().unwrap_or_default();
    let vt = base64::engine::general_purpose::STANDARD
        .decode(data)
        .unwrap();
    assert!(
        String::from_utf8_lossy(&vt).contains("FINAL_OUTPUT"),
        "exited session lost final portable output: {replay}"
    );
    let client = openforge_session_client::Client::connect(fixture.0.path()).unwrap();
    let inventory = client.inventory().unwrap();
    assert_eq!(inventory.sessions.len(), 1, "recovery must not respawn");
    assert_eq!(inventory.sessions[0].exit_code, Some(7));
    assert_eq!(json!(inventory.sessions[0].pty.instance), instance);
    drop(second);
}
