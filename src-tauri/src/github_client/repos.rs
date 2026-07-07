//! GitHub repository creation.
//!
//! REST-only. Reuses the shared client's token, request, and error handling via
//! [`GitHubClient`], mirroring `issues.rs`.

use super::error::GitHubError;
use super::types::{CreateRepoRequest, CreatedRepo};
use super::GitHubClient;

impl GitHubClient {
    /// Create a new repository on the authenticated user's account.
    /// `auto_init` is always false — the repo is created empty.
    pub async fn create_repo(
        &self,
        name: &str,
        private: bool,
        token: &str,
    ) -> Result<CreatedRepo, GitHubError> {
        let url = "https://api.github.com/user/repos";

        let request_body = CreateRepoRequest {
            name: name.to_string(),
            private,
            auto_init: false,
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, url, token)
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
}

#[cfg(test)]
mod tests {
    use crate::github_client::types::{CreateRepoRequest, CreatedRepo};

    #[test]
    fn create_repo_request_serializes_with_auto_init_false() {
        let body = CreateRepoRequest {
            name: "my-idea".to_string(),
            private: true,
            auto_init: false,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["name"], "my-idea");
        assert_eq!(json["private"], true);
        assert_eq!(json["auto_init"], false);
    }

    #[test]
    fn created_repo_deserializes_clone_url_ignoring_extra_fields() {
        let sample = serde_json::json!({
            "clone_url": "https://github.com/octocat/my-idea.git",
            "full_name": "octocat/my-idea",
            "ssh_url": "git@github.com:octocat/my-idea.git"
        });
        let created: CreatedRepo = serde_json::from_value(sample).unwrap();
        assert_eq!(created.clone_url, "https://github.com/octocat/my-idea.git");
    }
}
