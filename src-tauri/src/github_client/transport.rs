use super::{GitHubClient, GitHubError};
use log::warn;
use reqwest::{Method, RequestBuilder, Response};

impl GitHubClient {
    pub(super) fn github_request(&self, method: Method, url: &str, token: &str) -> RequestBuilder {
        self.client
            .request(method, url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10")
    }

    pub(super) fn github_get(&self, url: &str, token: &str) -> RequestBuilder {
        self.github_request(Method::GET, url, token)
    }

    pub(super) async fn send_github(&self, req: RequestBuilder) -> Result<Response, GitHubError> {
        let request = req
            .build()
            .map_err(|error| GitHubError::NetworkError(error.to_string()))?;
        let method = request.method().clone();

        let response = self
            .client
            .execute(request)
            .await
            .map_err(|error| GitHubError::NetworkError(error.to_string()))?;

        if let Some(reset_at) =
            self.capture_rate_limit_reset_from_headers(response.status(), response.headers())
        {
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

    pub(super) async fn api_error_from_response(response: Response) -> GitHubError {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};

    #[test]
    fn github_request_sets_standard_github_headers() {
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
    fn github_request_preserves_http_method() {
        let client = GitHubClient::new();

        let request = client
            .github_request(Method::PUT, "https://example.com/resource", "token")
            .build()
            .expect("request should build");

        assert_eq!(request.method(), Method::PUT);
    }
}
