use crate::db::{acquire_db, Database, PrRow, ProjectRow};
use log::warn;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

pub(super) const DEFAULT_GITHUB_POLL_INTERVAL_SECS: u64 = 60;
pub(super) const MIN_GITHUB_POLL_INTERVAL_SECS: u64 = 15;
pub(super) const MAX_GITHUB_POLL_INTERVAL_SECS: u64 = 300;

pub(super) fn parse_poll_interval_seconds(raw: Option<String>) -> u64 {
    raw.and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(MIN_GITHUB_POLL_INTERVAL_SECS, MAX_GITHUB_POLL_INTERVAL_SECS))
        .unwrap_or(DEFAULT_GITHUB_POLL_INTERVAL_SECS)
}

pub(super) fn unix_timestamp(
    now: std::time::SystemTime,
) -> Result<i64, std::time::SystemTimeError> {
    now.duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
}

pub(super) fn current_unix_timestamp() -> Result<i64, std::time::SystemTimeError> {
    unix_timestamp(std::time::SystemTime::now())
}

pub(super) fn rate_limit_sleep_duration_secs(
    poll_interval: u64,
    reset_at: Option<i64>,
    now: i64,
) -> u64 {
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

pub(super) fn rate_limit_sleep_duration_with_optional_now(
    poll_interval: u64,
    reset_at: Option<i64>,
    now: Option<i64>,
) -> u64 {
    now.map_or(poll_interval, |now| {
        rate_limit_sleep_duration_secs(poll_interval, reset_at, now)
    })
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
pub(super) struct ScheduledPr {
    pub(super) pr: PrRow,
    pub(super) project_id: String,
    pub(super) task_status: String,
    pub(super) out_of_focus: bool,
}

#[derive(Debug, Clone, Default)]
pub(super) struct PollSchedulerSnapshot {
    pub(super) linked_prs: Vec<ScheduledPr>,
    pub(super) rate_limited: bool,
    pub(super) rate_limit_reset_at: Option<i64>,
    pub(super) global_review_due: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PollPlan {
    pub(super) scopes: Vec<PollScope>,
    pub(super) sleep_secs: u64,
}

impl PollScope {
    pub(super) fn polls_task_prs(&self) -> bool {
        !matches!(self, Self::GlobalReviewLists)
    }

    pub(super) fn polls_global_lists(&self) -> bool {
        matches!(self, Self::Global | Self::GlobalReviewLists)
    }

    pub(super) fn refreshes_task_links(&self) -> bool {
        matches!(self, Self::Global | Self::GlobalReviewLists)
    }
}

pub(super) fn is_focus_task_status(status: &str) -> bool {
    !matches!(status, "backlog" | "done")
}

pub(super) fn is_pending_readiness(pr: &ScheduledPr) -> bool {
    matches!(
        pr.pr.ci_status.as_deref(),
        Some("pending" | "queued" | "running" | "in_progress")
    ) || matches!(
        pr.pr.merge_readiness_status.as_deref(),
        Some("pending" | "checking" | "unknown")
    ) || pr.pr.is_queued
}
pub(super) fn is_settled_readiness(pr: &ScheduledPr) -> bool {
    matches!(
        pr.pr.ci_status.as_deref(),
        Some("success" | "failure" | "none")
    ) && matches!(
        pr.pr.merge_readiness_status.as_deref(),
        Some("ready" | "mergeable")
    )
}

pub(super) fn scope_has_matches(scope: &PollScope, prs: &[ScheduledPr]) -> bool {
    prs.iter().any(|pr| scheduled_pr_in_scope(pr, scope))
}

pub(super) fn scheduled_pr_in_scope(pr: &ScheduledPr, scope: &PollScope) -> bool {
    match scope {
        PollScope::Global | PollScope::ActiveRepo(_) => true,
        PollScope::GlobalReviewLists => false,
        PollScope::ActiveFocusTaskPrs(Some(active_project_id)) => {
            pr.project_id == *active_project_id
                && is_focus_task_status(&pr.task_status)
                && !pr.out_of_focus
        }
        PollScope::ActiveTaskPrs(Some(active_project_id)) => {
            pr.project_id == *active_project_id
                && (!is_focus_task_status(&pr.task_status) || pr.out_of_focus)
        }
        PollScope::InactiveTaskPrs(Some(active_project_id)) => pr.project_id != *active_project_id,
        PollScope::ActiveFocusTaskPrs(None)
        | PollScope::ActiveTaskPrs(None)
        | PollScope::InactiveTaskPrs(None) => false,
    }
}

pub(super) fn build_poll_plan(
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
pub(super) fn select_projects(all: Vec<ProjectRow>, scope: &PollScope) -> Vec<ProjectRow> {
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
pub(super) fn poll_scheduler_snapshot(
    db: &Mutex<Database>,
    rate_limited: bool,
    rate_limit_reset_at: Option<i64>,
    global_review_due: bool,
) -> PollSchedulerSnapshot {
    let projects = {
        let db_lock = acquire_db(db);
        db_lock.get_all_projects()
    };

    let linked_prs = match projects {
        Ok(projects) => projects
            .into_iter()
            .flat_map(
                |project| match get_scheduled_prs_for_project(db, &project.id) {
                    Ok(prs) => prs,
                    Err(e) => {
                        warn!(
                            "[GitHub Poller] Failed to build scheduler snapshot for Project {}: {}",
                            project.id, e
                        );
                        Vec::new()
                    }
                },
            )
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

pub(super) fn get_scheduled_prs_for_project(
    db: &Mutex<Database>,
    project_id: &str,
) -> Result<Vec<ScheduledPr>, String> {
    let db_lock = acquire_db(db);
    let all_open_prs = db_lock.get_open_prs().map_err(|e| e.to_string())?;

    let tasks = db_lock
        .get_tasks_for_project(project_id)
        .map_err(|e| e.to_string())?;

    let task_rows = tasks;
    let out_of_focus_task_ids: HashSet<String> = db_lock
        .get_project_config(project_id, "low_fire_task_ids")
        .map_err(|e| format!("Failed to get out-of-focus Task IDs: {e}"))?
        .map(|raw| {
            serde_json::from_str::<Vec<String>>(&raw)
                .map_err(|e| format!("Failed to parse out-of-focus Task IDs: {e}"))
        })
        .transpose()?
        .unwrap_or_default()
        .into_iter()
        .collect();
    let task_statuses: HashMap<String, (String, bool)> = task_rows
        .into_iter()
        .map(|task| {
            let out_of_focus = out_of_focus_task_ids.contains(&task.id);
            (task.id, (task.status, out_of_focus))
        })
        .collect();

    Ok(all_open_prs
        .into_iter()
        .filter_map(|pr| {
            task_statuses
                .get(&pr.ticket_id)
                .map(|(status, out_of_focus)| ScheduledPr {
                    pr,
                    project_id: project_id.to_string(),
                    task_status: status.clone(),
                    out_of_focus: *out_of_focus,
                })
        })
        .collect())
}
