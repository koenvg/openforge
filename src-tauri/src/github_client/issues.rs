use super::types::{CreateIssueRequest, CreateLabelRequest, CreatedIssue};
use super::{GitHubClient, GitHubError};

impl GitHubClient {
    /// Create an issue on {owner}/{repo}. Labels should already exist (see
    /// `ensure_label`); with push access GitHub applies them, otherwise it
    /// drops them silently rather than failing.
    pub async fn create_issue(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        labels: Vec<String>,
        token: &str,
    ) -> Result<CreatedIssue, GitHubError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}/issues");
        let request_body = CreateIssueRequest {
            title: title.to_string(),
            body: body.to_string(),
            labels,
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

    /// Best-effort: ensure a label exists so `create_issue` can apply it.
    /// Never surfaces an error — labeling is non-critical.
    pub async fn ensure_label(&self, owner: &str, repo: &str, name: &str, token: &str) {
        let get_url = format!("https://api.github.com/repos/{owner}/{repo}/labels/{name}");
        if let Ok(resp) = self.github_get(&get_url, token).send().await {
            if resp.status().is_success() {
                return;
            }
        }
        let create_url = format!("https://api.github.com/repos/{owner}/{repo}/labels");
        let body = CreateLabelRequest {
            name: name.to_string(),
            color: "ededed".to_string(),
        };
        let _ = self
            .send_github(
                self.github_request(reqwest::Method::POST, &create_url, token)
                    .json(&body),
            )
            .await;
    }
}
