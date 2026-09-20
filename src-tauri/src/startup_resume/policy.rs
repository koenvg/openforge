use crate::db;

pub(super) fn latest_session_allows_startup_resume(session: Option<&db::AgentSessionRow>) -> bool {
    session.is_some_and(|session| {
        db::STARTUP_RESUMABLE_AGENT_SESSION_STATUSES.contains(&session.status.as_str())
            || session.status == "completed"
    })
}

pub(super) fn interrupt_on_resume_failure(provider: &str) -> bool {
    matches!(
        provider,
        "claude-code" | "pi" | "opencode" | "codex" | "grok"
    )
}

pub(super) fn restored_status<'a>(
    session: &'a db::AgentSessionRow,
    provider: &str,
    pty_instance_id: Option<u64>,
) -> Option<&'a str> {
    if matches!(session.status.as_str(), "interrupted" | "running") {
        Some("running")
    } else if matches!(provider, "pi" | "opencode" | "codex")
        && pty_instance_id.is_some()
        && matches!(session.status.as_str(), "completed" | "paused")
    {
        Some(session.status.as_str())
    } else {
        None
    }
}
