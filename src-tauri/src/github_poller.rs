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
//! - last_polled_at timestamps are read before HTTP calls and written after
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the polling loop)
//! - Individual PR errors don't stop the batch
//! - Network errors trigger retry on next cycle
//! - Skips GitHub syncing when no token is configured

use crate::app_events::{publish_app_event, AppEventSender};
use crate::db::{
    build_merge_readiness_facts, ci_status_for_readiness, enforce_actor_scoped_readiness,
    finalize_readiness_facts_for_poll, needs_rest_ci_for_snapshot, queued_validation_sha,
    review_status_for_readiness, select_snapshot_readiness_inputs, Database, MergeReadinessInputs,
    PrMergeReadinessFacts, PrRow, ProjectRow,
};
use crate::github_client::{
    aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required,
    CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubReadinessSnapshot, PrComment,
    PrReview,
};
use futures::future::join_all;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::time::{sleep, Duration};

const DEFAULT_GITHUB_POLL_INTERVAL_SECS: u64 = 60;
const MIN_GITHUB_POLL_INTERVAL_SECS: u64 = 15;
const MAX_GITHUB_POLL_INTERVAL_SECS: u64 = 300;

#[derive(Clone, Default)]
pub struct GitHubEventTarget {
    app_event_tx: Option<AppEventSender>,
}

impl GitHubEventTarget {
    pub fn sidecar(app_event_tx: Option<AppEventSender>) -> Self {
        Self { app_event_tx }
    }

    fn emit(&self, event_name: &str, payload: serde_json::Value) -> Result<(), String> {
        publish_app_event(&self.app_event_tx, event_name, &payload);
        Ok(())
    }
}

// ============================================================================
// PollResult
// ============================================================================

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
}

fn parse_poll_interval_seconds(raw: Option<String>) -> u64 {
    raw.and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(MIN_GITHUB_POLL_INTERVAL_SECS, MAX_GITHUB_POLL_INTERVAL_SECS))
        .unwrap_or(DEFAULT_GITHUB_POLL_INTERVAL_SECS)
}

fn current_unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn rate_limit_sleep_duration_secs(poll_interval: u64, reset_at: Option<i64>, now: i64) -> u64 {
    let Some(reset_at) = reset_at else {
        return poll_interval;
    };

    let seconds_until_reset = reset_at.saturating_sub(now);
    if seconds_until_reset <= 0 {
        poll_interval
    } else {
        poll_interval.max(seconds_until_reset as u64 + 1)
    }
}

// ============================================================================
// Poll context & scope
// ============================================================================

/// Snapshot of the runtime poll context reported by the frontend.
///
/// Drives two efficiency behaviors:
/// - Focus-gating: when the app window is unfocused/hidden, polling is skipped
///   entirely so a backgrounded app makes zero GitHub calls.
/// - View-scoped polling: when the per-repo PR view is active, only the active
///   project's PRs are polled (collapsing the per-PR detail fan-out); the global
///   PR view opts back into polling every project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollContextSnapshot {
    /// Whether the frontend has reported context at least once. Until it has, the
    /// poller falls back to the pre-feature behavior (poll everything) so polling
    /// never silently stops if the frontend is slow or fails to report.
    pub reported: bool,
    pub focused: bool,
    pub active_project_id: Option<String>,
    pub global_view_open: bool,
}

impl Default for PollContextSnapshot {
    fn default() -> Self {
        Self {
            reported: false,
            focused: true,
            active_project_id: None,
            global_view_open: false,
        }
    }
}

/// Shared, cloneable handle to the runtime poll context.
///
/// The frontend updates it via the `set_poll_context` command; the poller loop
/// reads a snapshot each cycle. Follows the same shared-handle pattern as
/// `TaskClaims`.
#[derive(Clone, Default)]
pub struct PollContext {
    inner: Arc<Mutex<PollContextSnapshot>>,
}

impl PollContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&self, focused: bool, active_project_id: Option<String>, global_view_open: bool) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.reported = true;
            guard.focused = focused;
            guard.active_project_id = active_project_id;
            guard.global_view_open = global_view_open;
        }
    }

    pub fn snapshot(&self) -> PollContextSnapshot {
        self.inner.lock().map(|g| g.clone()).unwrap_or_default()
    }
}

/// Which repositories and PR lists a polling cycle should cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollScope {
    /// Poll every project + unscoped searches (used by manual "sync now" and
    /// as the pre-context fallback).
    Global,
    /// Poll only the active project's repo. Preserved for existing poll-context
    /// callers and tests; the background scheduler uses the finer-grained task
    /// PR scopes below.
    #[allow(dead_code)]
    ActiveRepo(Option<String>),
    /// Poll Focus-column task-linked PRs in the active project.
    ActiveFocusTaskPrs(Option<String>),
    /// Poll non-Focus task-linked PRs in the active project.
    ActiveTaskPrs(Option<String>),
    /// Poll task-linked PRs outside the active project.
    InactiveTaskPrs(Option<String>),
    /// Poll global review/authored PR-list data without the per-task PR fan-out.
    GlobalReviewLists,
}

#[derive(Debug, Clone)]
pub struct ScheduledPr {
    pr: PrRow,
    project_id: String,
    task_status: String,
    low_fire: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PollSchedulerSnapshot {
    linked_prs: Vec<ScheduledPr>,
    rate_limited: bool,
    rate_limit_reset_at: Option<i64>,
    global_review_due: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollPlan {
    scopes: Vec<PollScope>,
    sleep_secs: u64,
}

impl PollResult {
    fn empty() -> Self {
        Self {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        }
    }

    fn absorb(&mut self, other: PollResult) {
        self.new_comments += other.new_comments;
        self.ci_changes += other.ci_changes;
        self.review_changes += other.review_changes;
        self.pr_changes += other.pr_changes;
        self.errors += other.errors;
        self.rate_limited |= other.rate_limited;
        self.rate_limit_reset_at = other.rate_limit_reset_at.or(self.rate_limit_reset_at);
    }
}

impl PollScope {
    fn polls_task_prs(&self) -> bool {
        !matches!(self, Self::GlobalReviewLists)
    }

    fn polls_global_lists(&self) -> bool {
        matches!(self, Self::Global | Self::GlobalReviewLists)
    }

    fn refreshes_task_links(&self) -> bool {
        matches!(self, Self::Global | Self::GlobalReviewLists)
    }
}

fn is_focus_task_status(status: &str) -> bool {
    !matches!(status, "backlog" | "done")
}

fn is_pending_readiness(pr: &ScheduledPr) -> bool {
    matches!(
        pr.pr.ci_status.as_deref(),
        Some("pending" | "queued" | "running" | "in_progress")
    ) || matches!(
        pr.pr.merge_readiness_status.as_deref(),
        Some("pending" | "checking" | "unknown")
    ) || pr.pr.is_queued
}
fn is_settled_readiness(pr: &ScheduledPr) -> bool {
    matches!(
        pr.pr.ci_status.as_deref(),
        Some("success" | "failure" | "none")
    ) && matches!(
        pr.pr.merge_readiness_status.as_deref(),
        Some("ready" | "mergeable")
    )
}

fn scope_has_matches(scope: &PollScope, prs: &[ScheduledPr]) -> bool {
    prs.iter().any(|pr| scheduled_pr_in_scope(pr, scope))
}

fn scheduled_pr_in_scope(pr: &ScheduledPr, scope: &PollScope) -> bool {
    match scope {
        PollScope::Global | PollScope::ActiveRepo(_) => true,
        PollScope::GlobalReviewLists => false,
        PollScope::ActiveFocusTaskPrs(Some(active_project_id)) => {
            pr.project_id == *active_project_id
                && is_focus_task_status(&pr.task_status)
                && !pr.low_fire
        }
        PollScope::ActiveTaskPrs(Some(active_project_id)) => {
            pr.project_id == *active_project_id
                && (!is_focus_task_status(&pr.task_status) || pr.low_fire)
        }
        PollScope::InactiveTaskPrs(Some(active_project_id)) => pr.project_id != *active_project_id,
        PollScope::ActiveFocusTaskPrs(None)
        | PollScope::ActiveTaskPrs(None)
        | PollScope::InactiveTaskPrs(None) => false,
    }
}

fn build_poll_plan(
    ctx: &PollContextSnapshot,
    snapshot: PollSchedulerSnapshot,
    poll_interval: u64,
    now: i64,
) -> PollPlan {
    if snapshot.rate_limited {
        return PollPlan {
            scopes: Vec::new(),
            sleep_secs: rate_limit_sleep_duration_secs(
                poll_interval,
                snapshot.rate_limit_reset_at,
                now,
            ),
        };
    }

    if ctx.reported && !ctx.focused {
        return PollPlan {
            scopes: Vec::new(),
            sleep_secs: MAX_GITHUB_POLL_INTERVAL_SECS,
        };
    }

    if !ctx.reported {
        return PollPlan {
            scopes: vec![PollScope::Global],
            sleep_secs: poll_interval,
        };
    }

    let active_project_id = ctx.active_project_id.clone();
    let candidate_scopes = vec![
        PollScope::ActiveFocusTaskPrs(active_project_id.clone()),
        PollScope::ActiveTaskPrs(active_project_id.clone()),
        PollScope::InactiveTaskPrs(active_project_id),
        PollScope::GlobalReviewLists,
    ];

    let mut scopes: Vec<PollScope> = candidate_scopes
        .into_iter()
        .filter(|scope| {
            (matches!(scope, PollScope::GlobalReviewLists) && snapshot.global_review_due)
                || scope_has_matches(scope, &snapshot.linked_prs)
        })
        .collect();

    if scopes.is_empty() && ctx.global_view_open && snapshot.global_review_due {
        scopes.push(PollScope::GlobalReviewLists);
    }

    let has_pending = snapshot.linked_prs.iter().any(is_pending_readiness);
    let has_settled = snapshot.linked_prs.iter().any(is_settled_readiness);
    let sleep_secs = if has_pending {
        MIN_GITHUB_POLL_INTERVAL_SECS
    } else if has_settled {
        (poll_interval * 2).clamp(MIN_GITHUB_POLL_INTERVAL_SECS, MAX_GITHUB_POLL_INTERVAL_SECS)
    } else {
        poll_interval
    };

    PollPlan { scopes, sleep_secs }
}

/// What the loop should do for a given cycle, derived from the poll context.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollDecision {
    /// App is unfocused/hidden — skip the cycle entirely (no GitHub calls).
    Skip,
    /// Run a polling cycle with the given scope.
    Poll(PollScope),
}

/// Pure decision: given the current context, decide whether/how to poll.
#[allow(dead_code)]
pub fn decide_poll(ctx: &PollContextSnapshot) -> PollDecision {
    // Before the frontend reports, preserve the pre-feature behavior (poll all).
    if !ctx.reported {
        return PollDecision::Poll(PollScope::Global);
    }
    if !ctx.focused {
        return PollDecision::Skip;
    }
    if ctx.global_view_open {
        PollDecision::Poll(PollScope::Global)
    } else {
        PollDecision::Poll(PollScope::ActiveRepo(ctx.active_project_id.clone()))
    }
}

/// Pure project selection: which projects to poll for the given scope.
fn select_projects(all: Vec<ProjectRow>, scope: &PollScope) -> Vec<ProjectRow> {
    match scope {
        PollScope::Global => all,
        PollScope::GlobalReviewLists => Vec::new(),
        PollScope::ActiveRepo(None)
        | PollScope::ActiveFocusTaskPrs(None)
        | PollScope::ActiveTaskPrs(None) => Vec::new(),
        PollScope::ActiveRepo(Some(id))
        | PollScope::ActiveFocusTaskPrs(Some(id))
        | PollScope::ActiveTaskPrs(Some(id)) => all.into_iter().filter(|p| &p.id == id).collect(),
        PollScope::InactiveTaskPrs(None) => all,
        PollScope::InactiveTaskPrs(Some(id)) => all.into_iter().filter(|p| &p.id != id).collect(),
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Execute a single GitHub polling cycle.
///
/// Reads the GitHub token from secure storage, iterates all projects, syncs open
/// PRs, polls comments and CI status for each PR, and polls review-requested
/// PRs. All event emissions happen inside this function exactly as they did in
/// the original loop body.
///
/// The caller is responsible for creating and owning the `GitHubClient` so that
/// ETag caching (added in Task 2) persists across cycles in the background loop
/// while still allowing a fresh client to be used from a Tauri command.
///
/// # Arguments
/// * `github_client` - Shared GitHub API client (caller owns lifetime)
pub async fn poll_github_once_for_sidecar(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    app_event_tx: Option<AppEventSender>,
    scope: PollScope,
) -> PollResult {
    let events = GitHubEventTarget::sidecar(app_event_tx);
    poll_github_once_with_state(db, github_client, &events, &scope).await
}

async fn poll_github_once_with_state(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    events: &GitHubEventTarget,
    scope: &PollScope,
) -> PollResult {
    let cycle_start = Instant::now();
    github_client.clear_rate_limit_reset();

    let github_token = crate::secure_store::get_secret("github_token")
        .unwrap_or(None)
        .unwrap_or_default();

    if github_token.is_empty() {
        return PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };
    }

    let projects = {
        let db_lock = db.lock().unwrap();
        db_lock.get_all_projects()
    };

    let projects = match projects {
        Ok(projects) => projects,
        Err(e) => {
            error!("[GitHub Poller] Failed to get projects: {}", e);
            return PollResult {
                new_comments: 0,
                ci_changes: 0,
                review_changes: 0,
                pr_changes: 0,
                errors: 1,
                rate_limited: false,
                rate_limit_reset_at: None,
            };
        }
    };

    if projects.is_empty() && scope.polls_task_prs() {
        return PollResult::empty();
    }

    let projects = select_projects(projects, scope);

    debug!(
        "[GitHub Poller] Polling {} projects for PR updates (scope={:?})...",
        projects.len(),
        scope
    );

    let project_count = projects.len();
    let mut total_new_comments = 0;
    let mut total_ci_changes = 0;
    let mut total_review_changes = 0;
    let mut total_errors = 0;
    let mut rate_limit_count = 0;

    if scope.refreshes_task_links() {
        let sync_start = Instant::now();
        if let Err(e) = sync_authored_task_prs(github_client, &db, &github_token).await {
            error!("[GitHub Poller] Failed to sync authored task PRs: {}", e);
            total_errors += 1;
            if e.should_increment_rate_limit_count() {
                rate_limit_count += 1;
            }
        }
        debug!(
            "[GitHub Poller] Sync authored task PRs took {:.1}s",
            sync_start.elapsed().as_secs_f64()
        );
    }

    let configured_github_username = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_username").ok().flatten()
    };

    if scope.polls_task_prs() {
        for project in projects {
            let open_prs = match get_scheduled_prs_for_project(&db, &project.id) {
                Ok(prs) => prs
                    .into_iter()
                    .filter(|pr| scheduled_pr_in_scope(pr, scope))
                    .map(|pr| pr.pr)
                    .collect(),
                Err(e) => {
                    error!(
                        "[GitHub Poller] Failed to get PRs for project {}: {}",
                        project.id, e
                    );
                    total_errors += 1;
                    continue;
                }
            };

            let poll_start = Instant::now();
            let (new_comments, ci_changes, review_changes, errors) = poll_prs_for_project(
                github_client,
                &db,
                events,
                &github_token,
                configured_github_username.as_deref(),
                open_prs,
                &[],
            )
            .await;
            debug!(
                "[GitHub Poller] PR polling for project {} took {:.1}s",
                project.id,
                poll_start.elapsed().as_secs_f64()
            );
            total_new_comments += new_comments;
            total_ci_changes += ci_changes;
            total_review_changes += review_changes;
            total_errors += errors;
        }
    }

    if total_new_comments > 0 || total_errors > 0 {
        info!(
            "[GitHub Poller] Found {} new comments ({} errors)",
            total_new_comments, total_errors
        );
    }

    if scope.polls_global_lists() {
        let review_start = Instant::now();
        count_poll_phase_error(
            "review PRs",
            poll_review_prs(github_client, &db, events, &github_token).await,
            &mut total_errors,
            &mut rate_limit_count,
        );
        debug!(
            "[GitHub Poller] Review PR polling took {:.1}s",
            review_start.elapsed().as_secs_f64()
        );

        let authored_start = Instant::now();
        count_poll_phase_error(
            "authored PRs",
            poll_authored_prs(github_client, &db, events, &github_token).await,
            &mut total_errors,
            &mut rate_limit_count,
        );
        debug!(
            "[GitHub Poller] Authored PR polling took {:.1}s",
            authored_start.elapsed().as_secs_f64()
        );
    }

    let rate_limit_reset = github_client.get_last_rate_limit_reset();
    let rate_limited = rate_limit_reset.is_some() || rate_limit_count > 0;

    debug!(
        "[GitHub Poller] Cycle completed in {:.1}s ({} projects, {} new comments, {} CI changes, {} review changes, {} errors, rate_limited={}, reset_at={})",
        cycle_start.elapsed().as_secs_f64(),
        project_count,
        total_new_comments,
        total_ci_changes,
        total_review_changes,
        total_errors,
        rate_limited,
        rate_limit_reset.map(|ts| ts.to_string()).unwrap_or_else(|| "none".to_string())
    );

    if rate_limited {
        let has_changes =
            total_new_comments > 0 || total_ci_changes > 0 || total_review_changes > 0;

        if has_changes {
            warn!(
                "[GitHub Poller] Rate limit detected BUT cycle has changes: {} new comments, {} CI changes, {} review changes",
                total_new_comments, total_ci_changes, total_review_changes
            );
        } else if let Some(reset_at) = rate_limit_reset {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            let seconds_until_reset = (reset_at - now).max(0);

            warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (resets in {} seconds)",
                seconds_until_reset
            );
        } else {
            warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (reset time unknown)"
            );
        }
    }

    PollResult {
        new_comments: total_new_comments,
        ci_changes: total_ci_changes,
        review_changes: total_review_changes,
        pr_changes: 0,
        errors: total_errors,
        rate_limited,
        rate_limit_reset_at: rate_limit_reset,
    }
}

/// Start the GitHub poller background task.
///
/// Runs indefinitely: reads the poll interval from the database, calls
/// `poll_github_once_for_sidecar()`, then sleeps. The `GitHubClient` is created once and
/// reused across cycles so that ETag caching persists.
///
pub async fn start_github_poller_for_sidecar(
    db: Arc<Mutex<Database>>,
    github_client: GitHubClient,
    app_event_tx: Option<AppEventSender>,
    poll_context: PollContext,
) {
    let events = GitHubEventTarget::sidecar(app_event_tx);
    start_github_poller_with_state(db, github_client, events, poll_context).await;
}

async fn start_github_poller_with_state(
    db: Arc<Mutex<Database>>,
    github_client: GitHubClient,
    events: GitHubEventTarget,
    poll_context: PollContext,
) {
    let mut last_global_review_at = 0;

    loop {
        let poll_interval = {
            let db_lock = db.lock().unwrap();
            parse_poll_interval_seconds(db_lock.get_config("github_poll_interval").ok().flatten())
        };

        let now = current_unix_timestamp();
        let global_review_interval = (poll_interval * 4) as i64;
        let global_review_due = now.saturating_sub(last_global_review_at) >= global_review_interval;
        let scheduler_snapshot = poll_scheduler_snapshot(&db, false, None, global_review_due);
        let plan = build_poll_plan(
            &poll_context.snapshot(),
            scheduler_snapshot,
            poll_interval,
            now,
        );

        if plan.scopes.is_empty() {
            debug!(
                "[GitHub Poller] No GitHub sync scopes due; sleeping {}s",
                plan.sleep_secs
            );
            sleep(Duration::from_secs(plan.sleep_secs)).await;
            continue;
        }

        let ran_global_review = plan.scopes.iter().any(PollScope::polls_global_lists);
        let mut result = PollResult::empty();
        for scope in plan.scopes {
            let scope_result =
                poll_github_once_with_state(db.clone(), &github_client, &events, &scope).await;
            let stop_for_rate_limit = scope_result.rate_limited;
            result.absorb(scope_result);
            if stop_for_rate_limit {
                break;
            }
        }

        let has_changes = result.new_comments > 0
            || result.ci_changes > 0
            || result.review_changes > 0
            || result.pr_changes > 0;

        if has_changes {
            if let Err(e) = events.emit("github-sync-complete", json_value_for_event(&result)) {
                warn!("[GitHub Poller] Failed to emit github-sync-complete: {}", e);
            }
        }

        if result.rate_limited {
            if let Err(e) = events.emit(
                "github-rate-limited",
                serde_json::json!({
                    "reset_at": result.rate_limit_reset_at
                }),
            ) {
                warn!("[GitHub Poller] Failed to emit github-rate-limited: {}", e);
            }
        }

        if ran_global_review {
            last_global_review_at = current_unix_timestamp();
        }

        let sleep_secs = if result.rate_limited {
            rate_limit_sleep_duration_secs(
                poll_interval,
                result.rate_limit_reset_at,
                current_unix_timestamp(),
            )
        } else {
            plan.sleep_secs
        };
        sleep(Duration::from_secs(sleep_secs)).await;
    }
}

fn json_value_for_event<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

fn poll_scheduler_snapshot(
    db: &Mutex<Database>,
    rate_limited: bool,
    rate_limit_reset_at: Option<i64>,
    global_review_due: bool,
) -> PollSchedulerSnapshot {
    let projects = {
        let db_lock = db.lock().unwrap();
        db_lock.get_all_projects()
    };

    let linked_prs = match projects {
        Ok(projects) => projects
            .into_iter()
            .filter_map(|project| get_scheduled_prs_for_project(db, &project.id).ok())
            .flatten()
            .collect(),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to build scheduler project snapshot: {}",
                e
            );
            Vec::new()
        }
    };

    PollSchedulerSnapshot {
        linked_prs,
        rate_limited,
        rate_limit_reset_at,
        global_review_due,
    }
}

fn get_scheduled_prs_for_project(
    db: &Mutex<Database>,
    project_id: &str,
) -> Result<Vec<ScheduledPr>, String> {
    let db_lock = db.lock().unwrap();
    let all_open_prs = db_lock.get_open_prs().map_err(|e| e.to_string())?;

    let tasks = db_lock
        .get_tasks_for_project(project_id)
        .map_err(|e| e.to_string())?;

    let task_rows = tasks;
    let low_fire_task_ids: HashSet<String> = db_lock
        .get_project_config(project_id, "low_fire_task_ids")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .collect();
    let task_statuses: HashMap<String, (String, bool)> = task_rows
        .into_iter()
        .map(|task| {
            let low_fire = low_fire_task_ids.contains(&task.id);
            (task.id, (task.status, low_fire))
        })
        .collect();

    Ok(all_open_prs
        .into_iter()
        .filter_map(|pr| {
            task_statuses
                .get(&pr.ticket_id)
                .map(|(status, low_fire)| ScheduledPr {
                    pr,
                    project_id: project_id.to_string(),
                    task_status: status.clone(),
                    low_fire: *low_fire,
                })
        })
        .collect())
}

fn should_fetch_comments_for_pr(pr_id: i64, changed_pr_numbers: &HashSet<i64>) -> bool {
    changed_pr_numbers.is_empty() || changed_pr_numbers.contains(&pr_id)
}

#[derive(Debug)]
enum PollPhaseError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl PollPhaseError {
    fn should_increment_rate_limit_count(&self) -> bool {
        matches!(
            self,
            Self::GitHub(crate::github_client::GitHubError::ApiError { status: 429, .. })
        )
    }
}

impl fmt::Display for PollPhaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GitHub(error) => write!(f, "{}", error),
            Self::Db(message) => f.write_str(message),
        }
    }
}

#[derive(Debug)]
enum SyncOpenPrsError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl SyncOpenPrsError {
    fn should_increment_rate_limit_count(&self) -> bool {
        matches!(
            self,
            Self::GitHub(crate::github_client::GitHubError::ApiError { status: 429, .. })
        )
    }
}

impl fmt::Display for SyncOpenPrsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Db(message) => f.write_str(message),
            Self::GitHub(error) => write!(f, "{}", error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum StaleAuthoredPrTerminalState {
    Closed,
    Merged(Option<i64>),
}

fn stale_authored_task_pr_candidates(open_prs: Vec<PrRow>, open_search_ids: &[i64]) -> Vec<PrRow> {
    let open_search_ids: HashSet<i64> = open_search_ids.iter().copied().collect();
    open_prs
        .into_iter()
        .filter(|pr| !open_search_ids.contains(&pr.id))
        .collect()
}

fn terminal_state_for_stale_authored_pr(
    details: &crate::github_client::PullRequest,
) -> Option<StaleAuthoredPrTerminalState> {
    let state = details.state.to_ascii_lowercase();
    if state == "open" {
        return None;
    }

    let merged_at = details
        .extra
        .get("merged_at")
        .and_then(|value| value.as_str())
        .and_then(parse_github_timestamp);
    let merged = details
        .extra
        .get("merged")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        || merged_at.is_some();

    match state.as_str() {
        "closed" if merged => Some(StaleAuthoredPrTerminalState::Merged(merged_at)),
        "closed" => Some(StaleAuthoredPrTerminalState::Closed),
        "merged" => Some(StaleAuthoredPrTerminalState::Merged(merged_at)),
        _ => None,
    }
}

async fn reconcile_stale_authored_task_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
    open_search_ids: &[i64],
) -> Result<usize, SyncOpenPrsError> {
    let candidates = {
        let db_lock = db.lock().unwrap();
        let open_prs = db_lock
            .get_open_prs()
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get open PRs: {}", e)))?;
        stale_authored_task_pr_candidates(open_prs, open_search_ids)
    };

    let mut terminal_states = Vec::new();
    for pr in candidates {
        match github_client
            .get_pr_details(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token)
            .await
        {
            Ok(details) => {
                if let Some(terminal_state) = terminal_state_for_stale_authored_pr(&details) {
                    terminal_states.push((pr.id, terminal_state));
                }
            }
            Err(error) => warn!(
                "[GitHub Poller] Leaving stale authored PR {}/{} #{} open after failed detail fetch: {}",
                pr.repo_owner, pr.repo_name, pr.pr_number, error
            ),
        }
    }

    if terminal_states.is_empty() {
        return Ok(0);
    }

    let db_lock = db.lock().unwrap();
    let mut updated = 0;
    for (pr_id, terminal_state) in terminal_states {
        match terminal_state {
            StaleAuthoredPrTerminalState::Closed => db_lock
                .update_pr_closed(pr_id)
                .map_err(|e| SyncOpenPrsError::Db(format!("Failed to close stale PR: {}", e)))?,
            StaleAuthoredPrTerminalState::Merged(merged_at) => db_lock
                .update_pr_merged_state(pr_id, merged_at)
                .map_err(|e| {
                    SyncOpenPrsError::Db(format!("Failed to mark stale PR merged: {}", e))
                })?,
        }
        updated += 1;
    }

    Ok(updated)
}

async fn sync_authored_task_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
) -> Result<usize, SyncOpenPrsError> {
    let username = match read_or_fetch_github_username(github_client, db, github_token).await? {
        Some(username) => username,
        None => return Ok(0),
    };

    let (github_prs, all_search_ids) = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;

    let task_ids: Vec<String> = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_all_tasks()
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get task data: {}", e)))?
            .into_iter()
            .map(|task| task.id)
            .collect()
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut synced = 0;
    let should_reconcile_stale = !all_search_ids.is_empty() || github_prs.is_empty();
    {
        let db_lock = db.lock().unwrap();
        for pr in &github_prs {
            if let Some(task_id) =
                find_authoritative_task_id(&pr.title, &pr.head_ref, pr.body.as_deref(), &task_ids)
            {
                db_lock
                    .insert_pull_request_with_number(
                        pr.id,
                        pr.number,
                        &task_id,
                        &pr.repo_owner,
                        &pr.repo_name,
                        &pr.title,
                        &pr.html_url,
                        &pr.state,
                        now,
                        now,
                        pr.draft,
                    )
                    .map_err(|e| SyncOpenPrsError::Db(format!("Failed to upsert PR: {}", e)))?;
                db_lock
                    .update_pr_head_sha(pr.id, &pr.head_sha)
                    .map_err(|e| {
                        SyncOpenPrsError::Db(format!("Failed to update PR head SHA: {}", e))
                    })?;
                db_lock
                    .update_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                    .map_err(|e| {
                        SyncOpenPrsError::Db(format!("Failed to update PR mergeability: {}", e))
                    })?;
                synced += 1;
            }
        }
    }

    if should_reconcile_stale {
        reconcile_stale_authored_task_prs(github_client, db, github_token, &all_search_ids).await?;
    }

    Ok(synced)
}

async fn read_or_fetch_github_username(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    github_token: &str,
) -> Result<Option<String>, SyncOpenPrsError> {
    let username = github_client
        .get_authenticated_user(github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;
    {
        let db_lock = db.lock().unwrap();
        db_lock
            .set_config("github_username", &username)
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to cache GitHub username: {}", e)))?;
    }

    Ok(Some(username))
}

fn find_task_id_position(text: &str, task_id: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let pattern = task_id.as_bytes();
    let pat_len = pattern.len();
    if pat_len > bytes.len() {
        return None;
    }
    for i in 0..=(bytes.len() - pat_len) {
        if &bytes[i..i + pat_len] == pattern {
            // Check left boundary: must be start-of-string or non-alphanumeric
            if i > 0 && (bytes[i - 1] as char).is_alphanumeric() {
                continue;
            }
            // Check right boundary: must be end-of-string or non-digit
            let after = i + pat_len;
            if after < bytes.len() && (bytes[after] as char).is_ascii_digit() {
                continue;
            }
            return Some(i);
        }
    }
    None
}

fn contains_task_id(text: &str, task_id: &str) -> bool {
    find_task_id_position(text, task_id).is_some()
}

enum TaskMatchOutcome {
    None,
    Unique(String),
    Ambiguous,
}

fn classify_task_matches(text: &str, task_ids: &[String]) -> TaskMatchOutcome {
    let mut matched_task_ids = task_ids
        .iter()
        .filter(|task_id| contains_task_id(text, task_id.as_str()))
        .cloned();

    let Some(first_match) = matched_task_ids.next() else {
        return TaskMatchOutcome::None;
    };

    if matched_task_ids.next().is_some() {
        TaskMatchOutcome::Ambiguous
    } else {
        TaskMatchOutcome::Unique(first_match)
    }
}

fn find_authoritative_task_id(
    pr_title: &str,
    pr_branch: &str,
    pr_body: Option<&str>,
    task_ids: &[String],
) -> Option<String> {
    match classify_task_matches(pr_branch, task_ids) {
        TaskMatchOutcome::Unique(task_id) => Some(task_id),
        TaskMatchOutcome::Ambiguous => None,
        TaskMatchOutcome::None => match classify_task_matches(pr_title, task_ids) {
            TaskMatchOutcome::Unique(task_id) => Some(task_id),
            TaskMatchOutcome::Ambiguous => None,
            TaskMatchOutcome::None => {
                pr_body.and_then(|body| match classify_task_matches(body, task_ids) {
                    TaskMatchOutcome::Unique(task_id) => Some(task_id),
                    TaskMatchOutcome::Ambiguous | TaskMatchOutcome::None => None,
                })
            }
        },
    }
}

struct PollSinglePrResult {
    pr_id: i64,
    ticket_id: String,
    pr_title: String,
    /// PR source head SHA persisted on the pull_requests row.
    head_sha: String,
    /// SHA whose CI signals were evaluated; can be a merge-group SHA.
    ci_validation_sha: String,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    comments: Vec<PrComment>,
    check_runs: Option<CheckRunsResponse>,
    combined_status: Option<CombinedStatusResponse>,
    reviews: Option<Vec<PrReview>>,
    has_requested_reviewers: bool,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    is_queued: bool,
    required_check_names: Vec<String>,
    required_approving_count: Option<usize>,
    readiness_facts: PrMergeReadinessFacts,
    error: Option<String>,
}

struct RestReadinessSources {
    rest_ci_sha: String,
    check_runs: Option<CheckRunsResponse>,
    combined_status: Option<CombinedStatusResponse>,
    reviews: Option<Vec<PrReview>>,
    pr_details_result: Result<crate::github_client::PullRequest, crate::github_client::GitHubError>,
    has_requested_reviewers: bool,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    is_queued: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BranchPolicyInputs {
    required_check_names: Vec<String>,
    required_approving_count: Option<usize>,
    required_checks_policy_known: bool,
    required_reviews_policy_known: bool,
    requires_up_to_date_branch: bool,
    conversations_blocking: bool,
    merge_queue_required_by_policy: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CiPersistencePayload {
    pr_id: i64,
    /// PR source head SHA persisted on the pull_requests row.
    head_sha: String,
    /// SHA whose CI signals were evaluated; kept separate from the persisted PR head SHA.
    ci_validation_sha: String,
    status: String,
    check_runs_json: String,
    status_changed: bool,
}

#[derive(Debug, Default)]
struct PersistCommentsResult {
    new_comment_count: usize,
    failed_insert_count: usize,
}

fn persist_polled_comments(
    events: &GitHubEventTarget,
    db: &Database,
    result: &PollSinglePrResult,
    existing_ids: &HashSet<i64>,
    now: i64,
) -> PersistCommentsResult {
    let mut persist_result = PersistCommentsResult::default();
    let mut inserted_this_batch: HashSet<i64> = HashSet::new();

    for comment in &result.comments {
        if existing_ids.contains(&comment.id) || inserted_this_batch.contains(&comment.id) {
            continue;
        }

        let created_at = parse_github_timestamp(&comment.created_at).unwrap_or(now);

        if let Err(e) = db.insert_pr_comment(
            comment.id,
            result.pr_id,
            &comment.user.login,
            &comment.body,
            &comment.comment_type,
            comment.path.as_deref(),
            comment.line,
            false,
            created_at,
        ) {
            error!(
                "[GitHub Poller] Failed to insert comment {}: {}",
                comment.id, e
            );
            persist_result.failed_insert_count += 1;
            continue;
        }

        if let Err(e) = events.emit(
            "new-pr-comment",
            serde_json::json!({
                "ticket_id": result.ticket_id,
                "comment_id": comment.id
            }),
        ) {
            warn!("[GitHub Poller] Failed to emit new-pr-comment event: {}", e);
        }

        persist_result.new_comment_count += 1;
        inserted_this_batch.insert(comment.id);
    }

    persist_result
}

fn comment_fetch_error_result(
    pr: PrRow,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
    error: String,
) -> PollSinglePrResult {
    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: pr.title,
        head_sha: pr.head_sha.clone(),
        ci_validation_sha: pr.head_sha.clone(),
        old_ci_status,
        old_review_status,
        comments: vec![],
        check_runs: None,
        combined_status: None,
        reviews: None,
        has_requested_reviewers: false,
        mergeable: old_mergeable,
        mergeable_state: old_mergeable_state,
        is_queued: false,
        required_check_names: vec![],
        required_approving_count: None,
        readiness_facts: PrMergeReadinessFacts {
            status: None,
            action: None,
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some(pr.head_sha),
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        },
        error: Some(error),
    }
}

async fn fetch_pr_comments_for_poll(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    since: Option<&str>,
    fetch_comments: bool,
) -> Result<Vec<PrComment>, String> {
    if !fetch_comments {
        return Ok(Vec::new());
    }

    github_client
        .get_pr_comments(
            &pr.repo_owner,
            &pr.repo_name,
            pr.pr_number,
            github_token,
            since,
        )
        .await
        .map_err(|e| format!("Failed to fetch comments: {e}"))
}

async fn fetch_graphql_readiness_snapshot(
    github_client: &GitHubClient,
    pr: &PrRow,
    github_token: &str,
) -> Option<GitHubReadinessSnapshot> {
    match github_client
        .get_pr_readiness_snapshot(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token)
        .await
    {
        Ok(snapshot) if snapshot.source_head_sha.is_none() => {
            warn!(
                "[GitHub Poller] GraphQL readiness for PR #{} did not include a head SHA; using REST fallback",
                pr.pr_number
            );
            None
        }
        Ok(snapshot) if !snapshot.requires_rest_check_fallback() => Some(snapshot),
        Ok(snapshot) => {
            warn!(
                "[GitHub Poller] GraphQL readiness for PR #{} had stale or incomplete check rollup SHA; using REST fallback for checks",
                pr.pr_number
            );
            Some(snapshot)
        }
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch GraphQL readiness for PR #{}: {}",
                pr.pr_number, e
            );
            None
        }
    }
}

async fn collect_rest_readiness_sources(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
) -> RestReadinessSources {
    let needs_rest_ci = needs_rest_ci_for_snapshot(graphql_snapshot);
    let mut rest_ci_sha = graphql_snapshot
        .and_then(queued_validation_sha)
        .map(ToOwned::to_owned)
        .or_else(|| graphql_snapshot.and_then(|snapshot| snapshot.source_head_sha.clone()))
        .filter(|sha| !sha.is_empty())
        .unwrap_or_else(|| pr.head_sha.clone());
    let ci_sha_for_request = rest_ci_sha.clone();

    let ci_future = async {
        if !needs_rest_ci || ci_sha_for_request.is_empty() {
            (None, None)
        } else {
            let (check_runs, combined_status) = tokio::join!(
                github_client.get_check_runs(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &ci_sha_for_request,
                    github_token
                ),
                github_client.get_combined_status(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &ci_sha_for_request,
                    github_token
                )
            );
            (Some(check_runs), Some(combined_status))
        }
    };

    let reviews_future =
        github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token);
    let pr_details_future =
        github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.pr_number, github_token);

    let ((check_runs_result, combined_status_result), reviews_result, pr_details_result) =
        tokio::join!(ci_future, reviews_future, pr_details_future);

    let mut check_runs = check_runs_result.and_then(|result| match result {
        Ok(check_runs) => Some(check_runs),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch check runs for PR #{}: {}",
                pr.pr_number, e
            );
            None
        }
    });

    let mut combined_status = combined_status_result.and_then(|result| match result {
        Ok(combined_status) => Some(combined_status),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch combined status for PR #{}: {}",
                pr.pr_number, e
            );
            None
        }
    });

    if graphql_snapshot.is_none() {
        if let Ok(details) = &pr_details_result {
            if !details.head.sha.is_empty() && details.head.sha != rest_ci_sha {
                let (fresh_check_runs, fresh_combined_status) = tokio::join!(
                    github_client.get_check_runs(
                        &pr.repo_owner,
                        &pr.repo_name,
                        &details.head.sha,
                        github_token
                    ),
                    github_client.get_combined_status(
                        &pr.repo_owner,
                        &pr.repo_name,
                        &details.head.sha,
                        github_token
                    )
                );
                if let Ok(fresh_check_runs) = fresh_check_runs {
                    check_runs = Some(fresh_check_runs);
                }
                if let Ok(fresh_combined_status) = fresh_combined_status {
                    combined_status = Some(fresh_combined_status);
                }
                rest_ci_sha = details.head.sha.clone();
            }
        }
    }

    let reviews = match reviews_result {
        Ok(reviews) => Some(reviews),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch reviews for PR #{}: {}",
                pr.pr_number, e
            );
            None
        }
    };

    let has_requested_reviewers = match &pr_details_result {
        Ok(details) => has_requested_reviewers_from_details(details),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch PR details for PR #{}: {}",
                pr.pr_number, e
            );
            false
        }
    };
    let is_queued = pr_details_result
        .as_ref()
        .ok()
        .map(pr_is_queued_from_details)
        .unwrap_or(false);
    let (mergeable, mergeable_state) =
        mergeability_after_pr_details(&pr_details_result, old_mergeable, old_mergeable_state);

    RestReadinessSources {
        rest_ci_sha,
        check_runs,
        combined_status,
        reviews,
        pr_details_result,
        has_requested_reviewers,
        mergeable,
        mergeable_state,
        is_queued,
    }
}

fn non_empty_sha(value: Option<String>) -> Option<String> {
    value.filter(|sha| !sha.is_empty())
}

fn poll_result_pr_head_sha(
    pr: &PrRow,
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    rest_sources: &RestReadinessSources,
) -> String {
    graphql_snapshot
        .and_then(|snapshot| non_empty_sha(snapshot.source_head_sha.clone()))
        .or_else(|| {
            rest_sources
                .pr_details_result
                .as_ref()
                .ok()
                .and_then(|details| non_empty_sha(Some(details.head.sha.clone())))
        })
        .unwrap_or_else(|| pr.head_sha.clone())
}

fn poll_result_ci_validation_sha(
    graphql_inputs: Option<&MergeReadinessInputs>,
    rest_sources: &RestReadinessSources,
    fallback_pr_head_sha: &str,
) -> String {
    graphql_inputs
        .and_then(|inputs| non_empty_sha(inputs.source_head_sha.clone()))
        .or_else(|| non_empty_sha(Some(rest_sources.rest_ci_sha.clone())))
        .unwrap_or_else(|| fallback_pr_head_sha.to_string())
}

fn current_graphql_readiness_snapshot<'a>(
    graphql_snapshot: Option<&'a GitHubReadinessSnapshot>,
    result_head_sha: &str,
) -> Option<&'a GitHubReadinessSnapshot> {
    graphql_snapshot.filter(|snapshot| {
        snapshot
            .source_head_sha
            .as_deref()
            .is_some_and(|source| source == result_head_sha)
    })
}

fn current_graphql_review_status(
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    result_head_sha: &str,
    graphql_inputs: Option<&MergeReadinessInputs>,
) -> Option<String> {
    current_graphql_readiness_snapshot(graphql_snapshot, result_head_sha)
        .and_then(|snapshot| snapshot.review_status.clone())
        .or_else(|| graphql_inputs.and_then(|inputs| inputs.review_status.clone()))
}

fn current_graphql_mergeable_state<'a>(
    graphql_snapshot: Option<&'a GitHubReadinessSnapshot>,
    result_head_sha: &str,
    graphql_inputs: Option<&'a MergeReadinessInputs>,
) -> Option<&'a str> {
    current_graphql_readiness_snapshot(graphql_snapshot, result_head_sha)
        .and_then(|snapshot| snapshot.mergeable_state.as_deref())
        .or_else(|| graphql_inputs.and_then(|inputs| inputs.mergeable_state.as_deref()))
}

fn has_requested_reviewers_from_details(details: &crate::github_client::PullRequest) -> bool {
    details
        .extra
        .get("requested_reviewers")
        .and_then(|reviewers| reviewers.as_array())
        .map(|reviewers| !reviewers.is_empty())
        .unwrap_or(false)
        || details
            .extra
            .get("requested_teams")
            .and_then(|teams| teams.as_array())
            .map(|teams| !teams.is_empty())
            .unwrap_or(false)
}

fn pr_is_queued_from_details(details: &crate::github_client::PullRequest) -> bool {
    details
        .extra
        .get("merge_queue_entry")
        .map(|value| !value.is_null())
        .unwrap_or(false)
}

async fn collect_branch_policy_sources(
    github_client: &GitHubClient,
    github_token: &str,
    pr: &PrRow,
    pr_details_result: &Result<
        crate::github_client::PullRequest,
        crate::github_client::GitHubError,
    >,
) -> (
    crate::github_client::RequiredChecksPolicy,
    crate::github_client::RequiredReviewsPolicy,
) {
    match pr_details_result {
        Ok(details) => {
            let base_ref = details
                .extra
                .get("base")
                .and_then(|base| base.get("ref"))
                .and_then(|reference| reference.as_str())
                .unwrap_or("main");
            tokio::join!(
                github_client.get_required_status_checks_policy(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    github_token
                ),
                github_client.get_required_approving_review_policy(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    github_token
                )
            )
        }
        Err(_) => (
            crate::github_client::RequiredChecksPolicy::unknown(
                "PR details unavailable for branch protection lookup",
            ),
            crate::github_client::RequiredReviewsPolicy::unknown(
                "PR details unavailable for branch protection lookup",
            ),
        ),
    }
}

fn select_branch_policy_inputs(
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    rest_required_checks_policy: &crate::github_client::RequiredChecksPolicy,
    rest_required_reviews_policy: &crate::github_client::RequiredReviewsPolicy,
) -> BranchPolicyInputs {
    let required_check_names = graphql_snapshot
        .filter(|snapshot| snapshot.policy.required_checks.known)
        .map(|snapshot| snapshot.policy.required_checks.value.clone())
        .unwrap_or_else(|| rest_required_checks_policy.required_check_names.clone());
    let required_approving_count = graphql_snapshot
        .filter(|snapshot| snapshot.policy.required_reviews.known)
        .and_then(|snapshot| snapshot.policy.required_reviews.value)
        .or(rest_required_reviews_policy.required_approving_review_count);
    let required_checks_policy_known = graphql_snapshot
        .map(|snapshot| snapshot.policy.required_checks.known)
        .unwrap_or(false)
        || rest_required_checks_policy.known;
    let required_reviews_policy_known = graphql_snapshot
        .map(|snapshot| snapshot.policy.required_reviews.known)
        .unwrap_or(false)
        || rest_required_reviews_policy.known;
    let requires_up_to_date_branch = graphql_snapshot
        .filter(|snapshot| snapshot.policy.requires_up_to_date_branch.known)
        .and_then(|snapshot| snapshot.policy.requires_up_to_date_branch.value)
        .or(rest_required_checks_policy.requires_up_to_date_branch)
        .unwrap_or(false);
    let conversations_blocking = graphql_snapshot
        .filter(|snapshot| snapshot.policy.requires_conversation_resolution.known)
        .and_then(|snapshot| snapshot.policy.requires_conversation_resolution.value)
        .unwrap_or(false)
        && graphql_snapshot
            .and_then(|snapshot| snapshot.unresolved_conversations)
            .unwrap_or(false);
    let merge_queue_required_by_policy = graphql_snapshot
        .filter(|snapshot| snapshot.policy.merge_queue_required.known)
        .and_then(|snapshot| snapshot.policy.merge_queue_required.value)
        .unwrap_or(false);

    BranchPolicyInputs {
        required_check_names,
        required_approving_count,
        required_checks_policy_known,
        required_reviews_policy_known,
        requires_up_to_date_branch,
        conversations_blocking,
        merge_queue_required_by_policy,
    }
}

#[allow(clippy::too_many_arguments)]
async fn poll_single_pr(
    github_client: GitHubClient,
    github_token: String,
    configured_github_username: Option<String>,
    pr: PrRow,
    since: Option<String>,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
    fetch_comments: bool,
) -> PollSinglePrResult {
    let comments = match fetch_pr_comments_for_poll(
        &github_client,
        &github_token,
        &pr,
        since.as_deref(),
        fetch_comments,
    )
    .await
    {
        Ok(comments) => comments,
        Err(error) => {
            return comment_fetch_error_result(
                pr,
                old_ci_status,
                old_review_status,
                old_mergeable,
                old_mergeable_state,
                error,
            );
        }
    };

    let graphql_snapshot =
        fetch_graphql_readiness_snapshot(&github_client, &pr, &github_token).await;
    let rest_sources = collect_rest_readiness_sources(
        &github_client,
        &github_token,
        &pr,
        graphql_snapshot.as_ref(),
        old_mergeable,
        old_mergeable_state,
    )
    .await;
    let graphql_inputs = select_snapshot_readiness_inputs(&pr, graphql_snapshot.as_ref());
    let result_head_sha = poll_result_pr_head_sha(&pr, graphql_snapshot.as_ref(), &rest_sources);
    let ci_validation_sha =
        poll_result_ci_validation_sha(graphql_inputs.as_ref(), &rest_sources, &result_head_sha);

    let check_runs = graphql_inputs
        .as_ref()
        .map(|inputs| inputs.check_runs.clone())
        .or(rest_sources.check_runs);
    let combined_status = graphql_inputs
        .as_ref()
        .map(|inputs| inputs.combined_status.clone())
        .or(rest_sources.combined_status);

    let (rest_required_checks_policy, rest_required_reviews_policy) =
        collect_branch_policy_sources(
            &github_client,
            &github_token,
            &pr,
            &rest_sources.pr_details_result,
        )
        .await;
    let branch_policy_inputs = select_branch_policy_inputs(
        graphql_snapshot.as_ref(),
        &rest_required_checks_policy,
        &rest_required_reviews_policy,
    );

    let readiness_ci_status = ci_status_for_readiness(
        check_runs.as_ref(),
        combined_status.as_ref(),
        &branch_policy_inputs.required_check_names,
        old_ci_status.as_ref(),
    );
    let readiness_review_status = current_graphql_review_status(
        graphql_snapshot.as_ref(),
        &result_head_sha,
        graphql_inputs.as_ref(),
    )
    .or_else(|| {
        review_status_for_readiness(
            None,
            rest_sources.reviews.as_ref(),
            rest_sources.has_requested_reviewers,
            branch_policy_inputs.required_approving_count,
            old_review_status.as_ref(),
        )
    });
    let readiness_mergeable_state = current_graphql_mergeable_state(
        graphql_snapshot.as_ref(),
        &result_head_sha,
        graphql_inputs.as_ref(),
    )
    .or(rest_sources.mergeable_state.as_deref());
    let readiness_is_queued = graphql_snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.merge_queue_state.as_ref())
        .map(|_| true)
        .unwrap_or(rest_sources.is_queued);

    let mut readiness_facts = build_merge_readiness_facts(
        &pr,
        rest_sources.pr_details_result.as_ref().ok(),
        rest_sources.mergeable,
        readiness_mergeable_state,
        readiness_ci_status.as_deref(),
        readiness_review_status.as_deref(),
        readiness_is_queued,
        branch_policy_inputs.required_checks_policy_known,
        branch_policy_inputs.required_reviews_policy_known,
        branch_policy_inputs.requires_up_to_date_branch,
        branch_policy_inputs.conversations_blocking,
        None,
    );

    readiness_facts = finalize_readiness_facts_for_poll(
        readiness_facts,
        graphql_snapshot.as_ref(),
        &result_head_sha,
        readiness_is_queued,
        branch_policy_inputs.merge_queue_required_by_policy,
        0,
        0,
    );
    readiness_facts = enforce_actor_scoped_readiness(
        readiness_facts,
        rest_sources.pr_details_result.as_ref().ok(),
        configured_github_username.as_deref(),
    );

    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: pr.title,
        head_sha: result_head_sha,
        ci_validation_sha,
        old_ci_status,
        old_review_status,
        comments,
        check_runs,
        combined_status,
        reviews: rest_sources.reviews,
        has_requested_reviewers: rest_sources.has_requested_reviewers,
        mergeable: rest_sources.mergeable,
        mergeable_state: rest_sources.mergeable_state,
        is_queued: readiness_is_queued,
        required_check_names: branch_policy_inputs.required_check_names,
        required_approving_count: branch_policy_inputs.required_approving_count,
        readiness_facts,
        error: None,
    }
}

async fn poll_prs_for_project(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
    configured_github_username: Option<&str>,
    open_prs: Vec<PrRow>,
    changed_pr_numbers: &[i64],
) -> (usize, usize, usize, usize) {
    if open_prs.is_empty() {
        return (0, 0, 0, 0);
    }

    type PrMetadata = (
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
    );
    let pr_metadata: Vec<PrMetadata> = {
        let db_lock = db.lock().unwrap();
        open_prs
            .iter()
            .map(|pr| {
                let last_polled = db_lock.get_pr_last_polled(pr.id).ok().flatten();
                let old_ci = db_lock.get_pr_ci_status(pr.id).ok().flatten();
                let old_review = db_lock.get_pr_review_status(pr.id).ok().flatten();
                (
                    pr.id,
                    last_polled,
                    old_ci,
                    old_review,
                    pr.mergeable,
                    pr.mergeable_state.clone(),
                )
            })
            .collect()
    };

    let since_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, last_polled, _, _, _, _)| {
            let since = last_polled.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });
            (*pr_id, since)
        })
        .collect();

    let old_ci_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, old_ci, _, _, _)| (*pr_id, old_ci.clone()))
        .collect();

    let old_review_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, _, old_review, _, _)| (*pr_id, old_review.clone()))
        .collect();

    let old_mergeability_map: HashMap<i64, (Option<bool>, Option<String>)> = pr_metadata
        .into_iter()
        .map(|(pr_id, _, _, _, old_mergeable, old_mergeable_state)| {
            (pr_id, (old_mergeable, old_mergeable_state))
        })
        .collect();

    let changed_pr_numbers: HashSet<i64> = changed_pr_numbers.iter().copied().collect();

    let futures: Vec<_> = open_prs
        .into_iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            let since = since_map.get(&pr.id).cloned().flatten();
            let old_ci = old_ci_map.get(&pr.id).cloned().flatten();
            let old_review = old_review_map.get(&pr.id).cloned().flatten();
            let (old_mergeable, old_mergeable_state) = old_mergeability_map
                .get(&pr.id)
                .cloned()
                .unwrap_or((None, None));
            let fetch_comments = should_fetch_comments_for_pr(pr.pr_number, &changed_pr_numbers);
            let configured_github_username = configured_github_username.map(ToOwned::to_owned);
            poll_single_pr(
                client,
                token,
                configured_github_username,
                pr,
                since,
                old_ci,
                old_review,
                old_mergeable,
                old_mergeable_state,
                fetch_comments,
            )
        })
        .collect();

    let results = join_all(futures).await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut new_comment_count = 0;
    let mut ci_change_count = 0;
    let mut review_change_count = 0;
    let mut error_count = 0;

    let db_lock = db.lock().unwrap();

    for result in results {
        if let Some(err) = &result.error {
            error!(
                "[GitHub Poller] Failed to poll PR #{}: {}",
                result.pr_id, err
            );
            error_count += 1;
            continue;
        }

        let existing_ids = match db_lock.get_existing_comment_ids(result.pr_id) {
            Ok(ids) => ids,
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to get existing comment IDs for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
                continue;
            }
        };

        let persist_result = persist_polled_comments(events, &db_lock, &result, &existing_ids, now);
        new_comment_count += persist_result.new_comment_count;

        if let Some(ci_payload) = ci_persistence_payload(&result) {
            if let Err(e) = db_lock.update_pr_ci_status(
                ci_payload.pr_id,
                &ci_payload.head_sha,
                &ci_payload.status,
                &ci_payload.check_runs_json,
            ) {
                error!(
                    "[GitHub Poller] Failed to update CI status for PR #{}: {}",
                    result.pr_id, e
                );
            } else if ci_payload.status_changed {
                if let Err(e) = events.emit(
                    "ci-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "ci_status": ci_payload.status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit ci-status-changed event: {}",
                        e
                    );
                }
                ci_change_count += 1;
            }
        }

        if let Some(reviews) = &result.reviews {
            let review_status = aggregate_review_status(
                reviews,
                result.has_requested_reviewers,
                result.required_approving_count,
            );
            if let Err(e) = db_lock.update_pr_review_status(result.pr_id, &review_status) {
                error!(
                    "[GitHub Poller] Failed to update review status for PR #{}: {}",
                    result.pr_id, e
                );
            } else if result.old_review_status.as_deref() != Some(review_status.as_str()) {
                if let Err(e) = events.emit(
                    "review-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "review_status": review_status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit review-status-changed event: {}",
                        e
                    );
                }
                review_change_count += 1;
            }
        }

        if let Err(e) = db_lock.update_pr_is_queued(result.pr_id, result.is_queued) {
            error!(
                "[GitHub Poller] Failed to update is_queued for PR #{}: {}",
                result.pr_id, e
            );
        }

        if let Err(e) = db_lock.update_pr_mergeability(
            result.pr_id,
            result.mergeable,
            result.mergeable_state.as_deref(),
        ) {
            error!(
                "[GitHub Poller] Failed to update mergeability for PR #{}: {}",
                result.pr_id, e
            );
        }

        let readiness_facts = finalize_readiness_facts_for_poll(
            result.readiness_facts,
            None,
            &result.head_sha,
            result.is_queued,
            false,
            persist_result.new_comment_count,
            now,
        );
        if let Err(e) = db_lock.update_pr_merge_readiness(result.pr_id, &readiness_facts) {
            error!(
                "[GitHub Poller] Failed to update merge readiness for PR #{}: {}",
                result.pr_id, e
            );
        }

        if let Err(e) = db_lock.set_pr_last_polled(result.pr_id, now) {
            error!(
                "[GitHub Poller] Failed to set last_polled_at for PR #{}: {}",
                result.pr_id, e
            );
        }
    }

    drop(db_lock);

    (
        new_comment_count,
        ci_change_count,
        review_change_count,
        error_count,
    )
}

fn count_poll_phase_error(
    phase: &str,
    result: Result<(), PollPhaseError>,
    total_errors: &mut usize,
    rate_limit_count: &mut usize,
) {
    if let Err(e) = result {
        error!("[GitHub Poller] Failed to poll {}: {}", phase, e);
        *total_errors += 1;
        if e.should_increment_rate_limit_count() {
            *rate_limit_count += 1;
        }
    }
}

async fn poll_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_review_requested_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

    {
        let db_lock = db.lock().unwrap();
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let _ = db_lock.upsert_review_pr(
                pr.id,
                pr.number,
                &pr.title,
                pr.body.as_deref(),
                &pr.state,
                pr.draft,
                &pr.html_url,
                &pr.user_login,
                pr.user_avatar_url.as_deref(),
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_ref,
                &pr.base_ref,
                &pr.head_sha,
                pr.additions,
                pr.deletions,
                pr.changed_files,
                &pr.labels,
                created_at,
                updated_at,
            );
            let _ = db_lock.update_review_pr_mergeability(
                pr.id,
                pr.mergeable,
                pr.mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_review_prs(&all_search_ids);
        }
        let count = db_lock
            .get_all_review_prs()
            .map(|prs| prs.iter().filter(|p| p.viewed_at.is_none()).count())
            .unwrap_or(0);
        let _ = events.emit("review-pr-count-changed", serde_json::json!(count));
    }

    Ok(())
}

async fn poll_authored_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    events: &GitHubEventTarget,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

    type EnrichedPrData = (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
        bool,
    );
    let mut enriched: HashMap<i64, EnrichedPrData> = HashMap::with_capacity(prs.len());

    for pr in &prs {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let (check_runs_result, combined_status_result, reviews_result, pr_details_result) = tokio::join!(
            github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, github_token),
            github_client.get_combined_status(
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_sha,
                github_token
            ),
            github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, github_token),
            github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, github_token)
        );

        let (ci_status, ci_check_runs) = match (check_runs_result, combined_status_result) {
            (Ok(check_runs), Ok(combined_status)) => {
                let status =
                    crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
                let check_runs_json = serde_json::to_string(&check_runs.check_runs)
                    .unwrap_or_else(|_| "[]".to_string());
                (Some(status), Some(check_runs_json))
            }
            _ => (None, None),
        };

        let review_status = reviews_result
            .ok()
            .map(|reviews| crate::github_client::aggregate_review_status(&reviews, false, None));

        let pr_details = pr_details_result.ok();

        let is_queued = pr_details
            .as_ref()
            .and_then(|details| details.extra.get("merge_queue_entry").map(|v| !v.is_null()))
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                pr_details.as_ref().and_then(|details| details.mergeable),
                pr_details
                    .as_ref()
                    .and_then(|details| details.mergeable_state.clone()),
                is_queued,
            ),
        );
    }

    {
        let db_lock = db.lock().unwrap();
        for pr in &prs {
            let (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                mergeable,
                mergeable_state,
                is_queued,
            ) = match enriched.get(&pr.id) {
                Some(data) => data,
                None => continue,
            };

            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let task_id = db_lock.get_task_id_for_pr(pr.id).ok().flatten();

            let _ = db_lock.upsert_authored_pr(
                pr.id,
                pr.number,
                &pr.title,
                pr.body.as_deref(),
                &pr.state,
                pr.draft,
                &pr.html_url,
                &pr.user_login,
                pr.user_avatar_url.as_deref(),
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_ref,
                &pr.base_ref,
                &pr.head_sha,
                pr.additions,
                pr.deletions,
                pr.changed_files,
                ci_status.as_deref(),
                ci_check_runs.as_deref(),
                review_status.as_deref(),
                None,
                *is_queued,
                task_id.as_deref(),
                &pr.labels,
                *created_at,
                updated_at,
            );
            let _ = db_lock.update_authored_pr_mergeability(
                pr.id,
                *mergeable,
                mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_authored_prs(&all_search_ids);
        }

        let _ = events.emit("authored-prs-updated", serde_json::Value::Null);
    }

    Ok(())
}

fn parse_github_timestamp(timestamp: &str) -> Option<i64> {
    use chrono::{DateTime, Utc};
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

fn mergeability_after_pr_details(
    pr_details_result: &Result<
        crate::github_client::PullRequest,
        crate::github_client::GitHubError,
    >,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
) -> (Option<bool>, Option<String>) {
    match pr_details_result {
        Ok(details) => (details.mergeable, details.mergeable_state.clone()),
        Err(_) => (old_mergeable, old_mergeable_state),
    }
}

fn ci_persistence_payload(result: &PollSinglePrResult) -> Option<CiPersistencePayload> {
    let (Some(check_runs), Some(combined_status)) = (&result.check_runs, &result.combined_status)
    else {
        return None;
    };

    let check_runs = deduplicate_check_runs(check_runs);
    let (display_runs, status) = if result.required_check_names.is_empty() {
        (
            check_runs.check_runs.clone(),
            aggregate_ci_status(&check_runs, combined_status),
        )
    } else {
        let (filtered_runs, filtered_combined) =
            filter_to_required(&check_runs, combined_status, &result.required_check_names);
        let status = if filtered_runs.check_runs.is_empty() && filtered_combined.statuses.is_empty()
        {
            "pending".to_string()
        } else {
            aggregate_ci_status(&filtered_runs, &filtered_combined)
        };
        (filtered_runs.check_runs, status)
    };
    let check_runs_json = serde_json::to_string(&display_runs).unwrap_or_else(|_| "[]".to_string());
    let status_changed = result.old_ci_status.as_deref() != Some(status.as_str());

    Some(CiPersistencePayload {
        pr_id: result.pr_id,
        head_sha: result.head_sha.clone(),
        ci_validation_sha: result.ci_validation_sha.clone(),
        status,
        check_runs_json,
        status_changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend_runtime::AppHandle;
    use crate::db::test_helpers::{insert_test_task, make_test_db};
    use crate::github_client::{CheckRun, GitHubClient, GitHubHead, GitHubUser, PullRequest};

    fn make_project(id: &str) -> ProjectRow {
        ProjectRow {
            id: id.to_string(),
            name: format!("project {id}"),
            path: format!("/tmp/{id}"),
            created_at: 0,
            updated_at: 0,
        }
    }

    fn reported_ctx(
        focused: bool,
        active_project_id: Option<&str>,
        global_view_open: bool,
    ) -> PollContextSnapshot {
        PollContextSnapshot {
            reported: true,
            focused,
            active_project_id: active_project_id.map(|s| s.to_string()),
            global_view_open,
        }
    }
    fn make_pr(
        id: i64,
        ticket_id: &str,
        project_id: &str,
        task_status: &str,
        ci_status: Option<&str>,
        readiness_status: Option<&str>,
    ) -> ScheduledPr {
        ScheduledPr {
            pr: PrRow {
                id,
                pr_number: id,
                ticket_id: ticket_id.to_string(),
                repo_owner: "acme".to_string(),
                repo_name: project_id.to_string(),
                title: format!("PR {id}"),
                url: format!("https://github.com/acme/{project_id}/pull/{id}"),
                state: "open".to_string(),
                head_sha: format!("sha-{id}"),
                ci_status: ci_status.map(str::to_string),
                ci_check_runs: None,
                review_status: None,
                mergeable: None,
                mergeable_state: None,
                merged_at: None,
                created_at: 0,
                updated_at: 0,
                draft: false,
                is_queued: false,
                merge_readiness_status: readiness_status.map(str::to_string),
                merge_readiness_action: None,
                merge_readiness_blockers: None,
                merge_readiness_warnings: None,
                readiness_source_head_sha: None,
                merge_group_sha: None,
                required_checks_policy_known: None,
                required_reviews_policy_known: None,
                merge_queue_required: None,
                merge_queue_state: None,
                readiness_updated_at: None,
                unaddressed_comment_count: 0,
            },
            project_id: project_id.to_string(),
            task_status: task_status.to_string(),
            low_fire: false,
        }
    }

    #[test]
    fn test_scheduler_prioritizes_active_focus_task_prs_before_lower_budget_work() {
        let plan = build_poll_plan(
            &reported_ctx(true, Some("active"), false),
            PollSchedulerSnapshot {
                linked_prs: vec![
                    make_pr(
                        1,
                        "T-focus",
                        "active",
                        "doing",
                        Some("success"),
                        Some("blocked"),
                    ),
                    make_pr(
                        2,
                        "T-other",
                        "active",
                        "backlog",
                        Some("success"),
                        Some("blocked"),
                    ),
                    make_pr(
                        3,
                        "T-inactive",
                        "inactive",
                        "doing",
                        Some("success"),
                        Some("blocked"),
                    ),
                ],
                rate_limited: false,
                rate_limit_reset_at: None,
                global_review_due: true,
            },
            60,
            1_000,
        );

        assert_eq!(
            plan.scopes,
            vec![
                PollScope::ActiveFocusTaskPrs(Some("active".to_string())),
                PollScope::ActiveTaskPrs(Some("active".to_string())),
                PollScope::InactiveTaskPrs(Some("active".to_string())),
                PollScope::GlobalReviewLists,
            ]
        );
        assert_eq!(plan.sleep_secs, 60);
    }
    #[test]
    fn test_scheduler_keeps_global_review_lists_due_gated_even_when_global_view_open() {
        let plan = build_poll_plan(
            &reported_ctx(true, Some("active"), true),
            PollSchedulerSnapshot {
                linked_prs: Vec::new(),
                rate_limited: false,
                rate_limit_reset_at: None,
                global_review_due: false,
            },
            60,
            1_000,
        );

        assert!(plan.scopes.is_empty());
    }

    #[test]
    fn test_scheduler_uses_fast_cadence_while_active_focus_ci_is_pending() {
        let plan = build_poll_plan(
            &reported_ctx(true, Some("active"), false),
            PollSchedulerSnapshot {
                linked_prs: vec![make_pr(
                    1,
                    "T-focus",
                    "active",
                    "doing",
                    Some("pending"),
                    Some("pending"),
                )],
                rate_limited: false,
                rate_limit_reset_at: None,
                global_review_due: false,
            },
            60,
            1_000,
        );

        assert_eq!(plan.sleep_secs, MIN_GITHUB_POLL_INTERVAL_SECS);
    }

    #[test]
    fn test_scheduler_slows_down_after_readiness_settles() {
        let plan = build_poll_plan(
            &reported_ctx(true, Some("active"), false),
            PollSchedulerSnapshot {
                linked_prs: vec![make_pr(
                    1,
                    "T-focus",
                    "active",
                    "doing",
                    Some("success"),
                    Some("ready"),
                )],
                rate_limited: false,
                rate_limit_reset_at: None,
                global_review_due: false,
            },
            60,
            1_000,
        );

        assert_eq!(plan.sleep_secs, 120);
    }

    #[test]
    fn test_scheduler_slows_when_unfocused_without_github_calls() {
        let plan = build_poll_plan(
            &reported_ctx(false, Some("active"), false),
            PollSchedulerSnapshot {
                linked_prs: vec![make_pr(
                    1,
                    "T-focus",
                    "active",
                    "doing",
                    Some("pending"),
                    None,
                )],
                rate_limited: false,
                rate_limit_reset_at: None,
                global_review_due: false,
            },
            60,
            1_000,
        );

        assert!(plan.scopes.is_empty());
        assert_eq!(plan.sleep_secs, MAX_GITHUB_POLL_INTERVAL_SECS);
    }

    #[test]
    fn test_scheduler_rate_limit_sleep_honors_reset_before_any_priority_work() {
        let plan = build_poll_plan(
            &reported_ctx(true, Some("active"), false),
            PollSchedulerSnapshot {
                linked_prs: vec![make_pr(
                    1,
                    "T-focus",
                    "active",
                    "doing",
                    Some("pending"),
                    None,
                )],
                rate_limited: true,
                rate_limit_reset_at: Some(1_120),
                global_review_due: false,
            },
            60,
            1_000,
        );

        assert!(plan.scopes.is_empty());
        assert_eq!(plan.sleep_secs, 121);
    }
    #[test]
    fn test_decide_poll_unreported_falls_back_to_global() {
        // Before the frontend reports, behave like the pre-feature poller.
        assert_eq!(
            decide_poll(&PollContextSnapshot::default()),
            PollDecision::Poll(PollScope::Global)
        );
    }

    #[test]
    fn test_decide_poll_skips_when_unfocused() {
        let ctx = reported_ctx(false, Some("p1"), true);
        assert_eq!(decide_poll(&ctx), PollDecision::Skip);
    }

    #[test]
    fn test_decide_poll_global_when_global_view_open() {
        let ctx = reported_ctx(true, Some("p1"), true);
        assert_eq!(decide_poll(&ctx), PollDecision::Poll(PollScope::Global));
    }

    #[test]
    fn test_decide_poll_active_repo_when_global_view_closed() {
        let ctx = reported_ctx(true, Some("p1"), false);
        assert_eq!(
            decide_poll(&ctx),
            PollDecision::Poll(PollScope::ActiveRepo(Some("p1".to_string())))
        );
    }

    #[test]
    fn test_decide_poll_active_repo_none_when_no_active_project() {
        let ctx = reported_ctx(true, None, false);
        assert_eq!(
            decide_poll(&ctx),
            PollDecision::Poll(PollScope::ActiveRepo(None))
        );
    }

    #[test]
    fn test_select_projects_global_returns_all() {
        let all = vec![make_project("a"), make_project("b")];
        assert_eq!(select_projects(all, &PollScope::Global).len(), 2);
    }

    #[test]
    fn test_select_projects_active_repo_filters_to_one() {
        let all = vec![make_project("a"), make_project("b")];
        let got = select_projects(all, &PollScope::ActiveRepo(Some("b".to_string())));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "b");
    }

    #[test]
    fn test_select_projects_active_repo_none_returns_empty() {
        let all = vec![make_project("a"), make_project("b")];
        assert!(select_projects(all, &PollScope::ActiveRepo(None)).is_empty());
    }

    #[test]
    fn test_poll_context_set_and_snapshot() {
        let ctx = PollContext::new();
        assert_eq!(ctx.snapshot(), PollContextSnapshot::default());
        ctx.set(false, Some("p9".to_string()), true);
        assert_eq!(
            ctx.snapshot(),
            PollContextSnapshot {
                reported: true,
                focused: false,
                active_project_id: Some("p9".to_string()),
                global_view_open: true,
            }
        );
    }

    fn make_stale_detail(state: &str, extra: serde_json::Value) -> PullRequest {
        PullRequest {
            number: 42,
            title: "Stale authored PR".to_string(),
            state: state.to_string(),
            html_url: "https://github.com/acme/repo/pull/42".to_string(),
            user: GitHubUser {
                login: "octocat".to_string(),
                extra: serde_json::json!({}),
            },
            head: GitHubHead {
                ref_name: "feature/T-100".to_string(),
                sha: "abc123".to_string(),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: None,
            mergeable_state: None,
            extra,
        }
    }

    #[test]
    fn test_stale_authored_pr_terminal_state_marks_merged_from_merged_at() {
        let details = make_stale_detail(
            "closed",
            serde_json::json!({
                "merged": true,
                "merged_at": "2024-01-01T00:00:00Z"
            }),
        );

        assert_eq!(
            terminal_state_for_stale_authored_pr(&details),
            Some(StaleAuthoredPrTerminalState::Merged(Some(1704067200)))
        );
    }

    #[test]
    fn test_stale_authored_pr_terminal_state_marks_closed_without_merged_evidence() {
        let details = make_stale_detail(
            "closed",
            serde_json::json!({
                "merged": false,
                "merged_at": null
            }),
        );

        assert_eq!(
            terminal_state_for_stale_authored_pr(&details),
            Some(StaleAuthoredPrTerminalState::Closed)
        );
    }

    #[test]
    fn test_stale_authored_pr_terminal_state_leaves_open_pr_open() {
        let details = make_stale_detail("open", serde_json::json!({ "merged": false }));

        assert_eq!(terminal_state_for_stale_authored_pr(&details), None);
    }

    #[test]
    fn test_stale_authored_pr_candidates_preserve_repo_local_pr_identity() {
        let open_prs = vec![
            PrRow {
                id: 1001,
                pr_number: 42,
                ticket_id: "T-100".to_string(),
                repo_owner: "acme".to_string(),
                repo_name: "web".to_string(),
                title: "Web".to_string(),
                url: "https://github.com/acme/web/pull/42".to_string(),
                state: "open".to_string(),
                head_sha: "web-sha".to_string(),
                ci_status: None,
                ci_check_runs: None,
                review_status: None,
                mergeable: None,
                mergeable_state: None,
                merged_at: None,
                created_at: 1,
                updated_at: 2,
                draft: false,
                is_queued: false,
                merge_readiness_status: None,
                merge_readiness_action: None,
                merge_readiness_blockers: None,
                merge_readiness_warnings: None,
                readiness_source_head_sha: None,
                merge_group_sha: None,
                required_checks_policy_known: None,
                required_reviews_policy_known: None,
                merge_queue_required: None,
                merge_queue_state: None,
                readiness_updated_at: None,
                unaddressed_comment_count: 0,
            },
            PrRow {
                id: 2001,
                pr_number: 42,
                ticket_id: "T-100".to_string(),
                repo_owner: "acme".to_string(),
                repo_name: "api".to_string(),
                title: "API".to_string(),
                url: "https://github.com/acme/api/pull/42".to_string(),
                state: "open".to_string(),
                head_sha: "api-sha".to_string(),
                ci_status: None,
                ci_check_runs: None,
                review_status: None,
                mergeable: None,
                mergeable_state: None,
                merged_at: None,
                created_at: 1,
                updated_at: 2,
                draft: false,
                is_queued: false,
                merge_readiness_status: None,
                merge_readiness_action: None,
                merge_readiness_blockers: None,
                merge_readiness_warnings: None,
                readiness_source_head_sha: None,
                merge_group_sha: None,
                required_checks_policy_known: None,
                required_reviews_policy_known: None,
                merge_queue_required: None,
                merge_queue_state: None,
                readiness_updated_at: None,
                unaddressed_comment_count: 0,
            },
        ];

        let candidates = stale_authored_task_pr_candidates(open_prs, &[1001]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, 2001);
        assert_eq!(candidates[0].repo_name, "api");
        assert_eq!(candidates[0].pr_number, 42);
    }

    #[test]
    fn test_poll_result_construction() {
        let result = PollResult {
            new_comments: 3,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 1,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert_eq!(result.new_comments, 3);
        assert_eq!(result.ci_changes, 0);
        assert_eq!(result.review_changes, 0);
        assert_eq!(result.pr_changes, 0);
        assert_eq!(result.errors, 1);
        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    #[test]
    fn test_poll_result_rate_limit_fields_default() {
        let result = PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    #[test]
    fn test_poll_result_serialization_includes_rate_limit() {
        let result = PollResult {
            new_comments: 5,
            ci_changes: 2,
            review_changes: 1,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        let json = serde_json::to_string(&result).expect("serialization failed");
        assert!(json.contains("\"rate_limited\":true"));
        assert!(json.contains("\"rate_limit_reset_at\":1704067200"));
    }

    #[test]
    fn test_poll_result_deserialization_backward_compat() {
        let old_json = r#"{
            "new_comments": 3,
            "ci_changes": 1,
            "review_changes": 0,
            "pr_changes": 0,
            "errors": 0
        }"#;

        let result: PollResult = serde_json::from_str(old_json).expect("deserialization failed");
        assert_eq!(result.new_comments, 3);
        assert_eq!(result.ci_changes, 1);
        assert_eq!(result.review_changes, 0);
        assert_eq!(result.pr_changes, 0);
        assert_eq!(result.errors, 0);
        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    #[test]
    fn test_parse_github_timestamp() {
        let timestamp = "2024-01-01T00:00:00Z";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1704067200);
    }

    #[test]
    fn test_parse_github_timestamp_invalid() {
        let timestamp = "invalid";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_none());
    }

    #[test]
    fn test_mergeability_after_pr_details_preserves_previous_values_on_error() {
        let result = mergeability_after_pr_details(
            &Err(crate::github_client::GitHubError::NetworkError(
                "boom".to_string(),
            )),
            Some(false),
            Some("dirty".to_string()),
        );

        assert_eq!(result, (Some(false), Some("dirty".to_string())));
    }

    #[test]
    fn test_mergeability_after_pr_details_uses_fetched_unknown_state() {
        let details = crate::github_client::PullRequest {
            number: 1,
            title: "Test PR".to_string(),
            state: "open".to_string(),
            html_url: "https://github.com/acme/repo/pull/1".to_string(),
            user: crate::github_client::GitHubUser {
                login: "octocat".to_string(),
                extra: serde_json::json!({}),
            },
            head: crate::github_client::GitHubHead {
                ref_name: "feature/test".to_string(),
                sha: "abc123".to_string(),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: None,
            mergeable_state: Some("unknown".to_string()),
            extra: serde_json::json!({}),
        };

        let result =
            mergeability_after_pr_details(&Ok(details), Some(false), Some("dirty".to_string()));

        assert_eq!(result, (None, Some("unknown".to_string())));
    }

    #[test]
    fn test_sync_open_prs_error_rate_limit_detection_uses_typed_github_error() {
        let rate_limited = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 429,
            message: "Too Many Requests".to_string(),
        });
        assert!(rate_limited.should_increment_rate_limit_count());

        let forbidden = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 403,
            message: "Forbidden".to_string(),
        });
        assert!(!forbidden.should_increment_rate_limit_count());

        let non_rate_limited = SyncOpenPrsError::Db("boom".to_string());
        assert!(!non_rate_limited.should_increment_rate_limit_count());
    }

    #[test]
    fn test_contains_task_id_matches_boundaries() {
        assert!(contains_task_id("T-42 fix auth", "T-42"));
        assert!(contains_task_id("fix auth T-42", "T-42"));
        assert!(contains_task_id("feature/T-42/auth", "T-42"));
        assert!(contains_task_id("feature/T-42-auth", "T-42"));
        assert!(contains_task_id("T-42: fix auth", "T-42"));
    }

    #[test]
    fn test_contains_task_id_rejects_substring_false_positive() {
        assert!(!contains_task_id("fixT-42bug", "T-42"));
        assert!(!contains_task_id("Fix T-12 issue", "T-1"));
        assert!(!contains_task_id("feature/T-123", "T-12"));
    }

    #[test]
    fn test_classify_task_matches_returns_unique_match() {
        let task_ids = vec!["T-42".to_string(), "T-99".to_string()];

        match classify_task_matches("Fix bug T-42", &task_ids) {
            TaskMatchOutcome::Unique(task_id) => assert_eq!(task_id, "T-42"),
            TaskMatchOutcome::None | TaskMatchOutcome::Ambiguous => {
                panic!("expected unique task match")
            }
        }
    }

    #[test]
    fn test_classify_task_matches_rejects_ambiguous_matches() {
        let task_ids = vec!["T-1".to_string(), "T-2".to_string()];

        assert!(matches!(
            classify_task_matches("Fix T-1 and T-2", &task_ids),
            TaskMatchOutcome::Ambiguous
        ));
    }

    #[test]
    fn test_classify_task_matches_returns_none_for_no_matches() {
        let task_ids = vec!["T-100".to_string()];

        assert!(matches!(
            classify_task_matches("Update documentation", &task_ids),
            TaskMatchOutcome::None
        ));
    }

    #[test]
    fn test_find_authoritative_task_id_prefers_branch_match_over_title_and_body_match() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

        let matched = find_authoritative_task_id(
            "Fix T-2",
            "feature/T-1-auth",
            Some("Closes T-3"),
            &task_ids,
        );

        assert_eq!(matched.as_deref(), Some("T-1"));
    }

    #[test]
    fn test_find_authoritative_task_id_uses_unique_title_match_when_branch_has_none() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

        let matched = find_authoritative_task_id("Fix T-3", "feature/auth", None, &task_ids);

        assert_eq!(matched.as_deref(), Some("T-3"));
    }

    #[test]
    fn test_find_authoritative_task_id_uses_unique_body_match_when_branch_and_title_have_none() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

        let matched = find_authoritative_task_id(
            "Fix authentication",
            "feature/auth",
            Some("Implementation for Task T-3."),
            &task_ids,
        );

        assert_eq!(matched.as_deref(), Some("T-3"));
    }

    #[test]
    fn test_find_authoritative_task_id_rejects_ambiguous_body_matches() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

        let matched = find_authoritative_task_id(
            "Fix authentication",
            "feature/auth",
            Some("Covers T-1 and T-2."),
            &task_ids,
        );

        assert_eq!(matched, None);
    }

    #[test]
    fn test_find_authoritative_task_id_rejects_ambiguous_title_matches() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

        let matched =
            find_authoritative_task_id("Fix T-1 before T-2", "feature/auth", None, &task_ids);

        assert_eq!(matched, None);
    }

    #[test]
    fn test_should_fetch_comments_for_pr_uses_changed_pr_subset() {
        let changed_pr_numbers = HashSet::from([11]);

        assert!(!should_fetch_comments_for_pr(10, &changed_pr_numbers));
        assert!(should_fetch_comments_for_pr(11, &changed_pr_numbers));
    }

    #[test]
    fn test_should_fetch_comments_for_pr_falls_back_to_all_prs_without_events() {
        let changed_pr_numbers = HashSet::new();

        assert!(should_fetch_comments_for_pr(20, &changed_pr_numbers));
        assert!(should_fetch_comments_for_pr(21, &changed_pr_numbers));
    }

    #[test]
    fn test_poller_uses_managed_github_client() {
        let managed_client = GitHubClient::new();
        let app = AppHandle::new();
        app.manage(managed_client.clone());

        let state_client = app.state::<GitHubClient>();
        let poller_client = state_client.inner();

        assert!(poller_client.shares_cache_with(&managed_client));
    }

    #[test]
    fn test_poll_result_rate_limited_true_with_reset_timestamp() {
        let result = PollResult {
            new_comments: 5,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        assert!(result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, Some(1704067200));
    }

    #[test]
    fn test_poll_result_rate_limited_with_changes_can_coexist() {
        // This test verifies that rate_limited=true and new_comments>0 can both be true
        // (the confusing case where a cycle detects rate limit but still has changes)
        let result = PollResult {
            new_comments: 3,
            ci_changes: 1,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        // Verify both conditions are true simultaneously
        assert!(result.rate_limited);
        assert!(result.new_comments > 0);
        assert!(result.ci_changes > 0);
        assert_eq!(result.rate_limit_reset_at, Some(1704067200));
    }

    #[test]
    fn test_poll_result_rate_limited_false_when_no_reset_detected() {
        let result = PollResult {
            new_comments: 2,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    fn make_review_body_poll_result(pr_id: i64) -> PollSinglePrResult {
        let review = PrReview {
            id: 42,
            user: crate::github_client::GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            state: "COMMENTED".to_string(),
            body: Some("Looks good overall".to_string()),
            submitted_at: Some("2024-01-01T00:00:00Z".to_string()),
            extra: serde_json::json!({}),
        };

        PollSinglePrResult {
            pr_id,
            ticket_id: "T-100".to_string(),
            pr_title: "Review body test".to_string(),
            head_sha: "abc123".to_string(),
            ci_validation_sha: "abc123".to_string(),
            old_ci_status: None,
            old_review_status: None,
            comments: vec![PrComment {
                id: -review.id,
                body: review.body.clone().expect("review body should exist"),
                user: review.user.clone(),
                path: None,
                line: None,
                comment_type: "review_body".to_string(),
                created_at: review
                    .submitted_at
                    .clone()
                    .expect("submitted_at should exist"),
            }],
            check_runs: None,
            combined_status: None,
            reviews: Some(vec![review]),
            has_requested_reviewers: false,
            mergeable: None,
            mergeable_state: None,
            is_queued: false,
            required_check_names: vec![],
            required_approving_count: None,
            readiness_facts: PrMergeReadinessFacts {
                status: None,
                action: None,
                blockers_json: None,
                warnings_json: None,
                source_head_sha: Some("abc123".to_string()),
                merge_group_sha: None,
                required_checks_policy_known: None,
                required_reviews_policy_known: None,
                merge_queue_required: None,
                merge_queue_state: None,
                updated_at: 0,
            },
            error: None,
        }
    }

    #[test]
    fn test_persist_polled_comments_does_not_fail_when_review_body_exists_in_both_sources() {
        let (db, path) = make_test_db("persist_polled_comments_review_body_once");
        insert_test_task(&db);
        db.insert_pull_request(
            42,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/42",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let result = make_review_body_poll_result(42);
        let existing_ids = db
            .get_existing_comment_ids(42)
            .expect("get existing ids failed");
        let events = GitHubEventTarget::sidecar(None);

        let persist_result = persist_polled_comments(&events, &db, &result, &existing_ids, 1000);
        let comments = db.get_comments_for_pr(42).expect("get comments failed");

        assert_eq!(persist_result.failed_insert_count, 0);
        assert_eq!(persist_result.new_comment_count, 1);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);
        assert_eq!(comments[0].comment_type, "review_body");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_persist_polled_comments_is_idempotent_across_poll_cycles_for_review_bodies() {
        let (db, path) = make_test_db("persist_polled_comments_review_body_idempotent");
        insert_test_task(&db);
        db.insert_pull_request(
            84,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/84",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let result = make_review_body_poll_result(84);
        let events = GitHubEventTarget::sidecar(None);

        let first_existing_ids = db
            .get_existing_comment_ids(84)
            .expect("get initial existing ids failed");
        let first_persist =
            persist_polled_comments(&events, &db, &result, &first_existing_ids, 1000);

        let second_existing_ids = db
            .get_existing_comment_ids(84)
            .expect("get second existing ids failed");
        let second_persist =
            persist_polled_comments(&events, &db, &result, &second_existing_ids, 1000);

        let comments = db.get_comments_for_pr(84).expect("get comments failed");

        assert_eq!(first_persist.failed_insert_count, 0);
        assert_eq!(first_persist.new_comment_count, 1);
        assert_eq!(second_persist.failed_insert_count, 0);
        assert_eq!(second_persist.new_comment_count, 0);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_persist_polled_comments_deduplicates_repeated_ids_within_batch() {
        let (db, path) = make_test_db("persist_polled_comments_batch_dedup");
        insert_test_task(&db);
        db.insert_pull_request(
            126,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/126",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let mut result = make_review_body_poll_result(126);
        result.comments.push(
            result
                .comments
                .first()
                .expect("review body comment should exist")
                .clone(),
        );

        let existing_ids = db
            .get_existing_comment_ids(126)
            .expect("get existing ids failed");
        let events = GitHubEventTarget::sidecar(None);

        let persist_result = persist_polled_comments(&events, &db, &result, &existing_ids, 1000);
        let comments = db.get_comments_for_pr(126).expect("get comments failed");

        assert_eq!(persist_result.failed_insert_count, 0);
        assert_eq!(persist_result.new_comment_count, 1);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_poll_phase_error_rate_limit_detection_uses_typed_github_error() {
        let rate_limited = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 429,
            message: "Too Many Requests".to_string(),
        });
        assert!(rate_limited.should_increment_rate_limit_count());

        let forbidden = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 403,
            message: "Forbidden".to_string(),
        });
        assert!(!forbidden.should_increment_rate_limit_count());

        let non_rate_limited = PollPhaseError::Db("boom".to_string());
        assert!(!non_rate_limited.should_increment_rate_limit_count());
    }

    #[test]
    fn test_count_poll_phase_error_increments_total_errors_and_rate_limit_count_on_failure() {
        let mut total_errors = 0;
        let mut rate_limit_count = 0;

        count_poll_phase_error(
            "review PRs",
            Err(PollPhaseError::GitHub(
                crate::github_client::GitHubError::ApiError {
                    status: 429,
                    message: "Too Many Requests".to_string(),
                },
            )),
            &mut total_errors,
            &mut rate_limit_count,
        );
        count_poll_phase_error(
            "authored PRs",
            Err(PollPhaseError::Db("boom".to_string())),
            &mut total_errors,
            &mut rate_limit_count,
        );

        assert_eq!(total_errors, 2);
        assert_eq!(rate_limit_count, 1);
    }

    #[test]
    fn test_count_poll_phase_error_leaves_counters_unchanged_on_success() {
        let mut total_errors = 3;
        let mut rate_limit_count = 2;

        count_poll_phase_error(
            "review PRs",
            Ok(()),
            &mut total_errors,
            &mut rate_limit_count,
        );

        assert_eq!(total_errors, 3);
        assert_eq!(rate_limit_count, 2);
    }

    #[test]
    fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_missing() {
        assert_eq!(parse_poll_interval_seconds(None), 60);
    }

    #[test]
    fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_invalid() {
        assert_eq!(
            parse_poll_interval_seconds(Some("not-a-number".to_string())),
            60
        );
    }

    #[test]
    fn test_parse_poll_interval_seconds_uses_configured_value_when_valid() {
        assert_eq!(parse_poll_interval_seconds(Some("45".to_string())), 45);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_zero_to_minimum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("0".to_string())), 15);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_below_minimum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("10".to_string())), 15);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_above_maximum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("301".to_string())), 300);
    }

    #[test]
    fn test_rate_limit_sleep_duration_waits_until_future_reset() {
        assert_eq!(
            rate_limit_sleep_duration_secs(60, Some(1_700_000_300), 1_700_000_000),
            301
        );
    }

    #[test]
    fn test_rate_limit_sleep_duration_uses_poll_interval_after_past_reset() {
        assert_eq!(
            rate_limit_sleep_duration_secs(60, Some(1_699_999_999), 1_700_000_000),
            60
        );
    }

    #[test]
    fn test_rate_limit_sleep_duration_keeps_longer_poll_interval() {
        assert_eq!(
            rate_limit_sleep_duration_secs(120, Some(1_700_000_030), 1_700_000_000),
            120
        );
    }

    fn make_github_readiness_pr() -> PrRow {
        PrRow {
            id: 42,
            pr_number: 7,
            ticket_id: "T-42".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "repo".to_string(),
            title: "Readiness".to_string(),
            url: "https://github.com/acme/repo/pull/7".to_string(),
            state: "open".to_string(),
            head_sha: "head-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            unaddressed_comment_count: 0,
        }
    }

    fn known_readiness_policy(
        required_checks: Vec<&str>,
        required_reviews: Option<usize>,
        requires_up_to_date_branch: Option<bool>,
        requires_conversation_resolution: Option<bool>,
        merge_queue_required: Option<bool>,
    ) -> crate::github_client::RepositoryPolicyFacts {
        crate::github_client::RepositoryPolicyFacts {
            required_checks: crate::github_client::PolicyValue::known(
                required_checks.into_iter().map(str::to_string).collect(),
            ),
            required_reviews: crate::github_client::PolicyValue::known(required_reviews),
            requires_up_to_date_branch: crate::github_client::PolicyValue::known(
                requires_up_to_date_branch,
            ),
            requires_conversation_resolution: crate::github_client::PolicyValue::known(
                requires_conversation_resolution,
            ),
            merge_queue_required: crate::github_client::PolicyValue::known(merge_queue_required),
            required_deployments: crate::github_client::PolicyValue::known(Vec::new()),
            unknown_reasons: Vec::new(),
        }
    }

    fn readiness_snapshot_with_policy(
        source_head_sha: Option<&str>,
        status_check_rollup_sha: Option<&str>,
        policy: crate::github_client::RepositoryPolicyFacts,
    ) -> GitHubReadinessSnapshot {
        GitHubReadinessSnapshot {
            source_head_sha: source_head_sha.map(str::to_string),
            status_check_rollup_sha: status_check_rollup_sha.map(str::to_string),
            check_runs: CheckRunsResponse {
                total_count: 1,
                check_runs: vec![CheckRun {
                    id: 10,
                    name: "graphql-ci".to_string(),
                    status: "completed".to_string(),
                    conclusion: Some("success".to_string()),
                    html_url: "https://example.com/graphql-ci".to_string(),
                }],
            },
            combined_status: CombinedStatusResponse {
                state: "success".to_string(),
                statuses: vec![],
                sha: source_head_sha.unwrap_or_default().to_string(),
                total_count: 0,
                extra: serde_json::json!({}),
            },
            merge_state_status: Some("CLEAN".to_string()),
            mergeable_state: Some("clean".to_string()),
            review_decision: Some("APPROVED".to_string()),
            review_status: Some("approved".to_string()),
            auto_merge_requested: false,
            merge_queue_required: None,
            merge_queue_state: None,
            merge_group_sha: Some("merge-group-sha".to_string()),
            unresolved_conversations: Some(true),
            policy,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn select_branch_policy_inputs_prefers_known_graphql_policy_over_rest_fallbacks() {
        let mut snapshot = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("graphql-head-sha"),
            known_readiness_policy(
                vec!["graphql-ci"],
                Some(2),
                Some(true),
                Some(true),
                Some(true),
            ),
        );
        snapshot.unresolved_conversations = Some(true);
        let rest_checks = crate::github_client::RequiredChecksPolicy::known(
            vec!["rest-ci".to_string()],
            Some(false),
        );
        let rest_reviews = crate::github_client::RequiredReviewsPolicy::known(1);

        let inputs = select_branch_policy_inputs(Some(&snapshot), &rest_checks, &rest_reviews);

        assert_eq!(inputs.required_check_names, vec!["graphql-ci".to_string()]);
        assert_eq!(inputs.required_approving_count, Some(2));
        assert!(inputs.required_checks_policy_known);
        assert!(inputs.required_reviews_policy_known);
        assert!(inputs.requires_up_to_date_branch);
        assert!(inputs.conversations_blocking);
        assert!(inputs.merge_queue_required_by_policy);
    }

    #[test]
    fn current_graphql_readiness_keeps_mergeability_when_check_rollup_needs_rest_fallback() {
        let pr = make_github_readiness_pr();
        let mut snapshot = readiness_snapshot_with_policy(
            Some("pr-head-sha"),
            Some("stale-rollup-sha"),
            known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(false)),
        );
        snapshot.mergeable_state = Some("clean".to_string());
        snapshot.review_status = Some("approved".to_string());
        let rest_sources = RestReadinessSources {
            rest_ci_sha: "pr-head-sha".to_string(),
            check_runs: None,
            combined_status: None,
            reviews: None,
            pr_details_result: Err(crate::github_client::GitHubError::NetworkError(
                "unused".to_string(),
            )),
            has_requested_reviewers: false,
            mergeable: None,
            mergeable_state: Some("unknown".to_string()),
            is_queued: false,
        };

        let graphql_inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot));
        let result_head_sha = poll_result_pr_head_sha(&pr, Some(&snapshot), &rest_sources);

        assert!(graphql_inputs.is_none());
        assert_eq!(result_head_sha, "pr-head-sha");
        assert_eq!(
            current_graphql_mergeable_state(
                Some(&snapshot),
                &result_head_sha,
                graphql_inputs.as_ref()
            ),
            Some("clean")
        );
        assert_eq!(
            current_graphql_review_status(
                Some(&snapshot),
                &result_head_sha,
                graphql_inputs.as_ref()
            )
            .as_deref(),
            Some("approved")
        );
    }
    #[test]
    fn select_branch_policy_inputs_uses_rest_when_graphql_policy_is_unknown() {
        let snapshot = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("graphql-head-sha"),
            crate::github_client::RepositoryPolicyFacts::unknown("GraphQL policy unavailable"),
        );
        let rest_checks = crate::github_client::RequiredChecksPolicy::known(
            vec!["rest-ci".to_string()],
            Some(true),
        );
        let rest_reviews = crate::github_client::RequiredReviewsPolicy::known(1);

        let inputs = select_branch_policy_inputs(Some(&snapshot), &rest_checks, &rest_reviews);

        assert_eq!(inputs.required_check_names, vec!["rest-ci".to_string()]);
        assert_eq!(inputs.required_approving_count, Some(1));
        assert!(inputs.required_checks_policy_known);
        assert!(inputs.required_reviews_policy_known);
        assert!(inputs.requires_up_to_date_branch);
        assert!(!inputs.conversations_blocking);
        assert!(!inputs.merge_queue_required_by_policy);
    }

    #[test]
    fn github_readiness_keeps_merge_group_validation_sha_out_of_pr_head() {
        let pr = make_github_readiness_pr();
        let mut snapshot = readiness_snapshot_with_policy(
            Some("pr-head-sha"),
            Some("pr-head-sha"),
            known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(true)),
        );
        snapshot.merge_queue_state = Some("QUEUED".to_string());
        snapshot.merge_group_sha = Some("merge-group-sha".to_string());
        let rest_sources = RestReadinessSources {
            rest_ci_sha: "merge-group-sha".to_string(),
            check_runs: None,
            combined_status: None,
            reviews: None,
            pr_details_result: Err(crate::github_client::GitHubError::NetworkError(
                "unused".to_string(),
            )),
            has_requested_reviewers: false,
            mergeable: None,
            mergeable_state: None,
            is_queued: true,
        };

        let pr_head_sha = poll_result_pr_head_sha(&pr, Some(&snapshot), &rest_sources);
        let ci_validation_sha = poll_result_ci_validation_sha(None, &rest_sources, &pr_head_sha);

        assert_eq!(pr_head_sha, "pr-head-sha");
        assert_eq!(ci_validation_sha, "merge-group-sha");
    }

    #[test]
    fn ci_persistence_payload_filters_to_required_checks_and_reports_status_change() {
        let mut result = make_review_body_poll_result(42);
        result.head_sha = "head-sha".to_string();
        result.ci_validation_sha = "merge-group-sha".to_string();
        result.old_ci_status = Some("pending".to_string());
        result.required_check_names = vec!["ci".to_string()];
        result.check_runs = Some(CheckRunsResponse {
            total_count: 2,
            check_runs: vec![
                CheckRun {
                    id: 1,
                    name: "ci".to_string(),
                    status: "completed".to_string(),
                    conclusion: Some("success".to_string()),
                    html_url: "https://example.com/ci".to_string(),
                },
                CheckRun {
                    id: 2,
                    name: "optional-lint".to_string(),
                    status: "completed".to_string(),
                    conclusion: Some("failure".to_string()),
                    html_url: "https://example.com/lint".to_string(),
                },
            ],
        });
        result.combined_status = Some(CombinedStatusResponse {
            state: "success".to_string(),
            statuses: vec![],
            sha: "merge-group-sha".to_string(),
            total_count: 0,
            extra: serde_json::json!({}),
        });

        let payload = ci_persistence_payload(&result).expect("CI inputs should produce a payload");
        let persisted_runs: Vec<CheckRun> = serde_json::from_str(&payload.check_runs_json)
            .expect("payload should serialize display check runs");

        assert_eq!(payload.pr_id, 42);
        assert_eq!(payload.head_sha, "head-sha");
        assert_eq!(payload.ci_validation_sha, "merge-group-sha");
        assert_eq!(payload.status, "success");
        assert!(payload.status_changed);
        assert_eq!(persisted_runs.len(), 1);
        assert_eq!(persisted_runs[0].name, "ci");
    }
}
