use super::*;

#[tokio::test]
async fn accepts_remaining_electron_cutover_ipc_commands() {
    let (state, _temp_dir) = test_state("app_invoke_electron_cutover_remaining_ipc");
    let (project_id, task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("IPC Parity Project", "/tmp/openforge-ipc-parity")
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "claude-code")
            .expect("set provider");
        let task = db
            .create_task("ipc parity", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "session-ipc-parity",
            &task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create session");
        (project.id, task.id)
    };

    let requests = [
        ("check_opencode_installed", serde_json::Value::Null),
        ("check_pi_installed", serde_json::Value::Null),
        ("check_codex_installed", serde_json::Value::Null),
        ("check_claude_installed", serde_json::Value::Null),
        ("get_worktree_for_task", json!({ "taskId": task_id })),
        (
            "abort_session",
            json!({ "sessionId": "session-ipc-parity" }),
        ),
        ("list_opencode_commands", json!({ "projectId": project_id })),
        (
            "search_opencode_files",
            json!({ "projectId": project_id, "query": "README" }),
        ),
        ("list_opencode_agents", json!({ "projectId": project_id })),
        ("list_opencode_models", json!({ "projectId": project_id })),
    ];

    for (command, payload) in requests {
        let result = invoke(&state, command, payload).await;
        assert_ne!(
            result.as_ref().err().map(|err| err.0),
            Some(StatusCode::NOT_IMPLEMENTED),
            "{command} should be routed by app_invoke after Electron cutover"
        );
    }

    let legacy_output_result = invoke(
        &state,
        "get_session_output",
        json!({ "taskId": "missing-task" }),
    )
    .await;
    assert_eq!(
        legacy_output_result.err().map(|err| err.0),
        Some(StatusCode::NOT_IMPLEMENTED),
        "legacy OpenCode REST session output recovery should not be routed after direct TTY migration"
    );

    for command in [
        "list_opencode_skills",
        "save_skill_content",
        // Personal-skill editing moved to the external com.openforge.injectables
        // plugin, which writes skill files from its own backend.
        "claude_skill_write",
        "claude_skill_delete",
    ] {
        let result = invoke(&state, command, json!({ "projectId": project_id })).await;
        assert_eq!(
            result.err().map(|err| err.0),
            Some(StatusCode::NOT_IMPLEMENTED),
            "retired core skill command {command} should not be routed after plugin migration"
        );
    }
}

#[tokio::test]
async fn force_github_sync_uses_sidecar_managed_client_state() {
    let (state, _temp_dir) = test_state("app_invoke_force_github_sync");

    let body = invoke_ok(&state, "force_github_sync", serde_json::Value::Null).await;
    assert_eq!(body["new_comments"], 0);
    assert_eq!(body["ci_changes"], 0);
    assert_eq!(body["review_changes"], 0);
    assert_eq!(body["pr_changes"], 0);
    assert_eq!(body["errors"], 0);
    assert_eq!(body["rate_limited"], false);
    assert_eq!(body["rate_limit_reset_at"], serde_json::Value::Null);
    assert_eq!(body["outcome"], "missing_github_token");
}
