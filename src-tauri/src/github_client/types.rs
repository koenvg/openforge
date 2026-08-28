use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrRef {
    pub repo_owner: String,
    pub repo_name: String,
    pub number: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub repo: Option<GitHubEventRepo>,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubEventRepo {
    pub name: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Pull request representation
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub user: GitHubUser,
    pub head: GitHubHead,
    pub draft: Option<bool>,
    #[serde(default)]
    pub mergeable: Option<bool>,
    #[serde(default)]
    pub mergeable_state: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// A GitHub label attached to a pull request.
///
/// `color` is a 6-digit hex string without a leading '#' (e.g. "b60205"),
/// exactly as GitHub returns it.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PrLabel {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

/// Search PR result with full details
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchPrResult {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub labels: Vec<PrLabel>,
}

/// PR file diff
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrFileDiff {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub changes: i64,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
    #[serde(default)]
    pub is_truncated: bool,
    #[serde(default)]
    pub patch_line_count: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReviewComment {
    pub id: i64,
    pub path: String,
    pub line: Option<i32>,
    pub side: Option<String>,
    pub body: String,
    pub user: GitHubUser,
    pub created_at: String,
    pub in_reply_to_id: Option<i64>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Unified PR comment (can be review comment or issue comment)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    /// File path (only present for review comments)
    pub path: Option<String>,
    /// Line number (only present for review comments)
    pub line: Option<i32>,
    /// Type of comment: "review_comment" or "issue_comment"
    pub comment_type: String,
    /// True when GitHub considers this comment outdated (its diff `position`
    /// became null because the commented line changed). Only ever true for
    /// review comments; issue comments and review bodies are never outdated.
    #[serde(default)]
    pub outdated: bool,
    pub created_at: String,
}

/// GitHub user
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubUser {
    pub login: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// GitHub head ref (branch info)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubHead {
    /// Branch name (e.g., "feature/PROJ-123-fix-bug")
    #[serde(rename = "ref")]
    pub ref_name: String,
    /// Commit SHA of the head branch
    pub sha: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Review comment (inline code comment) from GitHub API
#[derive(Debug, Deserialize)]
pub(crate) struct ReviewComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    pub path: String,
    /// The line in the latest diff the comment maps to. GitHub sets this to
    /// `null` when the comment is outdated — the commented line no longer exists
    /// in the current diff. (Note: the older `position` field is NOT reliable
    /// for this; it can stay non-null on an outdated comment.)
    #[serde(default)]
    pub line: Option<i32>,
    /// The line the comment was originally made on. Retained by GitHub even after
    /// the comment goes outdated, so it's used for display/anchoring.
    #[serde(default)]
    pub original_line: Option<i32>,
    pub created_at: String,
}

impl ReviewComment {
    /// Convert an inline review comment into the unified [`PrComment`].
    ///
    /// A line comment is "outdated" (GitHub's Conversation-tab chip) when its
    /// current `line` no longer maps to the diff (`null`) while it still has an
    /// `original_line`. The original line is kept for display so outdated
    /// comments still show `path:line`.
    pub(crate) fn into_pr_comment(self) -> PrComment {
        let outdated = self.line.is_none() && self.original_line.is_some();
        PrComment {
            id: self.id,
            body: self.body,
            user: self.user,
            path: Some(self.path),
            line: self.line.or(self.original_line),
            comment_type: "review_comment".to_string(),
            outdated,
            created_at: self.created_at,
        }
    }
}

/// Issue comment (general comment) from GitHub API
#[derive(Debug, Deserialize)]
pub(crate) struct IssueComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    pub created_at: String,
}

impl IssueComment {
    /// Convert a general issue comment into the unified [`PrComment`].
    /// Issue comments have no diff position and are never outdated.
    pub(crate) fn into_pr_comment(self) -> PrComment {
        PrComment {
            id: self.id,
            body: self.body,
            user: self.user,
            path: None,
            line: None,
            comment_type: "issue_comment".to_string(),
            outdated: false,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewSubmitRequest {
    pub commit_id: String,
    pub event: String,
    pub body: String,
    pub comments: Vec<ReviewSubmitComment>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewCommentReplyRequest {
    pub body: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreateReviewCommentRequest {
    pub body: String,
    pub commit_id: String,
    pub path: String,
    pub line: i32,
    pub side: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestMergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl PullRequestMergeMethod {
    pub(crate) fn from_github_value(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "merge" => Some(Self::Merge),
            "squash" => Some(Self::Squash),
            "rebase" => Some(Self::Rebase),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Squash => "squash",
            Self::Rebase => "rebase",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct MergePrRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
    pub merge_method: PullRequestMergeMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MergePrResponse {
    pub merged: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSubmitComment {
    pub path: String,
    pub line: i32,
    pub side: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthenticatedUser {
    pub login: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchResponse {
    pub total_count: usize,
    pub items: Vec<SearchItem>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchItem {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: Option<bool>,
    pub html_url: String,
    pub user: SearchUser,
    pub repository_url: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub labels: Vec<PrLabel>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchUser {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BlobResponse {
    pub content: String,
}

/// PR review from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReview {
    pub id: i64,
    pub user: GitHubUser,
    pub state: String,
    /// Review body text (the top-level summary comment).
    /// Present when a reviewer submits a review with a body message.
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub submitted_at: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Request body for creating a repository on the authenticated user's account.
#[derive(Debug, Serialize)]
pub(crate) struct CreateRepoRequest {
    pub name: String,
    pub private: bool,
    /// Always false — OpenForge creates an empty repo and the user makes the
    /// first commit; an auto-init README is never injected.
    pub auto_init: bool,
}

/// Subset of the GitHub repo object we need from a create response.
#[derive(Debug, Deserialize)]
pub struct CreatedRepo {
    pub clone_url: String,
}

/// Check runs response from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRunsResponse {
    /// Total number of check runs
    pub total_count: usize,
    /// List of check runs
    pub check_runs: Vec<CheckRun>,
}

/// Individual check run from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRun {
    /// Check run ID
    pub id: i64,
    /// Check run name (e.g., "build", "test", "lint")
    pub name: String,
    /// Check run status (e.g., "queued", "in_progress", "completed")
    #[serde(default)]
    pub status: String,
    /// Check run conclusion (e.g., "success", "failure", "skipped", "neutral")
    #[serde(default)]
    pub conclusion: Option<String>,
    /// URL to view the check run
    pub html_url: String,
}

/// Combined status response from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CombinedStatusResponse {
    /// Overall state (e.g., "success", "failure", "pending", "error")
    pub state: String,
    /// List of commit statuses
    pub statuses: Vec<CommitStatusEntry>,
    /// Commit SHA
    #[serde(default)]
    pub sha: String,
    /// Total number of statuses
    #[serde(default)]
    pub total_count: usize,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Individual commit status entry from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommitStatusEntry {
    /// Status state (e.g., "success", "failure", "pending", "error")
    pub state: String,
    /// Status context (e.g., "continuous-integration/travis-ci")
    pub context: String,
    /// Status description
    #[serde(default)]
    pub description: Option<String>,
    /// URL to view the status
    #[serde(default)]
    pub target_url: Option<String>,
}

/// Required status checks response from GitHub branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredStatusChecksResponse {
    /// Deprecated flat list of required check names
    #[serde(default)]
    pub contexts: Vec<String>,
    /// Required checks with context name and optional app_id
    #[serde(default)]
    pub checks: Vec<RequiredCheckEntry>,
}

/// Individual required check entry from branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredCheckEntry {
    /// Check context name (matches CheckRun.name or CommitStatusEntry.context)
    pub context: String,
}

impl RequiredStatusChecksResponse {
    /// Extract deduplicated context names from both `checks` and `contexts` fields
    pub fn into_context_names(self) -> Vec<String> {
        let mut names: Vec<String> = self.checks.into_iter().map(|c| c.context).collect();
        for ctx in self.contexts {
            if !names.contains(&ctx) {
                names.push(ctx);
            }
        }
        names
    }
}

/// Required pull request reviews response from GitHub branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredPullRequestReviewsResponse {
    /// Number of approving reviews required
    #[serde(default)]
    pub required_approving_review_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredChecksPolicy {
    pub known: bool,
    pub required_check_names: Vec<String>,
    pub requires_up_to_date_branch: Option<bool>,
    pub unknown_reason: Option<String>,
}

impl RequiredChecksPolicy {
    pub fn known(
        required_check_names: Vec<String>,
        requires_up_to_date_branch: Option<bool>,
    ) -> Self {
        Self {
            known: true,
            required_check_names,
            requires_up_to_date_branch,
            unknown_reason: None,
        }
    }

    pub fn unknown(reason: impl Into<String>) -> Self {
        Self {
            known: false,
            required_check_names: Vec::new(),
            requires_up_to_date_branch: None,
            unknown_reason: Some(reason.into()),
        }
    }

    pub fn from_rest_json(json: &str) -> Result<Self, serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        let response: RequiredStatusChecksResponse = serde_json::from_value(value.clone())?;
        let requires_up_to_date_branch = value.get("strict").and_then(|v| v.as_bool());
        Ok(Self::known(
            response.into_context_names(),
            requires_up_to_date_branch,
        ))
    }

    pub fn from_rest_error(status: u16, message: &str) -> Self {
        if status == 404 {
            Self::known(Vec::new(), Some(false))
        } else {
            Self::unknown(format!(
                "REST required checks unavailable ({status}): {message}"
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredReviewsPolicy {
    pub known: bool,
    pub required_approving_review_count: Option<usize>,
    pub unknown_reason: Option<String>,
}

impl RequiredReviewsPolicy {
    pub fn known(required_approving_review_count: usize) -> Self {
        Self {
            known: true,
            required_approving_review_count: Some(required_approving_review_count),
            unknown_reason: None,
        }
    }

    pub fn unknown(reason: impl Into<String>) -> Self {
        Self {
            known: false,
            required_approving_review_count: None,
            unknown_reason: Some(reason.into()),
        }
    }

    pub fn from_rest_json(json: &str) -> Result<Self, serde_json::Error> {
        let response: RequiredPullRequestReviewsResponse = serde_json::from_str(json)?;
        Ok(Self::known(response.required_approving_review_count))
    }

    pub fn from_rest_error(status: u16, message: &str) -> Self {
        if status == 404 {
            Self::known(0)
        } else {
            Self::unknown(format!(
                "REST required reviews unavailable ({status}): {message}"
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyValue<T> {
    pub known: bool,
    pub value: T,
    pub unknown_reason: Option<String>,
}

impl<T: Default> PolicyValue<T> {
    pub fn unknown(reason: impl Into<String>) -> Self {
        Self {
            known: false,
            value: T::default(),
            unknown_reason: Some(reason.into()),
        }
    }
}

impl<T> PolicyValue<T> {
    pub fn known(value: T) -> Self {
        Self {
            known: true,
            value,
            unknown_reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryPolicyFacts {
    pub required_checks: PolicyValue<Vec<String>>,
    pub required_reviews: PolicyValue<Option<usize>>,
    pub requires_up_to_date_branch: PolicyValue<Option<bool>>,
    pub requires_conversation_resolution: PolicyValue<Option<bool>>,
    pub allowed_merge_methods: PolicyValue<Vec<PullRequestMergeMethod>>,
    pub default_merge_method: PolicyValue<Option<PullRequestMergeMethod>>,
    pub required_deployments: PolicyValue<Vec<String>>,
    pub unknown_reasons: Vec<String>,
}

impl RepositoryPolicyFacts {
    pub fn known_empty() -> Self {
        Self {
            required_checks: PolicyValue::known(Vec::new()),
            required_reviews: PolicyValue::known(Some(0)),
            requires_up_to_date_branch: PolicyValue::known(Some(false)),
            requires_conversation_resolution: PolicyValue::known(Some(false)),
            allowed_merge_methods: PolicyValue::unknown("repository merge methods unavailable"),
            default_merge_method: PolicyValue::unknown("default merge method unavailable"),
            required_deployments: PolicyValue::known(Vec::new()),
            unknown_reasons: Vec::new(),
        }
    }

    pub fn unknown(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        Self {
            required_checks: PolicyValue::unknown(reason.clone()),
            required_reviews: PolicyValue::unknown(reason.clone()),
            requires_up_to_date_branch: PolicyValue::unknown(reason.clone()),
            requires_conversation_resolution: PolicyValue::unknown(reason.clone()),
            allowed_merge_methods: PolicyValue::unknown(reason.clone()),
            default_merge_method: PolicyValue::unknown(reason.clone()),
            required_deployments: PolicyValue::unknown(reason.clone()),
            unknown_reasons: vec![reason],
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct GitHubReadinessSnapshot {
    pub github_node_id: Option<String>,
    pub source_head_sha: Option<String>,
    pub status_check_rollup_sha: Option<String>,
    pub check_runs: CheckRunsResponse,
    pub combined_status: CombinedStatusResponse,
    pub merge_state_status: Option<String>,
    pub mergeable_state: Option<String>,
    pub review_decision: Option<String>,
    pub review_status: Option<String>,
    pub auto_merge_requested: bool,
    pub merge_queue_enabled: Option<bool>,
    pub merge_queue_state: Option<String>,
    pub merge_group_sha: Option<String>,
    pub unresolved_conversations: Option<bool>,
    pub policy: RepositoryPolicyFacts,
    pub warnings: Vec<String>,
}

impl GitHubReadinessSnapshot {
    pub fn unknown(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        Self {
            github_node_id: None,
            source_head_sha: None,
            status_check_rollup_sha: None,
            check_runs: CheckRunsResponse {
                total_count: 0,
                check_runs: vec![],
            },
            combined_status: CombinedStatusResponse {
                state: "pending".to_string(),
                statuses: vec![],
                sha: String::new(),
                total_count: 0,
                extra: serde_json::json!({}),
            },
            merge_state_status: None,
            mergeable_state: None,
            review_decision: None,
            review_status: None,
            auto_merge_requested: false,
            merge_queue_enabled: None,
            merge_queue_state: None,
            merge_group_sha: None,
            unresolved_conversations: None,
            policy: RepositoryPolicyFacts::unknown(reason.clone()),
            warnings: vec![reason],
        }
    }

    pub fn from_graphql_response(payload: &serde_json::Value) -> Result<Self, String> {
        let error_reason = payload
            .get("errors")
            .and_then(|value| value.as_array())
            .filter(|errors| !errors.is_empty())
            .map(|errors| {
                let reason = errors
                    .iter()
                    .filter_map(|error| error.get("message").and_then(|message| message.as_str()))
                    .collect::<Vec<_>>()
                    .join("; ");
                if reason.is_empty() {
                    "GraphQL readiness unavailable".to_string()
                } else {
                    reason
                }
            });

        // GitHub GraphQL routinely returns partial responses: fully usable
        // pullRequest data alongside a field-level error (e.g.
        // baseRef.branchProtectionRule requires admin access). Salvage the data we
        // did get so the poller keeps a valid head SHA instead of falling back to
        // REST on every poll; only when pullRequest data is absent do we return a
        // fully-unknown snapshot.
        let Some(repository) = payload.pointer("/data/repository") else {
            return match error_reason {
                Some(reason) => Ok(Self::unknown(reason)),
                None => Err("GraphQL response missing repository".to_string()),
            };
        };
        let Some(pr) = repository
            .get("pullRequest")
            .filter(|value| !value.is_null())
        else {
            return match error_reason {
                Some(reason) => Ok(Self::unknown(reason)),
                None => Err("GraphQL response missing pullRequest".to_string()),
            };
        };
        let github_node_id = string_field(pr, "id");
        let source_head_sha = string_field(pr, "headRefOid");
        let merge_state_status = string_field(pr, "mergeStateStatus");
        let review_decision = string_field(pr, "reviewDecision");
        let mut warnings = Vec::new();
        let mergeable_state = merge_state_status.as_deref().map(|status| {
            if is_known_merge_state_status(status) {
                normalize_merge_state_status(status)
            } else {
                warnings.push(format!(
                    "Unknown mergeStateStatus value from GraphQL: {status}"
                ));
                "unknown".to_string()
            }
        });
        let review_status =
            crate::github_client::reviews::normalize_review_decision(review_decision.as_deref());
        let auto_merge_requested = pr
            .get("autoMergeRequest")
            .map(|value| !value.is_null())
            .unwrap_or(false);
        let merge_queue_enabled = pr
            .get("isMergeQueueEnabled")
            .and_then(|value| value.as_bool());
        let merge_queue = pr.get("mergeQueueEntry");
        let merge_queue_state = merge_queue.and_then(|entry| string_field(entry, "state"));
        let merge_group_sha = merge_queue
            .and_then(|entry| entry.pointer("/mergeGroup/headSha"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);

        let commit = pr
            .pointer("/commits/nodes/0/commit")
            .unwrap_or(&serde_json::Value::Null);
        let status_check_rollup_sha = string_field(commit, "oid");
        let (check_runs, combined_status, check_rollup_truncated) =
            parse_status_check_rollup(commit, &status_check_rollup_sha);
        let status_check_rollup_sha = if check_rollup_truncated {
            None
        } else {
            status_check_rollup_sha
        };

        let review_threads_truncated = pr
            .pointer("/reviewThreads/pageInfo/hasNextPage")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let unresolved_conversations = pr
            .pointer("/reviewThreads/nodes")
            .and_then(|nodes| nodes.as_array())
            .map(|nodes| {
                nodes
                    .iter()
                    .any(|node| node.get("isResolved").and_then(|v| v.as_bool()) == Some(false))
            });

        let mut policy = parse_repository_policy(pr.pointer("/baseRef/branchProtectionRule"));
        apply_repository_merge_method_policy(repository, &mut policy);
        if check_rollup_truncated {
            warnings.push(
                "statusCheckRollup contexts are paginated; REST check fallback required"
                    .to_string(),
            );
        }
        if review_threads_truncated
            && (policy.requires_conversation_resolution.value != Some(false))
        {
            let reason = "reviewThreads are paginated; conversation resolution coverage is unknown"
                .to_string();
            policy.requires_conversation_resolution = PolicyValue::unknown(reason.clone());
            policy.unknown_reasons.push(reason.clone());
            warnings.push(reason);
        }

        // A partial error may have nulled out branch-protection fields, and a null
        // branchProtectionRule is otherwise read as "no protection required". We
        // cannot tell those apart, so treat all policy coverage as unknown and let
        // the REST fallback fill only that gap.
        if let Some(reason) = error_reason {
            let allowed_merge_methods = policy.allowed_merge_methods.clone();
            let default_merge_method = policy.default_merge_method.clone();
            policy = RepositoryPolicyFacts::unknown(reason.clone());
            policy.allowed_merge_methods = allowed_merge_methods;
            policy.default_merge_method = default_merge_method;
            warnings.push(reason);
        }

        Ok(Self {
            github_node_id,
            source_head_sha,
            status_check_rollup_sha,
            check_runs,
            combined_status,
            merge_state_status,
            mergeable_state,
            review_decision,
            review_status,
            auto_merge_requested,
            merge_queue_enabled,
            merge_queue_state,
            merge_group_sha,
            unresolved_conversations,
            policy,
            warnings,
        })
    }

    pub fn requires_rest_check_fallback(&self) -> bool {
        match (&self.source_head_sha, &self.status_check_rollup_sha) {
            (Some(source), Some(rollup)) => source != rollup,
            _ => true,
        }
    }
}

fn string_field(value: &serde_json::Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

pub(crate) fn normalize_merge_state_status(status: &str) -> String {
    status.to_ascii_lowercase()
}

fn is_known_merge_state_status(status: &str) -> bool {
    matches!(
        status,
        "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE"
    )
}

fn merge_method_from_graphql(value: &str) -> Option<PullRequestMergeMethod> {
    match value {
        "MERGE" => Some(PullRequestMergeMethod::Merge),
        "SQUASH" => Some(PullRequestMergeMethod::Squash),
        "REBASE" => Some(PullRequestMergeMethod::Rebase),
        _ => None,
    }
}

fn apply_repository_merge_method_policy(
    repository: &serde_json::Value,
    policy: &mut RepositoryPolicyFacts,
) {
    let configured_methods = [
        ("mergeCommitAllowed", PullRequestMergeMethod::Merge),
        ("squashMergeAllowed", PullRequestMergeMethod::Squash),
        ("rebaseMergeAllowed", PullRequestMergeMethod::Rebase),
    ];
    if configured_methods.iter().all(|(field, _)| {
        repository
            .get(field)
            .and_then(|value| value.as_bool())
            .is_some()
    }) {
        policy.allowed_merge_methods = PolicyValue::known(
            configured_methods
                .iter()
                .filter_map(|(field, method)| {
                    repository
                        .get(field)
                        .and_then(|value| value.as_bool())
                        .filter(|allowed| *allowed)
                        .map(|_| *method)
                })
                .collect(),
        );
    } else {
        let reason = "repository merge methods unavailable from GraphQL".to_string();
        policy.allowed_merge_methods = PolicyValue::unknown(reason.clone());
        policy.unknown_reasons.push(reason);
    }

    match repository
        .get("viewerDefaultMergeMethod")
        .and_then(|value| value.as_str())
        .and_then(merge_method_from_graphql)
    {
        Some(method) => policy.default_merge_method = PolicyValue::known(Some(method)),
        None => {
            let reason = "default merge method unavailable from GraphQL".to_string();
            policy.default_merge_method = PolicyValue::unknown(reason.clone());
            policy.unknown_reasons.push(reason);
        }
    }
}

fn parse_repository_policy(rule: Option<&serde_json::Value>) -> RepositoryPolicyFacts {
    let Some(rule) = rule else {
        return RepositoryPolicyFacts::known_empty();
    };

    let required_checks = rule
        .get("requiredStatusCheckContexts")
        .and_then(|value| value.as_array())
        .map(|contexts| {
            contexts
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let required_reviews = rule
        .get("requiredApprovingReviewCount")
        .and_then(|value| value.as_u64())
        .and_then(|value| usize::try_from(value).ok());
    let requires_up_to_date_branch = rule
        .get("requiresStrictStatusChecks")
        .and_then(|value| value.as_bool());
    let requires_conversation_resolution = rule
        .get("requiresConversationResolution")
        .and_then(|value| value.as_bool());
    let requires_deployments = rule
        .get("requiresDeployments")
        .and_then(|value| value.as_bool());
    let required_deployment_environments = rule
        .get("requiredDeploymentEnvironments")
        .and_then(|value| value.as_array())
        .map(|environments| {
            environments
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        });
    let (required_deployments, unknown_reasons) = match (
        requires_deployments,
        required_deployment_environments,
    ) {
        (Some(true), Some(environments)) => (PolicyValue::known(environments), Vec::new()),
        (Some(true), None) => {
            let reason = "required deployments are configured but deployment environments were not available from GraphQL".to_string();
            (PolicyValue::unknown(reason.clone()), vec![reason])
        }
        _ => (PolicyValue::known(Vec::new()), Vec::new()),
    };

    RepositoryPolicyFacts {
        required_checks: PolicyValue::known(required_checks),
        required_reviews: PolicyValue::known(required_reviews),
        requires_up_to_date_branch: PolicyValue::known(requires_up_to_date_branch),
        requires_conversation_resolution: PolicyValue::known(requires_conversation_resolution),
        allowed_merge_methods: PolicyValue::unknown("repository merge methods unavailable"),
        default_merge_method: PolicyValue::unknown("default merge method unavailable"),
        required_deployments,
        unknown_reasons,
    }
}

fn combined_status_state_from_status_contexts(statuses: &[CommitStatusEntry]) -> String {
    if statuses
        .iter()
        .any(|status| matches!(status.state.as_str(), "failure" | "error"))
    {
        "failure".to_string()
    } else if statuses.iter().any(|status| status.state == "pending") {
        "pending".to_string()
    } else {
        "success".to_string()
    }
}

fn parse_status_check_rollup(
    commit: &serde_json::Value,
    sha: &Option<String>,
) -> (CheckRunsResponse, CombinedStatusResponse, bool) {
    let rollup = commit
        .get("statusCheckRollup")
        .unwrap_or(&serde_json::Value::Null);
    let nodes = rollup
        .pointer("/contexts/nodes")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut check_runs = Vec::new();
    let mut statuses = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        match node.get("__typename").and_then(|value| value.as_str()) {
            Some("CheckRun") => check_runs.push(CheckRun {
                id: i64::try_from(index + 1).unwrap_or(1),
                name: string_field(node, "name").unwrap_or_else(|| "check".to_string()),
                status: string_field(node, "status")
                    .map(|status| status.to_ascii_lowercase())
                    .unwrap_or_default(),
                conclusion: string_field(node, "conclusion")
                    .map(|conclusion| conclusion.to_ascii_lowercase()),
                html_url: string_field(node, "detailsUrl").unwrap_or_default(),
            }),
            Some("StatusContext") => statuses.push(CommitStatusEntry {
                state: string_field(node, "state")
                    .map(|state| state.to_ascii_lowercase())
                    .unwrap_or_default(),
                context: string_field(node, "context").unwrap_or_else(|| "status".to_string()),
                description: string_field(node, "description"),
                target_url: string_field(node, "targetUrl"),
            }),
            _ => {}
        }
    }

    let state = combined_status_state_from_status_contexts(&statuses);

    let truncated = rollup
        .pointer("/contexts/pageInfo/hasNextPage")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    (
        CheckRunsResponse {
            total_count: check_runs.len(),
            check_runs,
        },
        CombinedStatusResponse {
            state,
            statuses,
            sha: sha.clone().unwrap_or_default(),
            total_count: 0,
            extra: serde_json::json!({}),
        },
        truncated,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pr_comment_serialization() {
        let comment = PrComment {
            id: 123,
            body: "Test comment".to_string(),
            user: GitHubUser {
                login: "testuser".to_string(),
                extra: serde_json::json!({}),
            },
            path: Some("src/main.rs".to_string()),
            line: Some(42),
            comment_type: "review_comment".to_string(),
            outdated: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"id\":123"));
        assert!(json.contains("\"comment_type\":\"review_comment\""));
        assert!(json.contains("\"path\":\"src/main.rs\""));
        assert!(json.contains("\"line\":42"));
    }

    #[test]
    fn test_pull_request_deserialization() {
        let json = r#"{
            "number": 123,
            "title": "Test PR",
            "state": "open",
            "html_url": "https://github.com/owner/repo/pull/123",
            "user": {
                "login": "testuser"
            },
            "head": {
                "ref": "feature/PROJ-123-fix-bug",
                "sha": "abc123def456"
            },
            "extra_field": "ignored"
        }"#;

        let pr: PullRequest = serde_json::from_str(json).unwrap();
        assert_eq!(pr.number, 123);
        assert_eq!(pr.title, "Test PR");
        assert_eq!(pr.state, "open");
        assert_eq!(pr.user.login, "testuser");
        assert_eq!(pr.head.ref_name, "feature/PROJ-123-fix-bug");
        assert_eq!(pr.mergeable, None);
        assert_eq!(pr.mergeable_state, None);
    }

    #[test]
    fn test_pr_file_diff_deserialization() {
        let json = r#"{
            "sha": "abc123",
            "filename": "src/main.rs",
            "status": "modified",
            "additions": 10,
            "deletions": 5,
            "changes": 15,
            "patch": "@@ -1,3 +1,5 @@\n-old\n+new",
            "previous_filename": null
        }"#;
        let diff: PrFileDiff = serde_json::from_str(json).unwrap();
        assert_eq!(diff.sha, "abc123");
        assert_eq!(diff.filename, "src/main.rs");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.additions, 10);
        assert_eq!(diff.deletions, 5);
        assert_eq!(diff.changes, 15);
        assert!(diff.patch.is_some());
        assert!(diff.previous_filename.is_none());
    }

    #[test]
    fn test_pr_file_diff_with_rename() {
        let json = r#"{
            "sha": "def456",
            "filename": "src/new.rs",
            "status": "renamed",
            "additions": 2,
            "deletions": 1,
            "changes": 3,
            "patch": null,
            "previous_filename": "src/old.rs"
        }"#;
        let diff: PrFileDiff = serde_json::from_str(json).unwrap();
        assert_eq!(diff.filename, "src/new.rs");
        assert_eq!(diff.status, "renamed");
        assert!(diff.patch.is_none());
        assert_eq!(diff.previous_filename, Some("src/old.rs".to_string()));
    }

    #[test]
    fn test_pr_review_comment_deserialization() {
        let json = r#"{
            "id": 456,
            "path": "src/auth.rs",
            "line": 42,
            "side": "RIGHT",
            "body": "This needs a null check",
            "user": { "login": "reviewer" },
            "created_at": "2024-01-15T10:30:00Z",
            "in_reply_to_id": null
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 456);
        assert_eq!(comment.path, "src/auth.rs");
        assert_eq!(comment.line, Some(42));
        assert_eq!(comment.side, Some("RIGHT".to_string()));
        assert_eq!(comment.body, "This needs a null check");
        assert_eq!(comment.user.login, "reviewer");
        assert!(comment.in_reply_to_id.is_none());
    }

    #[test]
    fn test_pr_review_comment_with_reply() {
        let json = r#"{
            "id": 789,
            "path": "src/lib.rs",
            "line": 10,
            "side": "LEFT",
            "body": "I agree with this suggestion",
            "user": { "login": "author" },
            "created_at": "2024-01-15T11:00:00Z",
            "in_reply_to_id": 100
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 789);
        assert_eq!(comment.in_reply_to_id, Some(100));
        assert_eq!(comment.body, "I agree with this suggestion");
    }

    #[test]
    fn test_review_submit_comment_serialization() {
        let comment = ReviewSubmitComment {
            path: "src/main.rs".to_string(),
            line: 10,
            side: "RIGHT".to_string(),
            body: "Fix this".to_string(),
        };
        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"path\":\"src/main.rs\""));
        assert!(json.contains("\"line\":10"));
        assert!(json.contains("\"side\":\"RIGHT\""));
        assert!(json.contains("\"body\":\"Fix this\""));
    }

    #[test]
    fn test_review_submit_request_serialization() {
        let request = ReviewSubmitRequest {
            commit_id: "sha123".to_string(),
            event: "APPROVE".to_string(),
            body: "Looks good!".to_string(),
            comments: vec![ReviewSubmitComment {
                path: "src/lib.rs".to_string(),
                line: 5,
                side: "RIGHT".to_string(),
                body: "Nice change".to_string(),
            }],
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"commit_id\":\"sha123\""));
        assert!(json.contains("\"event\":\"APPROVE\""));
        assert!(json.contains("\"comments\""));
    }

    #[test]
    fn test_merge_pr_request_serialization() {
        let request = MergePrRequest {
            commit_title: Some("Merge feature branch".to_string()),
            commit_message: None,
            merge_method: PullRequestMergeMethod::Squash,
            sha: Some("expected-head".to_string()),
        };

        let json = serde_json::to_string(&request).unwrap();

        assert!(json.contains("\"commit_title\":\"Merge feature branch\""));
        assert!(json.contains("\"merge_method\":\"squash\""));
        assert!(json.contains("\"sha\":\"expected-head\""));
        // Verify None fields are omitted, not serialized as null
        assert!(!json.contains("commit_message"));
        assert!(!json.contains("null"));
    }

    #[test]
    fn test_merge_pr_request_omits_none_fields() {
        let request = MergePrRequest {
            commit_title: None,
            commit_message: None,
            merge_method: PullRequestMergeMethod::Squash,
            sha: None,
        };

        let json = serde_json::to_string(&request).unwrap();

        // None fields should be omitted, not serialized as null
        assert!(!json.contains("commit_title"));
        assert!(!json.contains("commit_message"));
        assert!(json.contains("\"merge_method\":\"squash\""));
    }

    #[test]
    fn test_merge_pr_response_deserialization_ignores_unused_sha_field() {
        let json = r#"{
            "sha": "abc123",
            "merged": true,
            "message": "Pull Request successfully merged"
        }"#;

        let response: MergePrResponse = serde_json::from_str(json).unwrap();

        assert!(response.merged);
        assert_eq!(response.message, "Pull Request successfully merged");
    }

    #[test]
    fn test_search_item_deserialization() {
        let json = r#"{
            "id": 789,
            "number": 42,
            "title": "Fix bug",
            "body": "Description",
            "state": "open",
            "draft": false,
            "html_url": "https://github.com/owner/repo/pull/42",
            "user": { "login": "author", "avatar_url": "https://example.com/avatar.png" },
            "repository_url": "https://api.github.com/repos/owner/repo",
            "created_at": "2024-01-15T10:00:00Z",
            "updated_at": "2024-01-15T12:00:00Z"
        }"#;
        let item: SearchItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, 789);
        assert_eq!(item.number, 42);
        assert_eq!(item.title, "Fix bug");
        assert_eq!(item.draft, Some(false));
        assert_eq!(item.user.login, "author");
        assert_eq!(
            item.user.avatar_url,
            Some("https://example.com/avatar.png".to_string())
        );
    }

    #[test]
    fn test_blob_response_deserialization() {
        let json = r#"{
            "content": "SGVsbG8gV29ybGQ=\n",
            "encoding": "base64",
            "size": 11
        }"#;
        let blob: BlobResponse = serde_json::from_str(json).unwrap();
        assert!(!blob.content.is_empty());
    }

    #[test]
    fn test_authenticated_user_deserialization() {
        let json = r#"{ "login": "testuser", "id": 12345, "type": "User" }"#;
        let user: AuthenticatedUser = serde_json::from_str(json).unwrap();
        assert_eq!(user.login, "testuser");
    }

    #[test]
    fn test_github_head_sha_deserialization() {
        let json = r#"{"ref": "feature/T-1", "sha": "abc123def456", "repo": {"id": 1}}"#;
        let head: GitHubHead = serde_json::from_str(json).unwrap();
        assert_eq!(head.sha, "abc123def456");
        assert_eq!(head.ref_name, "feature/T-1");
    }

    #[test]
    fn test_check_runs_deserialization() {
        let json = r#"{"total_count":1,"check_runs":[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.total_count, 1);
        assert_eq!(resp.check_runs[0].conclusion, Some("success".to_string()));

        let json = r#"{"total_count":1,"check_runs":[{"id":2,"name":"test","status":"in_progress","conclusion":null,"html_url":"https://example.com"}]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.check_runs[0].status, "in_progress");
        assert_eq!(resp.check_runs[0].conclusion, None);

        let json = r#"{"total_count":0,"check_runs":[]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.total_count, 0);
        assert!(resp.check_runs.is_empty());
    }

    #[test]
    fn test_combined_status_deserialization() {
        let json = r#"{"state":"success","statuses":[{"state":"success","context":"ci/build","description":"Build passed","target_url":"https://example.com"}],"sha":"abc123","total_count":1}"#;
        let resp: CombinedStatusResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.state, "success");
        assert_eq!(resp.statuses.len(), 1);
        assert_eq!(resp.statuses[0].context, "ci/build");

        let json = r#"{"state":"pending","statuses":[],"sha":"def456","total_count":0}"#;
        let resp: CombinedStatusResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.state, "pending");
        assert!(resp.statuses.is_empty());
    }

    #[test]
    fn test_required_status_checks_response_into_context_names_deduplicates() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec!["ci/build".to_string(), "ci/test".to_string()],
            checks: vec![
                RequiredCheckEntry {
                    context: "ci/build".to_string(),
                },
                RequiredCheckEntry {
                    context: "ci/lint".to_string(),
                },
            ],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"ci/build".to_string()));
        assert!(names.contains(&"ci/lint".to_string()));
        assert!(names.contains(&"ci/test".to_string()));
    }

    #[test]
    fn test_required_status_checks_response_checks_field_only() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec![],
            checks: vec![
                RequiredCheckEntry {
                    context: "ci/build".to_string(),
                },
                RequiredCheckEntry {
                    context: "ci/test".to_string(),
                },
            ],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "ci/build");
        assert_eq!(names[1], "ci/test");
    }

    #[test]
    fn test_required_status_checks_response_contexts_field_only() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec!["ci/build".to_string(), "ci/test".to_string()],
            checks: vec![],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "ci/build");
        assert_eq!(names[1], "ci/test");
    }

    #[test]
    fn test_required_status_checks_response_empty() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec![],
            checks: vec![],
        };

        let names = resp.into_context_names();
        assert!(names.is_empty());
    }

    #[test]
    fn test_required_status_checks_response_deserialization() {
        let json = r#"{
            "contexts": ["ci/build", "ci/test"],
            "checks": [
                {"context": "ci/build", "app_id": 15368},
                {"context": "ci/lint", "app_id": null}
            ],
            "strict": true
        }"#;
        let resp: RequiredStatusChecksResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.contexts.len(), 2);
        assert_eq!(resp.checks.len(), 2);
        assert_eq!(resp.checks[0].context, "ci/build");
        assert_eq!(resp.checks[1].context, "ci/lint");
    }

    #[test]
    fn test_required_status_checks_response_deserialization_minimal() {
        let json = r#"{}"#;
        let resp: RequiredStatusChecksResponse = serde_json::from_str(json).unwrap();
        assert!(resp.contexts.is_empty());
        assert!(resp.checks.is_empty());
    }

    #[test]
    fn test_required_pr_reviews_response_deserialization() {
        let json = r#"{
            "required_approving_review_count": 2,
            "dismiss_stale_reviews": true,
            "require_code_owner_reviews": false
        }"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 2);
    }

    #[test]
    fn test_required_pr_reviews_response_deserialization_minimal() {
        let json = r#"{}"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 0);
    }

    #[test]
    fn test_required_pr_reviews_response_extra_fields() {
        let json = r#"{
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": false,
            "require_code_owner_reviews": true,
            "require_last_push_approval": false,
            "dismissal_restrictions": {}
        }"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 1);
    }

    #[test]
    fn test_pr_review_deserialization_with_body() {
        let json = r#"{
            "id": 80,
            "user": { "login": "copilot[bot]", "id": 198982749, "type": "Bot" },
            "body": "Copilot Review\n\nI found several issues.",
            "state": "COMMENTED",
            "submitted_at": "2024-01-15T10:30:00Z",
            "commit_id": "abc123"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 80);
        assert_eq!(review.user.login, "copilot[bot]");
        assert_eq!(review.state, "COMMENTED");
        assert_eq!(
            review.body,
            Some("Copilot Review\n\nI found several issues.".to_string())
        );
        assert_eq!(
            review.submitted_at,
            Some("2024-01-15T10:30:00Z".to_string())
        );
    }

    #[test]
    fn test_pr_review_deserialization_empty_body() {
        let json = r#"{
            "id": 81,
            "user": { "login": "reviewer" },
            "body": "",
            "state": "APPROVED",
            "submitted_at": "2024-01-15T11:00:00Z"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 81);
        assert_eq!(review.body, Some("".to_string()));
        assert_eq!(review.state, "APPROVED");
    }

    #[test]
    fn test_pr_review_deserialization_null_body() {
        let json = r#"{
            "id": 82,
            "user": { "login": "reviewer" },
            "body": null,
            "state": "PENDING"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 82);
        assert_eq!(review.body, None);
    }

    #[test]
    fn test_pr_review_deserialization_missing_body() {
        let json = r#"{
            "id": 83,
            "user": { "login": "reviewer" },
            "state": "DISMISSED"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 83);
        assert_eq!(review.body, None);
    }

    #[test]
    fn test_copilot_suggested_change_review_comment_deserialization() {
        let json = r#"{
            "id": 1234567890,
            "path": "src/main.rs",
            "line": 15,
            "side": "RIGHT",
            "body": "```suggestion\nlet x = 42;\n```",
            "user": { "login": "copilot[bot]", "id": 198982749, "type": "Bot" },
            "created_at": "2024-01-15T10:30:00Z",
            "in_reply_to_id": null,
            "diff_hunk": "@@ -10,6 +10,8 @@\n context",
            "subject_type": "line",
            "start_line": null,
            "original_line": 15,
            "pull_request_review_id": 987654321
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 1234567890);
        assert_eq!(comment.path, "src/main.rs");
        assert_eq!(comment.line, Some(15));
        assert_eq!(comment.side, Some("RIGHT".to_string()));
        assert!(comment.body.contains("suggestion"));
        assert_eq!(comment.user.login, "copilot[bot]");
        assert!(comment.in_reply_to_id.is_none());
    }

    #[test]
    fn test_copilot_multiline_suggested_change_deserialization() {
        let json = r#"{
            "id": 1234567891,
            "path": "src/lib.rs",
            "line": 20,
            "side": "RIGHT",
            "body": "```suggestion\nfn new_impl() {\n    // fixed\n}\n```",
            "user": { "login": "copilot[bot]" },
            "created_at": "2024-01-15T10:35:00Z",
            "in_reply_to_id": null,
            "start_line": 15,
            "original_start_line": 15,
            "original_line": 20,
            "start_side": "RIGHT",
            "subject_type": "line"
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 1234567891);
        assert_eq!(comment.line, Some(20));
        // start_line captured in extra via serde flatten
        assert_eq!(
            comment.extra.get("start_line").and_then(|v| v.as_i64()),
            Some(15)
        );
    }

    #[test]
    fn github_readiness_graphql_payload_preserves_unknown_strings_and_sha_scope() {
        let payload = serde_json::json!({
            "data": {
                "repository": {
                    "viewerDefaultMergeMethod": "SQUASH",
                    "mergeCommitAllowed": true,
                    "squashMergeAllowed": true,
                    "rebaseMergeAllowed": false,
                    "pullRequest": {
                        "id": "PR_node_42",
                        "headRefOid": "head-sha-1",
                        "mergeStateStatus": "FUTURE_STATE",
                        "reviewDecision": "AI_REVIEW_PENDING",
                        "autoMergeRequest": { "enabledAt": "2026-01-01T00:00:00Z" },
                        "isMergeQueueEnabled": true,
                        "mergeQueueEntry": { "state": "AWAITING_CHECKS", "mergeGroup": { "headSha": "merge-group-sha" } },
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-1",
                                    "statusCheckRollup": {
                                        "state": "SUCCESS",
                                        "contexts": { "nodes": [{ "__typename": "CheckRun", "name": "ci", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://example.com/ci" }] }
                                    }
                                }
                            }]
                        },
                        "reviewThreads": { "nodes": [{ "isResolved": true }] },
                        "baseRef": {
                            "name": "main",
                            "branchProtectionRule": {
                                "requiredStatusCheckContexts": ["ci"],
                                "requiredApprovingReviewCount": 2,
                                "requiresStrictStatusChecks": true,
                                "requiresConversationResolution": true,
                                "requiresDeployments": false
                            }
                        }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();
        assert_eq!(snapshot.github_node_id.as_deref(), Some("PR_node_42"));
        assert_eq!(
            snapshot.policy.allowed_merge_methods.value,
            vec![
                PullRequestMergeMethod::Merge,
                PullRequestMergeMethod::Squash
            ]
        );
        assert_eq!(
            snapshot.policy.default_merge_method.value,
            Some(PullRequestMergeMethod::Squash)
        );
        assert_eq!(snapshot.source_head_sha, Some("head-sha-1".to_string()));
        assert_eq!(snapshot.merge_state_status.as_deref(), Some("FUTURE_STATE"));
        assert_eq!(
            snapshot.review_decision.as_deref(),
            Some("AI_REVIEW_PENDING")
        );
        assert_eq!(snapshot.mergeable_state.as_deref(), Some("unknown"));
        assert_eq!(snapshot.review_status.as_deref(), Some("review_unknown"));
        assert!(snapshot
            .warnings
            .iter()
            .any(|warning| warning.contains("FUTURE_STATE")));
        assert_eq!(
            snapshot.policy.required_checks.value,
            vec!["ci".to_string()]
        );
        assert_eq!(snapshot.policy.requires_up_to_date_branch.value, Some(true));
        assert_eq!(
            snapshot.policy.requires_conversation_resolution.value,
            Some(true)
        );
        assert_eq!(snapshot.merge_queue_enabled, Some(true));
        assert_eq!(
            snapshot.status_check_rollup_sha.as_deref(),
            Some("head-sha-1")
        );
        assert_eq!(snapshot.check_runs.check_runs[0].name, "ci");
        assert!(snapshot.auto_merge_requested);
        assert_eq!(
            snapshot.merge_queue_state.as_deref(),
            Some("AWAITING_CHECKS")
        );
        assert_eq!(snapshot.merge_group_sha.as_deref(), Some("merge-group-sha"));
    }

    #[test]
    fn github_readiness_graphql_payload_reads_required_deployment_environments() {
        let payload = serde_json::json!({
            "data": {
                "repository": {
                    "viewerDefaultMergeMethod": "MERGE",
                    "mergeCommitAllowed": true,
                    "squashMergeAllowed": true,
                    "rebaseMergeAllowed": true,
                    "pullRequest": {
                        "headRefOid": "head-sha-1",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-1",
                                    "statusCheckRollup": {
                                        "state": "SUCCESS",
                                        "contexts": { "nodes": [] }
                                    }
                                }
                            }]
                        },
                        "reviewThreads": { "nodes": [] },
                        "baseRef": {
                            "branchProtectionRule": {
                                "requiresDeployments": true,
                                "requiredDeploymentEnvironments": ["production"]
                            }
                        }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();

        assert_eq!(
            snapshot.policy.required_deployments.value,
            vec!["production".to_string()]
        );
        assert!(snapshot.policy.required_deployments.known);
        assert!(snapshot.policy.unknown_reasons.is_empty());
    }

    #[test]
    fn github_readiness_graphql_rollup_state_does_not_poison_required_check_status() {
        let payload = serde_json::json!({
            "data": {
                "repository": {
                    "pullRequest": {
                        "headRefOid": "head-sha-1",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-1",
                                    "statusCheckRollup": {
                                        "state": "FAILURE",
                                        "contexts": {
                                            "nodes": [
                                                { "__typename": "CheckRun", "name": "required", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://example.com/required" },
                                                { "__typename": "CheckRun", "name": "optional", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://example.com/optional" }
                                            ]
                                        }
                                    }
                                }
                            }]
                        },
                        "reviewThreads": { "nodes": [] },
                        "baseRef": {
                            "branchProtectionRule": {
                                "requiredStatusCheckContexts": ["required"],
                                "requiresConversationResolution": false
                            }
                        }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();
        assert!(snapshot.combined_status.statuses.is_empty());
        assert_eq!(snapshot.combined_status.state, "success");
    }

    #[test]
    fn github_readiness_review_thread_pagination_keeps_disabled_conversation_policy_known() {
        let payload = serde_json::json!({
            "data": {
                "repository": {
                    "pullRequest": {
                        "headRefOid": "head-sha-1",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-1",
                                    "statusCheckRollup": {
                                        "state": "SUCCESS",
                                        "contexts": { "nodes": [] }
                                    }
                                }
                            }]
                        },
                        "reviewThreads": {
                            "pageInfo": { "hasNextPage": true },
                            "nodes": [{ "isResolved": false }]
                        },
                        "baseRef": {
                            "branchProtectionRule": {
                                "requiresConversationResolution": false
                            }
                        }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();
        assert!(snapshot.policy.requires_conversation_resolution.known);
        assert_eq!(
            snapshot.policy.requires_conversation_resolution.value,
            Some(false)
        );
        assert!(snapshot
            .policy
            .unknown_reasons
            .iter()
            .all(|reason| !reason.contains("reviewThreads")));
    }

    #[test]
    fn github_readiness_graphql_errors_mark_policy_coverage_unknown() {
        let payload = serde_json::json!({
            "errors": [{ "message": "Field 'mergeQueueEntry' doesn't exist on type 'PullRequest'" }],
            "data": { "repository": null }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();
        // With errors and no usable pullRequest data there is nothing to salvage,
        // so the snapshot stays fully unknown.
        assert!(snapshot.source_head_sha.is_none());
        assert!(!snapshot.policy.required_checks.known);
        assert!(!snapshot.policy.required_reviews.known);
        assert_eq!(snapshot.merge_queue_enabled, None);
        assert!(snapshot
            .policy
            .unknown_reasons
            .iter()
            .any(|reason| reason.contains("mergeQueueEntry")));
        assert!(snapshot.requires_rest_check_fallback());
    }

    #[test]
    fn github_readiness_status_rollup_sha_mismatch_requires_fallback() {
        let payload = serde_json::json!({
            "data": {
                "repository": {
                    "pullRequest": {
                        "headRefOid": "head-sha-2",
                        "commits": { "nodes": [{ "commit": { "oid": "old-sha", "statusCheckRollup": { "state": "SUCCESS", "contexts": { "nodes": [] } } } }] },
                        "baseRef": { "name": "main", "branchProtectionRule": null }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();
        assert_eq!(snapshot.source_head_sha.as_deref(), Some("head-sha-2"));
        assert_eq!(snapshot.status_check_rollup_sha.as_deref(), Some("old-sha"));
        assert!(snapshot.requires_rest_check_fallback());
    }

    #[test]
    fn github_readiness_partial_errors_preserve_pull_request_data() {
        // GitHub GraphQL routinely returns valid PR data alongside a field-level
        // error (e.g. baseRef.branchProtectionRule requires admin access). The
        // usable headRefOid must survive so the poller does not needlessly fall
        // back to REST for the head SHA on every poll.
        let payload = serde_json::json!({
            "errors": [{
                "type": "FORBIDDEN",
                "path": ["repository", "pullRequest", "baseRef", "branchProtectionRule"],
                "message": "Resource not accessible by personal access token"
            }],
            "data": {
                "repository": {
                    "viewerDefaultMergeMethod": "SQUASH",
                    "mergeCommitAllowed": false,
                    "squashMergeAllowed": true,
                    "rebaseMergeAllowed": true,
                    "pullRequest": {
                        "headRefOid": "head-sha-9",
                        "mergeStateStatus": "CLEAN",
                        "reviewDecision": "APPROVED",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-9",
                                    "statusCheckRollup": {
                                        "state": "SUCCESS",
                                        "contexts": { "nodes": [{ "__typename": "CheckRun", "name": "ci", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://example.com/ci" }] }
                                    }
                                }
                            }]
                        },
                        "isMergeQueueEnabled": true,
                        "reviewThreads": { "nodes": [] },
                        "baseRef": { "name": "main", "branchProtectionRule": null }
                    }
                }
            }
        });

        let snapshot = GitHubReadinessSnapshot::from_graphql_response(&payload).unwrap();

        assert_eq!(snapshot.source_head_sha.as_deref(), Some("head-sha-9"));
        assert_eq!(
            snapshot.status_check_rollup_sha.as_deref(),
            Some("head-sha-9")
        );
        assert_eq!(snapshot.check_runs.check_runs[0].name, "ci");
        assert_eq!(snapshot.review_status.as_deref(), Some("approved"));
        assert_eq!(snapshot.merge_queue_enabled, Some(true));
        assert!(!snapshot.requires_rest_check_fallback());

        assert!(!snapshot.policy.required_checks.known);
        assert!(!snapshot.policy.required_reviews.known);
        assert_eq!(
            snapshot.policy.allowed_merge_methods.value,
            vec![
                PullRequestMergeMethod::Squash,
                PullRequestMergeMethod::Rebase
            ]
        );
        assert_eq!(
            snapshot.policy.default_merge_method.value,
            Some(PullRequestMergeMethod::Squash)
        );

        assert!(snapshot
            .warnings
            .iter()
            .any(|warning| warning.contains("Resource not accessible")));
    }

    #[test]
    fn test_review_comment_outdated_when_line_null_but_original_line_present() {
        // Real GitHub shape for an outdated comment: `line` is null (the commented
        // line no longer exists in the diff), `original_line` retained, and note
        // `position` stays NON-null — which is exactly why position is unreliable.
        let json = r#"{
            "id": 3682992964,
            "body": "comment on line 21",
            "user": { "login": "octocat" },
            "path": "libs/assessments/main/src/types/Num.ts",
            "line": null,
            "original_line": 21,
            "position": 1,
            "original_position": 5,
            "created_at": "2024-01-01T00:00:00Z"
        }"#;
        let rc: ReviewComment = serde_json::from_str(json).unwrap();
        let pr = rc.into_pr_comment();
        assert!(
            pr.outdated,
            "null line with an original_line must be outdated"
        );
        // The original line is preserved for display/anchoring.
        assert_eq!(pr.line, Some(21));
        assert_eq!(pr.comment_type, "review_comment");
        assert_eq!(pr.id, 3682992964);
    }

    #[test]
    fn test_review_comment_not_outdated_when_line_present() {
        let json = r#"{
            "id": 124,
            "body": "ok",
            "user": { "login": "octocat" },
            "path": "src/lib.rs",
            "line": 10,
            "original_line": 10,
            "position": 3,
            "created_at": "2024-01-01T00:00:00Z"
        }"#;
        let rc: ReviewComment = serde_json::from_str(json).unwrap();
        let pr = rc.into_pr_comment();
        assert!(!pr.outdated, "a present line must not be outdated");
        assert_eq!(pr.line, Some(10));
    }

    #[test]
    fn test_review_comment_not_outdated_when_no_line_info() {
        // File-level / non-line comments have neither line nor original_line and
        // are not "outdated".
        let json = r#"{
            "id": 125,
            "body": "file-level note",
            "user": { "login": "octocat" },
            "path": "src/lib.rs",
            "created_at": "2024-01-01T00:00:00Z"
        }"#;
        let rc: ReviewComment = serde_json::from_str(json).unwrap();
        let pr = rc.into_pr_comment();
        assert!(!pr.outdated, "no line info must not be outdated");
        assert_eq!(pr.line, None);
    }

    #[test]
    fn test_issue_comment_is_never_outdated() {
        let json = r#"{
            "id": 200,
            "body": "general note",
            "user": { "login": "octocat" },
            "created_at": "2024-01-01T00:00:00Z"
        }"#;
        let ic: IssueComment = serde_json::from_str(json).unwrap();
        let pr = ic.into_pr_comment();
        assert!(!pr.outdated, "issue comments are never outdated");
        assert_eq!(pr.comment_type, "issue_comment");
        assert!(pr.path.is_none());
    }
}
