use super::GitHubClient;
use log::warn;
use reqwest::{header::HeaderMap, Method, StatusCode};

impl GitHubClient {
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

    pub(super) fn rate_limit_reset_from_headers(
        status: StatusCode,
        headers: &HeaderMap,
    ) -> Option<i64> {
        let retry_after = headers
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value >= 0);

        if let Some(retry_after_secs) = retry_after {
            if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
                match crate::unix_timestamp::seconds(std::time::SystemTime::now()) {
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

    pub(super) fn capture_rate_limit_reset_from_headers(
        &self,
        status: StatusCode,
        headers: &HeaderMap,
    ) -> Option<i64> {
        let reset_at = Self::rate_limit_reset_from_headers(status, headers);
        if let Some(reset_at) = reset_at {
            *self.last_rate_limit_reset.lock().unwrap() = Some(reset_at);
        }
        reset_at
    }

    pub(super) fn format_rate_limit_log_message(
        method: &Method,
        status: StatusCode,
        headers: &HeaderMap,
        reset_at: i64,
    ) -> String {
        let reset_description = match crate::unix_timestamp::seconds(std::time::SystemTime::now()) {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn last_rate_limit_reset_is_initialized_empty() {
        let client = GitHubClient::new();

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn cloned_clients_share_rate_limit_state() {
        let client = GitHubClient::new();
        let clone = client.clone();

        client.set_last_rate_limit_reset(Some(12345));
        assert_eq!(clone.get_last_rate_limit_reset(), Some(12345));

        clone.clear_rate_limit_reset();
        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn captures_reset_for_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        let reset_at =
            client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers);

        assert_eq!(reset_at, Some(12345));
        assert_eq!(client.get_last_rate_limit_reset(), Some(12345));
    }

    #[test]
    fn ignores_non_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        let reset_at = client.capture_rate_limit_reset_from_headers(StatusCode::OK, &headers);

        assert_eq!(reset_at, None);
        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn ignores_invalid_reset_header() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-ratelimit-reset",
            HeaderValue::from_static("not-a-number"),
        );

        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn captures_forbidden_with_valid_reset() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(1704067200));
    }

    #[test]
    fn ignores_forbidden_without_rate_limit_signal() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("42"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn retry_after_takes_precedence_over_reset_header() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("30"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("999"));

        let before = crate::unix_timestamp::seconds(std::time::SystemTime::now())
            .expect("test clock should follow Unix epoch");
        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers);
        let after = crate::unix_timestamp::seconds(std::time::SystemTime::now())
            .expect("test clock should follow Unix epoch");

        let reset = client
            .get_last_rate_limit_reset()
            .expect("retry-after should be converted into a reset timestamp");
        assert_ne!(reset, 999);
        assert!(reset >= before + 30);
        assert!(reset <= after + 30);
    }

    #[test]
    fn captures_too_many_requests_with_valid_reset() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704153600"));

        client.capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(1704153600));
    }

    #[test]
    fn stores_multiple_sequential_resets() {
        let client = GitHubClient::new();
        let mut first_headers = HeaderMap::new();
        first_headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        first_headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704067200"));

        client.capture_rate_limit_reset_from_headers(StatusCode::FORBIDDEN, &first_headers);
        assert_eq!(client.get_last_rate_limit_reset(), Some(1704067200));

        let mut second_headers = HeaderMap::new();
        second_headers.insert("x-ratelimit-reset", HeaderValue::from_static("1704153600"));

        client
            .capture_rate_limit_reset_from_headers(StatusCode::TOO_MANY_REQUESTS, &second_headers);
        assert_eq!(client.get_last_rate_limit_reset(), Some(1704153600));
    }

    #[test]
    fn log_message_redacts_request_identity() {
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
    fn log_message_omits_optional_headers_when_absent() {
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
}
