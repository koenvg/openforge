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
    mergeQueueEntry { state }
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

fn graphql_errors(body: &Value) -> &[Value] {
    body.get("errors")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn graphql_error_messages(body: &Value) -> Vec<String> {
    graphql_errors(body)
        .iter()
        .filter_map(|error| error.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
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

fn is_unsupported_enqueue_error(error: &Value) -> bool {
    names_an_enqueue_schema_symbol(error) && rejects_the_named_schema_symbol(error)
}

fn is_enqueue_schema_symbol(name: &str) -> bool {
    name.eq_ignore_ascii_case("enqueuePullRequest")
        || name.eq_ignore_ascii_case("EnqueuePullRequestInput")
}

fn names_an_enqueue_schema_symbol(error: &Value) -> bool {
    let extensions = error.get("extensions");
    let extension_name = |key: &str| {
        extensions
            .and_then(|extensions| extensions.get(key))
            .and_then(Value::as_str)
    };

    [extension_name("fieldName"), extension_name("name")]
        .into_iter()
        .flatten()
        .any(is_enqueue_schema_symbol)
        || quoted_names(error).any(is_enqueue_schema_symbol)
}

fn quoted_names(error: &Value) -> impl Iterator<Item = &str> {
    error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .split('\'')
}

fn rejects_the_named_schema_symbol(error: &Value) -> bool {
    if let Some(code) = error.pointer("/extensions/code").and_then(Value::as_str) {
        if matches!(code, "undefinedField" | "argumentNotAccepted") {
            return true;
        }
    }

    let lower = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    [
        "doesn't exist",
        "does not exist",
        "unknown field",
        "doesn't accept argument",
        "does not accept argument",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
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
    let errors = graphql_errors(body);
    if errors.is_empty() {
        return Ok(());
    }
    if errors.iter().any(is_unsupported_enqueue_error) {
        return Err(unsupported_enqueue_message());
    }

    let messages = graphql_error_messages(body);
    let joined = if messages.is_empty() {
        Value::from(errors).to_string()
    } else {
        messages.join("; ")
    };
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
        .pointer("/data/enqueuePullRequest")
        .is_some_and(Value::is_object)
    {
        Ok(())
    } else {
        Err("GitHub enqueue response did not include the enqueue payload.".to_string())
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
    fn enqueue_mutation_does_not_select_pull_request_on_the_enqueue_payload() {
        assert!(ENQUEUE_PULL_REQUEST_MUTATION.contains("mergeQueueEntry { state }"));
        assert!(!ENQUEUE_PULL_REQUEST_MUTATION.contains("pullRequest {"));
    }

    #[test]
    fn enqueue_response_success_only_requires_the_mutation_payload() {
        let body = json!({
            "data": { "enqueuePullRequest": { "mergeQueueEntry": { "state": "QUEUED" } } }
        });

        extract_enqueue_pull_request_result(&body).expect("valid enqueue response");
    }

    #[test]
    fn enqueue_response_succeeds_when_the_merge_queue_entry_is_null() {
        let body = json!({ "data": { "enqueuePullRequest": { "mergeQueueEntry": null } } });

        extract_enqueue_pull_request_result(&body).expect("null entry is a successful enqueue");
    }

    #[test]
    fn enqueue_response_rejects_a_null_mutation_payload() {
        let body = json!({ "data": { "enqueuePullRequest": null } });

        let err =
            extract_enqueue_pull_request_result(&body).expect_err("null payload should error");
        assert!(err.contains("did not include the enqueue payload"));
    }

    #[test]
    fn enqueue_surfaces_the_raw_error_when_our_own_selection_is_invalid() {
        let body = json!({
            "errors": [{
                "message": "Field 'pullRequest' doesn't exist on type 'EnqueuePullRequestPayload'",
                "extensions": {
                    "code": "undefinedField",
                    "typeName": "EnqueuePullRequestPayload",
                    "fieldName": "pullRequest"
                }
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("selection error should surface");
        assert_ne!(err, unsupported_enqueue_message());
        assert!(err.contains("EnqueuePullRequestPayload"));
    }

    #[test]
    fn enqueue_reports_unsupported_when_extensions_name_the_mutation_field() {
        let body = json!({
            "errors": [{
                "message": "Field 'enqueuePullRequest' doesn't exist on type 'Mutation'",
                "extensions": {
                    "code": "undefinedField",
                    "typeName": "Mutation",
                    "fieldName": "enqueuePullRequest"
                }
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("unsupported mutation should error");
        assert_eq!(err, unsupported_enqueue_message());
    }

    #[test]
    fn enqueue_reports_unsupported_when_extensions_reject_the_input_object() {
        let body = json!({
            "errors": [{
                "message": "InputObject 'EnqueuePullRequestInput' doesn't accept argument 'expectedHeadOid'",
                "extensions": {
                    "code": "argumentNotAccepted",
                    "typeName": "InputObject",
                    "name": "EnqueuePullRequestInput",
                    "argumentName": "expectedHeadOid"
                }
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("rejected input argument should error");
        assert_eq!(err, unsupported_enqueue_message());
    }

    #[test]
    fn enqueue_reports_unsupported_when_the_mutation_field_rejects_its_input_argument() {
        let body = json!({
            "errors": [{
                "message": "Field 'enqueuePullRequest' doesn't accept argument 'input'",
                "extensions": {
                    "code": "argumentNotAccepted",
                    "typeName": "Field",
                    "name": "enqueuePullRequest",
                    "argumentName": "input"
                }
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("rejected input argument should error");
        assert_eq!(err, unsupported_enqueue_message());
    }

    #[test]
    fn enqueue_reports_unsupported_when_only_the_message_names_the_mutation_field() {
        for extensions in [json!(null), json!({}), json!({ "code": "someOtherCode" })] {
            let body = json!({
                "errors": [{
                    "message": "Field 'enqueuePullRequest' doesn't exist on type 'Mutation'",
                    "extensions": extensions
                }]
            });

            let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
                .expect_err("unsupported mutation should error");
            assert_eq!(err, unsupported_enqueue_message());
        }
    }

    #[test]
    fn enqueue_reports_unsupported_when_no_extensions_are_present_at_all() {
        for message in [
            "Field 'enqueuePullRequest' doesn't exist on type 'Mutation'",
            "InputObject 'EnqueuePullRequestInput' doesn't accept argument 'expectedHeadOid'",
        ] {
            let body = json!({ "errors": [{ "message": message }] });

            let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
                .expect_err("unsupported mutation should error");
            assert_eq!(err, unsupported_enqueue_message());
        }
    }

    #[test]
    fn enqueue_surfaces_a_missing_node_verbatim_instead_of_claiming_an_unsupported_api() {
        let body = json!({
            "errors": [{
                "type": "NOT_FOUND",
                "path": ["enqueuePullRequest"],
                "message": "Could not resolve to a node with the global id of 'PR_node'"
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("missing node should error");
        assert_ne!(err, unsupported_enqueue_message());
        assert!(err.contains("Could not resolve to a node"));
    }

    #[test]
    fn enqueue_surfaces_a_non_schema_complaint_about_the_mutation_field_verbatim() {
        let body = json!({
            "errors": [{
                "message": "Field must have selections (field 'enqueuePullRequest' returns EnqueuePullRequestPayload)"
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("selection error should surface");
        assert_ne!(err, unsupported_enqueue_message());
        assert!(err.contains("Field must have selections"));
    }

    #[test]
    fn enqueue_classifies_permission_failures_that_carry_extensions() {
        let body = json!({
            "errors": [{
                "message": "Resource not accessible by integration",
                "extensions": { "code": "insufficientScopes" }
            }]
        });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("permission failure should be classified");
        assert!(err.contains("permission to enqueue owner/repo#42"));
    }

    #[test]
    fn enqueue_reports_message_less_errors_instead_of_treating_them_as_success() {
        let body = json!({ "errors": [{ "extensions": { "code": "someOtherCode" } }] });

        let err = classify_enqueue_graphql_errors(&body, "octocat", "owner", "repo", 42)
            .expect_err("a message-less error is still a failure");
        assert!(err.contains("someOtherCode"));
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
