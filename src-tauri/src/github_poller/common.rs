use crate::app_events::{publish_app_event, AppEventSender};
use serde::{Deserialize, Serialize};

pub struct GitHubEventTarget {
    app_event_tx: Option<AppEventSender>,
}

impl GitHubEventTarget {
    pub fn sidecar(app_event_tx: Option<AppEventSender>) -> Self {
        Self { app_event_tx }
    }

    pub(super) fn emit(&self, event_name: &str, payload: serde_json::Value) {
        publish_app_event(&self.app_event_tx, event_name, &payload);
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PollOutcome {
    #[default]
    Completed,
    MissingGithubToken,
    GithubTokenUnavailable,
    Failed,
    RateLimited,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManualGithubSyncError {
    MissingToken,
    TokenUnavailable,
    PollErrors { count: usize },
    RateLimited { reset_at: Option<i64> },
}

/// Result of a single GitHub polling cycle.
///
/// Returned by `poll_github_once()` and used by callers to observe what
/// happened during the cycle (e.g. for IPC responses or logging).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollResult {
    /// Number of new PR comments inserted into the database this cycle.
    pub new_comments: usize,
    /// Number of CI status changes detected this cycle (reserved for Task 3).
    pub ci_changes: usize,
    /// Number of review status changes detected this cycle (reserved for Task 3).
    pub review_changes: usize,
    /// Number of PR state changes (open/closed/merged) detected this cycle (reserved for Task 3).
    pub pr_changes: usize,
    /// Number of errors encountered during this cycle.
    pub errors: usize,
    /// Whether the GitHub API rate limit was exceeded during this cycle.
    #[serde(default)]
    pub rate_limited: bool,
    /// Unix timestamp when the rate limit resets, if rate_limited is true.
    #[serde(default)]
    pub rate_limit_reset_at: Option<i64>,
    /// Overall outcome used by explicit refresh callers to distinguish a real sync from a no-op or partial failure.
    #[serde(default)]
    pub outcome: PollOutcome,
}

impl PollResult {
    pub(super) fn empty() -> Self {
        Self {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
            outcome: PollOutcome::Completed,
        }
    }

    pub(super) fn with_outcome(outcome: PollOutcome) -> Self {
        Self {
            outcome,
            ..Self::empty()
        }
    }

    pub(super) fn absorb(&mut self, other: PollResult) {
        self.new_comments += other.new_comments;
        self.ci_changes += other.ci_changes;
        self.review_changes += other.review_changes;
        self.pr_changes += other.pr_changes;
        self.errors += other.errors;
        self.rate_limited |= other.rate_limited;
        self.rate_limit_reset_at = other.rate_limit_reset_at.or(self.rate_limit_reset_at);
        if outcome_priority(other.outcome) > outcome_priority(self.outcome) {
            self.outcome = other.outcome;
        }
    }

    pub(crate) fn manual_sync_error(&self) -> Option<ManualGithubSyncError> {
        match self.outcome {
            PollOutcome::MissingGithubToken => Some(ManualGithubSyncError::MissingToken),
            PollOutcome::GithubTokenUnavailable => Some(ManualGithubSyncError::TokenUnavailable),
            PollOutcome::RateLimited => Some(ManualGithubSyncError::RateLimited {
                reset_at: self.rate_limit_reset_at,
            }),
            _ if self.rate_limited => Some(ManualGithubSyncError::RateLimited {
                reset_at: self.rate_limit_reset_at,
            }),
            PollOutcome::Failed => Some(ManualGithubSyncError::PollErrors { count: self.errors }),
            _ if self.errors > 0 => Some(ManualGithubSyncError::PollErrors { count: self.errors }),
            PollOutcome::Completed => None,
        }
    }
}

fn outcome_priority(outcome: PollOutcome) -> u8 {
    match outcome {
        PollOutcome::Completed => 0,
        PollOutcome::Failed => 1,
        PollOutcome::RateLimited => 2,
        PollOutcome::GithubTokenUnavailable => 3,
        PollOutcome::MissingGithubToken => 4,
    }
}

pub(super) fn parse_github_timestamp(timestamp: &str) -> Option<i64> {
    use chrono::{DateTime, Utc};
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

pub(super) fn json_value_for_event<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}
