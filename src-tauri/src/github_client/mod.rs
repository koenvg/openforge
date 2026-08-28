//! GitHub REST API Client
//!
//! Type-safe Rust client for interacting with GitHub REST API v3.
//! Provides functions for fetching PR details, fetching PR comments (both review
//! and general comments), posting comments, and checking PR status.
//!
//! ## Module Structure
//! - `types` — Request/response type definitions
//! - `error` — Error types
//! - `transport` — GitHub request construction and execution
//! - `response_cache` — ETag conditional requests and response caching
//! - `rate_limit` — Rate-limit detection, state, and logging
//! - `pagination` — Multi-page REST response collection
//! - `pulls` — Pull request operations (details, comments, files, search)
//! - `checks` — CI check runs and commit status operations
//! - `reviews` — PR review operations
//!
//! ## Authentication
//! Uses Personal Access Token (PAT) in Authorization header
//! Authorization header format: `token {personal_access_token}`

mod assets;
mod checks;
pub mod error;
mod events;
mod graphql;
mod pagination;
mod pulls;
mod rate_limit;
mod repos;
mod response_cache;
mod reviews;
mod rules;
mod transport;
pub mod types;

pub use assets::ResolvedGithubAsset;
pub use checks::{aggregate_ci_status, deduplicate_check_runs, filter_to_required};
pub use error::GitHubError;
pub use events::{dedupe_pr_refs, extract_authored_pr_refs_from_user_events};
pub use graphql::EnqueuePullRequestRequest;
pub use response_cache::GitHubResponseCacheDiagnostics;
pub use reviews::aggregate_review_status;
pub use types::*;

use reqwest::Client;
use response_cache::{ConditionalResponse, EtagResponseCache};
#[cfg(test)]
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg(test)]
type TestPullRequests = HashMap<(String, String, i64), PullRequest>;

#[derive(Clone, Debug)]
enum GitHubTokenSource {
    SecureStore,
    #[cfg(test)]
    Fixed(Result<Option<String>, String>),
}

/// GitHub API client
#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
    etag_cache: Arc<Mutex<EtagResponseCache>>,
    last_rate_limit_reset: Arc<Mutex<Option<i64>>>,
    token_source: GitHubTokenSource,
    #[cfg(test)]
    test_pull_requests: Option<Arc<TestPullRequests>>,
}

/// Result of interpreting the HTTP status of a `GET /repos/{owner}/{repo}` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RepoAccess {
    Accessible,
    Denied,
    Unknown,
}

/// Maps a repo-lookup HTTP status to an access verdict.
/// 200-299 means accessible.
/// 401 (bad/expired token) and 404 (not found, or private-without-access —
/// GitHub returns 404 rather than 403 to avoid leaking a private repo's
/// existence) are a definitive "you can't see this repo".
/// 403 is typically rate-limiting or a forbidden action, not an access denial,
/// so treat it as Unknown and let the actual clone decide rather than wrongly blocking it.
pub(crate) fn classify_repo_access_status(status: u16) -> RepoAccess {
    match status {
        200..=299 => RepoAccess::Accessible,
        // 401 (bad/expired token) and 404 (not found, or private-without-access —
        // GitHub returns 404 rather than 403 to avoid leaking a private repo's
        // existence) are a definitive "you can't see this repo". 403 is typically
        // rate-limiting or a forbidden action, not an access denial, so treat it as
        // Unknown and let the actual clone decide rather than wrongly blocking it.
        401 | 404 => RepoAccess::Denied,
        _ => RepoAccess::Unknown,
    }
}

impl GitHubClient {
    /// Create a new GitHub client
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            etag_cache: Arc::new(Mutex::new(EtagResponseCache::new())),
            last_rate_limit_reset: Arc::new(Mutex::new(None)),
            token_source: GitHubTokenSource::SecureStore,
            #[cfg(test)]
            test_pull_requests: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_token(result: Result<Option<String>, String>) -> Self {
        Self {
            token_source: GitHubTokenSource::Fixed(result),
            ..Self::new()
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_pull_requests(
        pull_requests: Vec<(String, String, PullRequest)>,
    ) -> Self {
        let pull_requests = pull_requests
            .into_iter()
            .map(|(owner, repo, pull_request)| {
                (
                    (
                        owner.to_ascii_lowercase(),
                        repo.to_ascii_lowercase(),
                        pull_request.number,
                    ),
                    pull_request,
                )
            })
            .collect();
        Self {
            token_source: GitHubTokenSource::Fixed(Ok(Some("test-token".to_string()))),
            test_pull_requests: Some(Arc::new(pull_requests)),
            ..Self::new()
        }
    }

    #[cfg(test)]
    fn test_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Option<Result<PullRequest, GitHubError>> {
        self.test_pull_requests.as_ref().map(|pull_requests| {
            pull_requests
                .get(&(
                    owner.to_ascii_lowercase(),
                    repo.to_ascii_lowercase(),
                    number,
                ))
                .cloned()
                .ok_or_else(|| GitHubError::ApiError {
                    status: 404,
                    message: "Not Found".to_string(),
                })
        })
    }

    pub(crate) async fn github_token(&self) -> Result<Option<String>, String> {
        match &self.token_source {
            GitHubTokenSource::SecureStore => {
                crate::secure_store::get_secret_async("github_token").await
            }
            #[cfg(test)]
            GitHubTokenSource::Fixed(result) => result.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn shares_cache_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.etag_cache, &other.etag_cache)
            && Arc::ptr_eq(&self.last_rate_limit_reset, &other.last_rate_limit_reset)
    }

    /// Get authenticated user's login
    pub async fn get_authenticated_user(&self, token: &str) -> Result<String, GitHubError> {
        let url = "https://api.github.com/user";

        let user: AuthenticatedUser = self.get_with_etag(url, token).await?;

        Ok(user.login)
    }

    /// Checks whether the authenticated token can see the given repository.
    /// Returns Ok(true) when accessible or when the outcome is inconclusive
    /// (let the clone decide), Ok(false) only when GitHub clearly denies access.
    pub async fn check_repo_access(
        &self,
        owner: &str,
        repo: &str,
        token: &str,
    ) -> Result<bool, GitHubError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}");
        let response = self
            .github_get(&url, token)
            .send()
            .await
            .map_err(|error| GitHubError::NetworkError(error.to_string()))?;
        Ok(
            match classify_repo_access_status(response.status().as_u16()) {
                RepoAccess::Accessible | RepoAccess::Unknown => true,
                RepoAccess::Denied => false,
            },
        )
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_creation() {
        let _client = GitHubClient::new();
    }

    #[test]
    fn client_default() {
        let _client = GitHubClient::default();
    }

    #[test]
    fn cloned_clients_share_cache_state() {
        let client = GitHubClient::new();
        let clone = client.clone();

        assert!(client.shares_cache_with(&clone));
        assert!(clone.shares_cache_with(&client));
    }

    #[test]
    fn classify_repo_access_status_maps_codes() {
        assert!(matches!(
            classify_repo_access_status(200),
            RepoAccess::Accessible
        ));
        assert!(matches!(
            classify_repo_access_status(301),
            RepoAccess::Unknown
        ));
        assert!(matches!(
            classify_repo_access_status(401),
            RepoAccess::Denied
        ));
        assert!(matches!(
            classify_repo_access_status(403),
            RepoAccess::Unknown
        ));
        assert!(matches!(
            classify_repo_access_status(404),
            RepoAccess::Denied
        ));
        assert!(matches!(
            classify_repo_access_status(500),
            RepoAccess::Unknown
        ));
    }
}
