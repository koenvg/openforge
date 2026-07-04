use super::*;

#[test]
fn test_format_sync_scope_log_includes_scope_and_fanout() {
    let repo_identifier = "acme/private";
    let message = format_sync_scope_log(
        &PollScope::ActiveTaskPrs(Some(repo_identifier.to_string())),
        3,
        7,
    );

    assert!(message.contains("scope=active-task-prs"));
    assert!(message.contains("active_project=<redacted>"));
    assert!(!message.contains(repo_identifier));
    assert!(message.contains("projects=3"));
    assert!(message.contains("prs=7"));
}

#[test]
fn test_format_sync_phase_log_includes_phase_duration_and_counts() {
    let message = format_sync_phase_log("global review PR list", 1.25, Some("fetched 4 PRs"));

    assert_eq!(
        message,
        "[GitHub Poller] Finished global review PR list in 1.2s (fetched 4 PRs)"
    );
}

#[test]
fn test_format_rate_limit_pause_log_includes_reset_delay_and_scope() {
    let message =
        format_rate_limit_pause_log(Some(1_120), 1_000, &PollScope::GlobalReviewLists, 121);

    assert_eq!(
        message,
        "[GitHub Poller] Rate limit paused GitHub sync after scope=global-review-lists; reset_at=1120 (in 120s), sleeping 121s"
    );
}
