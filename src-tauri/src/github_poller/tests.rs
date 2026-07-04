use super::common::*;
use super::persistence::*;
use super::pr_execution::*;
use super::review_sync::*;
use super::scheduling::*;
use crate::backend_runtime::AppHandle;
use crate::db::test_helpers::{insert_test_task, make_test_db};
use crate::db::{select_snapshot_readiness_inputs, PrMergeReadinessFacts, PrRow, ProjectRow};
use crate::github_client::{
    CheckRun, CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubHead,
    GitHubReadinessSnapshot, GitHubUser, PrComment, PrReview, PullRequest,
};
use std::collections::HashSet;
use std::sync::Mutex;

fn make_project(id: &str) -> ProjectRow {
    ProjectRow {
        id: id.to_string(),
        name: format!("project {id}"),
        path: format!("/tmp/{id}"),
        created_at: 0,
        updated_at: 0,
    }
}

fn reported_ctx(
    focused: bool,
    active_project_id: Option<&str>,
    global_view_open: bool,
) -> PollContextSnapshot {
    PollContextSnapshot {
        reported: true,
        focused,
        active_project_id: active_project_id.map(|s| s.to_string()),
        global_view_open,
    }
}
fn make_pr(
    id: i64,
    ticket_id: &str,
    project_id: &str,
    task_status: &str,
    ci_status: Option<&str>,
    readiness_status: Option<&str>,
) -> ScheduledPr {
    ScheduledPr {
        pr: PrRow {
            id,
            pr_number: id,
            ticket_id: ticket_id.to_string(),
            repo_owner: "acme".to_string(),
            repo_name: project_id.to_string(),
            title: format!("PR {id}"),
            url: format!("https://github.com/acme/{project_id}/pull/{id}"),
            state: "open".to_string(),
            head_sha: format!("sha-{id}"),
            ci_status: ci_status.map(str::to_string),
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 0,
            updated_at: 0,
            draft: false,
            is_queued: false,
            merge_readiness_status: readiness_status.map(str::to_string),
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
            unaddressed_comment_count: 0,
        },
        project_id: project_id.to_string(),
        task_status: task_status.to_string(),
        low_fire: false,
    }
}

#[test]
fn test_format_sync_scope_log_includes_scope_and_fanout() {
    let message =
        format_sync_scope_log(&PollScope::ActiveTaskPrs(Some("active".to_string())), 3, 7);

    assert!(message.contains("scope=active-task-prs"));
    assert!(message.contains("active_project=active"));
    assert!(message.contains("projects=3"));
    assert!(message.contains("prs=7"));
}

#[test]
fn test_format_sync_phase_log_includes_phase_duration_and_counts() {
    let message = format_sync_phase_log("global review PR list", 1.25, Some("fetched 4 PRs"));

    assert_eq!(
        message,
        "[GitHub Poller] Finished global review PR list in 1.2s (fetched 4 PRs)"
    );
}

#[test]
fn test_format_rate_limit_pause_log_includes_reset_delay_and_scope() {
    let message =
        format_rate_limit_pause_log(Some(1_120), 1_000, &PollScope::GlobalReviewLists, 121);

    assert_eq!(
        message,
        "[GitHub Poller] Rate limit paused GitHub sync after scope=global-review-lists; reset_at=1120 (in 120s), sleeping 121s"
    );
}

#[test]
fn test_scheduler_prioritizes_active_focus_task_prs_before_lower_budget_work() {
    let plan = build_poll_plan(
        &reported_ctx(true, Some("active"), false),
        PollSchedulerSnapshot {
            linked_prs: vec![
                make_pr(
                    1,
                    "T-focus",
                    "active",
                    "doing",
                    Some("success"),
                    Some("blocked"),
                ),
                make_pr(
                    2,
                    "T-other",
                    "active",
                    "backlog",
                    Some("success"),
                    Some("blocked"),
                ),
                make_pr(
                    3,
                    "T-inactive",
                    "inactive",
                    "doing",
                    Some("success"),
                    Some("blocked"),
                ),
            ],
            rate_limited: false,
            rate_limit_reset_at: None,
            global_review_due: true,
        },
        60,
        1_000,
    );

    assert_eq!(
        plan.scopes,
        vec![
            PollScope::ActiveFocusTaskPrs(Some("active".to_string())),
            PollScope::ActiveTaskPrs(Some("active".to_string())),
            PollScope::InactiveTaskPrs(Some("active".to_string())),
            PollScope::GlobalReviewLists,
        ]
    );
    assert_eq!(plan.sleep_secs, 60);
}
#[test]
fn test_scheduler_keeps_global_review_lists_due_gated_even_when_global_view_open() {
    let plan = build_poll_plan(
        &reported_ctx(true, Some("active"), true),
        PollSchedulerSnapshot {
            linked_prs: Vec::new(),
            rate_limited: false,
            rate_limit_reset_at: None,
            global_review_due: false,
        },
        60,
        1_000,
    );

    assert!(plan.scopes.is_empty());
}

#[test]
fn test_scheduler_uses_fast_cadence_while_active_focus_ci_is_pending() {
    let plan = build_poll_plan(
        &reported_ctx(true, Some("active"), false),
        PollSchedulerSnapshot {
            linked_prs: vec![make_pr(
                1,
                "T-focus",
                "active",
                "doing",
                Some("pending"),
                Some("pending"),
            )],
            rate_limited: false,
            rate_limit_reset_at: None,
            global_review_due: false,
        },
        60,
        1_000,
    );

    assert_eq!(plan.sleep_secs, MIN_GITHUB_POLL_INTERVAL_SECS);
}

#[test]
fn test_scheduler_slows_down_after_readiness_settles() {
    let plan = build_poll_plan(
        &reported_ctx(true, Some("active"), false),
        PollSchedulerSnapshot {
            linked_prs: vec![make_pr(
                1,
                "T-focus",
                "active",
                "doing",
                Some("success"),
                Some("ready"),
            )],
            rate_limited: false,
            rate_limit_reset_at: None,
            global_review_due: false,
        },
        60,
        1_000,
    );

    assert_eq!(plan.sleep_secs, 120);
}

#[test]
fn test_scheduler_slows_when_unfocused_without_github_calls() {
    let plan = build_poll_plan(
        &reported_ctx(false, Some("active"), false),
        PollSchedulerSnapshot {
            linked_prs: vec![make_pr(
                1,
                "T-focus",
                "active",
                "doing",
                Some("pending"),
                None,
            )],
            rate_limited: false,
            rate_limit_reset_at: None,
            global_review_due: false,
        },
        60,
        1_000,
    );

    assert!(plan.scopes.is_empty());
    assert_eq!(plan.sleep_secs, MAX_GITHUB_POLL_INTERVAL_SECS);
}

#[test]
fn test_scheduler_rate_limit_sleep_honors_reset_before_any_priority_work() {
    let plan = build_poll_plan(
        &reported_ctx(true, Some("active"), false),
        PollSchedulerSnapshot {
            linked_prs: vec![make_pr(
                1,
                "T-focus",
                "active",
                "doing",
                Some("pending"),
                None,
            )],
            rate_limited: true,
            rate_limit_reset_at: Some(1_120),
            global_review_due: false,
        },
        60,
        1_000,
    );

    assert!(plan.scopes.is_empty());
    assert_eq!(plan.sleep_secs, 121);
}
#[test]
fn test_decide_poll_unreported_falls_back_to_global() {
    // Before the frontend reports, behave like the pre-feature poller.
    assert_eq!(
        decide_poll(&PollContextSnapshot::default()),
        PollDecision::Poll(PollScope::Global)
    );
}

#[test]
fn test_decide_poll_skips_when_unfocused() {
    let ctx = reported_ctx(false, Some("p1"), true);
    assert_eq!(decide_poll(&ctx), PollDecision::Skip);
}

#[test]
fn test_decide_poll_global_when_global_view_open() {
    let ctx = reported_ctx(true, Some("p1"), true);
    assert_eq!(decide_poll(&ctx), PollDecision::Poll(PollScope::Global));
}

#[test]
fn test_decide_poll_active_repo_when_global_view_closed() {
    let ctx = reported_ctx(true, Some("p1"), false);
    assert_eq!(
        decide_poll(&ctx),
        PollDecision::Poll(PollScope::ActiveRepo(Some("p1".to_string())))
    );
}

#[test]
fn test_decide_poll_active_repo_none_when_no_active_project() {
    let ctx = reported_ctx(true, None, false);
    assert_eq!(
        decide_poll(&ctx),
        PollDecision::Poll(PollScope::ActiveRepo(None))
    );
}

#[test]
fn test_select_projects_global_returns_all() {
    let all = vec![make_project("a"), make_project("b")];
    assert_eq!(select_projects(all, &PollScope::Global).len(), 2);
}

#[test]
fn test_select_projects_active_repo_filters_to_one() {
    let all = vec![make_project("a"), make_project("b")];
    let got = select_projects(all, &PollScope::ActiveRepo(Some("b".to_string())));
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].id, "b");
}

#[test]
fn test_select_projects_active_repo_none_returns_empty() {
    let all = vec![make_project("a"), make_project("b")];
    assert!(select_projects(all, &PollScope::ActiveRepo(None)).is_empty());
}

#[test]
fn refresh_task_github_status_selects_only_open_prs_for_requested_task() {
    let (db, path) = make_test_db("refresh_task_github_status_selects_task_prs");
    let task = db
        .create_task("Selected task", "doing", None, None, None)
        .expect("create selected task");
    let other_task = db
        .create_task("Other task", "doing", None, None, None)
        .expect("create other task");
    db.insert_pull_request_with_number(
        101,
        1,
        &task.id,
        "owner",
        "repo",
        "Selected open PR",
        "https://github.com/owner/repo/pull/1",
        "open",
        1000,
        3000,
        false,
    )
    .expect("insert selected open PR");
    db.insert_pull_request_with_number(
        102,
        2,
        &task.id,
        "owner",
        "repo",
        "Closed selected PR",
        "https://github.com/owner/repo/pull/2",
        "closed",
        1000,
        2000,
        false,
    )
    .expect("insert selected closed PR");
    db.insert_pull_request_with_number(
        103,
        3,
        &other_task.id,
        "owner",
        "repo",
        "Other task PR",
        "https://github.com/owner/repo/pull/3",
        "open",
        1000,
        4000,
        false,
    )
    .expect("insert other task PR");
    let db = Mutex::new(db);

    let prs = get_open_prs_for_task(&db, &task.id).expect("select task prs");

    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].id, 101);
    assert_eq!(prs[0].ticket_id, task.id);

    let _ = std::fs::remove_file(path);
}

#[test]
fn refresh_task_github_status_rejects_unknown_task_before_polling() {
    let (db, path) = make_test_db("refresh_task_github_status_unknown_task");
    let db = Mutex::new(db);

    let error = get_open_prs_for_task(&db, "T-missing").expect_err("missing task");

    assert!(error.contains("Task not found: T-missing"));

    let _ = std::fs::remove_file(path);
}

#[test]
fn test_poll_context_set_and_snapshot() {
    let ctx = PollContext::new();
    assert_eq!(ctx.snapshot(), PollContextSnapshot::default());
    ctx.set(false, Some("p9".to_string()), true);
    assert_eq!(
        ctx.snapshot(),
        PollContextSnapshot {
            reported: true,
            focused: false,
            active_project_id: Some("p9".to_string()),
            global_view_open: true,
        }
    );
}

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
        terminal_state_for_stale_authored_pr(&details),
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
        terminal_state_for_stale_authored_pr(&details),
        Some(StaleAuthoredPrTerminalState::Closed)
    );
}

#[test]
fn test_stale_authored_pr_terminal_state_leaves_open_pr_open() {
    let details = make_stale_detail("open", serde_json::json!({ "merged": false }));

    assert_eq!(terminal_state_for_stale_authored_pr(&details), None);
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
fn test_poll_result_construction() {
    let result = PollResult {
        new_comments: 3,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 1,
        rate_limited: false,
        rate_limit_reset_at: None,
    };

    assert_eq!(result.new_comments, 3);
    assert_eq!(result.ci_changes, 0);
    assert_eq!(result.review_changes, 0);
    assert_eq!(result.pr_changes, 0);
    assert_eq!(result.errors, 1);
    assert!(!result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, None);
}

#[test]
fn test_poll_result_rate_limit_fields_default() {
    let result = PollResult {
        new_comments: 0,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: None,
    };

    assert!(!result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, None);
}

#[test]
fn test_poll_result_serialization_includes_rate_limit() {
    let result = PollResult {
        new_comments: 5,
        ci_changes: 2,
        review_changes: 1,
        pr_changes: 0,
        errors: 0,
        rate_limited: true,
        rate_limit_reset_at: Some(1704067200),
    };

    let json = serde_json::to_string(&result).expect("serialization failed");
    assert!(json.contains("\"rate_limited\":true"));
    assert!(json.contains("\"rate_limit_reset_at\":1704067200"));
}

#[test]
fn test_poll_result_deserialization_backward_compat() {
    let old_json = r#"{
        "new_comments": 3,
        "ci_changes": 1,
        "review_changes": 0,
        "pr_changes": 0,
        "errors": 0
    }"#;

    let result: PollResult = serde_json::from_str(old_json).expect("deserialization failed");
    assert_eq!(result.new_comments, 3);
    assert_eq!(result.ci_changes, 1);
    assert_eq!(result.review_changes, 0);
    assert_eq!(result.pr_changes, 0);
    assert_eq!(result.errors, 0);
    assert!(!result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, None);
}

#[test]
fn test_parse_github_timestamp() {
    let timestamp = "2024-01-01T00:00:00Z";
    let result = parse_github_timestamp(timestamp);
    assert!(result.is_some());
    assert_eq!(result.unwrap(), 1704067200);
}

#[test]
fn test_parse_github_timestamp_invalid() {
    let timestamp = "invalid";
    let result = parse_github_timestamp(timestamp);
    assert!(result.is_none());
}

#[test]
fn test_mergeability_after_pr_details_preserves_previous_values_on_error() {
    let result = mergeability_after_pr_details(
        &Err(crate::github_client::GitHubError::NetworkError(
            "boom".to_string(),
        )),
        Some(false),
        Some("dirty".to_string()),
    );

    assert_eq!(result, (Some(false), Some("dirty".to_string())));
}

#[test]
fn test_mergeability_after_pr_details_uses_fetched_unknown_state() {
    let details = crate::github_client::PullRequest {
        number: 1,
        title: "Test PR".to_string(),
        state: "open".to_string(),
        html_url: "https://github.com/acme/repo/pull/1".to_string(),
        user: crate::github_client::GitHubUser {
            login: "octocat".to_string(),
            extra: serde_json::json!({}),
        },
        head: crate::github_client::GitHubHead {
            ref_name: "feature/test".to_string(),
            sha: "abc123".to_string(),
            extra: serde_json::json!({}),
        },
        draft: Some(false),
        mergeable: None,
        mergeable_state: Some("unknown".to_string()),
        extra: serde_json::json!({}),
    };

    let result =
        mergeability_after_pr_details(&Ok(details), Some(false), Some("dirty".to_string()));

    assert_eq!(result, (None, Some("unknown".to_string())));
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

#[test]
fn test_should_fetch_comments_for_pr_uses_changed_pr_subset() {
    let changed_pr_numbers = HashSet::from([11]);

    assert!(!should_fetch_comments_for_pr(10, &changed_pr_numbers));
    assert!(should_fetch_comments_for_pr(11, &changed_pr_numbers));
}

#[test]
fn test_should_fetch_comments_for_pr_falls_back_to_all_prs_without_events() {
    let changed_pr_numbers = HashSet::new();

    assert!(should_fetch_comments_for_pr(20, &changed_pr_numbers));
    assert!(should_fetch_comments_for_pr(21, &changed_pr_numbers));
}

#[test]
fn test_poller_uses_managed_github_client() {
    let managed_client = GitHubClient::new();
    let app = AppHandle::new();
    app.manage(managed_client.clone());

    let state_client = app.state::<GitHubClient>();
    let poller_client = state_client.inner();

    assert!(poller_client.shares_cache_with(&managed_client));
}

#[test]
fn test_poll_result_rate_limited_true_with_reset_timestamp() {
    let result = PollResult {
        new_comments: 5,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: true,
        rate_limit_reset_at: Some(1704067200),
    };

    assert!(result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, Some(1704067200));
}

#[test]
fn test_poll_result_rate_limited_with_changes_can_coexist() {
    // This test verifies that rate_limited=true and new_comments>0 can both be true
    // (the confusing case where a cycle detects rate limit but still has changes)
    let result = PollResult {
        new_comments: 3,
        ci_changes: 1,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: true,
        rate_limit_reset_at: Some(1704067200),
    };

    // Verify both conditions are true simultaneously
    assert!(result.rate_limited);
    assert!(result.new_comments > 0);
    assert!(result.ci_changes > 0);
    assert_eq!(result.rate_limit_reset_at, Some(1704067200));
}

#[test]
fn test_poll_result_rate_limited_false_when_no_reset_detected() {
    let result = PollResult {
        new_comments: 2,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: None,
    };

    assert!(!result.rate_limited);
    assert_eq!(result.rate_limit_reset_at, None);
}

fn make_review_body_poll_result(pr_id: i64) -> PollSinglePrResult {
    let review = PrReview {
        id: 42,
        user: crate::github_client::GitHubUser {
            login: "reviewer".to_string(),
            extra: serde_json::json!({}),
        },
        state: "COMMENTED".to_string(),
        body: Some("Looks good overall".to_string()),
        submitted_at: Some("2024-01-01T00:00:00Z".to_string()),
        extra: serde_json::json!({}),
    };

    PollSinglePrResult {
        pr_id,
        ticket_id: "T-100".to_string(),
        pr_title: "Review body test".to_string(),
        head_sha: "abc123".to_string(),
        ci_validation_sha: "abc123".to_string(),
        old_ci_status: None,
        old_review_status: None,
        comments: vec![PrComment {
            id: -review.id,
            body: review.body.clone().expect("review body should exist"),
            user: review.user.clone(),
            path: None,
            line: None,
            comment_type: "review_body".to_string(),
            created_at: review
                .submitted_at
                .clone()
                .expect("submitted_at should exist"),
        }],
        check_runs: None,
        combined_status: None,
        reviews: Some(vec![review]),
        has_requested_reviewers: false,
        mergeable: None,
        mergeable_state: None,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        readiness_facts: PrMergeReadinessFacts {
            status: None,
            action: None,
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some("abc123".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        },
        error: None,
    }
}

#[test]
fn test_persist_polled_comments_does_not_fail_when_review_body_exists_in_both_sources() {
    let (db, path) = make_test_db("persist_polled_comments_review_body_once");
    insert_test_task(&db);
    db.insert_pull_request(
        42,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/42",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let result = make_review_body_poll_result(42);
    let existing_ids = db
        .get_existing_comment_ids(42)
        .expect("get existing ids failed");
    let events = GitHubEventTarget::sidecar(None);

    let persist_result = persist_polled_comments(&events, &db, &result, &existing_ids, 1000);
    let comments = db.get_comments_for_pr(42).expect("get comments failed");

    assert_eq!(persist_result.failed_insert_count, 0);
    assert_eq!(persist_result.new_comment_count, 1);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);
    assert_eq!(comments[0].comment_type, "review_body");

    drop(db);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_persist_polled_comments_is_idempotent_across_poll_cycles_for_review_bodies() {
    let (db, path) = make_test_db("persist_polled_comments_review_body_idempotent");
    insert_test_task(&db);
    db.insert_pull_request(
        84,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/84",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let result = make_review_body_poll_result(84);
    let events = GitHubEventTarget::sidecar(None);

    let first_existing_ids = db
        .get_existing_comment_ids(84)
        .expect("get initial existing ids failed");
    let first_persist = persist_polled_comments(&events, &db, &result, &first_existing_ids, 1000);

    let second_existing_ids = db
        .get_existing_comment_ids(84)
        .expect("get second existing ids failed");
    let second_persist = persist_polled_comments(&events, &db, &result, &second_existing_ids, 1000);

    let comments = db.get_comments_for_pr(84).expect("get comments failed");

    assert_eq!(first_persist.failed_insert_count, 0);
    assert_eq!(first_persist.new_comment_count, 1);
    assert_eq!(second_persist.failed_insert_count, 0);
    assert_eq!(second_persist.new_comment_count, 0);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);

    drop(db);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn test_persist_polled_comments_deduplicates_repeated_ids_within_batch() {
    let (db, path) = make_test_db("persist_polled_comments_batch_dedup");
    insert_test_task(&db);
    db.insert_pull_request(
        126,
        "T-100",
        "acme",
        "repo",
        "Review body test",
        "https://example.com/pr/126",
        "open",
        1000,
        1000,
        false,
    )
    .expect("insert pr failed");

    let mut result = make_review_body_poll_result(126);
    result.comments.push(
        result
            .comments
            .first()
            .expect("review body comment should exist")
            .clone(),
    );

    let existing_ids = db
        .get_existing_comment_ids(126)
        .expect("get existing ids failed");
    let events = GitHubEventTarget::sidecar(None);

    let persist_result = persist_polled_comments(&events, &db, &result, &existing_ids, 1000);
    let comments = db.get_comments_for_pr(126).expect("get comments failed");

    assert_eq!(persist_result.failed_insert_count, 0);
    assert_eq!(persist_result.new_comment_count, 1);
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, -42);

    drop(db);
    let _ = std::fs::remove_file(&path);
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

#[test]
fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_missing() {
    assert_eq!(parse_poll_interval_seconds(None), 60);
}

#[test]
fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_invalid() {
    assert_eq!(
        parse_poll_interval_seconds(Some("not-a-number".to_string())),
        60
    );
}

#[test]
fn test_parse_poll_interval_seconds_uses_configured_value_when_valid() {
    assert_eq!(parse_poll_interval_seconds(Some("45".to_string())), 45);
}

#[test]
fn test_parse_poll_interval_seconds_clamps_zero_to_minimum_supported_value() {
    assert_eq!(parse_poll_interval_seconds(Some("0".to_string())), 15);
}

#[test]
fn test_parse_poll_interval_seconds_clamps_below_minimum_supported_value() {
    assert_eq!(parse_poll_interval_seconds(Some("10".to_string())), 15);
}

#[test]
fn test_parse_poll_interval_seconds_clamps_above_maximum_supported_value() {
    assert_eq!(parse_poll_interval_seconds(Some("301".to_string())), 300);
}

#[test]
fn test_rate_limit_sleep_duration_waits_until_future_reset() {
    assert_eq!(
        rate_limit_sleep_duration_secs(60, Some(1_700_000_300), 1_700_000_000),
        301
    );
}

#[test]
fn test_rate_limit_sleep_duration_uses_poll_interval_after_past_reset() {
    assert_eq!(
        rate_limit_sleep_duration_secs(60, Some(1_699_999_999), 1_700_000_000),
        60
    );
}

#[test]
fn test_rate_limit_sleep_duration_keeps_longer_poll_interval() {
    assert_eq!(
        rate_limit_sleep_duration_secs(120, Some(1_700_000_030), 1_700_000_000),
        120
    );
}

fn make_github_readiness_pr() -> PrRow {
    PrRow {
        id: 42,
        pr_number: 7,
        ticket_id: "T-42".to_string(),
        repo_owner: "acme".to_string(),
        repo_name: "repo".to_string(),
        title: "Readiness".to_string(),
        url: "https://github.com/acme/repo/pull/7".to_string(),
        state: "open".to_string(),
        head_sha: "head-sha".to_string(),
        ci_status: None,
        ci_check_runs: None,
        review_status: None,
        mergeable: Some(true),
        mergeable_state: Some("clean".to_string()),
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
        unaddressed_comment_count: 0,
    }
}

fn known_readiness_policy(
    required_checks: Vec<&str>,
    required_reviews: Option<usize>,
    requires_up_to_date_branch: Option<bool>,
    requires_conversation_resolution: Option<bool>,
    merge_queue_required: Option<bool>,
) -> crate::github_client::RepositoryPolicyFacts {
    crate::github_client::RepositoryPolicyFacts {
        required_checks: crate::github_client::PolicyValue::known(
            required_checks.into_iter().map(str::to_string).collect(),
        ),
        required_reviews: crate::github_client::PolicyValue::known(required_reviews),
        requires_up_to_date_branch: crate::github_client::PolicyValue::known(
            requires_up_to_date_branch,
        ),
        requires_conversation_resolution: crate::github_client::PolicyValue::known(
            requires_conversation_resolution,
        ),
        merge_queue_required: crate::github_client::PolicyValue::known(merge_queue_required),
        required_deployments: crate::github_client::PolicyValue::known(Vec::new()),
        unknown_reasons: Vec::new(),
    }
}

fn readiness_snapshot_with_policy(
    source_head_sha: Option<&str>,
    status_check_rollup_sha: Option<&str>,
    policy: crate::github_client::RepositoryPolicyFacts,
) -> GitHubReadinessSnapshot {
    GitHubReadinessSnapshot {
        source_head_sha: source_head_sha.map(str::to_string),
        status_check_rollup_sha: status_check_rollup_sha.map(str::to_string),
        check_runs: CheckRunsResponse {
            total_count: 1,
            check_runs: vec![CheckRun {
                id: 10,
                name: "graphql-ci".to_string(),
                status: "completed".to_string(),
                conclusion: Some("success".to_string()),
                html_url: "https://example.com/graphql-ci".to_string(),
            }],
        },
        combined_status: CombinedStatusResponse {
            state: "success".to_string(),
            statuses: vec![],
            sha: source_head_sha.unwrap_or_default().to_string(),
            total_count: 0,
            extra: serde_json::json!({}),
        },
        merge_state_status: Some("CLEAN".to_string()),
        mergeable_state: Some("clean".to_string()),
        review_decision: Some("APPROVED".to_string()),
        review_status: Some("approved".to_string()),
        auto_merge_requested: false,
        merge_queue_required: None,
        merge_queue_state: None,
        merge_group_sha: Some("merge-group-sha".to_string()),
        unresolved_conversations: Some(true),
        policy,
        warnings: Vec::new(),
    }
}

#[test]
fn select_branch_policy_inputs_prefers_known_graphql_policy_over_rest_fallbacks() {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        known_readiness_policy(
            vec!["graphql-ci"],
            Some(2),
            Some(true),
            Some(true),
            Some(true),
        ),
    );
    snapshot.unresolved_conversations = Some(true);
    let rest_checks =
        crate::github_client::RequiredChecksPolicy::known(vec!["rest-ci".to_string()], Some(false));
    let rest_reviews = crate::github_client::RequiredReviewsPolicy::known(1);

    let inputs = select_branch_policy_inputs(Some(&snapshot), &rest_checks, &rest_reviews);

    assert_eq!(inputs.required_check_names, vec!["graphql-ci".to_string()]);
    assert_eq!(inputs.required_approving_count, Some(2));
    assert!(inputs.required_checks_policy_known);
    assert!(inputs.required_reviews_policy_known);
    assert!(inputs.requires_up_to_date_branch);
    assert!(inputs.conversations_blocking);
    assert!(inputs.merge_queue_required_by_policy);
}

#[test]
fn current_graphql_readiness_keeps_mergeability_when_check_rollup_needs_rest_fallback() {
    let pr = make_github_readiness_pr();
    let mut snapshot = readiness_snapshot_with_policy(
        Some("pr-head-sha"),
        Some("stale-rollup-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(false)),
    );
    snapshot.mergeable_state = Some("clean".to_string());
    snapshot.review_status = Some("approved".to_string());
    let rest_sources = RestReadinessSources {
        rest_ci_sha: "pr-head-sha".to_string(),
        check_runs: None,
        combined_status: None,
        reviews: None,
        pr_details_result: Err(crate::github_client::GitHubError::NetworkError(
            "unused".to_string(),
        )),
        has_requested_reviewers: false,
        mergeable: None,
        mergeable_state: Some("unknown".to_string()),
        is_queued: false,
    };

    let graphql_inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot));
    let result_head_sha = poll_result_pr_head_sha(&pr, Some(&snapshot), &rest_sources);

    assert!(graphql_inputs.is_none());
    assert_eq!(result_head_sha, "pr-head-sha");
    assert_eq!(
        current_graphql_mergeable_state(Some(&snapshot), &result_head_sha, graphql_inputs.as_ref()),
        Some("clean")
    );
    assert_eq!(
        current_graphql_review_status(Some(&snapshot), &result_head_sha, graphql_inputs.as_ref())
            .as_deref(),
        Some("approved")
    );
}
#[test]
fn select_branch_policy_inputs_uses_rest_when_graphql_policy_is_unknown() {
    let snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        crate::github_client::RepositoryPolicyFacts::unknown("GraphQL policy unavailable"),
    );
    let rest_checks =
        crate::github_client::RequiredChecksPolicy::known(vec!["rest-ci".to_string()], Some(true));
    let rest_reviews = crate::github_client::RequiredReviewsPolicy::known(1);

    let inputs = select_branch_policy_inputs(Some(&snapshot), &rest_checks, &rest_reviews);

    assert_eq!(inputs.required_check_names, vec!["rest-ci".to_string()]);
    assert_eq!(inputs.required_approving_count, Some(1));
    assert!(inputs.required_checks_policy_known);
    assert!(inputs.required_reviews_policy_known);
    assert!(inputs.requires_up_to_date_branch);
    assert!(!inputs.conversations_blocking);
    assert!(!inputs.merge_queue_required_by_policy);
}

#[test]
fn github_readiness_keeps_merge_group_validation_sha_out_of_pr_head() {
    let pr = make_github_readiness_pr();
    let mut snapshot = readiness_snapshot_with_policy(
        Some("pr-head-sha"),
        Some("pr-head-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(true)),
    );
    snapshot.merge_queue_state = Some("QUEUED".to_string());
    snapshot.merge_group_sha = Some("merge-group-sha".to_string());
    let rest_sources = RestReadinessSources {
        rest_ci_sha: "merge-group-sha".to_string(),
        check_runs: None,
        combined_status: None,
        reviews: None,
        pr_details_result: Err(crate::github_client::GitHubError::NetworkError(
            "unused".to_string(),
        )),
        has_requested_reviewers: false,
        mergeable: None,
        mergeable_state: None,
        is_queued: true,
    };

    let pr_head_sha = poll_result_pr_head_sha(&pr, Some(&snapshot), &rest_sources);
    let ci_validation_sha = poll_result_ci_validation_sha(None, &rest_sources, &pr_head_sha);

    assert_eq!(pr_head_sha, "pr-head-sha");
    assert_eq!(ci_validation_sha, "merge-group-sha");
}

#[test]
fn ci_persistence_payload_filters_to_required_checks_and_reports_status_change() {
    let mut result = make_review_body_poll_result(42);
    result.head_sha = "head-sha".to_string();
    result.ci_validation_sha = "merge-group-sha".to_string();
    result.old_ci_status = Some("pending".to_string());
    result.required_check_names = vec!["ci".to_string()];
    result.check_runs = Some(CheckRunsResponse {
        total_count: 2,
        check_runs: vec![
            CheckRun {
                id: 1,
                name: "ci".to_string(),
                status: "completed".to_string(),
                conclusion: Some("success".to_string()),
                html_url: "https://example.com/ci".to_string(),
            },
            CheckRun {
                id: 2,
                name: "optional-lint".to_string(),
                status: "completed".to_string(),
                conclusion: Some("failure".to_string()),
                html_url: "https://example.com/lint".to_string(),
            },
        ],
    });
    result.combined_status = Some(CombinedStatusResponse {
        state: "success".to_string(),
        statuses: vec![],
        sha: "merge-group-sha".to_string(),
        total_count: 0,
        extra: serde_json::json!({}),
    });

    let payload = ci_persistence_payload(&result).expect("CI inputs should produce a payload");
    let persisted_runs: Vec<CheckRun> = serde_json::from_str(&payload.check_runs_json)
        .expect("payload should serialize display check runs");

    assert_eq!(payload.pr_id, 42);
    assert_eq!(payload.head_sha, "head-sha");
    assert_eq!(payload.ci_validation_sha, "merge-group-sha");
    assert_eq!(payload.status, "success");
    assert!(payload.status_changed);
    assert_eq!(persisted_runs.len(), 1);
    assert_eq!(persisted_runs[0].name, "ci");
}
