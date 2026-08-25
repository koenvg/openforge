//! GitHub REST API Client
//!
//! Type-safe Rust client for interacting with GitHub REST API v3.
//! Provides functions for fetching PR details, fetching PR comments (both review
//! and general comments), posting comments, and checking PR status.
//!
//! ## Module Structure
//! - `types` — Request/response type definitions
//! - `error` — Error types
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
mod pulls;
mod repos;
mod response_cache;
mod reviews;
mod rules;
pub mod types;

pub use assets::ResolvedGithubAsset;
pub use checks::{aggregate_ci_status, deduplicate_check_runs, filter_to_required};
pub use error::GitHubError;
pub use events::{dedupe_pr_refs, extract_authored_pr_refs_from_user_events};
pub use response_cache::GitHubResponseCacheDiagnostics;
pub use reviews::aggregate_review_status;
pub use types::*;

use log::warn;
use reqwest::{header::HeaderMap, Client, Method, RequestBuilder, Response, StatusCode};
use response_cache::{CachedResponse, EtagResponseCache};
use serde::de::DeserializeOwned;
use std::sync::{Arc, Mutex};

enum ConditionalResponse {
    NotModified(Option<Arc<str>>),
    Fresh(Response),
}

fn unix_timestamp(now: std::time::SystemTime) -> Result<i64, std::time::SystemTimeError> {
    now.duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
}

fn current_unix_timestamp() -> Result<i64, std::time::SystemTimeError> {
    unix_timestamp(std::time::SystemTime::now())
}

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
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_token(result: Result<Option<String>, String>) -> Self {
        Self {
            token_source: GitHubTokenSource::Fixed(result),
            ..Self::new()
        }
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

    /// Get the last rate limit reset timestamp, if a rate limit was hit.
    pub fn get_last_rate_limit_reset(&self) -> Option<i64> {
        *self.last_rate_limit_reset.lock().unwrap()
    }

    /// Clear the stored rate limit reset timestamp.
    /// Call at the start of each poll cycle so stale values don't persist.
    pub fn clear_rate_limit_reset(&self) {
        *self.last_rate_limit_reset.lock().unwrap() = None;
    }

    #[cfg(test)]
    pub(crate) fn set_last_rate_limit_reset(&self, reset_at: Option<i64>) {
        *self.last_rate_limit_reset.lock().unwrap() = reset_at;
    }

    #[cfg(test)]
    pub(crate) fn shares_cache_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.etag_cache, &other.etag_cache)
            && Arc::ptr_eq(&self.last_rate_limit_reset, &other.last_rate_limit_reset)
    }

    fn github_request(&self, method: Method, url: &str, token: &str) -> RequestBuilder {
        self.client
            .request(method, url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10")
    }

    fn github_get(&self, url: &str, token: &str) -> reqwest::RequestBuilder {
        self.github_request(Method::GET, url, token)
    }

    fn cached_response_for_url(&self, url: &str) -> Option<CachedResponse> {
        self.etag_cache.lock().unwrap().lookup(url)
    }

    fn apply_cached_etag(req: RequestBuilder, cached: Option<&CachedResponse>) -> RequestBuilder {
        if let Some(cached) = cached {
            req.header("If-None-Match", &cached.etag)
        } else {
            req
        }
    }

    fn cache_response_body(&self, url: &str, etag: Option<String>, body: &str) {
        self.etag_cache.lock().unwrap().store(url, etag, body);
    }

    /// Return the current response-cache entry count and cached body bytes.
    pub fn response_cache_diagnostics(&self) -> GitHubResponseCacheDiagnostics {
        self.etag_cache.lock().unwrap().diagnostics()
    }

    fn rate_limit_reset_from_headers(status: StatusCode, headers: &HeaderMap) -> Option<i64> {
        let retry_after = headers
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value >= 0);

        if let Some(retry_after_secs) = retry_after {
            if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
                match current_unix_timestamp() {
                    Ok(now) => return Some(now.saturating_add(retry_after_secs)),
                    Err(error) => warn!(
                        "[GitHub Client] Failed to convert retry-after to a reset timestamp: {error}"
                    ),
                }
            }
        }

        let reset = headers
            .get("x-ratelimit-reset")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok());

        match status {
            StatusCode::TOO_MANY_REQUESTS => reset,
            StatusCode::FORBIDDEN => {
                let remaining_is_zero = headers
                    .get("x-ratelimit-remaining")
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value == "0")
                    .unwrap_or(false);
                remaining_is_zero.then_some(reset).flatten()
            }
            _ => None,
        }
    }

    fn capture_rate_limit_reset_from_headers(&self, status: StatusCode, headers: &HeaderMap) {
        if let Some(reset_val) = Self::rate_limit_reset_from_headers(status, headers) {
            *self.last_rate_limit_reset.lock().unwrap() = Some(reset_val);
        }
    }

    fn format_rate_limit_log_message(
        method: &Method,
        status: StatusCode,
        headers: &HeaderMap,
        reset_at: i64,
    ) -> String {
        let reset_description = match current_unix_timestamp() {
            Ok(now) => format!(
                "resets in {} seconds (at unix timestamp {reset_at})",
                (reset_at - now).max(0)
            ),
            Err(error) => {
                warn!("[GitHub Client] Failed to read current time: {error}");
                format!("resets at unix timestamp {reset_at}; current time unavailable")
            }
        };

        let mut details = vec![format!("status {}", status.as_u16())];

        if let Some(resource) = headers
            .get("x-ratelimit-resource")
            .and_then(|value| value.to_str().ok())
        {
            details.push(format!("resource {}", resource));
        }

        if let Some(retry_after) = headers
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
        {
            details.push(format!("retry-after {}s", retry_after));
        }

        for (header, label) in [
            ("x-ratelimit-limit", "limit"),
            ("x-ratelimit-remaining", "remaining"),
            ("x-ratelimit-used", "used"),
        ] {
            if let Some(value) = headers.get(header).and_then(|value| value.to_str().ok()) {
                details.push(format!("{} {}", label, value));
            }
        }

        format!(
            "[GitHub Client] Rate limit detected for {} ({}): {}",
            method,
            details.join(", "),
            reset_description
        )
    }

    async fn send_github(&self, req: RequestBuilder) -> Result<Response, GitHubError> {
        let request = req
            .build()
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
        let method = request.method().clone();

        let response = self
            .client
            .execute(request)
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if let Some(reset_at) =
            Self::rate_limit_reset_from_headers(response.status(), response.headers())
        {
            self.capture_rate_limit_reset_from_headers(response.status(), response.headers());
            warn!(
                "{}",
                Self::format_rate_limit_log_message(
                    &method,
                    response.status(),
                    response.headers(),
                    reset_at,
                )
            );
        }

        Ok(response)
    }

    async fn conditional_get(
        &self,
        url: &str,
        token: &str,
    ) -> Result<ConditionalResponse, GitHubError> {
        let cached = self.cached_response_for_url(url);
        let request = Self::apply_cached_etag(self.github_get(url, token), cached.as_ref());
        let response = self.send_github(request).await?;

        if response.status() == StatusCode::NOT_MODIFIED {
            return Ok(ConditionalResponse::NotModified(
                cached.map(|cached| cached.body),
            ));
        }

        Ok(ConditionalResponse::Fresh(response))
    }

    async fn api_error_from_response(response: Response) -> GitHubError {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read response body".to_string());

        GitHubError::ApiError {
            status: status.as_u16(),
            message: body,
        }
    }

    /// Make a GET request with ETag conditional request support.
    ///
    /// Sends `If-None-Match` header when a cached ETag exists for the URL.
    /// On 304 Not Modified, returns the cached deserialized response.
    /// On 200, caches the response body + ETag and returns the parsed result.
    async fn get_with_etag<T: DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
    ) -> Result<T, GitHubError> {
        match self.conditional_get(url, token).await? {
            ConditionalResponse::NotModified(Some(cached_body)) => {
                serde_json::from_str(&cached_body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))
            }
            ConditionalResponse::NotModified(None) => Err(GitHubError::ParseError(
                "Received 304 but no cached response found".to_string(),
            )),
            ConditionalResponse::Fresh(response) => {
                if !response.status().is_success() {
                    return Err(Self::api_error_from_response(response).await);
                }

                let etag = response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);

                let body = response
                    .text()
                    .await
                    .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

                let result: T = serde_json::from_str(&body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;

                self.cache_response_body(url, etag, &body);

                Ok(result)
            }
        }
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
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
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
    use reqwest::header::{
        HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, IF_NONE_MATCH, USER_AGENT,
    };
    use reqwest::Method;

    #[test]
    fn unix_timestamp_rejects_time_before_unix_epoch() {
        let before_unix_epoch = std::time::UNIX_EPOCH - std::time::Duration::from_secs(1);

        let error = unix_timestamp(before_unix_epoch)
            .expect_err("a pre-epoch clock value should return an error");

        assert_eq!(error.duration(), std::time::Duration::from_secs(1));
    }
    #[test]
    fn test_client_creation() {
        let _client = GitHubClient::new();
    }

    #[test]
    fn test_client_default() {
        let _client = GitHubClient::default();
    }

    #[test]
    fn test_etag_cache_initialized_empty() {
        let client = GitHubClient::new();

        assert_eq!(
            client.response_cache_diagnostics(),
            GitHubResponseCacheDiagnostics {
                entry_count: 0,
                body_bytes: 0,
            }
        );
    }

    #[test]
    fn test_last_rate_limit_reset_initialized_none() {
        let client = GitHubClient::new();
        let reset = client.last_rate_limit_reset.lock().unwrap();
        assert!(reset.is_none());
    }

    #[test]
    fn test_get_last_rate_limit_reset_returns_none_initially() {
        let client = GitHubClient::new();
        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_cloned_clients_share_etag_cache() {
        let client1 = GitHubClient::new();
        let client2 = client1.clone();

        assert!(client1.shares_cache_with(&client2));
        assert!(client2.shares_cache_with(&client1));
    }

    #[test]
    fn test_cloned_clients_share_rate_limit_state() {
        let client1 = GitHubClient::new();
        let client2 = client1.clone();

        *client1.last_rate_limit_reset.lock().unwrap() = Some(12345);
        assert_eq!(client2.get_last_rate_limit_reset(), Some(12345));

        client2.clear_rate_limit_reset();
        assert_eq!(client1.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_cloned_client_mutation_persists_across_clones() {
        let client_original = GitHubClient::new();
        let client_clone = client_original.clone();

        *client_clone.last_rate_limit_reset.lock().unwrap() = Some(99999);
        assert_eq!(client_original.get_last_rate_limit_reset(), Some(99999));

        client_original.clear_rate_limit_reset();
        assert_eq!(client_clone.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_apply_cached_etag_sets_if_none_match_header() {
        let client = GitHubClient::new();
        client.cache_response_body(
            "https://example.com/resource",
            Some("W/\"etag-123\"".to_string()),
            "{}",
        );
        let cached = client.cached_response_for_url("https://example.com/resource");
        let request = GitHubClient::apply_cached_etag(
            client.github_get("https://example.com/resource", "token"),
            cached.as_ref(),
        )
        .build()
        .expect("request should build");

        assert_eq!(
            request.headers().get(IF_NONE_MATCH),
            Some(&HeaderValue::from_static("W/\"etag-123\""))
        );
    }

    #[test]
    fn test_apply_cached_etag_leaves_header_absent_when_cache_missing() {
        let client = GitHubClient::new();

        let request = GitHubClient::apply_cached_etag(
            client.github_get("https://example.com/resource", "token"),
            None,
        )
        .build()
        .expect("request should build");

        assert!(request.headers().get(IF_NONE_MATCH).is_none());
    }

    #[test]
    fn test_github_request_sets_standard_github_headers() {
        let client = GitHubClient::new();

        let request = client
            .github_request(Method::POST, "https://example.com/resource", "token")
            .build()
            .expect("request should build");

        assert_eq!(
            request.headers().get(AUTHORIZATION),
            Some(&HeaderValue::from_static("token token"))
        );
        assert_eq!(
            request.headers().get(USER_AGENT),
            Some(&HeaderValue::from_static("openforge"))
        );
        assert_eq!(
            request.headers().get(ACCEPT),
            Some(&HeaderValue::from_static("application/vnd.github+json"))
        );
        assert_eq!(
            request.headers().get("X-GitHub-Api-Version"),
            Some(&HeaderValue::from_static("2026-03-10"))
        );
    }

    #[test]
    fn test_github_request_preserves_http_method() {
        let client = GitHubClient::new();

        let request = client
            .github_request(Method::PUT, "https://example.com/resource", "token")
            .build()
            .expect("request should build");

        assert_eq!(request.method(), Method::PUT);
    }

    #[test]
    fn test_cache_response_body_stores_body_when_etag_present() {
        let client = GitHubClient::new();

        client.cache_response_body(
            "https://example.com/resource",
            Some("W/\"etag-123\"".to_string()),
            "{\"ok\":true}",
        );

        let cached = client
            .cached_response_for_url("https://example.com/resource")
            .expect("response should be cached");

        assert_eq!(cached.etag, "W/\"etag-123\"");
        assert_eq!(cached.body.as_ref(), "{\"ok\":true}");
    }

    #[test]
    fn test_cache_response_body_skips_cache_when_etag_missing() {
        let client = GitHubClient::new();

        client.cache_response_body("https://example.com/resource", None, "{\"ok\":true}");

        assert_eq!(client.response_cache_diagnostics().entry_count, 0);
    }

    #[test]
    fn test_capture_rate_limit_reset_stores_value_for_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        client.capture_rate_limit_reset_from_headers(reqwest::StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(12345));
    }

    #[test]
    fn test_capture_rate_limit_reset_ignores_non_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        client.capture_rate_limit_reset_from_headers(reqwest::StatusCode::OK, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_capture_rate_limit_reset_ignores_invalid_header_value() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-ratelimit-reset",
            HeaderValue::from_static("not-a-number"),
        );

        client.capture_rate_limit_reset_from_headers(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            &headers,
        );

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_capture_rate_limit_reset_forbidden_with_valid_reset() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(1704067200));
    }

    #[test]
    fn test_capture_rate_limit_reset_ignores_forbidden_without_rate_limit_signal() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("42"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_capture_rate_limit_reset_prefers_retry_after_over_reset_header() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("30"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("999"));

        let before = current_unix_timestamp().expect("test clock should follow Unix epoch");
        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers);
        let after = current_unix_timestamp().expect("test clock should follow Unix epoch");

        let reset = client
            .get_last_rate_limit_reset()
            .expect("retry-after should be converted into a reset timestamp");
        assert_ne!(reset, 999);
        assert!(reset >= before + 30);
        assert!(reset <= after + 30);
    }

    #[test]
    fn test_capture_rate_limit_reset_too_many_requests_with_valid_reset() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704153600"));

        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(1704153600));
    }

    #[test]
    fn test_capture_rate_limit_reset_stores_multiple_sequential_resets() {
        let client = GitHubClient::new();
        let mut headers1 = HeaderMap::new();
        headers1.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers1.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers1);
        assert_eq!(client.get_last_rate_limit_reset(), Some(1704067200));

        let mut headers2 = HeaderMap::new();
        headers2.insert("x-ratelimit-reset", HeaderValue::from_static("1704153600"));

        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers2);
        assert_eq!(client.get_last_rate_limit_reset(), Some(1704153600));
    }

    #[test]
    fn test_format_rate_limit_log_message_redacts_request_identity() {
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-resource", HeaderValue::from_static("search"));
        headers.insert("retry-after", HeaderValue::from_static("60"));
        headers.insert("x-ratelimit-limit", HeaderValue::from_static("30"));
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers.insert("x-ratelimit-used", HeaderValue::from_static("30"));

        let message = GitHubClient::format_rate_limit_log_message(
            &Method::GET,
            StatusCode::FORBIDDEN,
            &headers,
            1,
        );

        assert!(message.contains("GET"));
        assert!(message.contains("status 403"));
        assert!(message.contains("resource search"));
        assert!(message.contains("retry-after 60s"));
        assert!(message.contains("limit 30"));
        assert!(message.contains("remaining 0"));
        assert!(message.contains("used 30"));
        assert!(!message.contains("https://api.github.com"));
        assert!(!message.contains("repos"));
        assert!(!message.contains("owner"));
        assert!(!message.contains("repo"));
        assert!(!message.contains("alice"));
    }

    #[test]
    fn test_format_rate_limit_log_message_omits_optional_headers_when_absent() {
        let headers = HeaderMap::new();

        let message = GitHubClient::format_rate_limit_log_message(
            &Method::POST,
            StatusCode::TOO_MANY_REQUESTS,
            &headers,
            1,
        );

        assert!(message.contains("POST"));
        assert!(message.contains("status 429"));
        assert!(!message.contains("resource "));
        assert!(!message.contains("retry-after "));
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
