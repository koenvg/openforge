use super::*;

#[tokio::test]
async fn handles_config_projects_tasks_and_unmatched_commands() {
    let (state, _temp_dir) = test_state("app_invoke_config_projects_tasks");

    invoke_ok(
        &state,
        "set_config",
        json!({ "key": "theme", "value": "dark" }),
    )
    .await;
    assert_eq!(
        invoke_ok(&state, "get_config", json!({ "key": "theme" })).await,
        "dark"
    );

    invoke_ok(
        &state,
        "set_config",
        json!({
            "key": crate::pty_manager::GHOSTTY_TERMINAL_DIAGNOSTICS_CONFIG,
            "value": "true",
        }),
    )
    .await;
    assert!(state
        .pty_manager
        .as_ref()
        .expect("PTY manager")
        .terminal_diagnostics_enabled());

    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge" }),
    )
    .await;
    assert_eq!(project["name"], "Open Forge");
    let project_id = project["id"].as_str().expect("project id");
    {
        let db = crate::db::acquire_db(&state.db);
        db.set_config("ai_provider", "codex")
            .expect("set global provider");
    }
    assert_eq!(
        invoke_ok(
            &state,
            "resolve_ai_provider",
            json!({ "projectId": project_id })
        )
        .await,
        "codex"
    );

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Plan migration",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
            "worktreeSource": "existingBranch",
            "worktreeBranch": "feature/open-pr",
        }),
    )
    .await;
    assert_eq!(task["initial_prompt"], "Plan migration");
    assert_eq!(task["agent"], serde_json::Value::Null);
    assert_eq!(task["worktree_source"], "existingBranch");
    assert_eq!(task["worktree_branch"], "feature/open-pr");
    let task_id = task["id"].as_str().expect("task id");

    let tasks = invoke_ok(&state, "get_tasks", serde_json::Value::Null).await;
    assert_eq!(tasks.as_array().expect("tasks").len(), 1);

    let attention = invoke_ok(&state, "get_project_attention", serde_json::Value::Null).await;
    assert_eq!(attention.as_array().expect("attention rows").len(), 0);
    assert_eq!(
        invoke_ok(&state, "get_app_mode", serde_json::Value::Null).await,
        "dev"
    );
    invoke_ok(&state, "get_git_branch", serde_json::Value::Null).await;
    assert!(
        invoke_ok(&state, "get_latest_session", json!({ "taskId": task_id }))
            .await
            .is_null()
    );
    assert_eq!(
        invoke_ok(
            &state,
            "get_latest_sessions",
            json!({ "taskIds": [task_id] })
        )
        .await
        .as_array()
        .expect("latest sessions")
        .len(),
        0
    );

    invoke_ok(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "doing" }),
    )
    .await;
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_task(task_id)
            .expect("get updated task")
            .expect("updated task exists")
            .status,
        "doing"
    );

    let task_attention = invoke_ok(&state, "get_task_attention", serde_json::Value::Null).await;
    let task_attention_rows = task_attention.as_array().expect("task attention rows");
    assert_eq!(task_attention_rows.len(), 1);
    assert_eq!(task_attention_rows[0]["task_id"], task_id);
    assert_eq!(task_attention_rows[0]["project_id"], project_id);
    assert_eq!(task_attention_rows[0]["title"], "Plan migration");
    assert_eq!(task_attention_rows[0]["state"], "idle");
    assert_eq!(
        task_attention_rows[0]["reason"],
        "No agent running. Start when ready."
    );

    // Nothing is parked yet, so the set-aside lane is empty while that same Task sits in
    // the attention projection above.
    assert_eq!(
        invoke_ok(&state, "get_set_aside_tasks", serde_json::Value::Null)
            .await
            .as_array()
            .expect("set-aside rows")
            .len(),
        0
    );

    invoke_ok(
        &state,
        "set_project_config",
        json!({
            "projectId": project_id,
            "key": "low_fire_task_ids",
            "value": format!("[\"{task_id}\"]"),
        }),
    )
    .await;

    let set_aside = invoke_ok(&state, "get_set_aside_tasks", serde_json::Value::Null).await;
    let set_aside_rows = set_aside.as_array().expect("set-aside rows");
    assert_eq!(set_aside_rows.len(), 1);
    assert_eq!(set_aside_rows[0]["task_id"], task_id);
    assert_eq!(set_aside_rows[0]["project_id"], project_id);
    assert_eq!(set_aside_rows[0]["title"], "Plan migration");
    // Parking the Task also drops it out of the attention projection.
    assert_eq!(
        invoke_ok(&state, "get_task_attention", serde_json::Value::Null)
            .await
            .as_array()
            .expect("task attention rows")
            .len(),
        0
    );

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;
    let completed = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get completed task")
        .expect("completed task record should remain");
    assert_eq!(completed.status, "done");

    invoke_ok(&state, "delete_project", json!({ "id": project_id })).await;

    let unsupported = invoke(
        &state,
        "unsupported_desktop_command",
        serde_json::Value::Null,
    )
    .await
    .expect_err("unsupported command should be rejected");
    assert_eq!(unsupported.0, StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn rejects_legacy_coordinate_only_pull_request_commands() {
    let (state, _temp_dir) = test_state("app_invoke_legacy_pull_request_commands");

    for command in ["merge_pull_request", "enqueue_pull_request"] {
        let error = invoke(
            &state,
            command,
            json!({ "owner": "openforge", "repo": "openforge", "prNumber": 42 }),
        )
        .await
        .expect_err("legacy pull request command should be rejected");
        assert_eq!(error.0, StatusCode::NOT_IMPLEMENTED);
    }
}

#[tokio::test]
async fn create_task_dependency_domain_errors_keep_the_existing_bad_request_contract() {
    let (state, _temp_dir) = test_state("app_invoke_create_task_dependency_error");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Dependency Project", "path": "/tmp/dependency-project" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");

    let error = invoke(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Blocked task",
            "status": "backlog",
            "projectId": project_id,
            "dependsOn": ["T-404"],
        }),
    )
    .await
    .expect_err("missing dependency should fail");

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        error.1,
        "Failed to set task dependencies: dependency task T-404 does not exist"
    );
    assert!(crate::db::acquire_db(&state.db)
        .get_all_tasks()
        .expect("list tasks")
        .is_empty());
}

#[tokio::test]
async fn delete_project_conflicts_with_an_in_progress_task_start() {
    let (state, _temp_dir) = test_state("app_invoke_delete_project_claim");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Claimed Project", "path": "/tmp/claimed-project" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");
    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Claimed task",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("task id");
    let _start_claim = state
        .task_claims
        .try_claim(
            task_id,
            crate::task_claims::TaskOperation::StartImplementation,
        )
        .expect("claim task start");

    let error = invoke(&state, "delete_project", json!({ "id": project_id }))
        .await
        .expect_err("project deletion should conflict with task start");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(crate::db::acquire_db(&state.db)
        .get_project(project_id)
        .expect("get project")
        .is_some());
    assert!(crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get task")
        .is_some());
}

#[tokio::test]
async fn app_invoke_updates_only_never_started_initial_prompts() {
    let (state, _temp_dir) = test_state("app_invoke_initial_prompt_lifecycle_guard");
    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Original prompt",
            "status": "backlog",
            "projectId": null,
            "permissionMode": null,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("task id");

    invoke_ok(
        &state,
        "update_task",
        json!({ "id": task_id, "initialPrompt": "Updated prompt" }),
    )
    .await;
    let updated = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get updated task")
        .expect("task exists");
    assert_eq!(updated.initial_prompt, "Updated prompt");
    assert_eq!(updated.prompt.as_deref(), Some("Updated prompt"));
    drop(updated);

    invoke_ok(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "doing" }),
    )
    .await;
    let error = invoke(
        &state,
        "update_task",
        json!({ "id": task_id, "initialPrompt": "Too late" }),
    )
    .await
    .expect_err("started task prompt update should fail");
    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("replacement task"));

    let unchanged = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get unchanged task")
        .expect("task exists");
    assert_eq!(unchanged.initial_prompt, "Updated prompt");
    assert_eq!(unchanged.prompt.as_deref(), Some("Updated prompt"));
}

#[tokio::test]
async fn app_invoke_update_task_source_ticket_url_sets_and_clears() {
    let (state, _temp_dir) = test_state("app_invoke_update_source_ticket_url");
    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "No ticket at creation",
            "status": "doing",
            "projectId": null,
            "permissionMode": null,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("task id");

    // Add a link after the fact via the camelCase command payload.
    invoke_ok(
        &state,
        "update_task_source_ticket_url",
        json!({ "id": task_id, "sourceTicketUrl": "https://github.com/koenvg/openforge/issues/1294" }),
    )
    .await;
    let set = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(
        set.source_ticket_url.as_deref(),
        Some("https://github.com/koenvg/openforge/issues/1294")
    );
    drop(set);

    // Clearing with an explicit null reverts to no ticket.
    invoke_ok(
        &state,
        "update_task_source_ticket_url",
        json!({ "id": task_id, "sourceTicketUrl": null }),
    )
    .await;
    let cleared = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(cleared.source_ticket_url, None);
}

#[tokio::test]
async fn app_invoke_delete_task_permanently_removes_record_and_worktree_metadata() {
    let (state, _temp_dir) = test_state("app_invoke_delete_task_permanent");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge-complete" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");
    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Delete this backlog task",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("task id").to_string();
    {
        let db = crate::db::acquire_db(&state.db);
        db.create_worktree_record(
            &task_id,
            project_id,
            "/tmp/openforge-complete",
            "/tmp/openforge-complete/.worktrees/T-1",
            "openforge/T-1",
        )
        .expect("create worktree metadata");
        assert!(db
            .get_worktree_for_task(&task_id)
            .expect("get worktree")
            .is_some());
    }

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;

    {
        let db = crate::db::acquire_db(&state.db);
        assert!(
            db.get_task(&task_id).expect("get deleted task").is_none(),
            "backlog Delete must not retain Completed Task reference data",
        );
        assert!(db
            .get_worktree_for_task(&task_id)
            .expect("get worktree")
            .is_none());
        assert!(db
            .get_tasks_for_project_excluding_state(project_id, "done")
            .expect("get normal board tasks")
            .is_empty());
        assert!(db
            .get_tasks_for_project_by_state(project_id, "done")
            .expect("get completed tasks")
            .is_empty());
    }
    let visible_tasks = invoke_ok(
        &state,
        "get_tasks_for_project",
        json!({ "projectId": project_id }),
    )
    .await;
    assert_eq!(visible_tasks.as_array().expect("visible tasks").len(), 0);

    // Permanent deletion stays absent even when completed Tasks are requested.
    let all_tasks = invoke_ok(
        &state,
        "get_tasks_for_project",
        json!({ "projectId": project_id, "includeDone": true }),
    )
    .await;
    assert!(all_tasks.as_array().expect("all tasks").is_empty());

    // includeDone: false is explicitly the active-only default.
    let active_tasks = invoke_ok(
        &state,
        "get_tasks_for_project",
        json!({ "projectId": project_id, "includeDone": false }),
    )
    .await;
    assert_eq!(active_tasks.as_array().expect("active tasks").len(), 0);
}

#[tokio::test]
async fn app_invoke_delete_task_rejects_missing_task() {
    let (state, _temp_dir) = test_state("app_invoke_delete_missing_task");

    let error = invoke(&state, "delete_task", json!({ "id": "T-missing" }))
        .await
        .expect_err("a missing task must be rejected");

    assert_eq!(error.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn app_invoke_delete_task_rejects_completed_task_as_stale() {
    let (state, _temp_dir) = test_state("app_invoke_delete_completed_task");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        db.create_task("Already complete", "done", None, None, None)
            .expect("create completed task")
            .id
    };

    let error = invoke(&state, "delete_task", json!({ "id": task_id }))
        .await
        .expect_err("a stale completion must be rejected");

    assert_eq!(error.0, StatusCode::CONFLICT);
}
#[tokio::test]
async fn app_invoke_create_task_uses_project_worktree_default_when_source_omitted() {
    let (state, _temp_dir) = test_state("app_invoke_create_task_project_worktree_default");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge-default" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");
    {
        let db = crate::db::acquire_db(&state.db);
        db.set_project_config(project_id, "use_worktrees", "false")
            .expect("set worktree default");
    }

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Plan without worktree",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
        }),
    )
    .await;

    assert_eq!(task["worktree_source"], "disabled");
    assert_eq!(task["worktree_branch"], serde_json::Value::Null);
}

#[tokio::test]
async fn task_label_commands_round_trip_labels_on_tasks() {
    let (state, _temp_dir) = test_state("app_invoke_task_labels");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge-labels" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Label me",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
            "labelNames": ["Bug", "bug"]
        }),
    )
    .await;
    assert_eq!(task["labels"].as_array().expect("labels").len(), 1);
    assert_eq!(task["labels"][0]["name"], "Bug");
    let task_id = task["id"].as_str().expect("task id");

    let label = invoke_ok(
        &state,
        "add_task_label",
        json!({ "taskId": task_id, "name": "ui" }),
    )
    .await;
    assert_eq!(label["name"], "ui");

    let labels = invoke_ok(
        &state,
        "get_project_task_labels",
        json!({ "projectId": project_id }),
    )
    .await;
    assert_eq!(labels.as_array().expect("project labels").len(), 2);

    invoke_ok(
        &state,
        "remove_task_label",
        json!({ "taskId": task_id, "labelId": label["id"].as_i64().expect("label id") }),
    )
    .await;
    let updated = invoke_ok(&state, "get_task_detail", json!({ "taskId": task_id })).await;
    assert_eq!(
        updated["labels"].as_array().expect("updated labels").len(),
        1
    );

    invoke_ok(
        &state,
        "add_task_label",
        json!({ "taskId": task_id, "name": "ui" }),
    )
    .await;
    invoke_ok(
        &state,
        "delete_task_label",
        json!({ "labelId": label["id"].as_i64().expect("label id") }),
    )
    .await;
    let labels_after_delete = invoke_ok(
        &state,
        "get_project_task_labels",
        json!({ "projectId": project_id }),
    )
    .await;
    let labels_after_delete = labels_after_delete.as_array().expect("labels after delete");
    assert_eq!(labels_after_delete.len(), 1);
    assert_eq!(labels_after_delete[0]["name"], "Bug");
    let updated = invoke_ok(&state, "get_task_detail", json!({ "taskId": task_id })).await;
    assert_eq!(
        updated["labels"].as_array().expect("updated labels").len(),
        1
    );
}

#[tokio::test]
async fn update_task_status_rejects_done_and_leaves_status_unchanged() {
    let (state, _temp_dir) = test_state("app_invoke_reject_done_status");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge-reject-done" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Guard done",
            "status": "doing",
            "projectId": project_id,
            "permissionMode": null,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("task id");

    // 'done' is a legacy, recognized-but-unreachable status (AVIV-118). Assigning
    // it would hide the task from every board surface with no reopen path or
    // runtime cleanup, so the write boundary must reject it.
    let rejected = invoke(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "done" }),
    )
    .await
    .expect_err("update to 'done' should be rejected");
    assert_eq!(rejected.0, StatusCode::BAD_REQUEST);

    // The task must remain in its prior, board-visible status.
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .status,
        "doing"
    );
}

async fn task_workspace_value(
    task_id: &str,
    state: &crate::http_server::AppState,
) -> serde_json::Value {
    invoke_ok(state, "get_task_workspace", json!({ "taskId": task_id })).await
}

#[tokio::test]
async fn task_workspace_legacy_worktree_fallback_carries_workspace_data_only() {
    let (state, _temp_dir) = test_state("app_invoke_task_workspace_legacy_fallback");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let project = db
            .create_project("Open Forge", "/tmp/openforge")
            .expect("create project");
        let task = db
            .create_task(
                "Legacy worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/openforge",
            "/tmp/openforge-worktree",
            "feature/electron",
        )
        .expect("create worktree");
        db.create_agent_session(
            "ses-legacy",
            &task.id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("create session");
        task.id
    };

    let workspace = task_workspace_value(&task_id, &state).await;
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(workspace["workspace_path"], "/tmp/openforge-worktree");
    assert_eq!(workspace["provider_name"], "opencode");
    assert_eq!(workspace.get("opencode_port"), None);
    assert_eq!(workspace["kind"], "git_worktree");
    assert_eq!(workspace["branch_name"], "feature/electron");
}

#[tokio::test]
async fn task_workspace_prefers_task_workspace_over_legacy_worktree() {
    let (state, _temp_dir) = test_state("app_invoke_task_workspace_prefers_new_model");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let project = db
            .create_project("Open Forge", "/tmp/openforge")
            .expect("create project");
        let task = db
            .create_task(
                "Task workspace task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/openforge",
            "/tmp/legacy-worktree",
            "feature/legacy",
        )
        .expect("create worktree");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/task-workspace",
            "/tmp/openforge",
            "repository",
            None,
            "pi",
        )
        .expect("create task workspace");
        task.id
    };

    let workspace = task_workspace_value(&task_id, &state).await;
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(workspace["workspace_path"], "/tmp/task-workspace");
    assert_eq!(workspace["provider_name"], "pi");
    assert_eq!(workspace["kind"], "repository");
    assert_eq!(workspace["branch_name"], serde_json::Value::Null);
}

#[tokio::test]
async fn lists_and_acknowledges_plugin_browser_session_purge_intents() {
    let (state, _temp_dir) = test_state("app_invoke_browser_session_purges");
    {
        let db = crate::db::acquire_db(&state.db);
        db.install_plugin(&crate::db::PluginRow {
            id: "com.example.browser".to_string(),
            name: "Browser".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: String::new(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "index.js".to_string(),
            backend_entry: None,
            install_path: "/tmp/browser".to_string(),
            source_kind: "local".to_string(),
            source_spec: "/tmp/browser".to_string(),
            package_metadata: "{}".to_string(),
            installed_at: 1,
            is_builtin: false,
        })
        .expect("install plugin");
        db.uninstall_plugin("com.example.browser")
            .expect("uninstall plugin");
    }

    let intents = invoke_ok(
        &state,
        "list_browser_session_purge_intents",
        serde_json::Value::Null,
    )
    .await;
    let intent = &intents.as_array().expect("purge intents")[0];
    assert_eq!(intent["scope"], "plugin");
    assert_eq!(intent["ownerId"], "com.example.browser");

    invoke_ok(
        &state,
        "acknowledge_browser_session_purge_intent",
        json!({ "intentId": intent["id"] }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "list_browser_session_purge_intents",
            serde_json::Value::Null,
        )
        .await,
        json!([]),
    );
}

#[tokio::test]
async fn board_shaping_task_mutations_publish_project_scoped_invalidations() {
    let (state, _temp_dir) = test_state("app_invoke_task_board_invalidations");
    let project = crate::db::acquire_db(&state.db)
        .create_project("OpenForge", "/tmp/openforge")
        .expect("create Project");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Initial prompt",
            "status": "backlog",
            "projectId": project.id,
        }),
    )
    .await;
    let task_id = task["id"].as_str().expect("Task id");
    for (command, payload) in [
        (
            "update_task",
            json!({ "id": task_id, "initialPrompt": "Updated prompt" }),
        ),
        (
            "update_task_title",
            json!({ "id": task_id, "title": "Updated title" }),
        ),
    ] {
        let event = events.try_recv().expect("Task invalidation");
        assert_eq!(event.event_name, "task-changed");
        assert_eq!(event.payload["task_id"], task_id);
        assert_eq!(event.payload["project_id"], project.id);
        invoke_ok(&state, command, payload).await;
    }
    let event = events.try_recv().expect("final Task invalidation");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project.id);
}
