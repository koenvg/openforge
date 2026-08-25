use serde_json::Value;

use super::types::PullRequestMergeMethod;

fn parse_branch_merge_method_restriction(
    payload: &Value,
) -> Result<Option<Vec<PullRequestMergeMethod>>, String> {
    let rules = payload
        .as_array()
        .ok_or_else(|| "branch rules response must be an array".to_string())?;
    let mut restriction: Option<Vec<PullRequestMergeMethod>> = None;

    for rule in rules
        .iter()
        .filter(|rule| rule.get("type").and_then(Value::as_str) == Some("pull_request"))
    {
        let values = rule
            .pointer("/parameters/allowed_merge_methods")
            .and_then(Value::as_array)
            .ok_or_else(|| "pull request rule is missing allowed_merge_methods".to_string())?;
        let methods = values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .and_then(PullRequestMergeMethod::from_github_value)
                    .ok_or_else(|| "pull request rule has an unknown merge method".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;

        restriction = Some(match restriction {
            Some(current) => current
                .into_iter()
                .filter(|method| methods.contains(method))
                .collect(),
            None => methods,
        });
    }

    Ok(restriction)
}

fn branch_merge_method_restriction_from_body(
    body: &str,
) -> super::types::PolicyValue<Option<Vec<PullRequestMergeMethod>>> {
    serde_json::from_str::<Value>(body)
        .map_err(|error| error.to_string())
        .and_then(|payload| parse_branch_merge_method_restriction(&payload))
        .map(super::types::PolicyValue::known)
        .unwrap_or_else(super::types::PolicyValue::unknown)
}

fn branch_merge_method_restriction_from_response(
    status: reqwest::StatusCode,
    body: &str,
) -> super::types::PolicyValue<Option<Vec<PullRequestMergeMethod>>> {
    const PRIVATE_REPOSITORY_RULES_UNAVAILABLE: &str =
        "Upgrade to GitHub Pro or make this repository public to enable this feature.";

    let rules_are_unavailable_for_plan = status == reqwest::StatusCode::FORBIDDEN
        && serde_json::from_str::<Value>(body).is_ok_and(|value| {
            value.get("message").and_then(Value::as_str)
                == Some(PRIVATE_REPOSITORY_RULES_UNAVAILABLE)
        });

    if rules_are_unavailable_for_plan {
        return super::types::PolicyValue::known(None);
    }

    if !status.is_success() {
        return super::types::PolicyValue::unknown(format!(
            "active branch rules unavailable ({status})"
        ));
    }

    branch_merge_method_restriction_from_body(body)
}

fn branch_rules_url(owner: &str, repo: &str, branch: &str) -> String {
    let mut url = reqwest::Url::parse("https://api.github.com/")
        .expect("static GitHub API base URL must be valid");
    url.path_segments_mut()
        .expect("GitHub API base URL must support path segments")
        .extend(["repos", owner, repo, "rules", "branches", branch]);
    url.query_pairs_mut().append_pair("per_page", "100");
    url.to_string()
}
fn link_header_has_next_page(value: &str) -> bool {
    value
        .split(',')
        .any(|link| link.split(';').any(|part| part.trim() == "rel=\"next\""))
}

impl super::GitHubClient {
    pub async fn get_branch_merge_method_restriction_policy(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> super::types::PolicyValue<Option<Vec<PullRequestMergeMethod>>> {
        let url = branch_rules_url(owner, repo, branch);
        let response = match self.conditional_get(&url, token).await {
            Ok(super::ConditionalResponse::NotModified(Some(cached_body))) => {
                return branch_merge_method_restriction_from_body(&cached_body);
            }
            Ok(super::ConditionalResponse::NotModified(None)) => {
                return super::types::PolicyValue::unknown(
                    "304 without cached active branch rules response",
                );
            }
            Ok(super::ConditionalResponse::Fresh(response)) => response,
            Err(error) => return super::types::PolicyValue::unknown(error.to_string()),
        };

        let status = response.status();
        if response
            .headers()
            .get("link")
            .and_then(|value| value.to_str().ok())
            .is_some_and(link_header_has_next_page)
        {
            return super::types::PolicyValue::unknown(
                "active branch rules exceed the supported 100-rule page",
            );
        }
        let etag = response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(String::from);
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => return super::types::PolicyValue::unknown(error.to_string()),
        };
        if status.is_success() {
            self.cache_response_body(&url, etag, &body);
        }

        branch_merge_method_restriction_from_response(status, &body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_client::PullRequestMergeMethod;

    #[test]
    fn active_branch_rules_intersect_allowed_pull_request_merge_methods() {
        let payload = serde_json::json!([
            {
                "type": "pull_request",
                "parameters": {
                    "allowed_merge_methods": ["merge", "squash"]
                }
            },
            {
                "type": "pull_request",
                "parameters": {
                    "allowed_merge_methods": ["squash", "rebase"]
                }
            },
            { "type": "required_status_checks" }
        ]);

        let restriction = parse_branch_merge_method_restriction(&payload)
            .expect("active branch rules should parse");

        assert_eq!(restriction, Some(vec![PullRequestMergeMethod::Squash]));
    }

    #[test]
    fn unavailable_private_repository_rules_do_not_restrict_merge_methods() {
        let policy = branch_merge_method_restriction_from_response(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."}"#,
        );

        assert!(policy.known);
        assert_eq!(policy.value, None);
        assert_eq!(policy.unknown_reason, None);
    }

    #[test]
    fn cached_and_fresh_branch_rules_bodies_produce_same_policy() {
        let body = r#"[{"type":"pull_request","parameters":{"allowed_merge_methods":["merge","squash"]}}]"#;
        let cached_policy = branch_merge_method_restriction_from_body(body);
        let fresh_policy =
            branch_merge_method_restriction_from_response(reqwest::StatusCode::OK, body);

        assert_eq!(cached_policy, fresh_policy);
        assert!(fresh_policy.known);
        assert_eq!(
            fresh_policy.value,
            Some(vec![
                PullRequestMergeMethod::Merge,
                PullRequestMergeMethod::Squash,
            ])
        );
        assert_eq!(fresh_policy.unknown_reason, None);
    }

    #[test]
    fn malformed_successful_branch_rules_response_is_unknown() {
        let policy =
            branch_merge_method_restriction_from_response(reqwest::StatusCode::OK, "not json");

        assert!(!policy.known);
        assert_eq!(policy.value, None);
        assert!(policy.unknown_reason.is_some());
    }

    #[test]
    fn unexpected_branch_rules_response_is_unknown_without_parsing_body() {
        let policy = branch_merge_method_restriction_from_response(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "not json",
        );

        assert!(!policy.known);
        assert_eq!(policy.value, None);
        assert_eq!(
            policy.unknown_reason.as_deref(),
            Some("active branch rules unavailable (500 Internal Server Error)")
        );
    }

    #[test]
    fn branch_rules_url_encodes_branch_name_and_requests_max_page() {
        assert_eq!(
            branch_rules_url("acme", "repo", "release/1.0"),
            "https://api.github.com/repos/acme/repo/rules/branches/release%2F1.0?per_page=100"
        );
    }

    #[test]
    fn link_header_detects_truncated_active_rules() {
        assert!(link_header_has_next_page(
            "<https://api.github.com/rules?page=2>; rel=\"next\", <https://api.github.com/rules?page=3>; rel=\"last\""
        ));
        assert!(!link_header_has_next_page(
            "<https://api.github.com/rules?page=1>; rel=\"last\""
        ));
    }
}
