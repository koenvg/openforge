use super::super::lifecycle::{
    format_sidecar_stderr_diagnostic, SIDECAR_EXITED_EVENT, SIDECAR_FAILED_EVENT,
};
use super::super::*;
use super::build_plugin_host;
use std::time::Duration;

#[test]
fn plugin_tagged_stderr_diagnostics_preserve_activation_and_handler_context() {
    assert_eq!(
        format_sidecar_stderr_diagnostic(
            "[plugin:acme.sync] activation error: duplicate background service id"
        ),
        "[plugin_host] sidecar stderr line [plugin:acme.sync] activation error: duplicate background service id"
    );
    assert_eq!(
        format_sidecar_stderr_diagnostic(
            "[plugin:acme.sync] backend handler error in acme.sync.refresh: upstream unavailable"
        ),
        "[plugin_host] sidecar stderr line [plugin:acme.sync] backend handler error in acme.sync.refresh: upstream unavailable"
    );
}

#[test]
fn plugin_tagged_stderr_diagnostics_redact_sensitive_values() {
    let diagnostic = format_sidecar_stderr_diagnostic(
        "[plugin:acme.sync] activation error: token=ghp_secret path=/Users/alice/private/plugin.js url=https://api.example.test/private",
    );

    assert!(diagnostic.contains("[plugin:acme.sync] activation error:"));
    assert!(diagnostic.matches("<redacted>").count() >= 3);
    assert!(!diagnostic.contains("ghp_secret"));
    assert!(!diagnostic.contains("/Users/alice"));
    assert!(!diagnostic.contains("api.example.test"));
}

#[test]
fn untagged_stderr_diagnostics_suppress_content() {
    assert_eq!(
        format_sidecar_stderr_diagnostic("host runtime secret"),
        "[plugin_host] sidecar stderr line suppressed bytes=19"
    );
}

#[test]
fn malformed_plugin_tags_do_not_opt_into_stderr_content_logging() {
    for line in [
        "[plugin:] activation error: secret",
        "[plugin:ACME.sync] activation error: secret",
        "[plugin:acme sync] activation error: secret",
    ] {
        let diagnostic = format_sidecar_stderr_diagnostic(line);
        assert!(diagnostic.contains("stderr line suppressed bytes="));
        assert!(!diagnostic.contains("secret"));
    }
}

#[test]
fn plugin_tagged_stderr_diagnostics_are_character_bounded() {
    let line = format!("[plugin:acme.sync] activation error: {}", "é".repeat(2_500));
    let diagnostic = format_sidecar_stderr_diagnostic(&line);
    let content = diagnostic
        .strip_prefix("[plugin_host] sidecar stderr line ")
        .expect("diagnostic prefix");

    assert_eq!(content.chars().count(), 2_013);
    assert!(content.ends_with("… [truncated]"));
}

#[test]
fn plugin_tagged_stderr_diagnostics_escape_control_characters() {
    let diagnostic = format_sidecar_stderr_diagnostic(
        "[plugin:acme.sync] activation error: reset\u{1b}[2Jterminal",
    );

    assert!(diagnostic.contains("reset\\u{1b}[2Jterminal"));
    assert!(!diagnostic.contains('\u{1b}'));
}

#[test]
fn new_host_starts_stopped() {
    let host = build_plugin_host();

    assert_eq!(host.get_state(), SidecarState::Stopped);
    assert!(!host.is_sidecar_running());
}

#[test]
fn stop_transition_reaches_stopped() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);
    host.mark_stopping_for_test();
    assert_eq!(host.get_state(), SidecarState::Stopping);

    host.complete_stop_for_test();
    assert_eq!(host.get_state(), SidecarState::Stopped);
    assert!(!host.is_sidecar_running());
}

#[test]
fn unexpected_exit_marks_host_crashed() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);

    let delay = host.handle_unexpected_exit_for_test();

    assert_eq!(host.get_state(), SidecarState::Crashed);
    assert_eq!(delay, Some(Duration::from_secs(1)));
}

#[test]
fn retries_use_exponential_backoff_then_stop() {
    let host = build_plugin_host();

    host.mark_running_for_test(1234);

    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(1))
    );
    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(2))
    );
    assert_eq!(
        host.handle_unexpected_exit_for_test(),
        Some(Duration::from_secs(4))
    );
    assert_eq!(host.handle_unexpected_exit_for_test(), None);
    assert_eq!(host.get_state(), SidecarState::Crashed);
}

#[test]
fn health_check_depends_on_running_state() {
    let host = build_plugin_host();

    assert!(!host.is_sidecar_running());

    host.mark_running_for_test(1234);

    assert!(host.is_sidecar_running());
}

#[test]
fn sidecar_lifecycle_events_publish_to_backend_app_event_stream() {
    let (sender, mut receiver) = tokio::sync::broadcast::channel(8);
    let host = PluginHost::with_app_event_sender(AppHandle::new(), Some(sender));

    host.mark_running_for_test(4321);
    host.emit_sidecar_exited(Some(1), None, Some(4321));
    host.emit_sidecar_failed(Some("boom".to_string()));

    let exited = receiver.try_recv().expect("exit event should publish");
    assert_eq!(exited.event_name, SIDECAR_EXITED_EVENT);
    assert_eq!(exited.payload["code"], 1);
    assert_eq!(exited.payload["pid"], 4321);

    let failed = receiver.try_recv().expect("failure event should publish");
    assert_eq!(failed.event_name, SIDECAR_FAILED_EVENT);
    assert_eq!(failed.payload["error"], "boom");
}
