use serde_json::{json, Value};

use super::error::GitHubError;
use super::types::GitHubReadinessSnapshot;
use super::GitHubClient;

const PR_READINESS_QUERY: &str = r#"
query OpenForgePullRequestReadiness($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    viewerDefaultMergeMethod
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    pullRequest(number: $number) {
      id
      headRefOid
      mergeStateStatus
      reviewDecision
      autoMergeRequest { enabledAt }
      isMergeQueueEnabled
      mergeQueueEntry { state }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state description targetUrl }
                }
              }
            }
          }
        }
      }
      reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
      baseRef {
        name
        branchProtectionRule {
          requiredStatusCheckContexts
          requiredApprovingReviewCount
          requiresStrictStatusChecks
          requiresConversationResolution
          requiresDeployments
          requiredDeploymentEnvironments
        }
      }
    }
  }
}
"#;

const PR_READINESS_CORE_QUERY: &str = r#"
query OpenForgePullRequestReadinessCore($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    viewerDefaultMergeMethod
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    pullRequest(number: $number) {
      id
      headRefOid
      mergeStateStatus
      reviewDecision
      autoMergeRequest { enabledAt }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state description targetUrl }
                }
              }
            }
          }
        }
      }
      reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
    }
  }
}
"#;

const ENQUEUE_PULL_REQUEST_MUTATION: &str = r#"
mutation OpenForgeEnqueuePullRequest($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid }) {
    pullRequest {
      id
      mergeQueueEntry { state }
    }
  }
}
"#;

pub struct EnqueuePullRequestRequest<'a> {
    pub pull_request_id: &'a str,
    pub expected_head_oid: &'a str,
    pub owner: &'a str,
    pub repo: &'a str,
    pub pr_number: i64,
    pub actor_login: &'a str,
}

impl GitHubClient {
    pub async fn get_pr_readiness_snapshot(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<GitHubReadinessSnapshot, GitHubError> {
        let body = self
            .send_pr_readiness_query(owner, repo, pr_number, token, PR_READINESS_QUERY)
            .await?;

        if body.pointer("/data/repository/pullRequest").is_none()
            && body
                .get("errors")
                .and_then(|value| value.as_array())
                .is_some()
        {
            let fallback_body = self
                .send_pr_readiness_query(owner, repo, pr_number, token, PR_READINESS_CORE_QUERY)
                .await?;
            return parse_pr_readiness_fallback(&body, &fallback_body)
                .map_err(GitHubError::ParseError);
        }

        GitHubReadinessSnapshot::from_graphql_response(&body).map_err(GitHubError::ParseError)
    }
    pub async fn enqueue_pull_request_by_node_id(
        &self,
        request: EnqueuePullRequestRequest<'_>,
        token: &str,
    ) -> Result<(), GitHubError> {
        let body = self
            .send_graphql_payload(
                enqueue_pull_request_payload(request.pull_request_id, request.expected_head_oid),
                token,
            )
            .await?;

        classify_enqueue_graphql_errors(
            &body,
            request.actor_login,
            request.owner,
            request.repo,
            request.pr_number,
        )
        .map_err(|message| GitHubError::ApiError {
            status: 422,
            message,
        })?;
        extract_enqueue_pull_request_result(&body).map_err(|message| GitHubError::ApiError {
            status: 422,
            message,
        })
    }

    async fn send_graphql_payload(
        &self,
        payload: Value,
        token: &str,
    ) -> Result<Value, GitHubError> {
        let response = self
            .send_github(
                self.github_request(
                    reqwest::Method::POST,
                    "https://api.github.com/graphql",
                    token,
                )
                .header("Accept", "application/vnd.github+json")
                .json(&payload),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }

    async fn send_pr_readiness_query(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        query: &str,
    ) -> Result<serde_json::Value, GitHubError> {
        let payload = json!({
            "query": query,
            "variables": {
                "owner": owner,
                "repo": repo,
                "number": pr_number,
            },
        });

        let response = self
            .send_github(
                self.github_request(
                    reqwest::Method::POST,
                    "https://api.github.com/graphql",
                    token,
                )
                .header("Accept", "application/vnd.github+json")
                .json(&payload),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }
}

fn enqueue_pull_request_payload(pull_request_id: &str, expected_head_oid: &str) -> Value {
    json!({
        "query": ENQUEUE_PULL_REQUEST_MUTATION,
        "variables": {
            "pullRequestId": pull_request_id,
            "expectedHeadOid": expected_head_oid,
        },
    })
}

fn graphql_error_messages(body: &Value) -> Vec<String> {
    body.get("errors")
        .and_then(Value::as_array)
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("message").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_pr_readiness_fallback(
    primary_body: &Value,
    fallback_body: &Value,
) -> Result<GitHubReadinessSnapshot, String> {
    let mut snapshot = GitHubReadinessSnapshot::from_graphql_response(fallback_body)?;
    let policy_error = {
        let messages = graphql_error_messages(primary_body);
        if messages.is_empty() {
            "GraphQL readiness query returned no pull request data".to_string()
        } else {
            messages.join("; ")
        }
    };

    snapshot.policy = super::types::RepositoryPolicyFacts::unknown(policy_error.clone());
    snapshot.warnings.push(policy_error);
    Ok(snapshot)
}

fn is_unsupported_enqueue_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("enqueuepullrequest")
        && (lower.contains("doesn't exist")
            || lower.contains("does not exist")
            || lower.contains("undefinedfield")
            || lower.contains("unknown field")
            || lower.contains("doesn't accept argument")
            || lower.contains("does not accept argument"))
}

fn is_enqueue_permission_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("resource not accessible")
        || lower.contains("permission")
        || lower.contains("not permitted")
        || lower.contains("write access")
        || lower.contains("forbidden")
}

fn unsupported_enqueue_message() -> String {
    "GitHub merge queue enqueue is not supported by this GitHub API. If this is GitHub Enterprise, update GitHub Enterprise or enqueue the pull request in GitHub.".to_string()
}

fn enqueue_permission_message(
    actor_login: &str,
    owner: &str,
    repo: &str,
    pr_number: i64,
    github_message: &str,
) -> String {
    format!(
        "GitHub user {actor_login} does not have permission to enqueue {owner}/{repo}#{pr_number}. Use a token for an actor with write access and merge queue permissions. GitHub said: {github_message}"
    )
}

fn classify_enqueue_graphql_errors(
    body: &Value,
    actor_login: &str,
    owner: &str,
    repo: &str,
    pr_number: i64,
) -> Result<(), String> {
    let messages = graphql_error_messages(body);
    if messages.is_empty() {
        return Ok(());
    }

    let joined = messages.join("; ");
    if messages
        .iter()
        .any(|message| is_unsupported_enqueue_error(message))
    {
        return Err(unsupported_enqueue_message());
    }
    if messages
        .iter()
        .any(|message| is_enqueue_permission_error(message))
    {
        return Err(enqueue_permission_message(
            actor_login,
            owner,
            repo,
            pr_number,
            &joined,
        ));
    }

    Err(format!(
        "GitHub refused to enqueue pull request {owner}/{repo}#{pr_number}: {joined}"
    ))
}

fn extract_enqueue_pull_request_result(body: &Value) -> Result<(), String> {
    classify_enqueue_graphql_errors(body, "the authenticated actor", "unknown", "unknown", 0)?;

    if body
        .pointer("/data/enqueuePullRequest/pullRequest/id")
        .and_then(Value::as_str)
        .is_some()
    {
        Ok(())
    } else {
        Err("GitHub enqueue response did not include the pull request payload.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn core_readiness_query_avoids_permission_sensitive_policy_fields() {
        assert!(PR_READINESS_CORE_QUERY.contains("headRefOid"));
        assert!(!PR_READINESS_CORE_QUERY.contains("branchProtectionRule"));
        assert!(!PR_READINESS_CORE_QUERY.contains("requiredDeploymentEnvironments"));
        assert!(!PR_READINESS_CORE_QUERY.contains("requiresMergeQueue"));
    }

    #[test]
    fn readiness_query_only_uses_supported_github_schema_fields() {
        assert!(PR_READINESS_QUERY.contains("isMergeQueueEnabled"));
        assert!(PR_READINESS_QUERY.contains("mergeQueueEntry { state }"));
        assert!(!PR_READINESS_QUERY.contains("mergeGroup"));
        assert!(!PR_READINESS_QUERY.contains("requiresMergeQueue"));
    }

    #[test]
    fn enqueue_payload_sends_the_expected_head_oid() {
        let payload = enqueue_pull_request_payload("PR_node", "head-sha-42");

        assert_eq!(
            payload
                .pointer("/variables/expectedHeadOid")
                .and_then(Value::as_str),
            Some("head-sha-42")
        );
    }

    #[test]
    fn enqueue_treats_a_rejected_expected_head_oid_argument_as_an_unsupported_merge_queue() {
        let body = json!({
            "errors": [{
                "message": "InputObject 'EnqueuePullRequestInput' doesn't accept argument 'expectedHeadOid'"
            }]
        });

        let err = extract_enqueue_pull_request_result(&body)
            .expect_err("unsupported argument should error");
        assert!(err.contains("GitHub merge queue enqueue is not supported"));
    }

    #[test]
    fn enqueue_response_success_requires_pull_request_payload() {
        let body = json!({
            "data": {
                "enqueuePullRequest": {
                    "pullRequest": {
                        "id": "PR_node",
                        "mergeQueueEntry": { "state": "QUEUED" }
                    }
                }
            }
        });

        extract_enqueue_pull_request_result(&body).expect("valid enqueue response");
    }

    #[test]
    fn enqueue_response_reports_unsupported_merge_queue_api() {
        let body = json!({
            "errors": [{ "message": "Field 'enqueuePullRequest' doesn't exist on type 'Mutation'" }]
        });

        let err = extract_enqueue_pull_request_result(&body)
            .expect_err("unsupported mutation should error");
        assert!(err.contains("GitHub merge queue enqueue is not supported"));
        assert!(err.contains("update GitHub Enterprise"));
    }

    #[test]
    fn enqueue_response_reports_actor_scoped_permission_failure() {
        let body = json!({
            "errors": [{ "message": "Resource not accessible by personal access token" }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("permission failure should be classified");
        assert!(err.contains("GitHub user octocat"));
        assert!(err.contains("permission to enqueue owner/repo#42"));
    }

    #[test]
    fn enqueue_response_preserves_github_error_context() {
        let body = json!({
            "errors": [{ "message": "Pull request cannot be enqueued while mergeability is UNKNOWN" }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("GitHub error should surface");
        assert!(err.contains("GitHub refused to enqueue pull request owner/repo#42"));
        assert!(err.contains("mergeability is UNKNOWN"));
    }

    #[test]
    fn readiness_fallback_preserves_head_sha_but_marks_policy_unknown() {
        let primary_body = json!({
            "errors": [{
                "message": "Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest'"
            }]
        });
        let fallback_body = json!({
            "data": {
                "repository": {
                    "pullRequest": {
                        "headRefOid": "head-sha-42",
                        "mergeStateStatus": "CLEAN",
                        "reviewDecision": "APPROVED",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "oid": "head-sha-42",
                                    "statusCheckRollup": {
                                        "state": "SUCCESS",
                                        "contexts": { "nodes": [] }
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        });

        let snapshot = parse_pr_readiness_fallback(&primary_body, &fallback_body)
            .expect("fallback readiness should parse");

        assert_eq!(snapshot.source_head_sha.as_deref(), Some("head-sha-42"));
        assert!(!snapshot.policy.required_checks.known);
        assert!(!snapshot.policy.required_reviews.known);
        assert_eq!(snapshot.merge_queue_enabled, None);
        assert!(snapshot
            .warnings
            .iter()
            .any(|warning| warning.contains("isMergeQueueEnabled")));
    }
}
