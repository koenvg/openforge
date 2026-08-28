use super::pr_readiness::{
    collect_branch_policy_sources, collect_rest_readiness_sources, current_graphql_mergeable_state,
    current_graphql_review_status, enforce_merge_method_policy, fetch_graphql_readiness_snapshot,
    poll_result_ci_validation_sha, poll_result_pr_head_sha, select_branch_policy_inputs,
};
use super::review_sync::{terminal_state_for_pr_details, StaleAuthoredPrTerminalState};
use crate::db::{
    build_merge_readiness_facts, ci_status_for_readiness, enforce_actor_scoped_readiness,
    finalize_readiness_facts_for_poll, review_status_for_readiness,
    select_snapshot_readiness_inputs, PrMergeReadinessFacts, PrRow,
};
use crate::github_client::{
    CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubError, PrComment, PrReview,
};
use std::collections::HashSet;

pub(super) fn should_fetch_comments_for_pr(pr_id: i64, changed_pr_numbers: &HashSet<i64>) -> bool {
    changed_pr_numbers.is_empty() || changed_pr_numbers.contains(&pr_id)
}

pub(super) fn sanitized_comment_fetch_error_message(error: &GitHubError) -> String {
    format!(
        "Failed to fetch comments: {}",
        error.sanitized_log_message()
    )
}

pub(super) struct PollSinglePrResult {
    pub(super) pr_id: i64,
    pub(super) ticket_id: String,
    pub(super) pr_title: String,
    pub(super) github_node_id: Option<String>,
    /// PR source head SHA persisted on the pull_requests row.
    pub(super) head_sha: String,
    /// SHA whose CI signals were evaluated; can be a merge-group SHA.
    pub(super) ci_validation_sha: String,
    pub(super) old_ci_status: Option<String>,
    pub(super) old_review_status: Option<String>,
    pub(super) comments: Vec<PrComment>,
    pub(super) comments_snapshot_complete: bool,
    pub(super) check_runs: Option<CheckRunsResponse>,
    pub(super) combined_status: Option<CombinedStatusResponse>,
    pub(super) reviews: Option<Vec<PrReview>>,
    pub(super) has_requested_reviewers: bool,
    pub(super) mergeable: Option<bool>,
    pub(super) mergeable_state: Option<String>,
    pub(super) is_queued: bool,
    pub(super) required_check_names: Vec<String>,
    pub(super) required_approving_count: Option<usize>,
    pub(super) merge_methods_policy_known: bool,
    pub(super) allowed_merge_methods: Vec<crate::github_client::PullRequestMergeMethod>,
    pub(super) default_merge_method: Option<crate::github_client::PullRequestMergeMethod>,
    pub(super) readiness_facts: PrMergeReadinessFacts,
    pub(super) terminal_state: Option<StaleAuthoredPrTerminalState>,
    pub(super) error: Option<String>,
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
        github_node_id: pr.github_node_id.clone(),
        head_sha: pr.head_sha.clone(),
        ci_validation_sha: pr.head_sha.clone(),
        old_ci_status,
        old_review_status,
        comments: vec![],
        comments_snapshot_complete: false,
        check_runs: None,
        combined_status: None,
        reviews: None,
        has_requested_reviewers: false,
        mergeable: old_mergeable,
        mergeable_state: old_mergeable_state,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        merge_methods_policy_known: false,
        allowed_merge_methods: Vec::new(),
        default_merge_method: None,
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
        terminal_state: None,
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
        .map_err(|e| sanitized_comment_fetch_error_message(&e))
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

    let (rest_required_checks_policy, rest_required_reviews_policy, rest_merge_method_restriction) =
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
        &rest_merge_method_restriction,
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
        pr.merge_queue_required,
        0,
        0,
    );
    readiness_facts = enforce_actor_scoped_readiness(
        readiness_facts,
        rest_sources.pr_details_result.as_ref().ok(),
        configured_github_username.as_deref(),
    );
    readiness_facts = enforce_merge_method_policy(readiness_facts, &branch_policy_inputs);
    let terminal_state = rest_sources
        .pr_details_result
        .as_ref()
        .ok()
        .and_then(terminal_state_for_pr_details);

    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: rest_sources
            .pr_details_result
            .as_ref()
            .ok()
            .map(|details| details.title.clone())
            .unwrap_or(pr.title),
        github_node_id: graphql_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.github_node_id.clone())
            .or(pr.github_node_id),
        head_sha: result_head_sha,
        ci_validation_sha,
        old_ci_status,
        old_review_status,
        comments,
        comments_snapshot_complete: fetch_comments,
        check_runs,
        combined_status,
        reviews: rest_sources.reviews,
        has_requested_reviewers: rest_sources.has_requested_reviewers,
        mergeable: rest_sources.mergeable,
        mergeable_state: rest_sources.mergeable_state,
        is_queued: readiness_is_queued,
        required_check_names: branch_policy_inputs.required_check_names,
        required_approving_count: branch_policy_inputs.required_approving_count,
        merge_methods_policy_known: branch_policy_inputs.merge_methods_policy_known,
        allowed_merge_methods: branch_policy_inputs.allowed_merge_methods,
        default_merge_method: branch_policy_inputs.default_merge_method,
        readiness_facts,
        terminal_state,
        error: None,
    }
}
