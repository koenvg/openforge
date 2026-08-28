use crate::db::{
    needs_rest_ci_for_snapshot, queued_validation_sha, MergeReadinessInputs, PrMergeReadinessFacts,
    PrRow,
};
use crate::github_client::{
    CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubReadinessSnapshot, PolicyValue,
    PrReview, PullRequestMergeMethod,
};
use log::warn;

pub(super) struct RestReadinessSources {
    pub(super) rest_ci_sha: String,
    pub(super) check_runs: Option<CheckRunsResponse>,
    pub(super) combined_status: Option<CombinedStatusResponse>,
    pub(super) reviews: Option<Vec<PrReview>>,
    pub(super) pr_details_result:
        Result<crate::github_client::PullRequest, crate::github_client::GitHubError>,
    pub(super) has_requested_reviewers: bool,
    pub(super) mergeable: Option<bool>,
    pub(super) mergeable_state: Option<String>,
    pub(super) is_queued: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BranchPolicyInputs {
    pub(super) required_check_names: Vec<String>,
    pub(super) required_approving_count: Option<usize>,
    pub(super) required_checks_policy_known: bool,
    pub(super) required_reviews_policy_known: bool,
    pub(super) requires_up_to_date_branch: bool,
    pub(super) conversations_blocking: bool,
    pub(super) merge_methods_policy_known: bool,
    pub(super) allowed_merge_methods: Vec<PullRequestMergeMethod>,
    pub(super) default_merge_method: Option<PullRequestMergeMethod>,
}

pub(super) fn enforce_merge_method_policy(
    mut facts: PrMergeReadinessFacts,
    policy: &BranchPolicyInputs,
) -> PrMergeReadinessFacts {
    if facts.status.as_deref() != Some("ready_to_merge") {
        return facts;
    }
    if !policy.merge_methods_policy_known {
        facts.status = Some("readiness_unknown".to_string());
        facts.action = Some("wait_for_github".to_string());
        facts.blockers_json = Some(
            serde_json::json!([{
                "code": "merge_method_policy_unknown",
                "message": "GitHub merge methods are not available yet."
            }])
            .to_string(),
        );
    } else if policy.allowed_merge_methods.is_empty() {
        facts.status = Some("blocked".to_string());
        facts.action = Some("resolve_blockers".to_string());
        facts.blockers_json = Some(
            serde_json::json!([{
                "code": "no_allowed_merge_method",
                "message": "Repository and branch rules do not allow a common merge method."
            }])
            .to_string(),
        );
    }
    facts
}

pub(super) async fn fetch_graphql_readiness_snapshot(
    github_client: &GitHubClient,
    pr: &PrRow,
    github_token: &str,
) -> Option<GitHubReadinessSnapshot> {
    match github_client
        .get_pr_readiness_snapshot(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token)
        .await
    {
        Ok(snapshot) if snapshot.source_head_sha.is_none() => {
            warn!(
                "[GitHub Poller] GraphQL readiness for PR #{} did not include a head SHA; using REST fallback",
                pr.pr_number
            );
            None
        }
        Ok(snapshot) if !snapshot.requires_rest_check_fallback() => Some(snapshot),
        Ok(snapshot) => {
            warn!(
                "[GitHub Poller] GraphQL readiness for PR #{} had stale or incomplete check rollup SHA; using REST fallback for checks",
                pr.pr_number
            );
            Some(snapshot)
        }
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch GraphQL readiness for PR #{}: {}",
                pr.pr_number,
                e.sanitized_log_message()
            );
            None
        }
    }
}

pub(super) async fn collect_rest_readiness_sources(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
) -> RestReadinessSources {
    let needs_rest_ci = needs_rest_ci_for_snapshot(graphql_snapshot);
    let mut rest_ci_sha = graphql_snapshot
        .and_then(queued_validation_sha)
        .map(ToOwned::to_owned)
        .or_else(|| graphql_snapshot.and_then(|snapshot| snapshot.source_head_sha.clone()))
        .filter(|sha| !sha.is_empty())
        .unwrap_or_else(|| pr.head_sha.clone());
    let ci_sha_for_request = rest_ci_sha.clone();

    let ci_future = async {
        if !needs_rest_ci || ci_sha_for_request.is_empty() {
            (None, None)
        } else {
            let (check_runs, combined_status) = tokio::join!(
                github_client.get_check_runs(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &ci_sha_for_request,
                    github_token
                ),
                github_client.get_combined_status(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &ci_sha_for_request,
                    github_token
                )
            );
            (Some(check_runs), Some(combined_status))
        }
    };

    let reviews_future =
        github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token);
    let pr_details_future =
        github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token);

    let ((check_runs_result, combined_status_result), reviews_result, pr_details_result) =
        tokio::join!(ci_future, reviews_future, pr_details_future);

    let mut check_runs = check_runs_result.and_then(|result| match result {
        Ok(check_runs) => Some(check_runs),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch check runs for PR #{}: {}",
                pr.pr_number,
                e.sanitized_log_message()
            );
            None
        }
    });

    let mut combined_status = combined_status_result.and_then(|result| match result {
        Ok(combined_status) => Some(combined_status),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch combined status for PR #{}: {}",
                pr.pr_number,
                e.sanitized_log_message()
            );
            None
        }
    });

    if graphql_snapshot.is_none() {
        if let Ok(details) = &pr_details_result {
            if !details.head.sha.is_empty() && details.head.sha != rest_ci_sha {
                let (fresh_check_runs, fresh_combined_status) = tokio::join!(
                    github_client.get_check_runs(
                        &pr.repo_owner,
                        &pr.repo_name,
                        &details.head.sha,
                        github_token
                    ),
                    github_client.get_combined_status(
                        &pr.repo_owner,
                        &pr.repo_name,
                        &details.head.sha,
                        github_token
                    )
                );
                if let Ok(fresh_check_runs) = fresh_check_runs {
                    check_runs = Some(fresh_check_runs);
                }
                if let Ok(fresh_combined_status) = fresh_combined_status {
                    combined_status = Some(fresh_combined_status);
                }
                rest_ci_sha = details.head.sha.clone();
            }
        }
    }

    let reviews = match reviews_result {
        Ok(reviews) => Some(reviews),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch reviews for PR #{}: {}",
                pr.pr_number,
                e.sanitized_log_message()
            );
            None
        }
    };

    let has_requested_reviewers = match &pr_details_result {
        Ok(details) => has_requested_reviewers_from_details(details),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch PR details for PR #{}: {}",
                pr.pr_number,
                e.sanitized_log_message()
            );
            false
        }
    };
    let is_queued = pr_details_result
        .as_ref()
        .ok()
        .map(pr_is_queued_from_details)
        .unwrap_or(false);
    let (mergeable, mergeable_state) =
        mergeability_after_pr_details(&pr_details_result, old_mergeable, old_mergeable_state);

    RestReadinessSources {
        rest_ci_sha,
        check_runs,
        combined_status,
        reviews,
        pr_details_result,
        has_requested_reviewers,
        mergeable,
        mergeable_state,
        is_queued,
    }
}

pub(super) fn non_empty_sha(value: Option<String>) -> Option<String> {
    value.filter(|sha| !sha.is_empty())
}

pub(super) fn poll_result_pr_head_sha(
    pr: &PrRow,
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    rest_sources: &RestReadinessSources,
) -> String {
    graphql_snapshot
        .and_then(|snapshot| non_empty_sha(snapshot.source_head_sha.clone()))
        .or_else(|| {
            rest_sources
                .pr_details_result
                .as_ref()
                .ok()
                .and_then(|details| non_empty_sha(Some(details.head.sha.clone())))
        })
        .unwrap_or_else(|| pr.head_sha.clone())
}

pub(super) fn poll_result_ci_validation_sha(
    graphql_inputs: Option<&MergeReadinessInputs>,
    rest_sources: &RestReadinessSources,
    fallback_pr_head_sha: &str,
) -> String {
    graphql_inputs
        .and_then(|inputs| non_empty_sha(inputs.source_head_sha.clone()))
        .or_else(|| non_empty_sha(Some(rest_sources.rest_ci_sha.clone())))
        .unwrap_or_else(|| fallback_pr_head_sha.to_string())
}

pub(super) fn current_graphql_readiness_snapshot<'a>(
    graphql_snapshot: Option<&'a GitHubReadinessSnapshot>,
    result_head_sha: &str,
) -> Option<&'a GitHubReadinessSnapshot> {
    graphql_snapshot.filter(|snapshot| {
        snapshot
            .source_head_sha
            .as_deref()
            .is_some_and(|source| source == result_head_sha)
    })
}

pub(super) fn current_graphql_review_status(
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    result_head_sha: &str,
    graphql_inputs: Option<&MergeReadinessInputs>,
) -> Option<String> {
    current_graphql_readiness_snapshot(graphql_snapshot, result_head_sha)
        .and_then(|snapshot| snapshot.review_status.clone())
        .or_else(|| graphql_inputs.and_then(|inputs| inputs.review_status.clone()))
}

pub(super) fn current_graphql_mergeable_state<'a>(
    graphql_snapshot: Option<&'a GitHubReadinessSnapshot>,
    result_head_sha: &str,
    graphql_inputs: Option<&'a MergeReadinessInputs>,
) -> Option<&'a str> {
    current_graphql_readiness_snapshot(graphql_snapshot, result_head_sha)
        .and_then(|snapshot| snapshot.mergeable_state.as_deref())
        .or_else(|| graphql_inputs.and_then(|inputs| inputs.mergeable_state.as_deref()))
}

pub(super) fn has_requested_reviewers_from_details(
    details: &crate::github_client::PullRequest,
) -> bool {
    details
        .extra
        .get("requested_reviewers")
        .and_then(|reviewers| reviewers.as_array())
        .map(|reviewers| !reviewers.is_empty())
        .unwrap_or(false)
        || details
            .extra
            .get("requested_teams")
            .and_then(|teams| teams.as_array())
            .map(|teams| !teams.is_empty())
            .unwrap_or(false)
}

pub(super) fn pr_is_queued_from_details(details: &crate::github_client::PullRequest) -> bool {
    details
        .extra
        .get("merge_queue_entry")
        .map(|value| !value.is_null())
        .unwrap_or(false)
}

pub(super) async fn collect_branch_policy_sources(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    pr_details_result: &Result<
        crate::github_client::PullRequest,
        crate::github_client::GitHubError,
    >,
) -> (
    crate::github_client::RequiredChecksPolicy,
    crate::github_client::RequiredReviewsPolicy,
    PolicyValue<Option<Vec<PullRequestMergeMethod>>>,
) {
    match pr_details_result {
        Ok(details) => {
            let base_ref = details
                .extra
                .get("base")
                .and_then(|base| base.get("ref"))
                .and_then(|reference| reference.as_str())
                .unwrap_or("main");
            tokio::join!(
                github_client.get_required_status_checks_policy(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    github_token
                ),
                github_client.get_required_approving_review_policy(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    github_token
                ),
                github_client.get_branch_merge_method_restriction_policy(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    github_token,
                )
            )
        }
        Err(_) => (
            crate::github_client::RequiredChecksPolicy::unknown(
                "PR details unavailable for branch protection lookup",
            ),
            crate::github_client::RequiredReviewsPolicy::unknown(
                "PR details unavailable for branch protection lookup",
            ),
            PolicyValue::unknown("PR details unavailable for active branch rules lookup"),
        ),
    }
}

pub(super) fn select_branch_policy_inputs(
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    rest_required_checks_policy: &crate::github_client::RequiredChecksPolicy,
    rest_required_reviews_policy: &crate::github_client::RequiredReviewsPolicy,
    rest_merge_method_restriction: &PolicyValue<Option<Vec<PullRequestMergeMethod>>>,
) -> BranchPolicyInputs {
    let required_check_names = graphql_snapshot
        .filter(|snapshot| snapshot.policy.required_checks.known)
        .map(|snapshot| snapshot.policy.required_checks.value.clone())
        .unwrap_or_else(|| rest_required_checks_policy.required_check_names.clone());
    let required_approving_count = graphql_snapshot
        .filter(|snapshot| snapshot.policy.required_reviews.known)
        .and_then(|snapshot| snapshot.policy.required_reviews.value)
        .or(rest_required_reviews_policy.required_approving_review_count);
    let required_checks_policy_known = graphql_snapshot
        .map(|snapshot| snapshot.policy.required_checks.known)
        .unwrap_or(false)
        || rest_required_checks_policy.known;
    let required_reviews_policy_known = graphql_snapshot
        .map(|snapshot| snapshot.policy.required_reviews.known)
        .unwrap_or(false)
        || rest_required_reviews_policy.known;
    let requires_up_to_date_branch = graphql_snapshot
        .filter(|snapshot| snapshot.policy.requires_up_to_date_branch.known)
        .and_then(|snapshot| snapshot.policy.requires_up_to_date_branch.value)
        .or(rest_required_checks_policy.requires_up_to_date_branch)
        .unwrap_or(false);
    let conversations_blocking = graphql_snapshot
        .filter(|snapshot| snapshot.policy.requires_conversation_resolution.known)
        .and_then(|snapshot| snapshot.policy.requires_conversation_resolution.value)
        .unwrap_or(false)
        && graphql_snapshot
            .and_then(|snapshot| snapshot.unresolved_conversations)
            .unwrap_or(false);
    let repository_merge_methods = graphql_snapshot
        .filter(|snapshot| snapshot.policy.allowed_merge_methods.known)
        .map(|snapshot| snapshot.policy.allowed_merge_methods.value.clone());
    let merge_methods_policy_known =
        repository_merge_methods.is_some() && rest_merge_method_restriction.known;
    let allowed_merge_methods = if merge_methods_policy_known {
        let repository_methods = repository_merge_methods.unwrap_or_default();
        match &rest_merge_method_restriction.value {
            Some(restriction) => repository_methods
                .into_iter()
                .filter(|method| restriction.contains(method))
                .collect(),
            None => repository_methods,
        }
    } else {
        Vec::new()
    };
    let default_merge_method = graphql_snapshot
        .filter(|snapshot| snapshot.policy.default_merge_method.known)
        .and_then(|snapshot| snapshot.policy.default_merge_method.value)
        .filter(|method| allowed_merge_methods.contains(method))
        .or_else(|| allowed_merge_methods.first().copied());

    BranchPolicyInputs {
        required_check_names,
        required_approving_count,
        required_checks_policy_known,
        required_reviews_policy_known,
        requires_up_to_date_branch,
        conversations_blocking,
        merge_methods_policy_known,
        allowed_merge_methods,
        default_merge_method,
    }
}

pub(super) fn mergeability_after_pr_details(
    pr_details_result: &Result<
        crate::github_client::PullRequest,
        crate::github_client::GitHubError,
    >,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
) -> (Option<bool>, Option<String>) {
    match pr_details_result {
        Ok(details) => (details.mergeable, details.mergeable_state.clone()),
        Err(_) => (old_mergeable, old_mergeable_state),
    }
}
