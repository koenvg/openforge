use std::collections::HashSet;

use super::error::GitHubError;
use super::types::{GitHubEvent, PrRef};
use super::GitHubClient;

pub fn extract_authored_pr_refs_from_user_events(
    events: &[GitHubEvent],
    username: &str,
) -> Vec<PrRef> {
    let mut refs = Vec::new();

    for event in events {
        let Some((repo_owner, repo_name)) = event
            .repo
            .as_ref()
            .and_then(|repo| parse_repo_full_name(&repo.name))
        else {
            continue;
        };

        let payload = &event.payload;

        match event.event_type.as_str() {
            "PullRequestEvent" => {
                let pr = payload.get("pull_request");
                if !is_authored_by(pr, username) || is_closed(pr) {
                    continue;
                }
                if let Some(number) = json_i64(pr, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            "IssueCommentEvent" => {
                let issue = payload.get("issue");
                let is_pr_issue = issue.and_then(|v| v.get("pull_request")).is_some();
                if !is_pr_issue || !is_authored_by(issue, username) || is_closed(issue) {
                    continue;
                }
                if let Some(number) = json_i64(issue, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            "PullRequestReviewEvent" | "PullRequestReviewCommentEvent" => {
                let pr = payload.get("pull_request");
                if !is_authored_by(pr, username) || is_closed(pr) {
                    continue;
                }
                if let Some(number) = json_i64(pr, "number") {
                    refs.push(PrRef {
                        repo_owner: repo_owner.to_string(),
                        repo_name: repo_name.to_string(),
                        number,
                    });
                }
            }
            _ => {}
        }
    }

    dedupe_pr_refs(refs)
}

impl GitHubClient {
    pub async fn list_user_events(
        &self,
        username: &str,
        token: &str,
    ) -> Result<Vec<GitHubEvent>, GitHubError> {
        let url = format!(
            "https://api.github.com/users/{}/events?per_page=100",
            username
        );
        self.get_with_etag::<Vec<GitHubEvent>>(&url, token).await
    }
}

pub fn dedupe_pr_refs(pr_refs: Vec<PrRef>) -> Vec<PrRef> {
    let mut seen: HashSet<(String, String, i64)> = HashSet::new();
    let mut deduped = Vec::new();
    for pr_ref in pr_refs {
        let key = (
            pr_ref.repo_owner.clone(),
            pr_ref.repo_name.clone(),
            pr_ref.number,
        );
        if seen.insert(key) {
            deduped.push(pr_ref);
        }
    }
    deduped
}

fn parse_repo_full_name(repo_name: &str) -> Option<(&str, &str)> {
    let mut parts = repo_name.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner, repo))
}

fn json_i64(root: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    root?.get(key)?.as_i64()
}

fn is_authored_by(root: Option<&serde_json::Value>, username: &str) -> bool {
    root.and_then(|v| v.get("user"))
        .and_then(|v| v.get("login"))
        .and_then(|v| v.as_str())
        .map(|login| login == username)
        .unwrap_or(false)
}

fn is_closed(root: Option<&serde_json::Value>) -> bool {
    root.and_then(|v| v.get("state"))
        .and_then(|v| v.as_str())
        .map(|state| state == "closed")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_events(json: &str) -> Vec<GitHubEvent> {
        serde_json::from_str(json).expect("events should deserialize")
    }

    #[test]
    fn test_extract_authored_pr_refs_from_user_events_filters_to_authored_prs() {
        let events = parse_events(
            r#"[
              {
                "id": "u-1",
                "type": "PullRequestEvent",
                "created_at": "2026-03-10T10:00:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "opened",
                  "pull_request": { "number": 7, "user": { "login": "octocat" } }
                }
              },
              {
                "id": "u-2",
                "type": "PullRequestEvent",
                "created_at": "2026-03-10T10:05:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "opened",
                  "pull_request": { "number": 8, "user": { "login": "someone-else" } }
                }
              },
              {
                "id": "u-3",
                "type": "IssueCommentEvent",
                "created_at": "2026-03-10T10:08:00Z",
                "repo": { "name": "acme/core" },
                "payload": {
                  "action": "created",
                  "issue": {
                    "number": 9,
                    "pull_request": { "url": "https://api.github.com/repos/acme/core/pulls/9" },
                    "user": { "login": "octocat" }
                  }
                }
              }
            ]"#,
        );

        let refs = extract_authored_pr_refs_from_user_events(&events, "octocat");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].repo_owner, "acme");
        assert_eq!(refs[0].repo_name, "core");
        assert_eq!(refs[0].number, 7);
        assert_eq!(refs[1].number, 9);
    }
}
