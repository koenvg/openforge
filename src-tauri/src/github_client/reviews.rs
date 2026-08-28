use std::collections::HashMap;

use log::warn;

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

impl GitHubClient {
    /// Fetch positioned review comments for a PR
    /// Returns inline review comments with path/line/side data
    pub async fn get_pr_review_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrReviewComment>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments?per_page=100",
            owner, repo, pr_number
        );

        self.get_all_pages(&url, token).await
    }

    /// Submit a PR review with inline comments
    /// event: "APPROVE", "REQUEST_CHANGES", or "COMMENT"
    #[allow(clippy::too_many_arguments)]
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        event: &str,
        body: &str,
        comments: Vec<ReviewSubmitComment>,
        commit_id: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/reviews",
            owner, repo, pr_number
        );

        let request_body = ReviewSubmitRequest {
            commit_id: commit_id.to_string(),
            event: event.to_string(),
            body: body.to_string(),
            comments,
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, &url, token)
                    .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        Ok(())
    }

    /// Post a single review comment immediately (not part of a pending review).
    /// GitHub's create-review-comment endpoint; anchored to a line on the head commit.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_comment(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        commit_id: &str,
        path: &str,
        line: i32,
        side: &str,
        body: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments",
            owner, repo, pr_number
        );

        let request_body = CreateReviewCommentRequest {
            body: body.to_string(),
            commit_id: commit_id.to_string(),
            path: path.to_string(),
            line,
            side: side.to_string(),
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, &url, token)
                    .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        Ok(())
    }

    /// Post a threaded reply to an existing review comment.
    /// Replies attach under the given comment's thread (GitHub's reply endpoint).
    pub async fn create_review_comment_reply(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        comment_id: i64,
        body: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments/{}/replies",
            owner, repo, pr_number, comment_id
        );

        let request_body = ReviewCommentReplyRequest {
            body: body.to_string(),
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, &url, token)
                    .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        Ok(())
    }

    /// Get reviews for a pull request
    ///
    /// Fetches all reviews to determine approval/changes-requested state.
    pub async fn get_pr_reviews(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrReview>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/reviews?per_page=100",
            owner, repo, pr_number
        );
        self.get_all_pages(&url, token).await
    }

    /// Get required pull request reviews policy from branch protection rules.
    pub async fn get_required_approving_review_policy(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> RequiredReviewsPolicy {
        let url = format!(
            "https://api.github.com/repos/{}/{}/branches/{}/protection/required_pull_request_reviews",
            owner, repo, branch
        );

        let response = match self.conditional_get(&url, token).await {
            Ok(super::ConditionalResponse::NotModified(Some(cached_body))) => {
                return RequiredReviewsPolicy::from_rest_json(&cached_body)
                    .unwrap_or_else(|e| RequiredReviewsPolicy::unknown(e.to_string()));
            }
            Ok(super::ConditionalResponse::NotModified(None)) => {
                return RequiredReviewsPolicy::unknown(
                    "304 without cached required reviews response",
                );
            }
            Ok(super::ConditionalResponse::Fresh(response)) => response,
            Err(e) => {
                warn!(
                    "[GitHub] Failed to fetch required reviews: {}",
                    e.sanitized_log_message()
                );
                return RequiredReviewsPolicy::unknown(e.to_string());
            }
        };

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return RequiredReviewsPolicy::from_rest_error(404, "not found");
        }
        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return RequiredReviewsPolicy::from_rest_error(403, "forbidden");
        }

        if !response.status().is_success() {
            let status = response.status();
            warn!(
                "[GitHub] Unexpected status {} fetching required reviews",
                status
            );
            return RequiredReviewsPolicy::from_rest_error(status.as_u16(), "unexpected status");
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let body = match response.text().await {
            Ok(b) => b,
            Err(e) => return RequiredReviewsPolicy::unknown(e.to_string()),
        };

        self.cache_response_body(&url, etag, &body);

        RequiredReviewsPolicy::from_rest_json(&body).unwrap_or_else(|e| {
            warn!("[GitHub] Failed to parse required reviews");
            RequiredReviewsPolicy::unknown(e.to_string())
        })
    }

    /// Get required approving review count from branch protection rules.
    ///
    /// Compatibility wrapper for callers that only need the count. Prefer
    /// `get_required_approving_review_policy` when policy coverage matters.
    #[allow(dead_code)]
    pub async fn get_required_approving_review_count(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> Option<usize> {
        self.get_required_approving_review_policy(owner, repo, branch, token)
            .await
            .required_approving_review_count
    }
}

pub(crate) fn normalize_review_decision(decision: Option<&str>) -> Option<String> {
    decision.map(|decision| match decision {
        "APPROVED" => "approved".to_string(),
        "CHANGES_REQUESTED" => "changes_requested".to_string(),
        "REVIEW_REQUIRED" => "review_required".to_string(),
        other => {
            warn!(
                "[GitHub] Unknown reviewDecision value from GraphQL: {}",
                other
            );
            "review_unknown".to_string()
        }
    })
}

/// Aggregate review status from PR reviews and requested reviewers
///
/// Determines the overall review status by examining submitted reviews.
/// When `required_approving_count` is provided (from branch protection rules),
/// the function treats reviews as sufficient once the required number of approvals
/// is reached, even if optional reviewers are still pending.
/// Returns one of: "approved", "changes_requested", "review_required", or "none".
pub fn aggregate_review_status(
    reviews: &[PrReview],
    has_requested_reviewers: bool,
    required_approving_count: Option<usize>,
) -> String {
    if reviews.is_empty() && !has_requested_reviewers {
        return "none".to_string();
    }
    // Build effective review state per reviewer (latest actionable review wins)
    let mut effective: HashMap<&str, &str> = HashMap::new();
    for review in reviews {
        match review.state.as_str() {
            "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" => {
                effective.insert(&review.user.login, &review.state);
            }
            _ => {}
        }
    }
    // Check if any reviewer requested changes (and hasn't since approved)
    for state in effective.values() {
        if *state == "CHANGES_REQUESTED" {
            return "changes_requested".to_string();
        }
    }

    // Count current approvals
    let approval_count = effective.values().filter(|s| **s == "APPROVED").count();

    // If we know the required approval count (from branch protection),
    // check if we have enough — remaining reviewers are optional
    if let Some(required) = required_approving_count {
        if required > 0 && approval_count >= required {
            return "approved".to_string();
        }
    }
    // If there are still pending reviewers, reviews are required
    if has_requested_reviewers {
        return "review_required".to_string();
    }
    // If at least one approval exists and no changes requested
    if approval_count > 0 {
        return "approved".to_string();
    }
    // Reviews exist but none are actionable (all COMMENTED/PENDING)
    if !reviews.is_empty() {
        return "review_required".to_string();
    }
    "none".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_review(login: &str, state: &str) -> PrReview {
        PrReview {
            id: 1,
            user: GitHubUser {
                login: login.to_string(),
                extra: serde_json::json!({}),
            },
            state: state.to_string(),
            body: None,
            submitted_at: None,
            extra: serde_json::json!({}),
        }
    }

    #[test]
    fn test_no_reviews_no_requested() {
        assert_eq!(aggregate_review_status(&[], false, None), "none");
    }

    #[test]
    fn test_no_reviews_with_requested() {
        assert_eq!(aggregate_review_status(&[], true, None), "review_required");
    }

    #[test]
    fn test_single_approval_no_requested() {
        let reviews = vec![make_review("alice", "APPROVED")];
        assert_eq!(aggregate_review_status(&reviews, false, None), "approved");
    }

    #[test]
    fn test_changes_requested() {
        let reviews = vec![make_review("alice", "CHANGES_REQUESTED")];
        assert_eq!(
            aggregate_review_status(&reviews, false, None),
            "changes_requested"
        );
    }

    #[test]
    fn test_changes_requested_takes_priority() {
        let reviews = vec![
            make_review("alice", "APPROVED"),
            make_review("bob", "CHANGES_REQUESTED"),
        ];
        assert_eq!(
            aggregate_review_status(&reviews, false, None),
            "changes_requested"
        );
    }

    #[test]
    fn test_approval_with_pending_reviewers_no_required_count() {
        let reviews = vec![make_review("alice", "APPROVED")];
        assert_eq!(
            aggregate_review_status(&reviews, true, None),
            "review_required"
        );
    }

    #[test]
    fn test_enough_approvals_with_required_count() {
        let reviews = vec![make_review("alice", "APPROVED")];
        assert_eq!(aggregate_review_status(&reviews, true, Some(1)), "approved");
    }

    #[test]
    fn test_more_approvals_than_required() {
        let reviews = vec![
            make_review("alice", "APPROVED"),
            make_review("bob", "APPROVED"),
        ];
        assert_eq!(aggregate_review_status(&reviews, true, Some(1)), "approved");
    }

    #[test]
    fn test_not_enough_approvals_for_required_count() {
        let reviews = vec![make_review("alice", "APPROVED")];
        assert_eq!(
            aggregate_review_status(&reviews, true, Some(2)),
            "review_required"
        );
    }

    #[test]
    fn test_exact_required_approvals_met() {
        let reviews = vec![
            make_review("alice", "APPROVED"),
            make_review("bob", "APPROVED"),
        ];
        assert_eq!(aggregate_review_status(&reviews, true, Some(2)), "approved");
    }

    #[test]
    fn test_changes_requested_overrides_required_count() {
        let reviews = vec![
            make_review("alice", "APPROVED"),
            make_review("bob", "CHANGES_REQUESTED"),
        ];
        assert_eq!(
            aggregate_review_status(&reviews, true, Some(1)),
            "changes_requested"
        );
    }

    #[test]
    fn test_required_count_zero() {
        assert_eq!(
            aggregate_review_status(&[], true, Some(0)),
            "review_required"
        );
    }

    #[test]
    fn test_only_commented_reviews() {
        let reviews = vec![make_review("alice", "COMMENTED")];
        assert_eq!(
            aggregate_review_status(&reviews, false, None),
            "review_required"
        );
    }

    #[test]
    fn test_latest_review_wins() {
        let reviews = vec![
            make_review("alice", "CHANGES_REQUESTED"),
            make_review("alice", "APPROVED"),
        ];
        assert_eq!(aggregate_review_status(&reviews, false, None), "approved");
    }

    #[test]
    fn test_dismissed_then_approved() {
        let reviews = vec![
            make_review("alice", "CHANGES_REQUESTED"),
            make_review("alice", "DISMISSED"),
        ];
        assert_eq!(
            aggregate_review_status(&reviews, false, None),
            "review_required"
        );
    }

    #[test]
    fn github_readiness_review_decision_normalizes_known_and_unknown_values() {
        assert_eq!(
            normalize_review_decision(Some("APPROVED")),
            Some("approved".to_string())
        );
        assert_eq!(
            normalize_review_decision(Some("CHANGES_REQUESTED")),
            Some("changes_requested".to_string())
        );
        assert_eq!(
            normalize_review_decision(Some("REVIEW_REQUIRED")),
            Some("review_required".to_string())
        );
        assert_eq!(
            normalize_review_decision(Some("AI_REVIEW_PENDING")),
            Some("review_unknown".to_string())
        );
        assert_eq!(normalize_review_decision(None), None);
    }

    #[test]
    fn github_readiness_required_reviews_policy_parses_count() {
        let json = r#"{
            "required_approving_review_count": 2,
            "dismiss_stale_reviews": true,
            "require_code_owner_reviews": true
        }"#;

        let policy = RequiredReviewsPolicy::from_rest_json(json).unwrap();
        assert!(policy.known);
        assert_eq!(policy.required_approving_review_count, Some(2));
    }

    #[test]
    fn github_readiness_required_reviews_forbidden_is_unknown_not_no_policy() {
        let policy = RequiredReviewsPolicy::from_rest_error(403, "Forbidden");
        assert!(!policy.known);
        assert_eq!(policy.required_approving_review_count, None);
        assert!(policy
            .unknown_reason
            .as_deref()
            .unwrap_or_default()
            .contains("403"));
    }

    #[test]
    fn github_readiness_required_reviews_not_found_is_known_no_policy() {
        let policy = RequiredReviewsPolicy::from_rest_error(404, "Not Found");
        assert!(policy.known);
        assert_eq!(policy.required_approving_review_count, Some(0));
        assert!(policy.unknown_reason.is_none());
    }
}
