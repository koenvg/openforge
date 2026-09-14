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
    legacy_url: Option<&str>,
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
    let args = [provider, kind, event]
        .into_iter()
        .chain(legacy_url)
        .map(quote)
        .collect::<Vec<_>>()
        .join(" ");
    format!("node -e {} {args}", quote(SOURCE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_lifecycle::AgentLifecycleEventKind;

    #[test]
    fn shell_command_appends_the_legacy_url_as_a_quoted_trailing_argument() {
        let command = shell_command(
            "grok",
            AgentLifecycleEventKind::Ended,
            "stop",
            Some("http://127.0.0.1:1/hooks/grok-stop?x=it's"),
        );

        assert!(
            command
                .ends_with("'grok' 'ended' 'stop' 'http://127.0.0.1:1/hooks/grok-stop?x=it'\\''s'"),
            "{command}"
        );
    }

    #[test]
    fn shell_command_omits_the_legacy_url_argument_when_there_is_no_legacy_route() {
        let command = shell_command("claude-code", AgentLifecycleEventKind::Ended, "stop", None);

        assert!(
            command.ends_with("'claude-code' 'ended' 'stop'"),
            "{command}"
        );
    }
}
