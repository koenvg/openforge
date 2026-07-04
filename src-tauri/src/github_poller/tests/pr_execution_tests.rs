use super::*;

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
fn test_sanitized_comment_fetch_error_message_redacts_github_error_body() {
    let error = crate::github_client::GitHubError::ApiError {
        status: 403,
        message: "token ghp_secret body https://api.github.com/repos/acme/private/pulls?user=alice"
            .to_string(),
    };

    let sanitized = sanitized_comment_fetch_error_message(&error);

    assert_eq!(
        sanitized,
        "Failed to fetch comments: GitHub API error (status 403)"
    );
    assert!(!sanitized.contains("ghp_secret"));
    assert!(!sanitized.contains("https://api.github.com"));
    assert!(!sanitized.contains("acme"));
    assert!(!sanitized.contains("private"));
    assert!(!sanitized.contains("alice"));
    assert!(!sanitized.contains("body"));
}
