use super::*;
use std::{
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

struct FailingProviderLauncher;

impl ProviderLauncher for FailingProviderLauncher {
    fn launch<'a>(
        &'a self,
        _request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async {
            Err(TaskStartError::ProviderLaunch(
                "controllable provider launch failure".to_string(),
            ))
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }
}

struct StaleAfterLaunchProvider {
    db: Arc<Mutex<Database>>,
    aborted: Arc<AtomicBool>,
}

impl ProviderLauncher for StaleAfterLaunchProvider {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async move {
            db::acquire_db(&self.db)
                .update_task_status(request.task_id, "doing")
                .map_err(|error| TaskStartError::Persistence(error.to_string()))?;
            Ok(ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: Some(42),
            })
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.aborted.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
}

fn service_for_state(state: &crate::http_server::AppState) -> TaskStartService {
    TaskStartService::new(
        state.app.clone(),
        Arc::clone(&state.db),
        state.pty_manager.clone(),
        state.app_event_tx.clone(),
        state.task_claims.clone(),
    )
}

fn task_with_provider_options(agent: Option<&str>, permission_mode: Option<&str>) -> TaskRow {
    TaskRow {
        id: "T-provider-options".to_string(),
        initial_prompt: "Implement provider options".to_string(),
        status: "backlog".to_string(),
        project_id: Some("P-provider-options".to_string()),
        created_at: 1,
        updated_at: 1,
        prompt: None,
        summary: None,
        agent: agent.map(str::to_string),
        permission_mode: permission_mode.map(str::to_string),
        worktree_source: None,
        worktree_branch: None,
        title: None,
        title_source: None,
        title_generated_at: None,
        handoff_notes_enabled: true,
        source_ticket_url: None,
        depends_on: Vec::new(),
        labels: Vec::new(),
    }
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .expect("git command should run");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_remote_backed_main(repo: &Path) {
    std::fs::create_dir_all(repo).expect("repository should create");
    git(repo, &["init", "-b", "main"]);
    git(repo, &["config", "user.email", "test@example.com"]);
    git(repo, &["config", "user.name", "Test User"]);
    std::fs::write(repo.join("README.md"), "base\n").expect("base file should write");
    git(repo, &["add", "README.md"]);
    git(repo, &["commit", "-m", "base"]);
    git(repo, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

fn init_diverged_existing_branch(repo: &Path) {
    std::fs::create_dir_all(repo).expect("repository should create");
    git(repo, &["init", "-b", "main"]);
    git(repo, &["config", "user.email", "test@example.com"]);
    git(repo, &["config", "user.name", "Test User"]);
    std::fs::write(repo.join("README.md"), "base\n").expect("base file should write");
    git(repo, &["add", "README.md"]);
    git(repo, &["commit", "-m", "base"]);
    git(repo, &["checkout", "-b", "feature/diverged"]);
    std::fs::write(repo.join("local.txt"), "local\n").expect("local file should write");
    git(repo, &["add", "local.txt"]);
    git(repo, &["commit", "-m", "local"]);
    git(repo, &["checkout", "main"]);
    std::fs::write(repo.join("remote.txt"), "remote\n").expect("remote file should write");
    git(repo, &["add", "remote.txt"]);
    git(repo, &["commit", "-m", "remote"]);
    git(
        repo,
        &["update-ref", "refs/remotes/origin/feature/diverged", "HEAD"],
    );
}

#[test]
fn provider_run_options_borrow_saved_task_agent_and_permission_mode() {
    let task = task_with_provider_options(Some("rust-specialist"), Some("trusted"));

    let options = ProviderRunOptions::for_task(&task);

    assert_eq!(options.agent, Some("rust-specialist"));
    assert_eq!(options.permission_mode, Some("trusted"));
    assert!(options.model.is_none());
}

#[test]
fn start_context_resolves_saved_task_overrides() {
    let (state, path) =
        crate::app_invoke::test_support::test_state("task_start_context_saved_overrides");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db.create_project("P", "/tmp/p").expect("create Project");
        db.set_config("code_cleanup_tasks_enabled", "false")
            .expect("set global cleanup setting");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: Some("disabled"),
                worktree_branch: None,
                title: None,
                handoff_notes_enabled: true,
                source_ticket_url: None,
                code_cleanup_enabled: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create Task");
        db.set_task_config(&task.id, "code_cleanup_tasks_enabled", "true")
            .expect("set Task cleanup override");
        db.set_task_config(&task.id, "ai_provider", "opencode")
            .expect("set Task provider override");
        task.id
    };

    let context = service_for_state(&state)
        .load_context(&task_id)
        .expect("load Start context");

    assert!(context.code_cleanup_enabled);
    assert_eq!(context.provider_name, "opencode");
    assert_eq!(context.repo_path, Path::new("/tmp/p"));

    drop(state);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn safe_start_represents_stale_dependency_and_concurrent_outcomes() {
    let (state, path) =
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
    let _ = std::fs::remove_file(path);
}
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
    let (state, path) =
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
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn failed_start_preserves_a_reused_worktree_and_its_local_changes() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, path) =
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
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn post_launch_finalization_failure_aborts_provider_and_rolls_back_owned_state() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, path) =
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
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn worktree_record_failure_removes_new_files_but_preserves_existing_record() {
    let temp = tempfile::tempdir().expect("tempdir should create");
    let repo = temp.path().join("repo");
    let worktree_root = temp.path().join("worktrees");
    init_remote_backed_main(&repo);
    let (state, path) =
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
    let _ = std::fs::remove_file(path);
}
