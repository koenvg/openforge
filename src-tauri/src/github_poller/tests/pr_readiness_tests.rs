use super::*;

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
        github_node_id: None,
        merge_methods_policy_known: None,
        allowed_merge_methods: None,
        default_merge_method: None,
        unaddressed_comment_count: 0,
    }
}

fn known_readiness_policy(
    required_checks: Vec<&str>,
    required_reviews: Option<usize>,
    requires_up_to_date_branch: Option<bool>,
    requires_conversation_resolution: Option<bool>,
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
        allowed_merge_methods: crate::github_client::PolicyValue::known(vec![
            crate::github_client::PullRequestMergeMethod::Merge,
        ]),
        default_merge_method: crate::github_client::PolicyValue::known(Some(
            crate::github_client::PullRequestMergeMethod::Merge,
        )),
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

#[test]
fn select_branch_policy_inputs_prefers_known_graphql_policy_over_rest_fallbacks() {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        known_readiness_policy(vec!["graphql-ci"], Some(2), Some(true), Some(true)),
    );
    snapshot.unresolved_conversations = Some(true);
    let rest_checks =
        crate::github_client::RequiredChecksPolicy::known(vec!["rest-ci".to_string()], Some(false));
    let rest_reviews = crate::github_client::RequiredReviewsPolicy::known(1);

    let inputs = select_branch_policy_inputs(
        Some(&snapshot),
        &rest_checks,
        &rest_reviews,
        &crate::github_client::PolicyValue::known(None),
    );

    assert_eq!(inputs.required_check_names, vec!["graphql-ci".to_string()]);
    assert_eq!(inputs.required_approving_count, Some(2));
    assert!(inputs.required_checks_policy_known);
    assert!(inputs.required_reviews_policy_known);
    assert!(inputs.requires_up_to_date_branch);
    assert!(inputs.conversations_blocking);
}

#[test]
fn select_branch_policy_inputs_intersects_repository_and_branch_merge_methods() {
    let mut snapshot = readiness_snapshot_with_policy(
        Some("graphql-head-sha"),
        Some("graphql-head-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false)),
    );
    snapshot.policy.allowed_merge_methods = crate::github_client::PolicyValue::known(vec![
        crate::github_client::PullRequestMergeMethod::Merge,
        crate::github_client::PullRequestMergeMethod::Squash,
    ]);
    snapshot.policy.default_merge_method = crate::github_client::PolicyValue::known(Some(
        crate::github_client::PullRequestMergeMethod::Merge,
    ));
    let branch_methods = crate::github_client::PolicyValue::known(Some(vec![
        crate::github_client::PullRequestMergeMethod::Squash,
        crate::github_client::PullRequestMergeMethod::Rebase,
    ]));

    let inputs = select_branch_policy_inputs(
        Some(&snapshot),
        &crate::github_client::RequiredChecksPolicy::known(vec![], Some(false)),
        &crate::github_client::RequiredReviewsPolicy::known(0),
        &branch_methods,
    );

    assert!(inputs.merge_methods_policy_known);
    assert_eq!(
        inputs.allowed_merge_methods,
        vec![crate::github_client::PullRequestMergeMethod::Squash]
    );
    assert_eq!(
        inputs.default_merge_method,
        Some(crate::github_client::PullRequestMergeMethod::Squash)
    );
}

#[test]
fn merge_readiness_waits_when_merge_method_policy_is_unknown() {
    let facts = crate::db::PrMergeReadinessFacts {
        status: Some("ready_to_merge".to_string()),
        action: Some("merge".to_string()),
        blockers_json: Some("[]".to_string()),
        warnings_json: Some("[]".to_string()),
        source_head_sha: Some("head-sha".to_string()),
        merge_group_sha: None,
        required_checks_policy_known: Some(true),
        required_reviews_policy_known: Some(true),
        merge_queue_required: Some(false),
        merge_queue_state: None,
        updated_at: 1,
    };
    let inputs = BranchPolicyInputs {
        required_check_names: Vec::new(),
        required_approving_count: Some(0),
        required_checks_policy_known: true,
        required_reviews_policy_known: true,
        requires_up_to_date_branch: false,
        conversations_blocking: false,
        merge_methods_policy_known: false,
        allowed_merge_methods: Vec::new(),
        default_merge_method: None,
    };

    let facts = enforce_merge_method_policy(facts, &inputs);

    assert_eq!(facts.status.as_deref(), Some("readiness_unknown"));
    assert_eq!(facts.action.as_deref(), Some("wait_for_github"));
    assert!(facts
        .blockers_json
        .unwrap_or_default()
        .contains("merge_method_policy_unknown"));
}

#[test]
fn current_graphql_readiness_keeps_mergeability_when_check_rollup_needs_rest_fallback() {
    let pr = make_github_readiness_pr();
    let mut snapshot = readiness_snapshot_with_policy(
        Some("pr-head-sha"),
        Some("stale-rollup-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false)),
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

    let inputs = select_branch_policy_inputs(
        Some(&snapshot),
        &rest_checks,
        &rest_reviews,
        &crate::github_client::PolicyValue::unknown("active branch rules unavailable"),
    );

    assert_eq!(inputs.required_check_names, vec!["rest-ci".to_string()]);
    assert_eq!(inputs.required_approving_count, Some(1));
    assert!(inputs.required_checks_policy_known);
    assert!(inputs.required_reviews_policy_known);
    assert!(inputs.requires_up_to_date_branch);
    assert!(!inputs.conversations_blocking);
}

#[test]
fn github_readiness_keeps_merge_group_validation_sha_out_of_pr_head() {
    let pr = make_github_readiness_pr();
    let mut snapshot = readiness_snapshot_with_policy(
        Some("pr-head-sha"),
        Some("pr-head-sha"),
        known_readiness_policy(vec![], Some(0), Some(false), Some(false)),
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
