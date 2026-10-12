use super::*;
use serde_json::json;
use std::path::Path;
use std::process::Command;

fn git(repo_path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .expect("git command should run");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A started Task that owns a real git worktree, the way `task start` leaves it.
struct WorktreeTask {
    state: AppState,
    task_id: String,
    worktree_dir: std::path::PathBuf,
    _temp: tempfile::TempDir,
    _db_dir: tempfile::TempDir,
}

async fn started_task_with_worktree(name: &str) -> WorktreeTask {
    let temp = tempfile::tempdir().expect("tempdir");
    let repo_dir = temp.path().join("repo");
    let worktree_dir = temp.path().join("wt");
    std::fs::create_dir_all(&repo_dir).expect("repo dir");
    git(&repo_dir, &["init", "-b", "main"]);
    git(&repo_dir, &["config", "user.email", "test@example.com"]);
    git(&repo_dir, &["config", "user.name", "Test User"]);
    std::fs::write(repo_dir.join("README.md"), "main\n").expect("write README");
    git(&repo_dir, &["add", "README.md"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let (state, db_dir) = test_state(name);
    let (project_id, task_id) = {
        let db = crate::db::acquire_db(&state.db);
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        let project = db
            .create_project("Project", repo_dir.to_str().expect("utf8 repo path"))
            .expect("create project");
        let task = db
            .create_task("Placeholder", "doing", Some(&project.id), None, None)
            .expect("create task");
        (project.id, task.id)
    };
    let branch = crate::git_worktree::task_branch_name(&task_id);
    crate::git_worktree::create_worktree(&repo_dir, &worktree_dir, &branch, "origin/main")
        .await
        .expect("create worktree");
    crate::db::acquire_db(&state.db)
        .create_worktree_record(
            &task_id,
            &project_id,
            repo_dir.to_str().expect("utf8 repo path"),
            worktree_dir.to_str().expect("utf8 worktree path"),
            &branch,
        )
        .expect("create worktree record");

    WorktreeTask {
        state,
        task_id,
        worktree_dir,
        _temp: temp,
        _db_dir: db_dir,
    }
}

async fn post_complete(state: &AppState, body: serde_json::Value) -> axum::response::Response {
    create_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/complete_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .expect("build request"),
        )
        .await
        .expect("request should return a response")
}

fn task_status(state: &AppState, task_id: &str) -> String {
    crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get task")
        .expect("task exists")
        .status
}

#[tokio::test]
async fn complete_task_with_clean_worktree_marks_it_done_and_removes_the_worktree() {
    let fixture = started_task_with_worktree("http_complete_task_clean").await;

    let response = post_complete(&fixture.state, json!({ "task_id": fixture.task_id })).await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_body_json(response).await;
    assert_eq!(body["task_id"], fixture.task_id.as_str());
    assert_eq!(body["previous_status"], "doing");
    assert_eq!(body["status"], "done");
    assert_eq!(
        body["worktree_path"],
        fixture.worktree_dir.to_str().expect("utf8 worktree path")
    );
    assert_eq!(body["worktree_removed"], true);
    assert!(
        !fixture.worktree_dir.exists(),
        "the worktree folder must be gone when the response arrives"
    );
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "done");
}

#[tokio::test]
async fn complete_task_refuses_a_dirty_worktree_unless_forced() {
    let fixture = started_task_with_worktree("http_complete_task_dirty").await;
    std::fs::write(fixture.worktree_dir.join("scratch.txt"), "untracked\n")
        .expect("write untracked file");

    let refused = post_complete(&fixture.state, json!({ "task_id": fixture.task_id })).await;

    assert_eq!(refused.status(), StatusCode::CONFLICT);
    let message = response_body_text(refused).await;
    assert!(
        message.contains("uncommitted or untracked changes"),
        "{message}"
    );
    assert!(message.contains("--force"), "{message}");
    assert!(fixture.worktree_dir.join("scratch.txt").exists());
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "doing");

    let forced = post_complete(
        &fixture.state,
        json!({ "task_id": fixture.task_id, "force": true }),
    )
    .await;

    assert_eq!(forced.status(), StatusCode::OK);
    assert_eq!(response_body_json(forced).await["worktree_removed"], true);
    assert!(!fixture.worktree_dir.exists());
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "done");
}

#[tokio::test]
async fn complete_task_refuses_a_running_session_unless_stop_session_is_passed() {
    let fixture = started_task_with_worktree("http_complete_task_running_session").await;
    crate::db::acquire_db(&fixture.state.db)
        .create_agent_session(
            "ses-running",
            &fixture.task_id,
            None,
            "implement",
            "running",
            "claude-code",
        )
        .expect("create running session");

    let refused = post_complete(&fixture.state, json!({ "task_id": fixture.task_id })).await;

    assert_eq!(refused.status(), StatusCode::CONFLICT);
    let message = response_body_text(refused).await;
    assert!(message.contains("running agent session"), "{message}");
    assert!(message.contains("--stop-session"), "{message}");
    assert!(fixture.worktree_dir.exists());
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "doing");

    let stopped = post_complete(
        &fixture.state,
        json!({ "task_id": fixture.task_id, "stop_session": true }),
    )
    .await;

    assert_eq!(stopped.status(), StatusCode::OK);
    assert!(!fixture.worktree_dir.exists());
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "done");
}

#[tokio::test]
async fn completing_an_already_completed_task_is_a_successful_no_op() {
    let fixture = started_task_with_worktree("http_complete_task_repeat").await;
    let first = post_complete(&fixture.state, json!({ "task_id": fixture.task_id })).await;
    assert_eq!(first.status(), StatusCode::OK);
    let completed_at = crate::db::acquire_db(&fixture.state.db)
        .get_task(&fixture.task_id)
        .expect("get task")
        .expect("task exists")
        .updated_at;

    let second = post_complete(&fixture.state, json!({ "task_id": fixture.task_id })).await;

    assert_eq!(second.status(), StatusCode::OK);
    let body = response_body_json(second).await;
    assert_eq!(body["task_id"], fixture.task_id.as_str());
    assert_eq!(body["previous_status"], "done");
    assert_eq!(body["status"], "done");
    assert_eq!(body["worktree_path"], serde_json::Value::Null);
    assert_eq!(body["worktree_removed"], false);
    let task = crate::db::acquire_db(&fixture.state.db)
        .get_task(&fixture.task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.status, "done");
    assert_eq!(task.updated_at, completed_at, "a repeat must not write");
}

#[tokio::test]
async fn complete_task_with_keep_worktree_leaves_the_folder_in_place() {
    let fixture = started_task_with_worktree("http_complete_task_keep_worktree").await;

    let response = post_complete(
        &fixture.state,
        json!({ "task_id": fixture.task_id, "keep_worktree": true }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_body_json(response).await;
    assert_eq!(body["status"], "done");
    assert_eq!(
        body["worktree_path"],
        fixture.worktree_dir.to_str().expect("utf8 worktree path")
    );
    assert_eq!(body["worktree_removed"], false);
    assert!(fixture.worktree_dir.join("README.md").exists());
    assert_eq!(task_status(&fixture.state, &fixture.task_id), "done");
}

#[tokio::test]
async fn complete_task_rejects_an_unknown_task_id() {
    let (state, _temp_dir) = test_state("http_complete_task_missing");

    let response = post_complete(&state, json!({ "task_id": "T-404" })).await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(response_body_text(response).await.contains("T-404"));
}

#[tokio::test]
async fn complete_task_points_a_never_started_task_at_task_delete() {
    let (state, _temp_dir) = test_state("http_complete_task_backlog");
    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Never started", "backlog", None, None, None)
            .expect("create task")
            .id
    };

    let response = post_complete(&state, json!({ "task_id": task_id })).await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(response_body_text(response).await.contains("task delete"));
    assert_eq!(task_status(&state, &task_id), "backlog");
}
