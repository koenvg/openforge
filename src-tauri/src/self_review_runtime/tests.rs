use super::*;
use std::{fs, path::Path, process::Command};
use tempfile::tempdir;

fn run_git(repo_path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .expect("run git command");

    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_git_repo() -> tempfile::TempDir {
    let repo = tempdir().expect("create temp git repo");
    run_git(repo.path(), &["init"]);
    run_git(repo.path(), &["checkout", "-B", "main"]);
    run_git(repo.path(), &["config", "user.email", "test@example.com"]);
    run_git(repo.path(), &["config", "user.name", "Test User"]);
    repo
}

#[test]
fn git_status_parse_diff_shortstat_full() {
    let (files, ins, del) =
        parse_diff_shortstat(" 38 files changed, 1607 insertions(+), 642 deletions(-)\n");
    assert_eq!(files, 38);
    assert_eq!(ins, 1607);
    assert_eq!(del, 642);
}

#[test]
fn git_status_parse_diff_shortstat_insertions_only() {
    let (files, ins, del) = parse_diff_shortstat(" 1 file changed, 5 insertions(+)\n");
    assert_eq!(files, 1);
    assert_eq!(ins, 5);
    assert_eq!(del, 0);
}

#[test]
fn git_status_parse_diff_shortstat_deletions_only() {
    let (files, ins, del) = parse_diff_shortstat(" 2 files changed, 3 deletions(-)\n");
    assert_eq!(files, 2);
    assert_eq!(ins, 0);
    assert_eq!(del, 3);
}

#[test]
fn git_status_parse_diff_shortstat_empty_is_zero() {
    assert_eq!(parse_diff_shortstat(""), (0, 0, 0));
}

#[test]
fn git_status_parse_ahead_behind_reads_ahead_then_behind() {
    // `git rev-list --left-right --count HEAD...@{upstream}` => "<ahead>\t<behind>"
    assert_eq!(parse_ahead_behind("3\t1\n"), (3, 1));
    assert_eq!(parse_ahead_behind("0\t0\n"), (0, 0));
}

#[test]
fn git_status_parse_ahead_behind_zero_when_empty_or_malformed() {
    assert_eq!(parse_ahead_behind(""), (0, 0));
    assert_eq!(parse_ahead_behind("garbage"), (0, 0));
}

#[tokio::test]
async fn git_status_summary_reports_no_remote_with_local_commits() {
    let repo = init_git_repo();
    // Base commit on main.
    fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    // Task branch with one commit (no remote/upstream configured).
    run_git(repo.path(), &["checkout", "-b", "task"]);
    fs::write(repo.path().join("b.txt"), "2\n").expect("write b.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "task commit"]);
    // One uncommitted modification.
    fs::write(repo.path().join("a.txt"), "1\nmore\n").expect("modify a.txt");

    let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("git status summary");

    assert!(!summary.has_remote);
    assert_eq!(summary.remote_ahead, 0);
    assert_eq!(summary.remote_behind, 0);
    assert_eq!(summary.local_commits, 1);
    assert_eq!(summary.uncommitted_files, 1);
    assert_eq!(summary.insertions, 1);
    assert_eq!(summary.deletions, 0);
}

#[tokio::test]
async fn git_status_summary_counts_untracked_files_and_their_lines() {
    let repo = init_git_repo();
    fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    // Brand-new files, which `git diff HEAD` cannot see at all.
    fs::write(repo.path().join("new1.txt"), "one\ntwo\nthree\n").expect("write new1.txt");
    fs::write(repo.path().join("new2.txt"), "solo").expect("write new2.txt");

    let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("git status summary");

    assert_eq!(summary.untracked_files, 2);
    // 3 lines, plus 1 line that has no trailing newline.
    assert_eq!(summary.untracked_insertions, 4);
    // Untracked files must stay out of the tracked-diff counts.
    assert_eq!(summary.uncommitted_files, 0);
    assert_eq!(summary.insertions, 0);
}

#[tokio::test]
async fn git_status_summary_untracked_excludes_gitignored_files() {
    let repo = init_git_repo();
    fs::write(repo.path().join(".gitignore"), "ignored/\n").expect("write .gitignore");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    fs::create_dir(repo.path().join("ignored")).expect("create ignored dir");
    fs::write(repo.path().join("ignored/junk.txt"), "noise\n").expect("write junk.txt");

    let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("git status summary");

    assert_eq!(summary.untracked_files, 0);
    assert_eq!(summary.untracked_insertions, 0);
}

#[tokio::test]
async fn git_status_summary_untracked_counts_binary_file_without_lines() {
    let repo = init_git_repo();
    fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    // Invalid UTF-8 — counts as a file, but contributes no lines.
    fs::write(repo.path().join("blob.bin"), [0xff, 0xfe, 0x00, 0x01]).expect("write blob.bin");

    let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("git status summary");

    assert_eq!(summary.untracked_files, 1);
    assert_eq!(summary.untracked_insertions, 0);
}

#[tokio::test]
async fn git_status_summary_reports_ahead_of_remote_when_pushed() {
    let remote = tempdir().expect("create bare remote");
    run_git(remote.path(), &["init", "--bare"]);

    let repo = init_git_repo();
    fs::write(repo.path().join("a.txt"), "1\n").expect("write a.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    run_git(
        repo.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    // Push sets up the upstream tracking branch (origin/main); branch is in sync.
    run_git(repo.path(), &["push", "-u", "origin", "main"]);
    // One local commit that has not been pushed.
    fs::write(repo.path().join("c.txt"), "x\n").expect("write c.txt");
    run_git(repo.path(), &["add", "."]);
    run_git(repo.path(), &["commit", "-m", "unpushed"]);

    let summary = get_task_git_status_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("git status summary");

    assert!(summary.has_remote);
    assert_eq!(summary.remote_ahead, 1);
    assert_eq!(summary.remote_behind, 0);
}

fn write_repo_file(repo_path: &Path, path: &str, content: &str) {
    fs::write(repo_path.join(path), content).expect("write repo file");
}

fn commit_all(repo_path: &Path, message: &str) {
    run_git(repo_path, &["add", "."]);
    run_git(repo_path, &["commit", "-m", message]);
}

#[tokio::test]
async fn test_task_diff_falls_back_to_local_main_without_origin_main() {
    let repo = init_git_repo();
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
    commit_all(repo.path(), "feature commit");

    let result = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false).await;

    assert!(
        result.is_ok(),
        "local-only repositories without origin/main should still produce a self-review diff: {:?}",
        result
    );
    let diffs = result.unwrap();
    assert!(
        diffs.iter().any(|diff| {
            diff.filename == "tracked.txt"
                && diff.patch.as_deref().unwrap_or("").contains("+feature")
        }),
        "expected diff for feature commit, got {:?}",
        diffs
    );
}

/// Repo with one committed change to `tracked.txt`, then an uncommitted
/// modification to it, plus a brand-new untracked file. Used to assert the
/// committed/uncommitted scope flags select the right slice of changes.
fn setup_committed_and_uncommitted_repo() -> tempfile::TempDir {
    let repo = init_git_repo();
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\ncommitted\n");
    commit_all(repo.path(), "committed change");
    // Uncommitted (unstaged) modification on top of the committed change.
    write_repo_file(repo.path(), "tracked.txt", "base\ncommitted\nuncommitted\n");
    // Untracked file — uncommitted, never added.
    write_repo_file(repo.path(), "untracked.txt", "new file\n");
    repo
}

#[tokio::test]
async fn test_task_diff_committed_only_excludes_uncommitted_and_untracked() {
    let repo = setup_committed_and_uncommitted_repo();

    let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false)
        .await
        .expect("committed-only diff");

    let tracked = diffs
        .iter()
        .find(|d| d.filename == "tracked.txt")
        .expect("tracked.txt in diff");
    let patch = tracked.patch.as_deref().unwrap_or("");
    assert!(
        patch.contains("+committed"),
        "committed change should show: {patch}"
    );
    assert!(
        !patch.contains("+uncommitted"),
        "uncommitted change must be hidden in committed-only mode: {patch}"
    );
    assert!(
        !diffs.iter().any(|d| d.filename == "untracked.txt"),
        "untracked file must be hidden in committed-only mode"
    );
}

#[tokio::test]
async fn test_task_diff_both_includes_committed_and_uncommitted() {
    let repo = setup_committed_and_uncommitted_repo();

    let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, true)
        .await
        .expect("both-scopes diff");

    let tracked = diffs
        .iter()
        .find(|d| d.filename == "tracked.txt")
        .expect("tracked.txt in diff");
    let patch = tracked.patch.as_deref().unwrap_or("");
    assert!(
        patch.contains("+committed"),
        "committed change should show: {patch}"
    );
    assert!(
        patch.contains("+uncommitted"),
        "uncommitted change should show: {patch}"
    );
    assert!(
        diffs.iter().any(|d| d.filename == "untracked.txt"),
        "untracked file should show when uncommitted is included"
    );
}

#[tokio::test]
async fn test_task_diff_uncommitted_only_excludes_committed() {
    let repo = setup_committed_and_uncommitted_repo();

    let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, true)
        .await
        .expect("uncommitted-only diff");

    let tracked = diffs
        .iter()
        .find(|d| d.filename == "tracked.txt")
        .expect("tracked.txt in diff");
    let patch = tracked.patch.as_deref().unwrap_or("");
    assert!(
        patch.contains("+uncommitted"),
        "uncommitted change should show: {patch}"
    );
    assert!(
            !patch.contains("+committed"),
            "committed change is already in HEAD and must NOT re-appear in uncommitted-only mode: {patch}"
        );
    assert!(
        diffs.iter().any(|d| d.filename == "untracked.txt"),
        "untracked file should show in uncommitted-only mode"
    );
}

#[tokio::test]
async fn test_task_diff_neither_scope_is_empty() {
    let repo = setup_committed_and_uncommitted_repo();

    let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, false)
        .await
        .expect("empty-scope diff");

    assert!(
        diffs.is_empty(),
        "no scope selected yields no diff, got {diffs:?}"
    );
}

#[tokio::test]
async fn test_task_diff_uncommitted_only_works_without_base_candidate() {
    // No origin/main, main, or master shares history with HEAD — committed mode
    // would error, but uncommitted-only compares against HEAD and must still work.
    let repo = init_git_repo();
    run_git(repo.path(), &["checkout", "-B", "trunk"]);
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "trunk base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\nuncommitted\n");

    let diffs = get_task_diff_for_workspace(repo.path().to_str().unwrap(), false, true)
        .await
        .expect("uncommitted-only diff should not require a base candidate");

    let tracked = diffs
        .iter()
        .find(|d| d.filename == "tracked.txt")
        .expect("tracked.txt in diff");
    assert!(tracked
        .patch
        .as_deref()
        .unwrap_or("")
        .contains("+uncommitted"));
}

#[tokio::test]
async fn test_task_file_contents_committed_only_uses_merge_base_and_head() {
    let repo = setup_committed_and_uncommitted_repo();

    let contents = get_task_file_contents_for_workspace(
        repo.path().to_str().unwrap(),
        "tracked.txt",
        None,
        "modified",
        true,
        false,
    )
    .await
    .expect("committed-only file contents");

    assert_eq!(contents.old_content, "base\n", "old = merge-base version");
    assert_eq!(
        contents.new_content, "base\ncommitted\n",
        "new = HEAD version"
    );
}

#[tokio::test]
async fn test_task_file_contents_uncommitted_only_uses_head_and_worktree() {
    let repo = setup_committed_and_uncommitted_repo();

    let contents = get_task_file_contents_for_workspace(
        repo.path().to_str().unwrap(),
        "tracked.txt",
        None,
        "modified",
        false,
        true,
    )
    .await
    .expect("uncommitted-only file contents");

    assert_eq!(
        contents.old_content, "base\ncommitted\n",
        "old = HEAD version"
    );
    assert_eq!(
        contents.new_content, "base\ncommitted\nuncommitted\n",
        "new = working-tree version"
    );
}

#[tokio::test]
async fn test_task_commits_falls_back_to_local_main_without_origin_main() {
    let repo = init_git_repo();
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
    commit_all(repo.path(), "feature commit");

    let commits = get_task_commits_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("local-only repositories without origin/main should still produce commit history");

    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].message, "feature commit");
}

#[tokio::test]
async fn test_task_commits_prefers_origin_main_when_available() {
    let repo = init_git_repo();
    write_repo_file(repo.path(), "tracked.txt", "root\n");
    commit_all(repo.path(), "root commit");
    write_repo_file(repo.path(), "tracked.txt", "root\norigin base\n");
    commit_all(repo.path(), "origin base commit");
    run_git(
        repo.path(),
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );
    run_git(repo.path(), &["reset", "--hard", "HEAD~1"]);
    run_git(repo.path(), &["checkout", "-b", "feature", "origin/main"]);
    write_repo_file(repo.path(), "tracked.txt", "root\norigin base\nfeature\n");
    commit_all(repo.path(), "feature commit");

    let commits = get_task_commits_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect("origin/main should be used when available");

    let messages: Vec<&str> = commits
        .iter()
        .map(|commit| commit.message.as_str())
        .collect();
    assert_eq!(messages, vec!["feature commit"]);
}

#[tokio::test]
async fn test_task_diff_errors_when_no_candidate_base_exists() {
    let repo = init_git_repo();
    run_git(repo.path(), &["checkout", "-B", "trunk"]);
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "trunk base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
    commit_all(repo.path(), "feature commit");

    let err = get_task_diff_for_workspace(repo.path().to_str().unwrap(), true, false)
        .await
        .expect_err("missing base candidates should not fall back to HEAD and hide diffs");

    assert!(
        err.contains("Failed to resolve self-review base"),
        "expected explicit base-resolution error, got {err}"
    );
}

#[tokio::test]
async fn test_task_commits_errors_when_no_candidate_base_exists() {
    let repo = init_git_repo();
    run_git(repo.path(), &["checkout", "-B", "trunk"]);
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "trunk base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    write_repo_file(repo.path(), "tracked.txt", "base\nfeature\n");
    commit_all(repo.path(), "feature commit");

    let err = get_task_commits_for_workspace(repo.path().to_str().unwrap())
        .await
        .expect_err("missing base candidates should not fall back to HEAD and hide commits");

    assert!(
        err.contains("Failed to resolve self-review base"),
        "expected explicit base-resolution error, got {err}"
    );
}

#[test]
fn test_image_path_detection_is_case_insensitive() {
    assert!(is_image_path("assets/logo.PNG"));
    assert!(is_image_path("photo.jpeg"));
    assert!(is_image_path("icons/vector.svg"));
    assert!(!is_image_path("src/main.rs"));
}

#[test]
fn test_video_path_detection_and_mime_types_are_case_insensitive() {
    let cases = [
        ("recordings/demo.mp4", "video/mp4"),
        ("recordings/demo.M4V", "video/mp4"),
        ("recordings/demo.webm", "video/webm"),
        ("recordings/demo.OGV", "video/ogg"),
        ("recordings/demo.ogg", "video/ogg"),
        ("recordings/demo.MOV", "video/quicktime"),
    ];

    for (path, expected_mime_type) in cases {
        assert!(is_video_path(path), "expected {path} to be a video");
        assert_eq!(video_mime_type(path), Some(expected_mime_type));
    }
    assert!(!is_video_path("src/main.rs"));
    assert_eq!(video_mime_type("src/main.rs"), None);
}

#[test]
fn test_video_content_is_encoded_for_frontend() {
    let revision = bytes_to_frontend_revision("recordings/demo.mp4", &[0xff, 0x00, 0x7f]);

    assert_eq!(revision.content, "/wB/");
    assert_eq!(
        revision.availability,
        FileRevisionAvailability::Available { size: 3 }
    );
}

#[test]
fn test_video_content_over_the_inline_limit_is_not_encoded() {
    let bytes = vec![0_u8; MAX_INLINE_VIDEO_PREVIEW_SIZE + 1];
    let revision = bytes_to_frontend_revision("recordings/demo.webm", &bytes);

    assert!(revision.content.is_empty());
    assert_eq!(
        revision.availability,
        FileRevisionAvailability::TooLarge { size: bytes.len() }
    );
}

#[tokio::test]
async fn test_added_video_has_a_missing_old_revision_and_base64_new_revision() {
    let repo = init_git_repo();
    write_repo_file(repo.path(), "tracked.txt", "base\n");
    commit_all(repo.path(), "base commit");
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    fs::create_dir_all(repo.path().join("recordings")).expect("create recordings directory");
    fs::write(repo.path().join("recordings/demo.MP4"), [0xff, 0x00, 0x7f]).expect("write video");
    commit_all(repo.path(), "add video");

    let contents = get_task_file_contents_for_workspace(
        repo.path().to_str().expect("repo path is UTF-8"),
        "recordings/demo.MP4",
        None,
        "added",
        true,
        false,
    )
    .await
    .expect("video contents");

    assert!(contents.old_content.is_empty());
    assert_eq!(contents.old_availability, FileRevisionAvailability::Missing);
    assert_eq!(contents.new_content, "/wB/");
    assert_eq!(
        contents.new_availability,
        FileRevisionAvailability::Available { size: 3 }
    );
}

#[test]
fn test_image_content_is_encoded_for_frontend() {
    let content = bytes_to_frontend_revision("assets/logo.png", &[0x89, b'P', b'N', b'G']).content;
    assert_eq!(content, "iVBORw==");
}

#[test]
fn test_text_content_stays_text_for_frontend() {
    let content = bytes_to_frontend_revision("src/main.rs", b"fn main() {}\n").content;
    assert_eq!(content, "fn main() {}\n");
}

#[tokio::test]
async fn test_worktree_file_reads_stay_within_canonical_root() {
    let worktree = tempdir().expect("create worktree");
    fs::create_dir_all(worktree.path().join("assets")).expect("create assets directory");
    fs::write(worktree.path().join("assets/logo.png"), b"image").expect("write image");

    assert_eq!(
        read_contained_worktree_file(
            worktree.path().to_str().expect("worktree path is UTF-8"),
            "assets/logo.png",
        )
        .await,
        Some(b"image".to_vec()),
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let outside = tempdir().expect("create outside directory");
        fs::write(outside.path().join("secret.png"), b"secret").expect("write secret");
        symlink(outside.path(), worktree.path().join("linked")).expect("create symlink");

        assert_eq!(
            read_contained_worktree_file(
                worktree.path().to_str().expect("worktree path is UTF-8"),
                "linked/secret.png",
            )
            .await,
            None,
        );
    }
}

#[test]
fn test_removed_status_accepts_git_and_github_names() {
    assert!(is_removed_status("removed"));
    assert!(is_removed_status("deleted"));
    assert!(!is_removed_status("modified"));
}

#[test]
fn test_file_content_request_deserialize() {
    let json = r#"{"path":"src/main.rs","old_path":null,"status":"modified"}"#;
    let req: FileContentRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.path, "src/main.rs");
    assert!(req.old_path.is_none());
    assert_eq!(req.status, "modified");
}

#[test]
fn test_file_content_request_deserialize_with_old_path() {
    let json = r#"{"path":"new/path.rs","old_path":"old/path.rs","status":"renamed"}"#;
    let req: FileContentRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.path, "new/path.rs");
    assert_eq!(req.old_path.as_deref(), Some("old/path.rs"));
    assert_eq!(req.status, "renamed");
}

#[test]
fn test_batch_request_produces_parallel_results_structure() {
    let files = [
        FileContentRequest {
            path: "a.rs".into(),
            old_path: None,
            status: "added".into(),
        },
        FileContentRequest {
            path: "b.rs".into(),
            old_path: None,
            status: "modified".into(),
        },
        FileContentRequest {
            path: "c.rs".into(),
            old_path: Some("old_c.rs".into()),
            status: "renamed".into(),
        },
    ];

    assert_eq!(files.len(), 3);
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["a.rs", "b.rs", "c.rs"]);
}

#[test]
fn test_commit_info_serialize() {
    let info = super::CommitInfo {
        sha: "abc123def456".to_string(),
        short_sha: "abc123d".to_string(),
        message: "Fix login bug".to_string(),
        author: "dev".to_string(),
        date: "2025-01-01T00:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&info).unwrap();
    assert!(json.contains("abc123def456"));
    assert!(json.contains("abc123d"));
    assert!(json.contains("Fix login bug"));
}

#[test]
fn test_parse_git_log_output_multiple() {
    let output = "abc123\0abc\0First commit\0Alice\x002025-01-01T00:00:00Z\ndef456\0def\0Second commit\0Bob\x002025-01-02T00:00:00Z";
    let result = super::parse_git_log_output(output);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].sha, "abc123");
    assert_eq!(result[0].short_sha, "abc");
    assert_eq!(result[0].message, "First commit");
    assert_eq!(result[0].author, "Alice");
    assert_eq!(result[1].sha, "def456");
    assert_eq!(result[1].message, "Second commit");
}

#[test]
fn test_parse_git_log_output_empty() {
    let result = super::parse_git_log_output("");
    assert!(result.is_empty());
    let result = super::parse_git_log_output("   \n  ");
    assert!(result.is_empty());
}

#[test]
fn test_parse_git_log_output_malformed_line() {
    let output = "abc123\0abc\0Commit msg\0Author\x002025-01-01\nbadline";
    let result = super::parse_git_log_output(output);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].sha, "abc123");
}
