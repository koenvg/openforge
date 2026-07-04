use super::scheduling::PollScope;

pub(super) fn poll_scope_log_name(scope: &PollScope) -> &'static str {
    match scope {
        PollScope::Global => "global",
        PollScope::ActiveRepo(_) => "active-repo",
        PollScope::ActiveFocusTaskPrs(_) => "active-focus-task-prs",
        PollScope::ActiveTaskPrs(_) => "active-task-prs",
        PollScope::InactiveTaskPrs(_) => "inactive-task-prs",
        PollScope::GlobalReviewLists => "global-review-lists",
    }
}

pub(super) fn poll_scope_active_project_id(scope: &PollScope) -> Option<&str> {
    match scope {
        PollScope::ActiveRepo(active_project_id)
        | PollScope::ActiveFocusTaskPrs(active_project_id)
        | PollScope::ActiveTaskPrs(active_project_id)
        | PollScope::InactiveTaskPrs(active_project_id) => active_project_id.as_deref(),
        PollScope::Global | PollScope::GlobalReviewLists => None,
    }
}

pub(super) fn format_sync_scope_log(
    scope: &PollScope,
    project_count: usize,
    pr_count: usize,
) -> String {
    let mut parts = vec![format!("scope={}", poll_scope_log_name(scope))];
    if let Some(active_project_id) = poll_scope_active_project_id(scope) {
        parts.push(format!("active_project={active_project_id}"));
    }
    parts.push(format!("projects={project_count}"));
    parts.push(format!("prs={pr_count}"));

    format!(
        "[GitHub Poller] Starting GitHub sync ({})",
        parts.join(", ")
    )
}

pub(super) fn format_sync_phase_log(
    phase: &str,
    elapsed_secs: f64,
    detail: Option<&str>,
) -> String {
    match detail.filter(|value| !value.is_empty()) {
        Some(detail) => {
            format!("[GitHub Poller] Finished {phase} in {elapsed_secs:.1}s ({detail})")
        }
        None => format!("[GitHub Poller] Finished {phase} in {elapsed_secs:.1}s"),
    }
}

pub(super) fn format_rate_limit_pause_log(
    reset_at: Option<i64>,
    now: i64,
    scope: &PollScope,
    sleep_secs: u64,
) -> String {
    let reset_detail = reset_at
        .map(|reset_at| {
            let seconds_until_reset = reset_at.saturating_sub(now);
            format!("reset_at={reset_at} (in {seconds_until_reset}s)")
        })
        .unwrap_or_else(|| "reset_at=unknown".to_string());

    format!(
        "[GitHub Poller] Rate limit paused GitHub sync after scope={}; {}, sleeping {}s",
        poll_scope_log_name(scope),
        reset_detail,
        sleep_secs
    )
}
