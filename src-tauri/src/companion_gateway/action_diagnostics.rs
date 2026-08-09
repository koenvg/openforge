use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionTaskAction {
    Start,
    Delete,
    Complete,
}

impl CompanionTaskAction {
    fn from_path(path: &str) -> Option<(Self, &str)> {
        let segments = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        let ["companion", "v1", "tasks", task_id, action] = segments.as_slice() else {
            return None;
        };
        let action = match *action {
            "start" => Self::Start,
            "delete" => Self::Delete,
            "complete" => Self::Complete,
            _ => return None,
        };
        Some((action, task_id))
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Delete => "delete",
            Self::Complete => "complete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionTaskActionOutcome {
    Accepted,
    InvalidRequest,
    AuthorizationDenied,
    NotFound,
    Conflict,
    RateLimited,
    TemporarilyUnavailable,
}

impl CompanionTaskActionOutcome {
    fn from_status(status: StatusCode) -> Self {
        match status {
            status if status.is_success() => Self::Accepted,
            StatusCode::BAD_REQUEST | StatusCode::PAYLOAD_TOO_LARGE => Self::InvalidRequest,
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Self::AuthorizationDenied,
            StatusCode::NOT_FOUND => Self::NotFound,
            StatusCode::CONFLICT => Self::Conflict,
            StatusCode::TOO_MANY_REQUESTS => Self::RateLimited,
            _ => Self::TemporarilyUnavailable,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::InvalidRequest => "invalid_request",
            Self::AuthorizationDenied => "authorization_denied",
            Self::NotFound => "not_found",
            Self::Conflict => "conflict",
            Self::RateLimited => "rate_limited",
            Self::TemporarilyUnavailable => "temporarily_unavailable",
        }
    }
}

struct CompanionTaskActionDiagnostic {
    request_id: String,
    task_id: String,
    action: CompanionTaskAction,
    started_at: Instant,
}

impl CompanionTaskActionDiagnostic {
    fn from_path(path: &str) -> Option<Self> {
        let (action, task_id) = CompanionTaskAction::from_path(path)?;
        Some(Self {
            request_id: uuid::Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            action,
            started_at: Instant::now(),
        })
    }

    fn emit(self, status: StatusCode) {
        log::info!(
            "{}",
            self.render(
                CompanionTaskActionOutcome::from_status(status),
                self.started_at.elapsed(),
            )
        );
    }

    fn render(&self, outcome: CompanionTaskActionOutcome, elapsed: Duration) -> String {
        format!(
            "[companion_task_action] request_id={} task_id={} action={} outcome={} elapsed_ms={}",
            safe_identifier(&self.request_id),
            safe_identifier(&self.task_id),
            self.action.as_str(),
            outcome.as_str(),
            elapsed.as_millis(),
        )
    }
}

pub(super) async fn record_task_action(request: Request, next: Next) -> Response {
    let diagnostic = CompanionTaskActionDiagnostic::from_path(request.uri().path());
    let response = next.run(request).await;
    if let Some(diagnostic) = diagnostic {
        diagnostic.emit(response.status());
    }
    response
}

fn safe_identifier(value: &str) -> &str {
    const MAX_IDENTIFIER_LENGTH: usize = 128;

    if !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        value
    } else {
        "[redacted]"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_diagnostics_render_only_safe_bounded_metadata() {
        let diagnostic = CompanionTaskActionDiagnostic {
            request_id: "request-1".to_string(),
            task_id:
                "/Users/example/private-repository prompt handoff terminal provider bearer-secret"
                    .to_string(),
            action: CompanionTaskAction::Complete,
            started_at: Instant::now(),
        };

        let rendered = diagnostic.render(
            CompanionTaskActionOutcome::TemporarilyUnavailable,
            Duration::from_millis(17),
        );

        assert_eq!(
            rendered.split_whitespace().count(),
            6,
            "diagnostics have a fixed metadata-only shape",
        );
        for sensitive in [
            "bearer-secret",
            "/Users/example",
            "private-repository",
            "prompt",
            "handoff",
            "terminal",
            "provider",
        ] {
            assert!(
                !rendered.contains(sensitive),
                "diagnostics leaked sensitive value: {sensitive}",
            );
        }
        assert!(rendered.contains("task_id=[redacted]"));
        assert_eq!(
            CompanionTaskAction::from_path("/companion/v1/tasks/KVG-3034/start"),
            Some((CompanionTaskAction::Start, "KVG-3034")),
        );
    }
}
