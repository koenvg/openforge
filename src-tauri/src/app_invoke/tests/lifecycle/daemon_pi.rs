use super::{support::*, *};

#[tokio::test]
#[ignore = "requires built Session Daemon"]
async fn pi_start_uses_daemon_ownership_through_existing_agent_interface() {
    let daemon = crate::app_invoke::tests::daemon_fixture::DaemonFixture(
        tempfile::Builder::new()
            .prefix("of-pi-")
            .tempdir_in("/tmp")
            .unwrap(),
    );
    let mut fixture = ProviderLifecycleFixture::new("daemon-pi-start").await;
    let (_temp, repo) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&fixture.state().db);
        let project = db
            .create_project("Daemon Pi", repo.to_str().unwrap())
            .unwrap();
        db.set_project_config(&project.id, "ai_provider", "pi")
            .unwrap();
        db.create_task_with_worktree_source(
            "Keep this Pi alive",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .unwrap()
        .id
    };
    fixture
        .state_mut()
        .pty_manager
        .as_mut()
        .unwrap()
        .enable_daemon_pi(
            daemon.0.path().into(),
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("crates/session-daemon/target/debug/openforge-session-daemon"),
            task_id.clone(),
        );
    let started = invoke_ok(
        fixture.state(),
        "start_implementation",
        json!({
            "taskId": task_id, "repoPath": repo,
        }),
    )
    .await;
    assert!(started["session_id"].is_string());
    wait_for_provider_log_record(fixture.log_path(), "pi", "Keep this Pi alive").await;
    let inventory = invoke_ok(fixture.state(), "get_restart_terminal_inventory", json!({})).await;
    let old_manager = fixture.state().pty_manager.as_ref().unwrap().clone();
    let instance = inventory["sessions"][0]["instanceId"].as_u64().unwrap();
    let pid = old_manager
        .agent_pty_pid(&task_id, Some(instance))
        .await
        .expect("daemon Pi PID");
    let mut replacement = crate::pty_manager::PtyManager::new();
    replacement.enable_daemon_pi(
        daemon.0.path().into(),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("crates/session-daemon/target/debug/openforge-session-daemon"),
        task_id.clone(),
    );
    fixture.state_mut().pty_manager = Some(replacement);
    let recovered = invoke_ok(
        fixture.state(),
        "get_pty_buffer",
        json!({"shellSessionKey": task_id}),
    )
    .await;
    assert_eq!(recovered["instanceId"], instance);
    assert_eq!(recovered["isLive"], true);
    assert!(old_manager.write_pty(&task_id, b"stale").await.is_err());
    assert_eq!(
        fixture
            .state()
            .pty_manager
            .as_ref()
            .unwrap()
            .agent_pty_pid(&task_id, Some(instance))
            .await,
        Some(pid)
    );
    assert_eq!(
        fixture
            .state()
            .pty_manager
            .as_ref()
            .unwrap()
            .agent_pty_pid(&task_id, Some(instance + 1))
            .await,
        None
    );
    // History recovery must not require the old cwd to remain at its launch path.
    std::fs::rename(&repo, daemon.0.path().join("moved-workspace")).unwrap();
    {
        let db = crate::db::acquire_db(&fixture.state().db);
        db.create_agent_session("stale-pi", &task_id, None, "implementing", "running", "pi")
            .unwrap();
        db.set_agent_session_pty_instance_id("stale-pi", instance + 1)
            .unwrap();
        db.lock_conn()
            .unwrap()
            .execute(
                "UPDATE agent_sessions SET created_at=0 WHERE id='stale-pi'",
                [],
            )
            .unwrap();
        db.lock_conn()
            .unwrap()
            .execute(
                "UPDATE agent_sessions SET updated_at=1 WHERE ticket_id=?1",
                [&task_id],
            )
            .unwrap();
    }
    let app = crate::backend_runtime::AppHandle::new();
    app.manage(fixture.state().db.clone());
    app.manage(fixture.state().pty_manager.as_ref().unwrap().clone());
    let readiness = crate::http_server::SidecarReadinessState::new();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    ready_tx.send(()).unwrap();
    crate::startup_resume::resume_task_sessions(app, ready_rx, readiness, 2).await;
    let restored = invoke_ok(
        fixture.state(),
        "get_latest_session",
        json!({"taskId": task_id}),
    )
    .await;
    assert_eq!(
        restored["status"], "running",
        "live inventory must precede history recovery"
    );
    assert_eq!(restored["pty_instance_id"], instance);
    let stale = invoke_ok(
        fixture.state(),
        "get_session_status",
        json!({"sessionId":"stale-pi"}),
    )
    .await;
    assert_eq!(
        stale["status"], "interrupted",
        "only the surviving allocation may remain running"
    );
    let manager = fixture.state().pty_manager.as_ref().unwrap();
    let buffer = manager.pty_buffer_state(&task_id).await;
    use base64::Engine;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let output = loop {
        let buffer = manager.pty_buffer_state(&task_id).await;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(buffer.snapshot.unwrap().compatibility_data)
            .unwrap();
        let output = String::from_utf8_lossy(&bytes).into_owned();
        if output.contains("pty-instance=") {
            break output;
        }
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    };
    assert!(
        output.contains(&format!("pty-instance={}", buffer.instance_id.unwrap())),
        "{output}"
    );
    assert!(
        manager
            .get_pty_buffer(&task_id)
            .await
            .unwrap_or_default()
            .contains("pty-instance="),
        "completion replay capture must read daemon output"
    );
    manager.write_pty(&task_id, b"still-here").await.unwrap();
    manager.resize_pty(&task_id, 92, 31).await.unwrap();
    manager.kill_pty(&task_id).await.unwrap();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while manager.pty_buffer_state(&task_id).await.is_live {
        assert!(
            tokio::time::Instant::now() < deadline,
            "scoped stop must reach Pi in the daemon"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(
        buffer.is_live,
        "agent lifecycle reads must reach the daemon"
    );
    assert_eq!(
        buffer.instance_id,
        inventory["sessions"][0]["instanceId"].as_u64()
    );
    assert_eq!(
        inventory["sessions"].as_array().unwrap().len(),
        1,
        "Pi must be owned by the daemon, not the Sidecar"
    );
    assert_eq!(inventory["sessions"][0]["key"], task_id);
    assert_eq!(inventory["sessions"][0]["isLive"], true);
}
