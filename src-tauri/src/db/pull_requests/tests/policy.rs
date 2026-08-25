use crate::db::test_helpers::*;
use crate::db::PrMergeReadinessFacts;

#[test]
fn test_pr_merge_readiness_round_trip() {
    let (db, _temp_dir) = make_test_db("pr_merge_readiness_round_trip");
    insert_test_task(&db);

    db.insert_pull_request(
        42,
        "T-100",
        "owner",
        "repo",
        "Test PR",
        "https://github.com/pr/42",
        "open",
        1000,
        1000,
        false,
    )
    .unwrap();

    let facts = PrMergeReadinessFacts {
        status: Some("ready_to_enqueue".to_string()),
        action: Some("enqueue".to_string()),
        blockers_json: Some("[]".to_string()),
        warnings_json: Some(r#"[{"code":"branch_behind"}]"#.to_string()),
        source_head_sha: Some("head-sha".to_string()),
        merge_group_sha: Some("merge-group-sha".to_string()),
        required_checks_policy_known: Some(true),
        required_reviews_policy_known: Some(false),
        merge_queue_required: Some(true),
        merge_queue_state: Some("not_queued".to_string()),
        updated_at: 1704067200,
    };

    db.update_pr_merge_readiness(42, &facts).unwrap();
    db.update_pr_merge_method_policy(42, true, r#"["squash","rebase"]"#, Some("squash"))
        .unwrap();

    let prs = db.get_open_prs().unwrap();
    let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");
    assert_eq!(
        pr.merge_readiness_status.as_deref(),
        Some("ready_to_enqueue")
    );
    assert_eq!(pr.merge_readiness_action.as_deref(), Some("enqueue"));
    assert_eq!(pr.merge_readiness_blockers.as_deref(), Some("[]"));
    assert_eq!(
        pr.merge_readiness_warnings.as_deref(),
        Some(r#"[{"code":"branch_behind"}]"#)
    );
    assert_eq!(pr.readiness_source_head_sha.as_deref(), Some("head-sha"));
    assert_eq!(pr.merge_group_sha.as_deref(), Some("merge-group-sha"));
    assert_eq!(pr.required_checks_policy_known, Some(true));
    assert_eq!(pr.required_reviews_policy_known, Some(false));
    assert_eq!(pr.merge_queue_required, Some(true));
    assert_eq!(pr.merge_queue_state.as_deref(), Some("not_queued"));
    assert_eq!(pr.readiness_updated_at, Some(1704067200));
    assert_eq!(pr.merge_methods_policy_known, Some(true));
    assert_eq!(
        pr.allowed_merge_methods.as_deref(),
        Some(r#"["squash","rebase"]"#)
    );
    assert_eq!(pr.default_merge_method.as_deref(), Some("squash"));
    let policy = pr
        .merge_method_policy()
        .expect("persisted merge method policy should decode");
    assert_eq!(
        policy.allowed,
        vec![
            crate::github_client::PullRequestMergeMethod::Squash,
            crate::github_client::PullRequestMergeMethod::Rebase,
        ]
    );
    assert_eq!(
        policy.default,
        Some(crate::github_client::PullRequestMergeMethod::Squash)
    );

    let mut unavailable_policy = pr.clone();
    unavailable_policy.merge_methods_policy_known = Some(false);
    assert_eq!(unavailable_policy.merge_method_policy(), None);

    let mut malformed_policy = pr.clone();
    malformed_policy.allowed_merge_methods = Some("not-json".to_string());
    assert_eq!(malformed_policy.merge_method_policy(), None);

    let mut unsupported_default = pr.clone();
    unsupported_default.default_merge_method = Some("merge".to_string());
    assert_eq!(
        unsupported_default
            .merge_method_policy()
            .expect("allowed methods should still decode")
            .default,
        None
    );

    drop(db);
}
