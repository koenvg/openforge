use super::*;

#[test]
fn rate_limit_sleep_uses_poll_interval_when_current_time_is_unavailable() {
    assert_eq!(
        rate_limit_sleep_duration_with_optional_now(60, Some(i64::MAX), None),
        60
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
fn scheduled_pr_selection_recovers_from_poisoned_database_lock() {
    let (db, _temp_dir) = make_test_db("scheduled_pr_selection_poisoned_lock");
    let db = Mutex::new(db);
    poison_mutex(&db);

    let prs =
        get_scheduled_prs_for_project(&db, "P-1").expect("select scheduled PRs after lock poison");
    let snapshot = poll_scheduler_snapshot(&db, false, None, false);

    assert!(prs.is_empty());
    assert!(snapshot.linked_prs.is_empty());
}

#[test]
fn scheduled_pr_selection_reports_malformed_out_of_focus_configuration() {
    let (db, _temp_dir) = make_test_db("scheduled_pr_selection_malformed_config");
    let project = db
        .create_project("Project", "/tmp/scheduled-pr-selection")
        .expect("create project");
    db.set_project_config(&project.id, "low_fire_task_ids", "not-json")
        .expect("set project config");
    let db = Mutex::new(db);

    let error = get_scheduled_prs_for_project(&db, &project.id)
        .expect_err("malformed out-of-focus configuration should fail");

    assert!(error.contains("Failed to parse out-of-focus Task IDs"));
}

#[test]
fn test_rate_limit_sleep_duration_keeps_longer_poll_interval() {
    assert_eq!(
        rate_limit_sleep_duration_secs(120, Some(1_700_000_030), 1_700_000_000),
        120
    );
}
