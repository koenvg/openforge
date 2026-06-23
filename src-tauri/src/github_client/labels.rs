//! GitHub repository labels for the Roadmap board.
//!
//! REST-only. Reuses the shared client's token, ETag, and rate-limit handling.

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

impl GitHubClient {
    /// List all labels defined on a repository (name + color).
    pub async fn list_labels(
        &self,
        owner: &str,
        name: &str,
        token: &str,
    ) -> Result<Vec<RepoLabel>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/labels?per_page=100",
            owner, name
        );

        self.get_with_etag::<Vec<RepoLabel>>(&url, token).await
    }
}
