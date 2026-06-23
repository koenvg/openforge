//! GitHub Issues operations for the Roadmap board.
//!
//! REST-only (no GraphQL). Reuses the shared client's token, ETag, and
//! rate-limit handling via [`GitHubClient`].

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

impl GitHubClient {
    /// List open issues for a repo, excluding pull requests.
    ///
    /// The `GET /issues` endpoint returns both issues and PRs; entries carrying a
    /// `pull_request` field are PRs and are filtered out.
    pub async fn list_open_issues(
        &self,
        owner: &str,
        name: &str,
        token: &str,
    ) -> Result<Vec<Issue>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues?state=open&per_page=100",
            owner, name
        );

        let issues: Vec<Issue> = self.get_with_etag::<Vec<Issue>>(&url, token).await?;
        Ok(issues
            .into_iter()
            .filter(|issue| !issue.is_pull_request())
            .collect())
    }

    /// Create a new issue.
    pub async fn create_issue(
        &self,
        owner: &str,
        name: &str,
        title: &str,
        body: &str,
        labels: &[String],
        token: &str,
    ) -> Result<Issue, GitHubError> {
        let url = format!("https://api.github.com/repos/{}/{}/issues", owner, name);

        let request_body = CreateIssueRequest {
            title: title.to_string(),
            body: body.to_string(),
            labels: labels.to_vec(),
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

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }

    /// Edit an issue: title / body / state and/or add+remove labels.
    ///
    /// Label changes are resolved against the issue's current labels (fetched
    /// first) and sent as the full replacement `labels` array. When the input
    /// has no changes, this is a no-op and the current issue is returned.
    pub async fn edit_issue(
        &self,
        owner: &str,
        name: &str,
        number: i64,
        input: EditIssueInput,
        token: &str,
    ) -> Result<Issue, GitHubError> {
        if input.is_empty() {
            return self.get_issue(owner, name, number, token).await;
        }

        let mut patch = serde_json::Map::new();
        if let Some(title) = &input.title {
            patch.insert("title".to_string(), serde_json::json!(title));
        }
        if let Some(body) = &input.body {
            patch.insert("body".to_string(), serde_json::json!(body));
        }
        if let Some(state) = &input.state {
            patch.insert("state".to_string(), serde_json::json!(state));
        }

        let needs_label_change = !input.add_labels.is_empty() || !input.remove_labels.is_empty();
        if needs_label_change {
            let current = self.get_issue(owner, name, number, token).await?;
            let current_labels: Vec<String> =
                current.labels.iter().map(|l| l.name.clone()).collect();
            let resolved = input.resolve_labels(&current_labels);
            patch.insert("labels".to_string(), serde_json::json!(resolved));
        }

        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}",
            owner, name, number
        );

        let response = self
            .send_github(
                self.github_request(reqwest::Method::PATCH, &url, token)
                    .json(&serde_json::Value::Object(patch)),
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

    /// Fetch a single issue by number.
    pub async fn get_issue(
        &self,
        owner: &str,
        name: &str,
        number: i64,
        token: &str,
    ) -> Result<Issue, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}",
            owner, name, number
        );

        let response = self.send_github(self.github_get(&url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }
}
