//! GitHub REST API Client
//!
//! Type-safe Rust client for interacting with GitHub REST API v3.
//! Provides functions for fetching PR details, fetching PR comments (both review
//! and general comments), posting comments, and checking PR status.
//!
//! ## API Endpoints
//! - GET /repos/{owner}/{repo}/pulls/{number} — Get PR details
//! - GET /repos/{owner}/{repo}/pulls/{number}/comments — Get review (inline) comments
//! - GET /repos/{owner}/{repo}/issues/{number}/comments — Get general comments
//! - POST /repos/{owner}/{repo}/issues/{number}/comments — Post a comment
//!
//! ## Authentication
//! Uses Personal Access Token (PAT) in Authorization header
//! Authorization header format: `token {personal_access_token}`
//!
//! ## User-Agent Requirement
//! GitHub API requires a User-Agent header. This client uses: `ai-command-center`

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::fmt;

/// GitHub API client
#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
}

impl GitHubClient {
    /// Create a new GitHub client
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Get pull request details
    ///
    /// # Arguments
    /// * `owner` - Repository owner (e.g., "facebook")
    /// * `repo` - Repository name (e.g., "react")
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// PullRequest with full details on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let pr = client.get_pr_details(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_details(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<PullRequest, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let pr: PullRequest = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(pr)
    }

    /// Get all PR comments (both review comments and general comments)
    ///
    /// Fetches both inline review comments (from /pulls/{number}/comments)
    /// and general issue comments (from /issues/{number}/comments), merging
    /// them into a single vector with a `comment_type` field to distinguish.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Vector of PrComment with both review and general comments
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let comments = client.get_pr_comments(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here"
    /// ).await?;
    /// for comment in comments {
    ///     println!("{}: {}", comment.comment_type, comment.body);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrComment>, GitHubError> {
        // Fetch review comments (inline code comments)
        let review_comments_url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments",
            owner, repo, pr_number
        );

        let review_response = self
            .client
            .get(&review_comments_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !review_response.status().is_success() {
            let status = review_response.status();
            let body = review_response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let mut review_comments: Vec<ReviewComment> = review_response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        // Fetch general issue comments
        let issue_comments_url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments",
            owner, repo, pr_number
        );

        let issue_response = self
            .client
            .get(&issue_comments_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !issue_response.status().is_success() {
            let status = issue_response.status();
            let body = issue_response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let mut issue_comments: Vec<IssueComment> = issue_response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        // Merge both comment types into a single vector
        let mut all_comments = Vec::new();

        // Convert review comments
        for comment in review_comments.drain(..) {
            all_comments.push(PrComment {
                id: comment.id,
                body: comment.body,
                user: comment.user,
                path: Some(comment.path),
                line: comment.line,
                comment_type: "review_comment".to_string(),
                created_at: comment.created_at,
            });
        }

        // Convert issue comments
        for comment in issue_comments.drain(..) {
            all_comments.push(PrComment {
                id: comment.id,
                body: comment.body,
                user: comment.user,
                path: None,
                line: None,
                comment_type: "issue_comment".to_string(),
                created_at: comment.created_at,
            });
        }

        Ok(all_comments)
    }

    /// Post a comment on a pull request
    ///
    /// Posts a general comment (not an inline review comment) to the PR.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `body` - Comment body (Markdown supported)
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Ok(()) on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// client.post_pr_comment(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "LGTM! :+1:",
    ///     "ghp_token_here"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn post_pr_comment(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        body: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments",
            owner, repo, pr_number
        );

        let request_body = CommentRequest {
            body: body.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        Ok(())
    }

    /// Get pull request status
    ///
    /// Returns the current state of the PR (e.g., "open", "closed", "merged").
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// PR state string on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let status = client.get_pr_status(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here"
    /// ).await?;
    /// println!("PR status: {}", status);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<String, GitHubError> {
        let pr = self.get_pr_details(owner, repo, pr_number, token).await?;
        Ok(pr.state)
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Pull request representation
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub user: GitHubUser,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Unified PR comment (can be review comment or issue comment)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    /// File path (only present for review comments)
    pub path: Option<String>,
    /// Line number (only present for review comments)
    pub line: Option<i32>,
    /// Type of comment: "review_comment" or "issue_comment"
    pub comment_type: String,
    pub created_at: String,
}

/// GitHub user
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubUser {
    pub login: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Review comment (inline code comment) from GitHub API
#[derive(Debug, Deserialize)]
struct ReviewComment {
    id: i64,
    body: String,
    user: GitHubUser,
    path: String,
    line: Option<i32>,
    created_at: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// Issue comment (general comment) from GitHub API
#[derive(Debug, Deserialize)]
struct IssueComment {
    id: i64,
    body: String,
    user: GitHubUser,
    created_at: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// Request body for posting a comment
#[derive(Debug, Serialize)]
struct CommentRequest {
    body: String,
}

// ============================================================================
// Error Types
// ============================================================================

/// GitHub API error types
#[derive(Debug)]
pub enum GitHubError {
    /// Network error (connection failure, timeout, etc.)
    NetworkError(String),
    /// API error (non-2xx status code)
    ApiError { status: u16, message: String },
    /// Parse error (JSON deserialization failure)
    ParseError(String),
}

impl fmt::Display for GitHubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitHubError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            GitHubError::ApiError { status, message } => {
                write!(f, "API error (status {}): {}", status, message)
            }
            GitHubError::ParseError(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl StdError for GitHubError {}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let _client = GitHubClient::new();
    }

    #[test]
    fn test_client_default() {
        let _client = GitHubClient::default();
    }

    #[test]
    fn test_comment_request_serialization() {
        let request = CommentRequest {
            body: "Test comment".to_string(),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"body\""));
        assert!(json.contains("\"Test comment\""));
    }

    #[test]
    fn test_error_display() {
        let network_err = GitHubError::NetworkError("Connection timeout".to_string());
        assert_eq!(
            network_err.to_string(),
            "Network error: Connection timeout"
        );

        let api_err = GitHubError::ApiError {
            status: 404,
            message: "Not Found".to_string(),
        };
        assert_eq!(api_err.to_string(), "API error (status 404): Not Found");

        let parse_err = GitHubError::ParseError("Invalid JSON".to_string());
        assert_eq!(parse_err.to_string(), "Parse error: Invalid JSON");
    }

    #[test]
    fn test_pr_comment_serialization() {
        let comment = PrComment {
            id: 123,
            body: "Test comment".to_string(),
            user: GitHubUser {
                login: "testuser".to_string(),
                extra: serde_json::json!({}),
            },
            path: Some("src/main.rs".to_string()),
            line: Some(42),
            comment_type: "review_comment".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"id\":123"));
        assert!(json.contains("\"comment_type\":\"review_comment\""));
        assert!(json.contains("\"path\":\"src/main.rs\""));
        assert!(json.contains("\"line\":42"));
    }

    #[test]
    fn test_pull_request_deserialization() {
        let json = r#"{
            "number": 123,
            "title": "Test PR",
            "state": "open",
            "html_url": "https://github.com/owner/repo/pull/123",
            "user": {
                "login": "testuser"
            },
            "extra_field": "ignored"
        }"#;

        let pr: PullRequest = serde_json::from_str(json).unwrap();
        assert_eq!(pr.number, 123);
        assert_eq!(pr.title, "Test PR");
        assert_eq!(pr.state, "open");
        assert_eq!(pr.user.login, "testuser");
    }
}
