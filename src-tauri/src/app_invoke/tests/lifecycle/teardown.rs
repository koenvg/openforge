use super::{support::*, *};
use std::path::Path;

fn git_stdout_lifecycle(repo_path: &Path, args: &[&str]) -> String {
    let output = git(repo_path, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn branch_exists_lifecycle(repo_path: &Path, branch: &str) -> bool {
    git(
        repo_path,
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .status
    .success()
}

/// Marks branch <branch> as fully pushed: points origin/<branch> at its tip and
/// configures the upstream so teardown treats it as safe to delete.
fn mark_branch_pushed(repo_path: &Path, branch: &str) {
    let sha = git_stdout_lifecycle(repo_path, &["rev-parse", &format!("refs/heads/{branch}")]);
    let _ = git(
        repo_path,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/openforge.git",
        ],
    );
    assert_git_success(
        repo_path,
        &["update-ref", &format!("refs/remotes/origin/{branch}"), &sha],
    );
    assert_git_success(
        repo_path,
        &[
            "branch",
            &format!("--set-upstream-to=origin/{branch}"),
            branch,
        ],
    );
}

/// Creates a committed repo, a "doing" task with an OpenForge worktree on its
/// `openforge/<task>` branch, and persists the worktree record. When `safe` the
/// branch is marked fully pushed so teardown may delete it. Returns the task id,
/// branch name, and worktree path.
async fn setup_owned_worktree_task(
    state: &crate::http_server::AppState,
    repo_dir: &Path,
    worktree_dir: &Path,
    safe: bool,
) -> (String, String) {
    init_committed_repo(repo_dir);
    let (project_id, task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project(
                "Cleanup Project",
                repo_dir.to_str().expect("utf8 repo path"),
            )
            .expect("create project");
        let task = db
            .create_task("owned branch task", "doing", Some(&project.id), None, None)
            .expect("create task");
        (project.id, task.id)
    };
    let branch = crate::git_worktree::task_branch_name(&task_id);
    crate::git_worktree::create_worktree(repo_dir, worktree_dir, &branch, "origin/main")
        .await
        .expect("create worktree");
    {
        let db = crate::db::acquire_db(&state.db);
        db.create_worktree_record(
            &task_id,
            &project_id,
            repo_dir.to_str().expect("utf8 repo path"),
            worktree_dir.to_str().expect("utf8 worktree path"),
            &branch,
        )
        .expect("create worktree record");
    }
    if safe {
        mark_branch_pushed(repo_dir, &branch);
    }
    (task_id, branch)
}

#[tokio::test]
async fn update_task_status_to_done_is_rejected_and_preserves_worktree() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_done_rejected_keeps_worktree");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    // 'done' is a legacy, recognized-but-unreachable status (AVIV-118): assigning
    // it hides the task from every board surface with no reopen path. The write
    // boundary rejects it, so the status update never runs.
    let rejected = invoke(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "done" }),
    )
    .await
    .expect_err("move to Done should be rejected");
    assert_eq!(rejected.0, StatusCode::BAD_REQUEST);

    // The task keeps its board-visible status...
    {
        let db = crate::db::acquire_db(&state.db);
        assert_eq!(
            db.get_task(&task_id)
                .expect("get task")
                .expect("task exists")
                .status,
            "doing"
        );
    }
    // ...and, because nothing was written, the worktree and branch survive
    // untouched (no accidental cleanup on the rejected path).
    assert!(
        branch_exists_lifecycle(&repo_dir, &branch),
        "rejecting a move to Done must not delete the branch"
    );
    assert!(
        worktree_dir.exists(),
        "rejecting a move to Done must not remove the worktree directory"
    );
    let db = crate::db::acquire_db(&state.db);
    assert!(
        db.get_worktree_for_task(&task_id)
            .expect("get worktree")
            .is_some(),
        "the worktree record must survive a rejected move to Done"
    );
    drop(db);
}

/// Polls until `condition` holds, panicking after a generous deadline. Used to
/// observe the background worktree cleanup that delete_task no longer awaits.
#[tokio::test]
async fn delete_task_deletes_owned_branch_when_safe() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_deletes_owned_branch");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;

    wait_for_background_cleanup(
        "safe owned branch must be deleted after a task is completed",
        || !branch_exists_lifecycle(&repo_dir, &branch),
    )
    .await;
}

#[tokio::test]
async fn delete_task_publishes_deleted_event_before_worktree_cleanup_finishes() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_event_before_cleanup");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    // Hold the per-repo worktree lock so the worktree/branch cleanup cannot run
    // yet. delete_task must still return, complete the row, and publish the
    // deleted event: cleanup is background work.
    let repo_lock = crate::git_worktree::acquire_lock(&repo_dir);
    let cleanup_gate = repo_lock.lock().await;

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        invoke_ok(&state, "delete_task", json!({ "id": task_id })),
    )
    .await
    .expect("delete_task must return while worktree cleanup is still pending");

    let completed = crate::db::acquire_db(&state.db)
        .get_task(&task_id)
        .expect("get task")
        .expect("completed task record should remain before worktree cleanup runs");
    assert_eq!(
        completed.status, "done",
        "the task row must be marked done before worktree cleanup runs"
    );
    let envelope = events
        .try_recv()
        .expect("task-changed{deleted} must be published before cleanup finishes");
    assert_eq!(envelope.event_name, "task-changed");
    assert_eq!(envelope.payload["action"], "deleted");
    assert_eq!(envelope.payload["task_id"], task_id.as_str());
    assert!(
        worktree_dir.exists(),
        "worktree removal must happen in the background, after the deleted event"
    );
    assert!(
        branch_exists_lifecycle(&repo_dir, &branch),
        "branch cleanup must happen in the background, after the deleted event"
    );

    drop(cleanup_gate);
    wait_for_background_cleanup("worktree directory and branch must be removed", || {
        !worktree_dir.exists() && !branch_exists_lifecycle(&repo_dir, &branch)
    })
    .await;
}

#[tokio::test]
async fn delete_task_rejects_duplicate_delete_while_cleanup_in_flight() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    let (state, _temp_dir) = test_state("app_invoke_delete_duplicate_guard");
    let (task_id, branch) = setup_owned_worktree_task(&state, &repo_dir, &worktree_dir, true).await;

    let repo_lock = crate::git_worktree::acquire_lock(&repo_dir);
    let cleanup_gate = repo_lock.lock().await;

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        invoke_ok(&state, "delete_task", json!({ "id": task_id })),
    )
    .await
    .expect("delete_task must return while worktree cleanup is still pending");

    let err = invoke(&state, "delete_task", json!({ "id": task_id }))
        .await
        .expect_err("a second Complete while cleanup is in flight must be rejected");
    assert_eq!(err.0, StatusCode::CONFLICT);

    drop(cleanup_gate);
    wait_for_background_cleanup("cleanup must finish after the gate is released", || {
        !worktree_dir.exists() && !branch_exists_lifecycle(&repo_dir, &branch)
    })
    .await;
}
