//! GitHub PR Comment Poller
//!
//! Background Tokio task that polls GitHub at a configurable interval for new PR comments,
//! inserts them into SQLite, and emits app events.
//!
//! ## Architecture
//! - Spawned as background task by the Electron sidecar HTTP runtime
//! - Reads GitHub token from secure storage
//! - Searches open Pull Requests authored by the configured GitHub token account
//! - Links authored PRs to Tasks when a unique Task ID appears in branch, title, or body
//! - For each project:
//!   - Gets all linked open PRs from pull_requests table
//!   - Fetches PR status from GitHub API (detects merged/closed PRs)
//!   - For each PR, fetches comments via GitHubClient::get_pr_comments()
//!   - Inserts NEW comments only (checks if comment id exists)
//!   - Emits `new-pr-comment` event with ticket_id and comment_id
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Parallelization
//! - All PRs in a project are polled concurrently using futures::future::join_all
//! - poll_single_pr() handles one PR: comments + CI (check_runs + combined_status in parallel)
//! - DB is locked once after all HTTP calls complete for batch writes
//! - last_polled_at timestamps are written after successful polls
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the polling loop)

mod common;
mod persistence;
mod poll_events;
mod poll_execution;
mod pr_execution;
mod pr_readiness;
mod review_sync;
mod scheduling;
mod sync_logging;

#[allow(unused_imports)]
pub use common::{GitHubEventTarget, ManualGithubSyncError, PollOutcome, PollResult};
pub use poll_execution::{
    poll_github_once_for_sidecar, refresh_task_github_status_for_sidecar,
    start_github_poller_for_sidecar,
};
#[allow(unused_imports)]
pub use scheduling::{decide_poll, PollContext, PollContextSnapshot, PollDecision, PollScope};

#[cfg(test)]
mod tests;
