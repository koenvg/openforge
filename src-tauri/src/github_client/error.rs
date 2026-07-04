use std::error::Error as StdError;
use std::fmt;

/// GitHub API error types
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub enum GitHubError {
    /// Network error (connection failure, timeout, etc.)
    NetworkError(String),
    /// API error (non-2xx status code)
    ApiError { status: u16, message: String },
    /// Parse error (JSON deserialization failure)
    ParseError(String),
}

impl GitHubError {
    pub(crate) fn sanitized_log_message(&self) -> String {
        match self {
            GitHubError::NetworkError(_) => "GitHub network error".to_string(),
            GitHubError::ApiError { status, .. } => {
                format!("GitHub API error (status {status})")
            }
            GitHubError::ParseError(_) => "GitHub parse error".to_string(),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let network_err = GitHubError::NetworkError("Connection timeout".to_string());
        assert_eq!(network_err.to_string(), "Network error: Connection timeout");

        let api_err = GitHubError::ApiError {
            status: 404,
            message: "Not Found".to_string(),
        };
        assert_eq!(api_err.to_string(), "API error (status 404): Not Found");

        let parse_err = GitHubError::ParseError("Invalid JSON".to_string());
        assert_eq!(parse_err.to_string(), "Parse error: Invalid JSON");
    }

    #[test]
    fn sanitized_log_message_preserves_status_without_sensitive_content() {
        let err = GitHubError::ApiError {
            status: 403,
            message: "token ghp_secret body mentions https://api.github.com/repos/acme/private/pulls?user=alice".to_string(),
        };

        let sanitized = err.sanitized_log_message();

        assert_eq!(sanitized, "GitHub API error (status 403)");
        assert!(!sanitized.contains("ghp_secret"));
        assert!(!sanitized.contains("https://api.github.com"));
        assert!(!sanitized.contains("acme"));
        assert!(!sanitized.contains("private"));
        assert!(!sanitized.contains("alice"));
        assert!(!sanitized.contains("body mentions"));
    }

    #[test]
    fn sanitized_log_message_redacts_network_and_parse_messages() {
        let network = GitHubError::NetworkError(
            "request to https://api.github.com/repos/acme/private failed with token ghp_secret"
                .to_string(),
        );
        let parse = GitHubError::ParseError(
            "invalid JSON body for owner acme repo private user alice".to_string(),
        );

        assert_eq!(network.sanitized_log_message(), "GitHub network error");
        assert_eq!(parse.sanitized_log_message(), "GitHub parse error");
    }
}
