use super::{support::*, *};
use std::{fs, path::Path, time::Duration};

#[test]
fn provider_log_requires_prompt_in_completed_invocation_record() {
    let incomplete_record = "provider=codex\ncwd=/repo\narg1=Start through Codex provider\n";
    assert!(!provider_log_has_complete_record(
        incomplete_record,
        "codex",
        "Start through Codex provider"
    ));

    let complete_record = format!("{incomplete_record}{PROVIDER_RECORD_COMPLETE}\n");
    assert!(provider_log_has_complete_record(
        &complete_record,
        "codex",
        "Start through Codex provider"
    ));
}

#[tokio::test]
async fn start_implementation_starts_configured_pi_provider_through_app_invoke_boundary() {
    let fixture = ProviderLifecycleFixture::new("app_invoke_start_pi_provider_boundary").await;
    let state = fixture.state();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Pi Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start through Pi provider",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(response["task_id"], task_id);
    assert!(response["session_id"]
        .as_str()
        .is_some_and(|session_id| !session_id.is_empty()));
    assert_eq!(
        response["workspace_path"],
        repo_dir.to_string_lossy().as_ref()
    );
    assert_eq!(response["port"], 0);

    let log =
        wait_for_provider_log_record(fixture.log_path(), "pi", "Start through Pi provider").await;
    assert!(log.contains("provider=pi"), "got provider log: {log}");
    let canonical_repo_dir = fs::canonicalize(&repo_dir).expect("repo dir should canonicalize");
    assert!(
        log.contains(&format!("cwd={}", canonical_repo_dir.display())),
        "got provider log: {log}"
    );
    assert!(
        log.contains("Start through Pi provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .get_task(&task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "doing");
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .expect("get latest session")
            .expect("session should be recorded");
        assert_eq!(session.provider, "pi");
        assert_eq!(session.status, "running");
        assert!(session.pty_instance_id.is_some());
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get task workspace")
            .expect("workspace should be recorded");
        assert_eq!(workspace.provider_name, "pi");
        assert_eq!(workspace.kind, "project_dir");
        assert_eq!(workspace.status, "active");
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_uses_authoritative_project_path_and_publishes_canonical_event() {
    let fixture =
        ProviderLifecycleFixture::new("app_invoke_start_authoritative_project_path").await;
    let state = fixture.state();
    let (_project_temp, project_repo_dir) = provider_repo_dir();
    let (_spoofed_temp, spoofed_repo_dir) = provider_repo_dir();
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Authoritative Project",
                project_repo_dir.to_str().expect("utf8 project repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start from authoritative project state",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": spoofed_repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(
        response["workspace_path"],
        project_repo_dir.to_string_lossy().as_ref()
    );
    let log = wait_for_provider_log_record(
        fixture.log_path(),
        "pi",
        "Start from authoritative project state",
    )
    .await;
    let canonical_project_repo =
        fs::canonicalize(&project_repo_dir).expect("project repo should canonicalize");
    assert!(
        log.contains(&format!("cwd={}", canonical_project_repo.display())),
        "provider must launch from the Project path saved in the database, got: {log}"
    );
    let event = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let event = events.recv().await.expect("task event should be readable");
            if event.event_name == "task-changed" {
                break event;
            }
        }
    })
    .await
    .expect("task event should arrive");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["action"], "updated");
    assert_eq!(event.payload["task_id"], task_id);

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_rejects_stale_non_backlog_task_state() {
    let fixture = ProviderLifecycleFixture::new("app_invoke_start_rejects_stale_state").await;
    let state = fixture.state();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Stale State Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Do not start stale state",
            "doing",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let error = invoke(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await
    .expect_err("only backlog Tasks may start an Implementation Run");

    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("backlog"), "got: {}", error.1);
    assert!(
        fs::read_to_string(fixture.log_path())
            .ok()
            .is_none_or(|log| !log.contains("Do not start stale state")),
        "provider must not launch for stale Task state"
    );
}

#[tokio::test]
async fn start_implementation_injects_plugin_configured_review_workflow() {
    let fixture = ProviderLifecycleFixture::new("app_invoke_start_plugin_review_workflow").await;
    let state = fixture.state();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Plugin Review Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        let contribution = crate::agent_lifecycle::StartPromptContribution {
            owner_plugin_id: None,
            id: "plugin-review-workflow".to_string(),
            enabled: true,
            content: "<plugin_review>Task {{taskId}}\n## Plugin Template\n- Preserve plugin-owned reviewer brief</plugin_review>".to_string(),
            order: 0,
        };
        db.set_project_config(
            &project.id,
            crate::agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            &serde_json::to_string(&vec![contribution]).expect("serialize contribution"),
        )
        .expect("set start prompt contribution");
        db.create_task_with_worktree_source(
            "Start with plugin prompt contribution",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(response["task_id"], task_id);
    let log = wait_for_provider_log_record(
        fixture.log_path(),
        "pi",
        "Start with plugin prompt contribution",
    )
    .await;
    assert!(
        log.contains("<openforge_start_prompt_contribution id=\"plugin-review-workflow\">")
            && log.contains("Task "),
        "plugin start prompt contribution should be injected, got provider log: {log}"
    );
    assert!(
        log.contains("## Plugin Template"),
        "got provider log: {log}"
    );
    assert!(
        log.contains("Preserve plugin-owned reviewer brief"),
        "got provider log: {log}"
    );

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_materializes_pasted_image_references_for_provider_prompt() {
    let fixture = ProviderLifecycleFixture::with_backend_app(
        "app_invoke_start_materializes_image_references",
    )
    .await;
    let state = fixture.state();
    let app_dir = fixture.app_dir();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Image Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Inspect [image#1]\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let log = wait_for_provider_log_record(fixture.log_path(), "pi", "Inspect [image#1]").await;
    assert!(log.contains("provider=pi"), "got provider log: {log}");
    assert!(
        !log.contains("data:image/png;base64"),
        "provider prompt should not include raw data URI, got provider log: {log}"
    );

    let image_path = app_dir
        .path()
        .join("task-image-attachments")
        .join(&task_id)
        .join("image-1.png");
    assert_eq!(
        fs::read(&image_path).expect("materialized image file"),
        b"image-bytes"
    );
    assert!(
        log.contains(image_path.to_string_lossy().as_ref()),
        "provider prompt should include materialized file path, got provider log: {log}"
    );

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_passes_task_agent_to_configured_opencode_provider() {
    let fixture = ProviderLifecycleFixture::new("app_invoke_start_opencode_agent_boundary").await;
    let state = fixture.state();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "OpenCode Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set provider");
        let task = db
            .create_task_with_worktree_source(
                "Start through OpenCode provider",
                "backlog",
                Some(&project.id),
                None,
                None,
                crate::db::TaskWorktreeOptions {
                    source: Some("disabled"),
                    branch: None,
                },
            )
            .expect("create task");
        let conn = db.connection();
        conn.lock()
            .expect("lock connection")
            .execute(
                "UPDATE tasks SET agent = ?1 WHERE id = ?2",
                rusqlite::params!["rust-specialist", &task.id],
            )
            .expect("set task agent");
        task.id
    };

    let mut provider_events = state
        .app_event_tx
        .as_ref()
        .expect("provider event sender")
        .subscribe();

    invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let log =
        read_provider_log_after_ready(&mut provider_events, &task_id, fixture.log_path()).await;
    assert!(log.contains("provider=opencode"), "got provider log: {log}");
    assert!(log.contains("arg1=--agent"), "got provider log: {log}");
    assert!(
        log.contains("arg2=rust-specialist"),
        "got provider log: {log}"
    );
    assert!(log.contains("--prompt"), "got provider log: {log}");
    assert!(
        log.contains("Start through OpenCode provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .expect("get latest session")
            .expect("session should be recorded");
        assert_eq!(session.provider, "opencode");
        assert_eq!(session.status, "running");
        assert!(session.pty_instance_id.is_some());
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_starts_configured_codex_provider_through_app_invoke_boundary() {
    let fixture = ProviderLifecycleFixture::new("app_invoke_start_codex_provider_boundary").await;
    let state = fixture.state();
    let (_temp, repo_dir) = provider_repo_dir();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Codex Provider Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "codex")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start through Codex provider",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let mut provider_events = state
        .app_event_tx
        .as_ref()
        .expect("provider event sender")
        .subscribe();

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    assert_eq!(response["task_id"], task_id);
    assert_eq!(
        response["workspace_path"],
        repo_dir.to_string_lossy().as_ref()
    );
    assert_eq!(response["port"], 0);

    let log =
        read_provider_log_after_ready(&mut provider_events, &task_id, fixture.log_path()).await;
    assert!(log.contains("provider=codex"), "got provider log: {log}");
    assert!(
        log.contains("Start through Codex provider"),
        "prompt should cross the provider boundary, got provider log: {log}"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .expect("get latest session")
            .expect("session should be recorded");
        assert_eq!(session.provider, "codex");
        assert_eq!(session.status, "running");
        assert!(session.pty_instance_id.is_some());
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get task workspace")
            .expect("workspace should be recorded");
        assert_eq!(workspace.provider_name, "codex");
        assert_eq!(workspace.kind, "project_dir");
        assert_eq!(workspace.status, "active");
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test]
async fn start_implementation_uses_persisted_existing_worktree_branch() {
    let mut fixture =
        ProviderLifecycleFixture::new("app_invoke_start_existing_branch_worktree").await;
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let worktree_root = temp.path().join("worktrees");
    let repo_dir = temp.path().join("repo");
    init_committed_repo(&repo_dir);
    assert_git_success(&repo_dir, &["checkout", "-b", "feature/open-pr"]);
    fs::write(repo_dir.join("README.md"), "feature branch\n").expect("fixture file should write");
    assert_git_success(&repo_dir, &["commit", "-am", "feature change"]);
    assert_git_success(&repo_dir, &["checkout", "main"]);
    fixture.state_mut().task_start_worktree_root = Some(worktree_root.clone());
    let state = fixture.state();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Continue existing PR",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create task")
        .id
    };

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let workspace_path = response["workspace_path"]
        .as_str()
        .expect("workspace path should be string");
    assert!(
        Path::new(workspace_path).starts_with(&worktree_root),
        "existing-branch workspace must use the injected worktree root"
    );
    let branch_output = git(
        Path::new(workspace_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
    );
    assert!(branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&branch_output.stdout).trim(),
        "feature/open-pr"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let worktree = db
            .get_worktree_for_task(&task_id)
            .expect("get worktree")
            .expect("worktree should exist");
        assert_eq!(worktree.branch_name, "feature/open-pr");
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get task workspace")
            .expect("workspace should exist");
        assert_eq!(workspace.branch_name.as_deref(), Some("feature/open-pr"));
    }

    invoke_ok(state, "delete_task", json!({ "id": task_id })).await;
    let workspace_dir = std::path::PathBuf::from(workspace_path);
    wait_for_background_cleanup("existing-branch worktree must be removed", || {
        !workspace_dir.exists()
    })
    .await;
    assert!(
        git(
            &repo_dir,
            &["show-ref", "--verify", "refs/heads/feature/open-pr"]
        )
        .status
        .success(),
        "deleting a task created from an existing branch must not delete that branch"
    );
}

#[tokio::test]
async fn start_implementation_replaces_stale_existing_branch_worktree_path() {
    let mut fixture =
        ProviderLifecycleFixture::new("app_invoke_start_existing_branch_replaces_stale_worktree")
            .await;
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let worktree_root = temp.path().join("worktrees");
    let repo_dir = temp.path().join("repo");
    init_committed_repo(&repo_dir);
    assert_git_success(&repo_dir, &["checkout", "-b", "feature/open-pr"]);
    fs::write(repo_dir.join("README.md"), "feature branch\n").expect("fixture file should write");
    assert_git_success(&repo_dir, &["commit", "-am", "feature change"]);
    assert_git_success(&repo_dir, &["checkout", "main"]);
    fixture.state_mut().task_start_worktree_root = Some(worktree_root.clone());
    let state = fixture.state();
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Continue existing PR",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create task")
        .id
    };
    let stale_worktree_path = worktree_root.join("repo").join(&task_id);
    let stale_worktree_path_str = stale_worktree_path.to_string_lossy().to_string();
    let stale_branch = crate::git_worktree::task_branch_name(&task_id);
    assert_git_success(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-b",
            &stale_branch,
            &stale_worktree_path_str,
            "main",
        ],
    );
    let stale_branch_output = git(&stale_worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert!(stale_branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&stale_branch_output.stdout).trim(),
        stale_branch
    );

    let response = invoke_ok(
        state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": repo_dir.to_string_lossy() }),
    )
    .await;

    let workspace_path = response["workspace_path"]
        .as_str()
        .expect("workspace path should be string");
    assert_eq!(workspace_path, stale_worktree_path_str);
    let branch_output = git(
        Path::new(workspace_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
    );
    assert!(branch_output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&branch_output.stdout).trim(),
        "feature/open-pr"
    );

    {
        let db = crate::db::acquire_db(&state.db);
        let workspace = db
            .get_task_workspace_for_task(&task_id)
            .expect("get workspace")
            .expect("workspace should exist");
        assert_eq!(workspace.branch_name.as_deref(), Some("feature/open-pr"));
    }

    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(&task_id).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_existing_branch_starts_keep_worktree_roots_isolated() {
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Barrier,
    };

    let process_home = std::env::var_os("HOME");
    let temp_a = tempfile::tempdir().expect("first tempdir should be created");
    let temp_b = tempfile::tempdir().expect("second tempdir should be created");
    let repo_a = temp_a.path().join("repo");
    let repo_b = temp_b.path().join("repo");
    let worktree_root_a = temp_a.path().join("worktrees");
    let worktree_root_b = temp_b.path().join("worktrees");
    let sandbox_a = ProviderTestSandbox::new();
    let sandbox_b = ProviderTestSandbox::new();
    let (mut state_a, _db_temp_a) = test_state("parallel_existing_branch_start_a");
    let (mut state_b, _db_temp_b) = test_state("parallel_existing_branch_start_b");
    state_a.task_start_worktree_root = Some(worktree_root_a.clone());
    state_b.task_start_worktree_root = Some(worktree_root_b.clone());
    configure_provider_test_path(&mut state_a, &sandbox_a.bin_dir);
    configure_provider_test_path(&mut state_b, &sandbox_b.bin_dir);

    let prepare_task = |state: &crate::http_server::AppState, repo_dir: &Path, prompt: &str| {
        init_committed_repo(repo_dir);
        assert_git_success(repo_dir, &["checkout", "-b", "feature/open-pr"]);
        fs::write(repo_dir.join("README.md"), "feature branch\n")
            .expect("fixture file should write");
        assert_git_success(repo_dir, &["commit", "-am", "feature change"]);
        assert_git_success(repo_dir, &["checkout", "main"]);

        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Parallel Existing Branch Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            prompt,
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/open-pr"),
            },
        )
        .expect("create task")
        .id
    };
    let task_a = prepare_task(&state_a, &repo_a, "Parallel existing branch A");
    let task_b = prepare_task(&state_b, &repo_b, "Parallel existing branch B");

    let stop_home_observer = Arc::new(AtomicBool::new(false));
    let home_changed = Arc::new(AtomicBool::new(false));
    let home_observations = Arc::new(AtomicUsize::new(0));
    let observer_ready = Arc::new(Barrier::new(2));
    let home_observer = {
        let expected_home = process_home.clone();
        let stop = Arc::clone(&stop_home_observer);
        let changed = Arc::clone(&home_changed);
        let observations = Arc::clone(&home_observations);
        let ready = Arc::clone(&observer_ready);
        std::thread::spawn(move || {
            ready.wait();
            while !stop.load(Ordering::Acquire) {
                observations.fetch_add(1, Ordering::Relaxed);
                if std::env::var_os("HOME") != expected_home {
                    changed.store(true, Ordering::Release);
                }
                std::thread::yield_now();
            }
        })
    };
    observer_ready.wait();

    let (response_a, response_b) = tokio::join!(
        invoke(
            &state_a,
            "start_implementation",
            json!({ "taskId": task_a, "repoPath": repo_a.to_string_lossy() }),
        ),
        invoke(
            &state_b,
            "start_implementation",
            json!({ "taskId": task_b, "repoPath": repo_b.to_string_lossy() }),
        ),
    );

    stop_home_observer.store(true, Ordering::Release);
    home_observer.join().expect("HOME observer should stop");
    assert!(
        home_observations.load(Ordering::Relaxed) > 0,
        "HOME observer should sample while both starts are in flight"
    );
    assert!(
        !home_changed.load(Ordering::Acquire),
        "task starts must never expose a temporary process HOME"
    );

    let response_a = response_a.expect("first concurrent task start should succeed");
    let response_b = response_b.expect("second concurrent task start should succeed");
    let workspace_a = Path::new(
        response_a["workspace_path"]
            .as_str()
            .expect("first workspace path should be a string"),
    );
    let workspace_b = Path::new(
        response_b["workspace_path"]
            .as_str()
            .expect("second workspace path should be a string"),
    );
    assert!(workspace_a.starts_with(&worktree_root_a));
    assert!(workspace_b.starts_with(&worktree_root_b));
    assert!(!workspace_a.starts_with(&worktree_root_b));
    assert!(!workspace_b.starts_with(&worktree_root_a));
    assert_eq!(std::env::var_os("HOME"), process_home);

    let manager_a = state_a.pty_manager.as_ref().expect("first PTY manager");
    let manager_b = state_b.pty_manager.as_ref().expect("second PTY manager");
    let (kill_a, kill_b) = tokio::join!(manager_a.kill_pty(&task_a), manager_b.kill_pty(&task_b));
    kill_a.expect("first provider should stop");
    kill_b.expect("second provider should stop");
}

#[tokio::test]
async fn start_implementation_reports_missing_task() {
    let (state, _temp_dir) = test_state("app_invoke_start_implementation");

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": "missing-task", "repoPath": "/tmp" }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));
}

#[tokio::test]
async fn start_implementation_blocks_in_progress_start_claim() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_in_progress_claim");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Start Claim Project", "/tmp/openforge-start-claim")
            .expect("create project");
        db.create_task("Starting already", "backlog", Some(&project.id), None, None)
            .expect("create task")
            .id
    };
    let _claim = state
        .task_claims
        .try_claim(
            &task_id,
            crate::http_server::TaskOperation::StartImplementation,
        )
        .expect("first start claim should be acquired");
    let cloned_state = state.clone();
    assert!(cloned_state
        .task_claims
        .try_claim(
            &task_id,
            crate::http_server::TaskOperation::StartImplementation,
        )
        .is_none());

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("in-progress start should block duplicate start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("start in progress"));
}

#[tokio::test]
async fn start_implementation_blocks_active_agent_session() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_active_session");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Active Session Project", "/tmp/openforge-active-session")
            .expect("create project");
        let task = db
            .create_task("Already running", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "session-active",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create session");
        task.id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("active session should block duplicate start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("active agent session"));
}

#[tokio::test]
async fn start_implementation_blocks_unmet_dependencies() {
    let (state, _temp_dir) = test_state("app_invoke_start_blocks_dependencies");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Dependency Project", "/tmp/openforge-dependencies")
            .expect("create project");
        let prerequisite = db
            .create_task("Prerequisite", "backlog", Some(&project.id), None, None)
            .expect("create prerequisite");
        let task = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.set_task_dependencies(&task.id, &[prerequisite.id])
            .expect("set dependency");
        task.id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": "/tmp" }),
    )
    .await
    .expect_err("unmet dependency should block start");

    assert_eq!(err.0, StatusCode::CONFLICT);
    assert!(err.1.contains("not done"));
}

#[tokio::test]
async fn start_implementation_reports_invalid_workspace_cwd_as_bad_request() {
    let (state, _temp_dir) = test_state("app_invoke_start_invalid_workspace_cwd");
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let missing_workspace = temp_dir.path().join("Missing Project");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Invalid Workspace Project",
                missing_workspace.to_str().expect("utf8 path"),
            )
            .expect("create project");
        db.set_project_config(&project.id, "ai_provider", "pi")
            .expect("set provider");
        db.create_task_with_worktree_source(
            "Start with missing cwd",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("disabled"),
                branch: None,
            },
        )
        .expect("create task")
        .id
    };

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": task_id, "repoPath": missing_workspace.to_string_lossy() }),
    )
    .await
    .expect_err("invalid workspace cwd should be rejected before spawning an agent PTY");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(
        err.1.contains("workspace cwd") && err.1.contains("Missing Project"),
        "error should identify the inaccessible workspace cwd, got: {}",
        err.1
    );
    assert!(
        !err.1.contains("Failed to spawn"),
        "invalid workspace errors should not be reported as generic spawn failures, got: {}",
        err.1
    );
}
