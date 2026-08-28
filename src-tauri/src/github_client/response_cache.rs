use super::{GitHubClient, GitHubError};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

const MAX_ENTRIES: usize = 256;
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Lightweight diagnostics for the process-lifetime GitHub response cache.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubResponseCacheDiagnostics {
    pub entry_count: usize,
    pub body_bytes: usize,
}

/// Cached HTTP response with ETag for conditional requests.
#[derive(Clone)]
pub(super) struct CachedResponse {
    pub(super) etag: String,
    pub(super) body: Arc<str>,
}

pub(super) struct EtagResponseCache {
    entries: HashMap<String, CachedResponse>,
    last_access: HashMap<String, u64>,
    body_bytes: usize,
    access_clock: u64,
    max_entries: usize,
    max_body_bytes: usize,
}

impl EtagResponseCache {
    pub(super) fn new() -> Self {
        Self::with_limits(MAX_ENTRIES, MAX_BODY_BYTES)
    }

    fn with_limits(max_entries: usize, max_body_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            last_access: HashMap::new(),
            body_bytes: 0,
            access_clock: 0,
            max_entries,
            max_body_bytes,
        }
    }

    fn diagnostics(&self) -> GitHubResponseCacheDiagnostics {
        GitHubResponseCacheDiagnostics {
            entry_count: self.entries.len(),
            body_bytes: self.body_bytes,
        }
    }

    fn lookup(&mut self, url: &str) -> Option<CachedResponse> {
        let cached = self.entries.get(url).cloned()?;
        self.touch(url);
        Some(cached)
    }

    fn store(&mut self, url: &str, etag: Option<String>, body: &str) {
        self.remove(url);

        let Some(etag) = etag else {
            return;
        };
        if self.max_entries == 0 || body.len() > self.max_body_bytes {
            return;
        }

        self.body_bytes += body.len();
        self.entries.insert(
            url.to_string(),
            CachedResponse {
                etag,
                body: Arc::from(body),
            },
        );
        self.touch(url);
        self.evict_to_limits();
    }

    fn touch(&mut self, url: &str) {
        self.access_clock = self.access_clock.saturating_add(1);
        self.last_access.insert(url.to_string(), self.access_clock);
    }

    fn evict_to_limits(&mut self) {
        while self.entries.len() > self.max_entries || self.body_bytes > self.max_body_bytes {
            let Some(lru_url) = self
                .last_access
                .iter()
                .min_by(|(url_a, access_a), (url_b, access_b)| {
                    access_a.cmp(access_b).then_with(|| url_a.cmp(url_b))
                })
                .map(|(url, _)| url.clone())
            else {
                break;
            };
            self.remove(&lru_url);
        }
    }

    fn remove(&mut self, url: &str) {
        if let Some(removed) = self.entries.remove(url) {
            self.body_bytes = self.body_bytes.saturating_sub(removed.body.len());
        }
        self.last_access.remove(url);
    }
}

pub(super) enum ConditionalResponse {
    NotModified(Option<Arc<str>>),
    Fresh(Response),
}

impl GitHubClient {
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

    pub(super) fn cache_response_body(&self, url: &str, etag: Option<String>, body: &str) {
        self.etag_cache.lock().unwrap().store(url, etag, body);
    }

    /// Return the current response-cache entry count and cached body bytes.
    pub fn response_cache_diagnostics(&self) -> GitHubResponseCacheDiagnostics {
        self.etag_cache.lock().unwrap().diagnostics()
    }

    pub(super) async fn conditional_get(
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

    /// Make a GET request with ETag conditional request support.
    ///
    /// Sends `If-None-Match` header when a cached ETag exists for the URL.
    /// On 304 Not Modified, returns the cached deserialized response.
    /// On 200, caches the response body + ETag and returns the parsed result.
    pub(super) async fn get_with_etag<T: DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
    ) -> Result<T, GitHubError> {
        match self.conditional_get(url, token).await? {
            ConditionalResponse::NotModified(Some(cached_body)) => {
                serde_json::from_str(&cached_body)
                    .map_err(|error| GitHubError::ParseError(error.to_string()))
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
                    .and_then(|value| value.to_str().ok())
                    .map(String::from);

                let body = response
                    .text()
                    .await
                    .map_err(|error| GitHubError::NetworkError(error.to_string()))?;

                let result: T = serde_json::from_str(&body)
                    .map_err(|error| GitHubError::ParseError(error.to_string()))?;

                self.cache_response_body(url, etag, &body);

                Ok(result)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderValue, IF_NONE_MATCH};

    #[test]
    fn replacement_updates_body_and_byte_diagnostics() {
        let mut cache = EtagResponseCache::with_limits(2, 64);

        cache.store("resource", Some("etag-1".to_string()), "old");
        cache.store("resource", Some("etag-2".to_string()), "replacement");

        let cached = cache
            .lookup("resource")
            .expect("replacement should remain cached");
        assert_eq!(cached.etag, "etag-2");
        assert_eq!(cached.body.as_ref(), "replacement");
        assert_eq!(
            cache.diagnostics(),
            GitHubResponseCacheDiagnostics {
                entry_count: 1,
                body_bytes: "replacement".len(),
            }
        );
    }

    #[test]
    fn evicts_least_recently_used_entry_at_entry_limit() {
        let mut cache = EtagResponseCache::with_limits(2, 64);
        cache.store("oldest", Some("etag-1".to_string()), "one");
        cache.store("recent", Some("etag-2".to_string()), "two");

        cache.lookup("oldest");
        cache.store("new", Some("etag-3".to_string()), "three");

        assert!(cache.lookup("oldest").is_some());
        assert!(cache.lookup("recent").is_none());
        assert!(cache.lookup("new").is_some());
        assert_eq!(cache.diagnostics().entry_count, 2);
    }

    #[test]
    fn evicts_least_recently_used_entry_at_byte_limit() {
        let mut cache = EtagResponseCache::with_limits(3, 6);
        cache.store("oldest", Some("etag-1".to_string()), "aaa");
        cache.store("recent", Some("etag-2".to_string()), "bb");

        cache.lookup("oldest");
        cache.store("new", Some("etag-3".to_string()), "cc");

        assert!(cache.lookup("oldest").is_some());
        assert!(cache.lookup("recent").is_none());
        assert!(cache.lookup("new").is_some());
        assert_eq!(cache.diagnostics().body_bytes, 5);
    }

    #[test]
    fn drops_existing_entry_when_replacement_body_is_oversized() {
        let mut cache = EtagResponseCache::with_limits(2, 4);
        cache.store("resource", Some("etag-1".to_string()), "old");

        cache.store("resource", Some("etag-2".to_string()), "oversized");

        assert!(cache.lookup("resource").is_none());
        assert_eq!(
            cache.diagnostics(),
            GitHubResponseCacheDiagnostics {
                entry_count: 0,
                body_bytes: 0,
            }
        );
    }

    #[test]
    fn client_cache_is_initialized_empty() {
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
    fn apply_cached_etag_sets_if_none_match_header() {
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
    fn apply_cached_etag_leaves_header_absent_when_cache_missing() {
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
    fn cache_response_body_stores_body_when_etag_present() {
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
    fn cache_response_body_skips_cache_when_etag_missing() {
        let client = GitHubClient::new();

        client.cache_response_body("https://example.com/resource", None, "{\"ok\":true}");

        assert_eq!(client.response_cache_diagnostics().entry_count, 0);
    }
}
