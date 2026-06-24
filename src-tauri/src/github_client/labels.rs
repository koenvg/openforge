//! GitHub repository labels for the Roadmap board.
//!
//! REST-only. Reuses the shared client's token, ETag, and rate-limit handling.

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

fn encode_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

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

    /// Update a repository label's color. The color must be six hex digits
    /// without a leading '#'.
    pub async fn update_label_color(
        &self,
        owner: &str,
        repo: &str,
        name: &str,
        color: &str,
        token: &str,
    ) -> Result<RepoLabel, GitHubError> {
        let encoded_name = encode_path_segment(name);
        let url = format!(
            "https://api.github.com/repos/{}/{}/labels/{}",
            owner, repo, encoded_name
        );

        let response = self
            .send_github(
                self.github_request(reqwest::Method::PATCH, &url, token)
                    .json(&serde_json::json!({ "color": color })),
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
    use super::*;

    #[test]
    fn encode_path_segment_escapes_label_names_for_github_paths() {
        assert_eq!(encode_path_segment("bug"), "bug");
        assert_eq!(encode_path_segment("needs review"), "needs%20review");
        assert_eq!(encode_path_segment("area/ui"), "area%2Fui");
    }
}
