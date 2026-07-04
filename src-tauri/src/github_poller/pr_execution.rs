use crate::db::{
    build_merge_readiness_facts, ci_status_for_readiness, enforce_actor_scoped_readiness,
    finalize_readiness_facts_for_poll, needs_rest_ci_for_snapshot, queued_validation_sha,
    review_status_for_readiness, select_snapshot_readiness_inputs, MergeReadinessInputs,
    PrMergeReadinessFacts, PrRow,
};
use crate::github_client::{
    CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubReadinessSnapshot, PrComment,
    PrReview,
};
use log::warn;
use std::collections::HashSet;

pub(super) fn should_fetch_comments_for_pr(pr_id: i64, changed_pr_numbers: &HashSet<i64>) -> bool {
    changed_pr_numbers.is_empty() || changed_pr_numbers.contains(&pr_id)
}

pub(super) struct PollSinglePrResult {
    pub(super) pr_id: i64,
    pub(super) ticket_id: String,
    pub(super) pr_title: String,
    /// PR source head SHA persisted on the pull_requests row.
    pub(super) head_sha: String,
    /// SHA whose CI signals were evaluated; can be a merge-group SHA.
    pub(super) ci_validation_sha: String,
    pub(super) old_ci_status: Option<String>,
    pub(super) old_review_status: Option<String>,
    pub(super) comments: Vec<PrComment>,
    pub(super) check_runs: Option<CheckRunsResponse>,
    pub(super) combined_status: Option<CombinedStatusResponse>,
    pub(super) reviews: Option<Vec<PrReview>>,
    pub(super) has_requested_reviewers: bool,
    pub(super) mergeable: Option<bool>,
    pub(super) mergeable_state: Option<String>,
    pub(super) is_queued: bool,
    pub(super) required_check_names: Vec<String>,
    pub(super) required_approving_count: Option<usize>,
    pub(super) readiness_facts: PrMergeReadinessFacts,
    pub(super) error: Option<String>,
}

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
    pub(super) merge_queue_required_by_policy: bool,
}

pub(super) fn comment_fetch_error_result(
    pr: PrRow,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
    error: String,
) -> PollSinglePrResult {
    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: pr.title,
        head_sha: pr.head_sha.clone(),
        ci_validation_sha: pr.head_sha.clone(),
        old_ci_status,
        old_review_status,
        comments: vec![],
        check_runs: None,
        combined_status: None,
        reviews: None,
        has_requested_reviewers: false,
        mergeable: old_mergeable,
        mergeable_state: old_mergeable_state,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        readiness_facts: PrMergeReadinessFacts {
            status: None,
            action: None,
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some(pr.head_sha),
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        },
        error: Some(error),
    }
}

pub(super) async fn fetch_pr_comments_for_poll(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    since: Option<&str>,
    fetch_comments: bool,
) -> Result<Vec<PrComment>, String> {
    if !fetch_comments {
        return Ok(Vec::new());
    }

    github_client
        .get_pr_comments(
            &pr.repo_owner,
            &pr.repo_name,
            pr.pr_number,
            github_token,
            since,
        )
        .await
        .map_err(|e| format!("Failed to fetch comments: {e}"))
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
                pr.pr_number, e
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
                pr.pr_number, e
            );
            None
        }
    });

    let mut combined_status = combined_status_result.and_then(|result| match result {
        Ok(combined_status) => Some(combined_status),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch combined status for PR #{}: {}",
                pr.pr_number, e
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
                pr.pr_number, e
            );
            None
        }
    };

    let has_requested_reviewers = match &pr_details_result {
        Ok(details) => has_requested_reviewers_from_details(details),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch PR details for PR #{}: {}",
                pr.pr_number, e
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
        ),
    }
}

pub(super) fn select_branch_policy_inputs(
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    rest_required_checks_policy: &crate::github_client::RequiredChecksPolicy,
    rest_required_reviews_policy: &crate::github_client::RequiredReviewsPolicy,
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
    let merge_queue_required_by_policy = graphql_snapshot
        .filter(|snapshot| snapshot.policy.merge_queue_required.known)
        .and_then(|snapshot| snapshot.policy.merge_queue_required.value)
        .unwrap_or(false);

    BranchPolicyInputs {
        required_check_names,
        required_approving_count,
        required_checks_policy_known,
        required_reviews_policy_known,
        requires_up_to_date_branch,
        conversations_blocking,
        merge_queue_required_by_policy,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn poll_single_pr(
    github_client: GitHubClient,
    github_token: String,
    configured_github_username: Option<String>,
    pr: PrRow,
    since: Option<String>,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
    fetch_comments: bool,
) -> PollSinglePrResult {
    let comments = match fetch_pr_comments_for_poll(
        &github_client,
        &github_token,
        &pr,
        since.as_deref(),
        fetch_comments,
    )
    .await
    {
        Ok(comments) => comments,
        Err(error) => {
            return comment_fetch_error_result(
                pr,
                old_ci_status,
                old_review_status,
                old_mergeable,
                old_mergeable_state,
                error,
            );
        }
    };

    let graphql_snapshot =
        fetch_graphql_readiness_snapshot(&github_client, &pr, &github_token).await;
    let rest_sources = collect_rest_readiness_sources(
        &github_client,
        &github_token,
        &pr,
        graphql_snapshot.as_ref(),
        old_mergeable,
        old_mergeable_state,
    )
    .await;
    let graphql_inputs = select_snapshot_readiness_inputs(&pr, graphql_snapshot.as_ref());
    let result_head_sha = poll_result_pr_head_sha(&pr, graphql_snapshot.as_ref(), &rest_sources);
    let ci_validation_sha =
        poll_result_ci_validation_sha(graphql_inputs.as_ref(), &rest_sources, &result_head_sha);

    let check_runs = graphql_inputs
        .as_ref()
        .map(|inputs| inputs.check_runs.clone())
        .or(rest_sources.check_runs);
    let combined_status = graphql_inputs
        .as_ref()
        .map(|inputs| inputs.combined_status.clone())
        .or(rest_sources.combined_status);

    let (rest_required_checks_policy, rest_required_reviews_policy) =
        collect_branch_policy_sources(
            &github_client,
            &github_token,
            &pr,
            &rest_sources.pr_details_result,
        )
        .await;
    let branch_policy_inputs = select_branch_policy_inputs(
        graphql_snapshot.as_ref(),
        &rest_required_checks_policy,
        &rest_required_reviews_policy,
    );

    let readiness_ci_status = ci_status_for_readiness(
        check_runs.as_ref(),
        combined_status.as_ref(),
        &branch_policy_inputs.required_check_names,
        old_ci_status.as_ref(),
    );
    let readiness_review_status = current_graphql_review_status(
        graphql_snapshot.as_ref(),
        &result_head_sha,
        graphql_inputs.as_ref(),
    )
    .or_else(|| {
        review_status_for_readiness(
            None,
            rest_sources.reviews.as_ref(),
            rest_sources.has_requested_reviewers,
            branch_policy_inputs.required_approving_count,
            old_review_status.as_ref(),
        )
    });
    let readiness_mergeable_state = current_graphql_mergeable_state(
        graphql_snapshot.as_ref(),
        &result_head_sha,
        graphql_inputs.as_ref(),
    )
    .or(rest_sources.mergeable_state.as_deref());
    let readiness_is_queued = graphql_snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.merge_queue_state.as_ref())
        .map(|_| true)
        .unwrap_or(rest_sources.is_queued);

    let mut readiness_facts = build_merge_readiness_facts(
        &pr,
        rest_sources.pr_details_result.as_ref().ok(),
        rest_sources.mergeable,
        readiness_mergeable_state,
        readiness_ci_status.as_deref(),
        readiness_review_status.as_deref(),
        readiness_is_queued,
        branch_policy_inputs.required_checks_policy_known,
        branch_policy_inputs.required_reviews_policy_known,
        branch_policy_inputs.requires_up_to_date_branch,
        branch_policy_inputs.conversations_blocking,
        None,
    );

    readiness_facts = finalize_readiness_facts_for_poll(
        readiness_facts,
        graphql_snapshot.as_ref(),
        &result_head_sha,
        readiness_is_queued,
        branch_policy_inputs.merge_queue_required_by_policy,
        0,
        0,
    );
    readiness_facts = enforce_actor_scoped_readiness(
        readiness_facts,
        rest_sources.pr_details_result.as_ref().ok(),
        configured_github_username.as_deref(),
    );

    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: pr.title,
        head_sha: result_head_sha,
        ci_validation_sha,
        old_ci_status,
        old_review_status,
        comments,
        check_runs,
        combined_status,
        reviews: rest_sources.reviews,
        has_requested_reviewers: rest_sources.has_requested_reviewers,
        mergeable: rest_sources.mergeable,
        mergeable_state: rest_sources.mergeable_state,
        is_queued: readiness_is_queued,
        required_check_names: branch_policy_inputs.required_check_names,
        required_approving_count: branch_policy_inputs.required_approving_count,
        readiness_facts,
        error: None,
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
