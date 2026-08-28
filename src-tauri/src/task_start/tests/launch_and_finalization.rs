use super::super::*;
use super::support::*;
use std::{
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

#[tokio::test]
async fn safe_start_creates_implementation_run_and_publishes_canonical_invalidation() {
    let (state, _temp_dir) = crate::app_invoke::test_support::test_state("task_start_success");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Start Project", "/tmp/start-project")
            .expect("create Project");
        db.create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "Start from Companion",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: Some("disabled"),
            worktree_branch: None,
            title: None,
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .expect("create Task")
        .id
    };
    let project_id = db::acquire_db(&state.db)
        .get_task(&task_id)
        .expect("get Task")
        .expect("Task exists")
        .project_id
        .expect("Task has Project");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let execution = service_for_state(&state)
        .with_provider_launcher(Arc::new(SuccessfulProviderLauncher))
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect("safe Start succeeds");

    assert_eq!(
        execution.outcome,
        TaskStartOutcome::Started {
            task_id: task_id.clone(),
        }
    );
    {
        let db = db::acquire_db(&state.db);
        assert_eq!(
            db.get_task(&task_id)
                .expect("get Task")
                .expect("Task exists")
                .status,
            "doing"
        );
        assert_eq!(
            db.get_latest_session_for_ticket(&task_id)
                .expect("get Agent Session")
                .expect("Agent Session exists")
                .status,
            "running"
        );
    }
    let event = events.recv().await.expect("canonical Task invalidation");
    assert_eq!(event.event_name, "task-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["project_id"], project_id);

    drop(state);
}

#[tokio::test]
async fn safe_start_represents_stale_dependency_and_concurrent_outcomes() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_safe_validation_outcomes");
    let (stale_task_id, blocked_task_id, dependency_id, claimed_task_id) = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Validation Project", "/tmp/validation-project")
            .expect("create Project");
        let stale = db
            .create_task("Stale", "doing", Some(&project.id), None, None)
            .expect("create stale Task");
        let dependency = db
            .create_task("Dependency", "backlog", Some(&project.id), None, None)
            .expect("create dependency Task");
        let blocked = db
            .create_task("Blocked", "backlog", Some(&project.id), None, None)
            .expect("create blocked Task");
        db.set_task_dependencies(&blocked.id, std::slice::from_ref(&dependency.id))
            .expect("set dependency");
        let claimed = db
            .create_task("Claimed", "backlog", Some(&project.id), None, None)
            .expect("create claimed Task");
        (stale.id, blocked.id, dependency.id, claimed.id)
    };
    let _claim = state
        .task_claims
        .try_claim(&claimed_task_id, TaskOperation::StartImplementation)
        .expect("claim should be acquired");
    let service = service_for_state(&state);

    assert_eq!(
        service
            .start(TaskStartRequest::safe(&stale_task_id))
            .await
            .expect_err("stale state should reject"),
        TaskStartError::InvalidState {
            status: "doing".to_string(),
        }
    );
    assert_eq!(
        service
            .start(TaskStartRequest::safe(&blocked_task_id))
            .await
            .expect_err("dependency should reject"),
        TaskStartError::DependencyBlocked { dependency_id }
    );
    assert_eq!(
        service
            .start(TaskStartRequest::safe(&claimed_task_id))
            .await
            .expect_err("concurrent Start should reject"),
        TaskStartError::AlreadyInProgress
    );

    drop(state);
}

#[tokio::test]
async fn post_launch_finalization_failure_aborts_provider_and_rolls_back_owned_state() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_finalization_failure_rollback");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Finalization Project", repo.to_str().expect("utf8 repo"))
            .expect("create Project");
        db.create_task(
            "Become stale after launch",
            "backlog",
            Some(&project.id),
            None,
            None,
        )
        .expect("create Task")
        .id
    };
    let branch = git_worktree::task_branch_name(&task_id);
    let worktree_path = worktree_root.join("repo").join(&task_id);
    let aborted = Arc::new(AtomicBool::new(false));
    let service = service_for_state(&state)
        .with_provider_launcher(Arc::new(StaleAfterLaunchProvider {
            db: Arc::clone(&state.db),
            aborted: Arc::clone(&aborted),
        }))
        .with_worktree_root(worktree_root);

    let error = service
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("stale finalization should fail");

    assert_eq!(error, TaskStartError::StaleState);
    assert!(aborted.load(Ordering::SeqCst));
    let db = db::acquire_db(&state.db);
    assert_eq!(
        db.get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .status,
        "doing",
        "the service must not overwrite the newer external state"
    );
    assert!(db
        .get_worktree_for_task(&task_id)
        .expect("get worktree")
        .is_none());
    assert!(db
        .get_task_workspace_for_task(&task_id)
        .expect("get Task workspace")
        .is_none());
    assert!(db
        .get_latest_session_for_ticket(&task_id)
        .expect("get Agent Session")
        .is_none());
    drop(db);
    assert!(!worktree_path.exists());
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["show-ref", "--verify", &format!("refs/heads/{branch}")])
        .output()
        .expect("branch query should run");
    assert!(!branch_output.status.success());

    drop(state);
}
