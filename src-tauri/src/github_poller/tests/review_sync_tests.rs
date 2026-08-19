use super::*;

fn make_stale_detail(state: &str, extra: serde_json::Value) -> PullRequest {
    PullRequest {
        number: 42,
        title: "Stale authored PR".to_string(),
        state: state.to_string(),
        html_url: "https://github.com/acme/repo/pull/42".to_string(),
        user: GitHubUser {
            login: "octocat".to_string(),
            extra: serde_json::json!({}),
        },
        head: GitHubHead {
            ref_name: "feature/T-100".to_string(),
            sha: "abc123".to_string(),
            extra: serde_json::json!({}),
        },
        draft: Some(false),
        mergeable: None,
        mergeable_state: None,
        extra,
    }
}

#[test]
fn test_stale_authored_pr_terminal_state_marks_merged_from_merged_at() {
    let details = make_stale_detail(
        "closed",
        serde_json::json!({
            "merged": true,
            "merged_at": "2024-01-01T00:00:00Z"
        }),
    );

    assert_eq!(
        terminal_state_for_pr_details(&details),
        Some(StaleAuthoredPrTerminalState::Merged(Some(1704067200)))
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_marks_closed_without_merged_evidence() {
    let details = make_stale_detail(
        "closed",
        serde_json::json!({
            "merged": false,
            "merged_at": null
        }),
    );

    assert_eq!(
        terminal_state_for_pr_details(&details),
        Some(StaleAuthoredPrTerminalState::Closed)
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_leaves_open_pr_open() {
    let details = make_stale_detail("open", serde_json::json!({ "merged": false }));

    assert_eq!(terminal_state_for_pr_details(&details), None);
}

#[test]
fn test_stale_authored_pr_candidates_preserve_repo_local_pr_identity() {
    let open_prs = vec![
        PrRow {
            id: 1001,
            pr_number: 42,
            ticket_id: "T-100".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "web".to_string(),
            title: "Web".to_string(),
            url: "https://github.com/acme/web/pull/42".to_string(),
            state: "open".to_string(),
            head_sha: "web-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            github_node_id: None,
            unaddressed_comment_count: 0,
        },
        PrRow {
            id: 2001,
            pr_number: 42,
            ticket_id: "T-100".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "api".to_string(),
            title: "API".to_string(),
            url: "https://github.com/acme/api/pull/42".to_string(),
            state: "open".to_string(),
            head_sha: "api-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            github_node_id: None,
            unaddressed_comment_count: 0,
        },
    ];

    let candidates = stale_authored_task_pr_candidates(open_prs, &[1001]);

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, 2001);
    assert_eq!(candidates[0].repo_name, "api");
    assert_eq!(candidates[0].pr_number, 42);
}

#[test]
fn test_sync_open_prs_error_rate_limit_detection_uses_typed_github_error() {
    let rate_limited = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "Too Many Requests".to_string(),
    });
    assert!(rate_limited.should_increment_rate_limit_count());

    let forbidden = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 403,
        message: "Forbidden".to_string(),
    });
    assert!(!forbidden.should_increment_rate_limit_count());

    let non_rate_limited = SyncOpenPrsError::Db("boom".to_string());
    assert!(!non_rate_limited.should_increment_rate_limit_count());
}

#[test]
fn test_sync_open_prs_error_sanitized_log_message_redacts_body_and_identity() {
    let error = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "token ghp_secret body https://api.github.com/repos/acme/private/pulls?user=alice"
            .to_string(),
    });

    let sanitized = error.sanitized_log_message("authored task PR link sync");

    assert!(sanitized.contains("phase authored task PR link sync"));
    assert!(sanitized.contains("status 429"));
    assert!(sanitized.contains("rate_limited true"));
    assert!(!sanitized.contains("ghp_secret"));
    assert!(!sanitized.contains("https://api.github.com"));
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
    assert!(!sanitized.contains("alice"));
    assert!(!sanitized.contains("body"));
}

#[test]
fn test_contains_task_id_matches_boundaries() {
    assert!(contains_task_id("T-42 fix auth", "T-42"));
    assert!(contains_task_id("fix auth T-42", "T-42"));
    assert!(contains_task_id("feature/T-42/auth", "T-42"));
    assert!(contains_task_id("feature/T-42-auth", "T-42"));
    assert!(contains_task_id("T-42: fix auth", "T-42"));
}

#[test]
fn test_contains_task_id_rejects_substring_false_positive() {
    assert!(!contains_task_id("fixT-42bug", "T-42"));
    assert!(!contains_task_id("Fix T-12 issue", "T-1"));
    assert!(!contains_task_id("feature/T-123", "T-12"));
}

#[test]
fn test_classify_task_matches_returns_unique_match() {
    let task_ids = vec!["T-42".to_string(), "T-99".to_string()];

    match classify_task_matches("Fix bug T-42", &task_ids) {
        TaskMatchOutcome::Unique(task_id) => assert_eq!(task_id, "T-42"),
        TaskMatchOutcome::None | TaskMatchOutcome::Ambiguous => {
            panic!("expected unique task match")
        }
    }
}

#[test]
fn test_classify_task_matches_rejects_ambiguous_matches() {
    let task_ids = vec!["T-1".to_string(), "T-2".to_string()];

    assert!(matches!(
        classify_task_matches("Fix T-1 and T-2", &task_ids),
        TaskMatchOutcome::Ambiguous
    ));
}

#[test]
fn test_classify_task_matches_returns_none_for_no_matches() {
    let task_ids = vec!["T-100".to_string()];

    assert!(matches!(
        classify_task_matches("Update documentation", &task_ids),
        TaskMatchOutcome::None
    ));
}

#[test]
fn test_find_authoritative_task_id_prefers_branch_match_over_title_and_body_match() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched =
        find_authoritative_task_id("Fix T-2", "feature/T-1-auth", Some("Closes T-3"), &task_ids);

    assert_eq!(matched.as_deref(), Some("T-1"));
}

#[test]
fn test_find_authoritative_task_id_uses_unique_title_match_when_branch_has_none() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched = find_authoritative_task_id("Fix T-3", "feature/auth", None, &task_ids);

    assert_eq!(matched.as_deref(), Some("T-3"));
}

#[test]
fn test_find_authoritative_task_id_uses_unique_body_match_when_branch_and_title_have_none() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

    let matched = find_authoritative_task_id(
        "Fix authentication",
        "feature/auth",
        Some("Implementation for Task T-3."),
        &task_ids,
    );

    assert_eq!(matched.as_deref(), Some("T-3"));
}

#[test]
fn test_find_authoritative_task_id_rejects_ambiguous_body_matches() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

    let matched = find_authoritative_task_id(
        "Fix authentication",
        "feature/auth",
        Some("Covers T-1 and T-2."),
        &task_ids,
    );

    assert_eq!(matched, None);
}

#[test]
fn test_find_authoritative_task_id_rejects_ambiguous_title_matches() {
    let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

    let matched = find_authoritative_task_id("Fix T-1 before T-2", "feature/auth", None, &task_ids);

    assert_eq!(matched, None);
}

fn wt_entry(task_id: &str, owner: &str, name: &str, branch: &str) -> WorktreeBranchEntry {
    WorktreeBranchEntry {
        task_id: task_id.to_string(),
        repo_owner: owner.to_string(),
        repo_name: name.to_string(),
        branch: branch.to_string(),
    }
}

#[test]
fn test_worktree_branch_index_matches_repo_scoped_branch() {
    let index = WorktreeBranchIndex::build(vec![wt_entry(
        "AVIV-152",
        "acme",
        "web",
        "refactor/item-60-tag-write-tests",
    )]);

    assert_eq!(
        index.task_for("acme", "web", "refactor/item-60-tag-write-tests"),
        Some("AVIV-152")
    );
}

#[test]
fn test_worktree_branch_index_is_repo_scoped() {
    let index = WorktreeBranchIndex::build(vec![wt_entry("AVIV-152", "acme", "web", "shared")]);

    // Same branch name, different repo must not match — task ids are globally
    // unique but branch names are not, so a cross-repo branch collision must
    // never produce a link.
    assert_eq!(index.task_for("acme", "api", "shared"), None);
    assert_eq!(index.task_for("other", "web", "shared"), None);
}

#[test]
fn test_worktree_branch_index_drops_ambiguous_branch() {
    let index = WorktreeBranchIndex::build(vec![
        wt_entry("T-1", "acme", "web", "dev"),
        wt_entry("T-2", "acme", "web", "dev"),
    ]);

    // Two distinct tasks claiming the same repo+branch is ambiguous; the index
    // must drop it rather than guess.
    assert_eq!(index.task_for("acme", "web", "dev"), None);
}

#[test]
fn test_worktree_branch_index_keeps_repeated_same_task_entry() {
    let index = WorktreeBranchIndex::build(vec![
        wt_entry("T-1", "acme", "web", "openforge/T-1"),
        wt_entry("T-1", "acme", "web", "openforge/T-1"),
    ]);

    // The provisioned branch and the resolved current branch can be identical;
    // repeating the same task for the same branch is not a collision.
    assert_eq!(index.task_for("acme", "web", "openforge/T-1"), Some("T-1"));
}

#[test]
fn test_resolve_authored_pr_task_id_links_by_head_branch_without_textual_task_id() {
    let index = WorktreeBranchIndex::build(vec![wt_entry(
        "AVIV-152",
        "acme",
        "web",
        "refactor/item-60-tag-write-tests",
    )]);

    // Descriptive branch, title, and body all omit the task id — only the
    // worktree index can link this PR.
    let matched = resolve_authored_pr_task_id(
        "acme",
        "web",
        "refactor/item-60-tag-write-tests",
        "Add tag write tests",
        Some("Covers tag writes end to end"),
        &["AVIV-152".to_string()],
        &index,
    );

    assert_eq!(matched.as_deref(), Some("AVIV-152"));
}

#[test]
fn test_resolve_authored_pr_task_id_falls_back_to_textual_match() {
    let index = WorktreeBranchIndex::build(Vec::new());

    let matched = resolve_authored_pr_task_id(
        "acme",
        "web",
        "feature/auth",
        "Fix T-3 bug",
        None,
        &["T-3".to_string()],
        &index,
    );

    assert_eq!(matched.as_deref(), Some("T-3"));
}

#[test]
fn test_resolve_authored_pr_task_id_prefers_head_branch_over_textual_match() {
    let index = WorktreeBranchIndex::build(vec![wt_entry("T-1", "acme", "web", "custom-branch")]);

    // The head branch belongs to T-1's worktree, but the title textually
    // mentions T-2. The authoritative worktree branch wins.
    let matched = resolve_authored_pr_task_id(
        "acme",
        "web",
        "custom-branch",
        "Fix T-2 regression",
        None,
        &["T-1".to_string(), "T-2".to_string()],
        &index,
    );

    assert_eq!(matched.as_deref(), Some("T-1"));
}

#[test]
fn test_resolve_authored_pr_task_id_ignores_index_for_different_repo() {
    let index = WorktreeBranchIndex::build(vec![wt_entry("AVIV-152", "acme", "web", "shared")]);

    // PR shares the branch name but lives in a different repo; with no textual
    // task id anywhere there must be no link.
    let matched = resolve_authored_pr_task_id(
        "acme",
        "api",
        "shared",
        "Add tag write tests",
        None,
        &["AVIV-152".to_string()],
        &index,
    );

    assert_eq!(matched, None);
}

fn run_git(repo_path: &std::path::Path, args: &[&str]) {
    let output = std::process::Command::new("git")
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

fn init_repo_on_branch(repo_path: &std::path::Path, origin_url: &str, branch: &str) {
    std::fs::create_dir_all(repo_path).expect("repo dir");
    run_git(repo_path, &["init", "-b", "main"]);
    run_git(repo_path, &["config", "user.email", "test@example.com"]);
    run_git(repo_path, &["config", "user.name", "Test User"]);
    run_git(repo_path, &["config", "commit.gpgsign", "false"]);
    run_git(repo_path, &["remote", "add", "origin", origin_url]);
    std::fs::write(repo_path.join("README.md"), "repo\n").expect("write readme");
    run_git(repo_path, &["add", "README.md"]);
    run_git(repo_path, &["commit", "-m", "initial"]);
    run_git(repo_path, &["checkout", "-b", branch]);
}

#[tokio::test]
async fn test_build_worktree_branch_index_indexes_provisioned_and_current_branches() {
    use crate::db::test_helpers::make_test_db;

    let temp = tempfile::tempdir().expect("tempdir");
    let repo_path = temp.path().join("repo");
    // Worktree checked out on a hand-named branch that shares no text with the
    // task id — the exact scenario the provisioned-branch-only match misses.
    init_repo_on_branch(
        &repo_path,
        "git@github.com:acme/web.git",
        "refactor/item-60-tag-write-tests",
    );

    let (db, db_path) = make_test_db("build_worktree_branch_index");
    let project = db
        .create_project("Web", repo_path.to_str().unwrap())
        .expect("create project");
    let task = db
        .create_task("Tag write tests", "doing", Some(&project.id), None, None)
        .expect("create task");
    db.create_worktree_record(
        &task.id,
        &project.id,
        repo_path.to_str().unwrap(),
        repo_path.to_str().unwrap(),
        "openforge/T-1",
    )
    .expect("create worktree record");

    let db = Mutex::new(db);
    let index = build_worktree_branch_index(&db).await;

    // Linkable by the actual checked-out branch...
    assert_eq!(
        index.task_for("acme", "web", "refactor/item-60-tag-write-tests"),
        Some(task.id.as_str())
    );
    // ...and still by the provisioned branch.
    assert_eq!(
        index.task_for("acme", "web", "openforge/T-1"),
        Some(task.id.as_str())
    );
    // Repo-scoped: a matching branch in a different repo does not link.
    assert_eq!(
        index.task_for("acme", "api", "refactor/item-60-tag-write-tests"),
        None
    );

    drop(db);
    let _ = std::fs::remove_file(&db_path);
}

#[test]
fn test_poll_phase_error_rate_limit_detection_uses_typed_github_error() {
    let rate_limited = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "Too Many Requests".to_string(),
    });
    assert!(rate_limited.should_increment_rate_limit_count());

    let forbidden = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 403,
        message: "Forbidden".to_string(),
    });
    assert!(!forbidden.should_increment_rate_limit_count());

    let non_rate_limited = PollPhaseError::Db("boom".to_string());
    assert!(!non_rate_limited.should_increment_rate_limit_count());
}

#[test]
fn test_poll_phase_error_sanitized_log_message_preserves_phase_and_status_only() {
    let error = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
        status: 429,
        message: "token ghp_secret body https://api.github.com/repos/acme/private/pulls?user=alice"
            .to_string(),
    });

    let sanitized = error.sanitized_log_message("review PRs");

    assert!(sanitized.contains("phase review PRs"));
    assert!(sanitized.contains("status 429"));
    assert!(sanitized.contains("rate_limited true"));
    assert!(!sanitized.contains("ghp_secret"));
    assert!(!sanitized.contains("https://api.github.com"));
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
    assert!(!sanitized.contains("alice"));
    assert!(!sanitized.contains("body"));
}

#[test]
fn test_poll_phase_error_sanitized_log_message_redacts_db_message() {
    let error = PollPhaseError::Db("database path mentions owner acme repo private".to_string());

    let sanitized = error.sanitized_log_message("authored PRs");

    assert_eq!(sanitized, "phase authored PRs: database error");
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
}

#[test]
fn test_count_poll_phase_error_increments_total_errors_and_rate_limit_count_on_failure() {
    let mut total_errors = 0;
    let mut rate_limit_count = 0;

    count_poll_phase_error(
        "review PRs",
        Err(PollPhaseError::GitHub(
            crate::github_client::GitHubError::ApiError {
                status: 429,
                message: "Too Many Requests".to_string(),
            },
        )),
        &mut total_errors,
        &mut rate_limit_count,
    );
    count_poll_phase_error(
        "authored PRs",
        Err(PollPhaseError::Db("boom".to_string())),
        &mut total_errors,
        &mut rate_limit_count,
    );

    assert_eq!(total_errors, 2);
    assert_eq!(rate_limit_count, 1);
}

#[test]
fn test_count_poll_phase_error_leaves_counters_unchanged_on_success() {
    let mut total_errors = 3;
    let mut rate_limit_count = 2;

    count_poll_phase_error(
        "review PRs",
        Ok(()),
        &mut total_errors,
        &mut rate_limit_count,
    );

    assert_eq!(total_errors, 3);
    assert_eq!(rate_limit_count, 2);
}
