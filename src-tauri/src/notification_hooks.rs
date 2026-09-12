//! Self-contained hook transport survives installed-file and backend replacement.
const SOURCE: &str = concat!(
    include_str!("agent-notifications/client.js"),
    "\n",
    include_str!("agent-notifications/shell-hook.js")
);

pub(crate) fn shell_command(
    provider: &str,
    kind: crate::agent_lifecycle::AgentLifecycleEventKind,
    event: &str,
) -> String {
    let kind = match kind {
        crate::agent_lifecycle::AgentLifecycleEventKind::Started => "started",
        crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy => "became_busy",
        crate::agent_lifecycle::AgentLifecycleEventKind::BecameIdle => "became_idle",
        crate::agent_lifecycle::AgentLifecycleEventKind::RequestedPermission => {
            "requested_permission"
        }
        crate::agent_lifecycle::AgentLifecycleEventKind::Failed => "failed",
        crate::agent_lifecycle::AgentLifecycleEventKind::Ended => "ended",
    };
    let quote = |value: &str| format!("'{}'", value.replace('\'', "'\\''"));
    format!(
        "node -e {} {} {} {}",
        quote(SOURCE),
        quote(provider),
        quote(kind),
        quote(event)
    )
}
