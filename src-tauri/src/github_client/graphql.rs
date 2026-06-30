use serde_json::json;

use super::error::GitHubError;
use super::types::GitHubReadinessSnapshot;
use super::GitHubClient;

const PR_READINESS_QUERY: &str = r#"
query OpenForgePullRequestReadiness($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid
      mergeStateStatus
      reviewDecision
      autoMergeRequest { enabledAt }
      mergeQueueEntry { state mergeGroup { headSha } }
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
          requiresMergeQueue
        }
      }
    }
  }
}
"#;

const PR_READINESS_CORE_QUERY: &str = r#"
query OpenForgePullRequestReadinessCore($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
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
      baseRef {
        name
        branchProtectionRule {
          requiredStatusCheckContexts
          requiredApprovingReviewCount
          requiresStrictStatusChecks
          requiresConversationResolution
          requiresDeployments
          requiresMergeQueue
        }
      }
    }
  }
}
"#;

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
            return GitHubReadinessSnapshot::from_graphql_response(&fallback_body)
                .map_err(GitHubError::ParseError);
        }

        GitHubReadinessSnapshot::from_graphql_response(&body).map_err(GitHubError::ParseError)
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
