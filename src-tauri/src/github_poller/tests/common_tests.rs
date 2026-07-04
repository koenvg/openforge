use super::*;

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
