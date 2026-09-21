//! Real scoped caller migration; all processes and paths belong to this fixture.
use super::*;
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
#[cfg(target_os = "macos")]
#[ignore = "build the Session Daemon first; run with the session-daemon contract command"]
async fn scoped_agent_uses_daemon_but_is_interrupted_before_restart_handoff() {
    let fixture = super::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-scoped-owner-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates/session-daemon/target/debug/openforge-session-daemon");
    let bin = fixture.0.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let provider = bin.join("claude");
    std::fs::write(&provider, "#!/bin/sh\nprintf '%s\\n' \"$OPENFORGE_AGENT_CONFIG\" > scoped-receipt\nexec /bin/sleep 120\n").unwrap();
    std::fs::set_permissions(&provider, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut state, _db) = test_state("scoped-production-daemon");
    let manager = state.pty_manager.as_mut().unwrap();
    manager.enable_installation_daemon(fixture.0.path().into(), executable);
    manager.set_test_environment_variable("PATH", format!("{}:/usr/bin:/bin", bin.display()));
    manager.set_test_environment_variable("HOME", fixture.0.path().to_string_lossy());
    let key = format!("scoped-agent-v1-{}", "a".repeat(64));
    let credential = fixture.0.path().join("restricted.json");
    let observed = std::sync::Arc::new(std::sync::Mutex::new(None));
    let observer = observed.clone();
    let instance = manager
        .spawn_scoped_claude_pty(
            &key,
            "scoped-1",
            fixture.0.path(),
            "review",
            "provider-1",
            false,
            &fixture.0.path().join("settings.json"),
            "(version 1)(allow default)".into(),
            Some(credential.clone()),
            fixture.0.path().into(),
            crate::claude_launch_context::ClaudeLaunchContext::for_test(
                provider,
                std::collections::HashMap::from([
                    (
                        "PATH".to_string(),
                        format!("{}:/usr/bin:/bin", bin.display()),
                    ),
                    (
                        "HOME".to_string(),
                        fixture.0.path().to_string_lossy().into_owned(),
                    ),
                ]),
            ),
            80,
            24,
            crate::app_events::RuntimeEventPublisher::new(
                state.app.clone(),
                state.app_event_tx.clone(),
            ),
            std::sync::Arc::new(move |instance, success| {
                *observer.lock().unwrap() = Some((instance, success));
            }),
        )
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !fixture.0.path().join("scoped-receipt").exists() {
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(
        std::fs::read_to_string(fixture.0.path().join("scoped-receipt"))
            .unwrap()
            .trim(),
        credential.to_str().unwrap()
    );
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    if inventory["hasLegacySessions"] == true {
        state
            .pty_manager
            .as_ref()
            .unwrap()
            .kill_pty(&key)
            .await
            .unwrap();
    }
    assert_eq!(
        inventory["hasLegacySessions"], false,
        "scoped process still belongs to the Sidecar"
    );
    let operation = uuid::Uuid::new_v4().to_string();
    invoke_ok(
        &state,
        "prepare_app_restart",
        json!({"operationId": operation, "intent": "restart"}),
    )
    .await;
    while observed.lock().unwrap().is_none() {
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(*observed.lock().unwrap(), Some((instance, false)));
    let inventory = invoke_ok(&state, "get_restart_terminal_inventory", json!({})).await;
    assert!(!inventory["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|session| session["key"] == key));
}
