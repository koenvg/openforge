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
