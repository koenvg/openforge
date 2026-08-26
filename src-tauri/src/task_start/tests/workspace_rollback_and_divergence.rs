use super::super::*;
use super::support::*;

use std::process::Command;

#[tokio::test]
async fn safe_start_returns_desktop_action_required_without_creating_runtime_state() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    init_diverged_existing_branch(&repo);
    let remote = temp.path().join("remote.git");
    let remote_init = Command::new("git")
        .args(["init", "--bare", remote.to_str().expect("utf8 remote")])
        .output()
        .expect("remote init should run");
    assert!(remote_init.status.success());
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            remote.to_str().expect("utf8 remote"),
        ],
    );
    git(&repo, &["push", "origin", "main:feature/diverged"]);
    let fetch_head = repo.join(".git").join("FETCH_HEAD");
    let _ = std::fs::remove_file(&fetch_head);
    let remote_ref_before = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["rev-parse", "refs/remotes/origin/feature/diverged"])
        .output()
        .expect("remote ref query should run")
        .stdout;
    let (mut state, path) =
        crate::app_invoke::test_support::test_state("task_start_desktop_action_required");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Diverged Project", repo.to_str().expect("utf8 repo"))
            .expect("create Project");
        db.create_task_with_worktree_source(
            "Start diverged branch",
            "backlog",
            Some(&project.id),
            None,
            None,
            crate::db::TaskWorktreeOptions {
                source: Some("existingBranch"),
                branch: Some("feature/diverged"),
            },
        )
        .expect("create Task")
        .id
    };
    state.pty_manager = None;
    let execution = service_for_state(&state)
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect("preflight should return a safe outcome");

    assert!(
        !fetch_head.exists(),
        "safe preflight must not fetch or create FETCH_HEAD"
    );
    let remote_ref_after = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["rev-parse", "refs/remotes/origin/feature/diverged"])
        .output()
        .expect("remote ref query should run")
        .stdout;
    assert_eq!(remote_ref_after, remote_ref_before);
    assert_eq!(
        execution.outcome,
        TaskStartOutcome::DesktopActionRequired {
            task_id: task_id.clone(),
            reason: DesktopActionReason::ExistingBranchDiverged,
        }
    );
    assert!(execution.receipt.is_none());
    let db = db::acquire_db(&state.db);
    assert_eq!(
        db.get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .status,
        "backlog"
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
    drop(state);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn failed_provider_launch_rolls_back_new_workspace_state() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_provider_failure_rollback");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Provider Failure Project",
                repo.to_str().expect("utf8 repo"),
            )
            .expect("create Project");
        db.create_task(
            "Provider must fail",
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
    let service = service_for_state(&state)
        .with_provider_launcher(Arc::new(FailingProviderLauncher))
        .with_worktree_root(worktree_root);

    let error = service
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("provider launch should fail");

    assert_eq!(
        error,
        TaskStartError::ProviderLaunch("controllable provider launch failure".to_string())
    );
    let db = db::acquire_db(&state.db);
    assert_eq!(
        db.get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .status,
        "backlog"
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
    assert!(
        !branch_output.status.success(),
        "fresh Task branch should be removed during rollback"
    );

    drop(state);
}

#[tokio::test]
async fn failed_start_preserves_a_reused_worktree_and_its_local_changes() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_reused_worktree_rollback");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Reused Worktree Project", repo.to_str().expect("utf8 repo"))
            .expect("create Project");
        db.create_task(
            "Preserve reused checkout",
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
    git_worktree::create_worktree(&repo, &worktree_path, &branch, "origin/main")
        .await
        .expect("create existing worktree");
    let local_file = worktree_path.join("keep-local.txt");
    std::fs::write(&local_file, "uncommitted work\n").expect("write local change");
    {
        let db = db::acquire_db(&state.db);
        let project_id = db
            .get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .project_id
            .expect("Task has Project");
        db.create_worktree_record(
            &task_id,
            &project_id,
            repo.to_str().expect("utf8 repo"),
            worktree_path.to_str().expect("utf8 worktree"),
            &branch,
        )
        .expect("create existing worktree record");
    }
    let service = service_for_state(&state)
        .with_provider_launcher(Arc::new(FailingProviderLauncher))
        .with_worktree_root(worktree_root);

    let error = service
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("provider launch should fail");

    assert!(matches!(error, TaskStartError::ProviderLaunch(_)));
    assert_eq!(
        std::fs::read_to_string(&local_file).expect("local file should survive"),
        "uncommitted work\n"
    );
    let record = db::acquire_db(&state.db)
        .get_worktree_for_task(&task_id)
        .expect("get worktree record")
        .expect("existing worktree record should survive");
    assert_eq!(record.worktree_path, worktree_path.to_string_lossy());
    assert_eq!(record.branch_name, branch);
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["show-ref", "--verify", &format!("refs/heads/{branch}")])
        .output()
        .expect("branch query should run");
    assert!(
        branch_output.status.success(),
        "reused branch should survive"
    );

    drop(state);
}

#[tokio::test]
async fn worktree_record_failure_removes_new_files_but_preserves_existing_record() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_worktree_record_failure");
    let (task_id, project_id) = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Record Failure Project", repo.to_str().expect("utf8 repo"))
            .expect("create Project");
        let task = db
            .create_task(
                "Collide with stale record",
                "backlog",
                Some(&project.id),
                None,
                None,
            )
            .expect("create Task");
        db.create_worktree_record(
            &task.id,
            &project.id,
            repo.to_str().expect("utf8 repo"),
            "/existing/worktree",
            "existing-branch",
        )
        .expect("create stale worktree record");
        db.connection()
            .lock()
            .expect("lock connection")
            .execute_batch(
                "CREATE TRIGGER fail_worktree_record_update
                 BEFORE UPDATE ON worktrees
                 BEGIN
                   SELECT RAISE(FAIL, 'forced worktree record failure');
                 END;",
            )
            .expect("create failure trigger");
        (task.id, project.id)
    };
    let branch = git_worktree::task_branch_name(&task_id);
    let worktree_path = worktree_root.join("repo").join(&task_id);
    let service = service_for_state(&state)
        .with_provider_launcher(Arc::new(FailingProviderLauncher))
        .with_worktree_root(worktree_root);

    let error = service
        .start(TaskStartRequest::safe(&task_id))
        .await
        .expect_err("duplicate worktree record should fail preparation");

    assert!(
        matches!(error, TaskStartError::Persistence(_)),
        "got {error:?}"
    );
    let db = db::acquire_db(&state.db);
    let record = db
        .get_worktree_for_task(&task_id)
        .expect("get worktree record")
        .expect("existing worktree record should remain");
    assert_eq!(record.project_id, project_id);
    assert_eq!(record.worktree_path, "/existing/worktree");
    assert_eq!(record.branch_name, "existing-branch");
    assert_eq!(
        db.get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .status,
        "backlog"
    );
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
