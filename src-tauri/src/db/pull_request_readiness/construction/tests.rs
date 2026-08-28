use super::super::test_support::make_github_readiness_pr;
use super::*;
use crate::github_client::{
    CheckRun, GitHubHead, GitHubUser, PolicyValue, PullRequest, PullRequestMergeMethod,
    RepositoryPolicyFacts,
};

#[test]
fn test_add_readiness_warning_deduplicates_unresolved_conversations() {
    let warnings = add_readiness_warning(
        Some(r#"[{"code":"branch_behind","message":"Branch is behind."}]"#.to_string()),
        MergeReadinessReason {
            code: "unresolved_conversations",
            message: "Pull request has unresolved conversations.",
        },
    )
    .expect("warnings should serialize");

    let warnings = add_readiness_warning(
        Some(warnings),
        MergeReadinessReason {
            code: "unresolved_conversations",
            message: "Pull request has unresolved conversations.",
        },
    )
    .expect("warnings should serialize");

    assert_eq!(warnings.matches("unresolved_conversations").count(), 1);
    assert!(warnings.contains("branch_behind"));
}

#[test]
fn github_readiness_snapshot_keeps_ci_data_scoped_to_source_sha() {
    let pr = make_github_readiness_pr();
    let snapshot = GitHubReadinessSnapshot {
        github_node_id: None,
        source_head_sha: Some("new-head-sha".to_string()),
        status_check_rollup_sha: Some("new-head-sha".to_string()),
        check_runs: CheckRunsResponse {
            total_count: 1,
            check_runs: vec![CheckRun {
                id: 1,
                name: "ci".to_string(),
                status: "completed".to_string(),
                conclusion: Some("success".to_string()),
                html_url: "https://example.com/ci".to_string(),
            }],
        },
        combined_status: CombinedStatusResponse {
            state: "success".to_string(),
            statuses: vec![],
            sha: "new-head-sha".to_string(),
            total_count: 0,
            extra: serde_json::json!({}),
        },
        merge_state_status: Some("CLEAN".to_string()),
        mergeable_state: Some("clean".to_string()),
        review_decision: Some("APPROVED".to_string()),
        review_status: Some("approved".to_string()),
        auto_merge_requested: false,
        merge_queue_enabled: Some(false),
        merge_queue_state: None,
        merge_group_sha: None,
        unresolved_conversations: Some(false),
        policy: RepositoryPolicyFacts::known_empty(),
        warnings: vec![],
    };

    assert!(!needs_rest_ci_for_snapshot(Some(&snapshot)));
    let inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot)).unwrap();
    assert_eq!(inputs.source_head_sha.as_deref(), Some("new-head-sha"));
    assert_eq!(inputs.review_status.as_deref(), Some("approved"));
    assert_eq!(inputs.mergeable_state.as_deref(), Some("clean"));
}

#[test]
fn github_readiness_snapshot_mismatched_rollup_sha_requires_rest_fallback() {
    let pr = make_github_readiness_pr();
    let snapshot = GitHubReadinessSnapshot {
        github_node_id: None,
        source_head_sha: Some("new-head-sha".to_string()),
        status_check_rollup_sha: Some("old-head-sha".to_string()),
        check_runs: CheckRunsResponse {
            total_count: 0,
            check_runs: vec![],
        },
        combined_status: CombinedStatusResponse {
            state: "success".to_string(),
            statuses: vec![],
            sha: "old-head-sha".to_string(),
            total_count: 0,
            extra: serde_json::json!({}),
        },
        merge_state_status: Some("CLEAN".to_string()),
        mergeable_state: Some("clean".to_string()),
        review_decision: None,
        review_status: None,
        auto_merge_requested: false,
        merge_queue_enabled: None,
        merge_queue_state: None,
        merge_group_sha: None,
        unresolved_conversations: None,
        policy: RepositoryPolicyFacts::unknown("missing statusCheckRollup for head SHA"),
        warnings: vec![],
    };

    assert!(needs_rest_ci_for_snapshot(Some(&snapshot)));
    assert!(select_snapshot_readiness_inputs(&pr, Some(&snapshot)).is_none());
}

#[test]
fn github_readiness_unknown_policy_keeps_ready_handoff_with_warning() {
    let pr = make_github_readiness_pr();
    let facts = build_merge_readiness_facts(
        &pr,
        None,
        Some(true),
        Some("clean"),
        Some("success"),
        Some("approved"),
        false,
        false,
        false,
        false,
        false,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.action.as_deref(), Some("merge"));
    assert_eq!(facts.required_checks_policy_known, Some(false));
    assert_eq!(facts.required_reviews_policy_known, Some(false));
    let warnings = facts.merge_readiness_warnings_or_default();
    assert!(warnings.contains("policy_coverage_unknown"));
}

#[test]
fn github_readiness_unstable_mergeability_does_not_fail_while_checks_pending() {
    let pr = make_github_readiness_pr();
    for ci_status in ["pending", "queued", "in_progress"] {
        let facts = build_merge_readiness_facts(
            &pr,
            None,
            Some(true),
            Some("unstable"),
            Some(ci_status),
            Some("approved"),
            false,
            true,
            true,
            false,
            false,
            None,
        );

        let blockers = facts.blockers_json.as_deref().unwrap_or_default();
        assert!(blockers.contains("checks_pending"));
        assert!(!blockers.contains("checks_failed"));
    }
}

#[test]
fn github_readiness_unstable_mergeability_waits_when_no_checks_have_published_yet() {
    let pr = make_github_readiness_pr();
    let facts = build_merge_readiness_facts(
        &pr,
        None,
        Some(true),
        Some("unstable"),
        Some("none"),
        Some("approved"),
        false,
        true,
        true,
        false,
        false,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("blocked"));
    let blockers = facts.blockers_json.as_deref().unwrap_or_default();
    assert!(blockers.contains("checks_pending"));
    assert!(!blockers.contains("checks_failed"));
}

#[test]
fn github_readiness_strict_policy_blocks_behind_branch() {
    let pr = make_github_readiness_pr();
    let facts = build_merge_readiness_facts(
        &pr,
        None,
        Some(true),
        Some("behind"),
        Some("success"),
        Some("approved"),
        false,
        true,
        true,
        true,
        false,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("blocked"));
    assert!(facts
        .blockers_json
        .as_deref()
        .unwrap_or_default()
        .contains("branch_behind"));
}

#[test]
fn github_readiness_conversation_resolution_policy_blocks_unresolved_threads() {
    let mut pr = make_github_readiness_pr();
    pr.unaddressed_comment_count = 1;
    let facts = build_merge_readiness_facts(
        &pr,
        None,
        Some(true),
        Some("clean"),
        Some("success"),
        Some("approved"),
        false,
        true,
        true,
        false,
        true,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("blocked"));
    assert!(facts
        .blockers_json
        .as_deref()
        .unwrap_or_default()
        .contains("unresolved_conversations"));
}

fn actor_scoped_pr_details(author: &str) -> PullRequest {
    PullRequest {
        number: 7,
        title: "Readiness".to_string(),
        state: "open".to_string(),
        html_url: "https://github.com/acme/repo/pull/7".to_string(),
        user: GitHubUser {
            login: author.to_string(),
            extra: serde_json::json!({}),
        },
        head: GitHubHead {
            ref_name: "feature/T-42".to_string(),
            sha: "head-sha".to_string(),
            extra: serde_json::json!({}),
        },
        draft: Some(false),
        mergeable: Some(true),
        mergeable_state: Some("clean".to_string()),
        extra: serde_json::json!({}),
    }
}

#[test]
fn github_readiness_actor_scope_prevents_non_actor_ready_handoff() {
    let pr = make_github_readiness_pr();
    let details = actor_scoped_pr_details("other-user");
    let facts = build_merge_readiness_facts(
        &pr,
        Some(&details),
        Some(true),
        Some("clean"),
        Some("success"),
        Some("approved"),
        false,
        true,
        true,
        false,
        false,
        None,
    );

    let facts = enforce_actor_scoped_readiness(facts, Some(&details), Some("octocat"));

    assert_eq!(facts.status.as_deref(), Some("readiness_unknown"));
    assert_eq!(facts.action.as_deref(), Some("wait_for_github"));
    assert!(facts
        .merge_readiness_warnings_or_default()
        .contains("actor_scope_mismatch"));
}

#[test]
fn github_readiness_actor_scope_allows_configured_actor_ready_handoff() {
    let pr = make_github_readiness_pr();
    let details = actor_scoped_pr_details("octocat");
    let facts = build_merge_readiness_facts(
        &pr,
        Some(&details),
        Some(true),
        Some("clean"),
        Some("success"),
        Some("approved"),
        false,
        true,
        true,
        false,
        false,
        None,
    );

    let facts = enforce_actor_scoped_readiness(facts, Some(&details), Some("octocat"));

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.action.as_deref(), Some("merge"));
}

#[test]
fn github_readiness_uses_current_polled_draft_state_as_blocker() {
    let pr = make_github_readiness_pr();
    let mut details = actor_scoped_pr_details("octocat");
    details.draft = Some(true);
    let facts = build_merge_readiness_facts(
        &pr,
        Some(&details),
        Some(true),
        Some("clean"),
        Some("success"),
        Some("approved"),
        false,
        true,
        true,
        false,
        false,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("blocked"));
    assert_eq!(facts.action.as_deref(), Some("resolve_blockers"));
    assert!(facts
        .blockers_json
        .as_deref()
        .unwrap_or_default()
        .contains("draft"));
}

#[test]
fn github_readiness_unknown_policy_does_not_override_clean_mergeability() {
    let pr = make_github_readiness_pr();
    let facts = build_merge_readiness_facts(
        &pr,
        None,
        Some(true),
        Some("clean"),
        Some("success"),
        Some("none"),
        false,
        false,
        false,
        false,
        false,
        None,
    );

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.action.as_deref(), Some("merge"));
    assert!(facts
        .merge_readiness_warnings_or_default()
        .contains("policy_coverage_unknown"));
}

fn known_readiness_policy(
    required_checks: Vec<&str>,
    required_reviews: Option<usize>,
    requires_up_to_date_branch: Option<bool>,
    requires_conversation_resolution: Option<bool>,
) -> RepositoryPolicyFacts {
    RepositoryPolicyFacts {
        required_checks: PolicyValue::known(
            required_checks.into_iter().map(str::to_string).collect(),
        ),
        required_reviews: PolicyValue::known(required_reviews),
        requires_up_to_date_branch: PolicyValue::known(requires_up_to_date_branch),
        requires_conversation_resolution: PolicyValue::known(requires_conversation_resolution),
        allowed_merge_methods: PolicyValue::known(vec![PullRequestMergeMethod::Merge]),
        default_merge_method: PolicyValue::known(Some(PullRequestMergeMethod::Merge)),
        required_deployments: PolicyValue::known(Vec::new()),
        unknown_reasons: Vec::new(),
    }
}

fn readiness_snapshot_with_policy(
    source_head_sha: Option<&str>,
    status_check_rollup_sha: Option<&str>,
    policy: RepositoryPolicyFacts,
) -> GitHubReadinessSnapshot {
    GitHubReadinessSnapshot {
        github_node_id: None,
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
        merge_queue_enabled: None,
        merge_queue_state: None,
        merge_group_sha: Some("merge-group-sha".to_string()),
        unresolved_conversations: Some(true),
        policy,
        warnings: Vec::new(),
    }
}

fn ready_to_merge_facts() -> PrMergeReadinessFacts {
    PrMergeReadinessFacts {
        status: Some("ready_to_merge".to_string()),
        action: Some("merge".to_string()),
        blockers_json: None,
        warnings_json: None,
        source_head_sha: Some("old-head-sha".to_string()),
        merge_group_sha: None,
        required_checks_policy_known: Some(true),
        required_reviews_policy_known: Some(true),
        merge_queue_required: None,
        merge_queue_state: None,
        updated_at: 0,
    }
}

#[test]
fn select_snapshot_readiness_inputs_accepts_fresh_graphql_head_data() {
    let pr = make_github_readiness_pr();
    let snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        RepositoryPolicyFacts::known_empty(),
    );

    let inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot))
        .expect("fresh GraphQL readiness should be usable");

    assert_eq!(inputs.source_head_sha.as_deref(), Some("graphql-head-sha"));
    assert_eq!(inputs.review_status.as_deref(), Some("approved"));
    assert_eq!(inputs.mergeable_state.as_deref(), Some("clean"));
    assert_eq!(inputs.check_runs.check_runs[0].name, "graphql-ci");
    assert_eq!(inputs.combined_status.sha, "graphql-head-sha");
}

#[test]
fn select_snapshot_readiness_inputs_rejects_missing_or_stale_head_data() {
    let pr = make_github_readiness_pr();
    let missing_head = readiness_snapshot_with_policy(
        None,
        Some("graphql-head-sha"),
        RepositoryPolicyFacts::known_empty(),
    );
    let stale_rollup = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("old-head-sha"),
        RepositoryPolicyFacts::known_empty(),
    );

    assert!(select_snapshot_readiness_inputs(&pr, Some(&missing_head)).is_none());
    assert!(select_snapshot_readiness_inputs(&pr, Some(&stale_rollup)).is_none());
    assert!(select_snapshot_readiness_inputs(&pr, None).is_none());
}

fn merge_queue_snapshot(merge_queue_enabled: Option<bool>) -> GitHubReadinessSnapshot {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false)),
    );
    snapshot.merge_queue_enabled = merge_queue_enabled;
    snapshot
}

fn finalize_ready_to_merge(
    snapshot: Option<&GitHubReadinessSnapshot>,
    last_known_merge_queue_required: Option<bool>,
) -> PrMergeReadinessFacts {
    finalize_readiness_facts_for_poll(
        ready_to_merge_facts(),
        snapshot,
        "graphql-head-sha",
        false,
        last_known_merge_queue_required,
        0,
        1234,
    )
}

#[test]
fn finalize_promotes_ready_to_merge_to_ready_to_enqueue_when_the_merge_queue_is_enabled() {
    let facts = finalize_ready_to_merge(Some(&merge_queue_snapshot(Some(true))), None);

    assert_eq!(facts.status.as_deref(), Some("ready_to_enqueue"));
    assert_eq!(facts.action.as_deref(), Some("enqueue"));
    assert_eq!(facts.source_head_sha.as_deref(), Some("graphql-head-sha"));
    assert_eq!(facts.merge_group_sha.as_deref(), Some("merge-group-sha"));
    assert_eq!(facts.merge_queue_required, Some(true));
    assert_eq!(facts.merge_queue_state.as_deref(), Some("not_queued"));
    assert_eq!(facts.updated_at, 1234);
}

#[test]
fn finalize_keeps_ready_to_merge_when_the_merge_queue_is_disabled() {
    let facts = finalize_ready_to_merge(Some(&merge_queue_snapshot(Some(false))), None);

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.action.as_deref(), Some("merge"));
    assert_eq!(facts.merge_queue_required, Some(false));
}

#[test]
fn finalize_uses_the_last_known_merge_queue_requirement_when_the_graphql_snapshot_is_missing() {
    let facts = finalize_ready_to_merge(None, Some(true));

    assert_eq!(facts.status.as_deref(), Some("ready_to_enqueue"));
    assert_eq!(facts.action.as_deref(), Some("enqueue"));
    assert_eq!(facts.merge_queue_required, Some(true));
}

#[test]
fn finalize_prefers_a_fresh_snapshot_over_the_last_known_merge_queue_requirement() {
    let facts = finalize_ready_to_merge(Some(&merge_queue_snapshot(Some(false))), Some(true));

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.merge_queue_required, Some(false));
}

#[test]
fn github_readiness_finalize_uses_merge_group_sha_for_queued_validation() {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("pr-head-sha"),
        Some("pr-head-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false)),
    );
    snapshot.merge_queue_state = Some("QUEUED".to_string());
    snapshot.merge_group_sha = Some("merge-group-sha".to_string());

    let mut queued_facts = ready_to_merge_facts();
    queued_facts.status = Some("queued_pull_request".to_string());
    queued_facts.action = Some("wait_for_queue".to_string());

    let facts = finalize_readiness_facts_for_poll(
        queued_facts,
        Some(&snapshot),
        "pr-head-sha",
        true,
        None,
        0,
        1234,
    );

    assert_eq!(facts.status.as_deref(), Some("queued_pull_request"));
    assert_eq!(facts.action.as_deref(), Some("wait_for_queue"));
    assert_eq!(facts.source_head_sha.as_deref(), Some("merge-group-sha"));
    assert_eq!(facts.merge_group_sha.as_deref(), Some("merge-group-sha"));
    assert_eq!(facts.merge_queue_state.as_deref(), Some("QUEUED"));
}

#[test]
fn finalize_readiness_facts_for_poll_adds_warnings_for_unknown_policy_and_new_comments() {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        RepositoryPolicyFacts::unknown("GraphQL policy unavailable"),
    );
    snapshot.unresolved_conversations = Some(false);

    let facts = finalize_readiness_facts_for_poll(
        ready_to_merge_facts(),
        Some(&snapshot),
        "graphql-head-sha",
        false,
        None,
        1,
        5678,
    );
    let warnings = facts.merge_readiness_warnings_or_default();

    assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
    assert_eq!(facts.action.as_deref(), Some("merge"));
    assert!(warnings.contains("policy_coverage_unknown"));
    assert!(warnings.contains("unresolved_conversations"));
    assert_eq!(warnings.matches("unresolved_conversations").count(), 1);
    assert_eq!(facts.updated_at, 5678);
}
