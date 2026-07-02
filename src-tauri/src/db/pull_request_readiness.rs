use crate::github_client::{
    aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required,
    CheckRunsResponse, CombinedStatusResponse, GitHubReadinessSnapshot, PrReview, PullRequest,
};
use rusqlite::Result;
use serde::Serialize;

use super::PrRow;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrMergeReadinessFacts {
    pub status: Option<String>,
    pub action: Option<String>,
    pub blockers_json: Option<String>,
    pub warnings_json: Option<String>,
    pub source_head_sha: Option<String>,
    pub merge_group_sha: Option<String>,
    pub required_checks_policy_known: Option<bool>,
    pub required_reviews_policy_known: Option<bool>,
    pub merge_queue_required: Option<bool>,
    pub merge_queue_state: Option<String>,
    pub updated_at: i64,
}

impl PrMergeReadinessFacts {
    pub fn merge_readiness_warnings_or_default(&self) -> String {
        self.warnings_json.clone().unwrap_or_default()
    }
}

pub(super) fn terminal_readiness_blockers_json(code: &str, message: &str) -> String {
    serde_json::json!([{ "code": code, "message": message }]).to_string()
}

impl super::Database {
    pub fn update_pr_merge_readiness(
        &self,
        pr_id: i64,
        facts: &PrMergeReadinessFacts,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET
                merge_readiness_status = ?1,
                merge_readiness_action = ?2,
                merge_readiness_blockers = ?3,
                merge_readiness_warnings = ?4,
                readiness_source_head_sha = ?5,
                merge_group_sha = ?6,
                required_checks_policy_known = ?7,
                required_reviews_policy_known = ?8,
                merge_queue_required = ?9,
                merge_queue_state = ?10,
                readiness_updated_at = ?11
             WHERE id = ?12",
            rusqlite::params![
                facts.status,
                facts.action,
                facts.blockers_json,
                facts.warnings_json,
                facts.source_head_sha,
                facts.merge_group_sha,
                facts.required_checks_policy_known,
                facts.required_reviews_policy_known,
                facts.merge_queue_required,
                facts.merge_queue_state,
                facts.updated_at,
                pr_id,
            ],
        )?;
        Ok(())
    }
}

#[derive(Serialize)]
struct MergeReadinessReason {
    code: &'static str,
    message: &'static str,
}

fn readiness_reason_json(reasons: &[MergeReadinessReason]) -> Option<String> {
    serde_json::to_string(reasons).ok()
}

fn add_readiness_warning(
    warnings_json: Option<String>,
    reason: MergeReadinessReason,
) -> Option<String> {
    let mut warnings = warnings_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(raw).ok())
        .unwrap_or_default();

    let already_present = warnings
        .iter()
        .any(|warning| warning.get("code").and_then(|code| code.as_str()) == Some(reason.code));

    if !already_present {
        warnings.push(serde_json::json!({
            "code": reason.code,
            "message": reason.message,
        }));
    }

    serde_json::to_string(&warnings).ok()
}

fn extra_string_at_path(extra: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = extra;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn merge_group_sha_from_details(details: &PullRequest) -> Option<String> {
    [
        ["merge_group_sha"].as_slice(),
        ["merge_group", "head_sha"].as_slice(),
        ["merge_queue_entry", "head_sha"].as_slice(),
        ["merge_queue_entry", "merge_group", "head_sha"].as_slice(),
    ]
    .into_iter()
    .find_map(|path| extra_string_at_path(&details.extra, path))
}

fn merge_queue_state_from_details(
    details: Option<&PullRequest>,
    is_queued: bool,
    merge_queue_required: Option<bool>,
) -> Option<String> {
    let detail_state = details.and_then(|details| {
        extra_string_at_path(&details.extra, &["merge_queue_entry", "state"])
            .or_else(|| extra_string_at_path(&details.extra, &["merge_queue_entry", "status"]))
    });

    match (detail_state, is_queued, merge_queue_required) {
        (Some(state), _, _) => Some(state),
        (None, true, _) => Some("queued".to_string()),
        (None, false, Some(true)) => Some("not_queued".to_string()),
        _ => None,
    }
}

pub(crate) fn queued_validation_sha(snapshot: &GitHubReadinessSnapshot) -> Option<&str> {
    snapshot
        .merge_group_sha
        .as_deref()
        .filter(|sha| !sha.is_empty())
        .filter(|_| snapshot.merge_queue_state.is_some())
}

pub(crate) fn needs_rest_ci_for_snapshot(snapshot: Option<&GitHubReadinessSnapshot>) -> bool {
    snapshot
        .map(|snapshot| {
            queued_validation_sha(snapshot).is_some() || snapshot.requires_rest_check_fallback()
        })
        .unwrap_or(true)
}

#[derive(Debug, Clone)]
pub(crate) struct MergeReadinessInputs {
    pub(crate) source_head_sha: Option<String>,
    pub(crate) review_status: Option<String>,
    pub(crate) mergeable_state: Option<String>,
    pub(crate) check_runs: CheckRunsResponse,
    pub(crate) combined_status: CombinedStatusResponse,
}

pub(crate) fn select_snapshot_readiness_inputs(
    _pr: &PrRow,
    snapshot: Option<&GitHubReadinessSnapshot>,
) -> Option<MergeReadinessInputs> {
    let snapshot = snapshot?;
    if snapshot.source_head_sha.is_none()
        || snapshot.requires_rest_check_fallback()
        || queued_validation_sha(snapshot).is_some()
    {
        return None;
    }

    Some(MergeReadinessInputs {
        source_head_sha: snapshot.source_head_sha.clone(),
        review_status: snapshot.review_status.clone(),
        mergeable_state: snapshot.mergeable_state.clone(),
        check_runs: snapshot.check_runs.clone(),
        combined_status: snapshot.combined_status.clone(),
    })
}

pub(crate) fn ci_status_for_readiness(
    check_runs: Option<&CheckRunsResponse>,
    combined_status: Option<&CombinedStatusResponse>,
    required_check_names: &[String],
    old_ci_status: Option<&String>,
) -> Option<String> {
    match (check_runs, combined_status) {
        (Some(check_runs), Some(combined_status)) => {
            let check_runs = deduplicate_check_runs(check_runs);
            if required_check_names.is_empty() {
                Some(aggregate_ci_status(&check_runs, combined_status))
            } else {
                let (filtered_runs, filtered_combined) =
                    filter_to_required(&check_runs, combined_status, required_check_names);
                if filtered_runs.check_runs.is_empty() && filtered_combined.statuses.is_empty() {
                    Some("pending".to_string())
                } else {
                    Some(aggregate_ci_status(&filtered_runs, &filtered_combined))
                }
            }
        }
        _ => old_ci_status.cloned(),
    }
}

pub(crate) fn review_status_for_readiness(
    graphql_inputs: Option<&MergeReadinessInputs>,
    reviews: Option<&Vec<PrReview>>,
    has_requested_reviewers: bool,
    required_approving_count: Option<usize>,
    old_review_status: Option<&String>,
) -> Option<String> {
    graphql_inputs
        .and_then(|inputs| inputs.review_status.clone())
        .or_else(|| {
            reviews.map(|reviews| {
                aggregate_review_status(reviews, has_requested_reviewers, required_approving_count)
            })
        })
        .or_else(|| old_review_status.cloned())
}

pub(crate) fn finalize_readiness_facts_for_poll(
    mut readiness_facts: PrMergeReadinessFacts,
    graphql_snapshot: Option<&GitHubReadinessSnapshot>,
    source_head_sha: &str,
    readiness_is_queued: bool,
    merge_queue_required_by_policy: bool,
    new_comment_count: usize,
    updated_at: i64,
) -> PrMergeReadinessFacts {
    if let Some(snapshot) = graphql_snapshot {
        if readiness_facts.merge_group_sha.is_none() {
            readiness_facts.merge_group_sha = snapshot.merge_group_sha.clone();
        }
        if readiness_facts.merge_queue_state.is_none() {
            readiness_facts.merge_queue_state = snapshot.merge_queue_state.clone();
        }
        if readiness_facts.merge_queue_required.is_none() {
            readiness_facts.merge_queue_required = snapshot
                .merge_queue_required
                .or(snapshot.policy.merge_queue_required.value);
        }
        if !snapshot.policy.unknown_reasons.is_empty() {
            readiness_facts.warnings_json = add_readiness_warning(
                readiness_facts.warnings_json,
                MergeReadinessReason {
                    code: "policy_coverage_unknown",
                    message: "Some repository policy facts could not be verified from GitHub.",
                },
            );
        }
        if snapshot.unresolved_conversations == Some(true) {
            readiness_facts.warnings_json = add_readiness_warning(
                readiness_facts.warnings_json,
                MergeReadinessReason {
                    code: "unresolved_conversations",
                    message: "Pull request has unresolved conversations.",
                },
            );
        }
        if merge_queue_required_by_policy
            && !readiness_is_queued
            && readiness_facts.status.as_deref() == Some("ready_to_merge")
        {
            readiness_facts.status = Some("ready_to_enqueue".to_string());
            readiness_facts.action = Some("enqueue".to_string());
            readiness_facts.merge_queue_required = Some(true);
            readiness_facts.merge_queue_state = Some("not_queued".to_string());
        }
        if !snapshot.policy.unknown_reasons.is_empty()
            && first_class_readiness_status(readiness_facts.status.as_deref())
        {
            readiness_facts.status = Some("readiness_unknown".to_string());
            readiness_facts.action = Some("wait_for_github".to_string());
        }
    }

    let effective_source_sha = if readiness_is_queued {
        readiness_facts
            .merge_group_sha
            .as_deref()
            .filter(|sha| !sha.is_empty())
            .unwrap_or(source_head_sha)
    } else {
        source_head_sha
    };
    if !effective_source_sha.is_empty() {
        readiness_facts.source_head_sha = Some(effective_source_sha.to_string());
    }

    if new_comment_count > 0 {
        readiness_facts.warnings_json = add_readiness_warning(
            readiness_facts.warnings_json,
            MergeReadinessReason {
                code: "unresolved_conversations",
                message: "Pull request has unresolved conversations.",
            },
        );
    }
    readiness_facts.updated_at = updated_at;
    readiness_facts
}

fn first_class_readiness_status(status: Option<&str>) -> bool {
    matches!(
        status,
        Some("ready_to_merge" | "ready_to_enqueue" | "queued_pull_request")
    )
}

fn downgrade_ready_handoff_to_unknown(
    mut readiness_facts: PrMergeReadinessFacts,
    reason: MergeReadinessReason,
) -> PrMergeReadinessFacts {
    if first_class_readiness_status(readiness_facts.status.as_deref()) {
        readiness_facts.status = Some("readiness_unknown".to_string());
        readiness_facts.action = Some("wait_for_github".to_string());
        readiness_facts.warnings_json =
            add_readiness_warning(readiness_facts.warnings_json, reason);
    }
    readiness_facts
}

pub(crate) fn enforce_actor_scoped_readiness(
    readiness_facts: PrMergeReadinessFacts,
    details: Option<&PullRequest>,
    configured_github_username: Option<&str>,
) -> PrMergeReadinessFacts {
    let Some(configured_github_username) = configured_github_username
        .map(str::trim)
        .filter(|username| !username.is_empty())
    else {
        return downgrade_ready_handoff_to_unknown(
            readiness_facts,
            MergeReadinessReason {
                code: "actor_scope_unknown",
                message: "OpenForge GitHub identity was unavailable for readiness scoping.",
            },
        );
    };

    let Some(details) = details else {
        return downgrade_ready_handoff_to_unknown(
            readiness_facts,
            MergeReadinessReason {
                code: "actor_scope_unknown",
                message: "Pull request author was unavailable for readiness scoping.",
            },
        );
    };

    if details
        .user
        .login
        .eq_ignore_ascii_case(configured_github_username)
    {
        readiness_facts
    } else {
        downgrade_ready_handoff_to_unknown(
            readiness_facts,
            MergeReadinessReason {
                code: "actor_scope_mismatch",
                message:
                    "Pull request is not authored by the configured OpenForge GitHub identity.",
            },
        )
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_merge_readiness_facts(
    pr: &PrRow,
    details: Option<&PullRequest>,
    mergeable: Option<bool>,
    mergeable_state: Option<&str>,
    ci_status: Option<&str>,
    review_status: Option<&str>,
    is_queued: bool,
    required_checks_policy_known: bool,
    required_reviews_policy_known: bool,
    requires_up_to_date_branch: bool,
    conversations_blocking: bool,
    updated_at: Option<i64>,
) -> PrMergeReadinessFacts {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    let mergeable_state_lower = mergeable_state.map(str::to_ascii_lowercase);
    let ci_status = ci_status.map(str::to_ascii_lowercase);
    let review_status = review_status.map(str::to_ascii_lowercase);
    let current_state = details
        .map(|details| details.state.as_str())
        .unwrap_or(pr.state.as_str());
    let current_draft = details
        .and_then(|details| details.draft)
        .unwrap_or(pr.draft);

    if current_state != "open" {
        blockers.push(if current_state == "merged" {
            MergeReadinessReason {
                code: "already_merged",
                message: "Pull request is already merged.",
            }
        } else {
            MergeReadinessReason {
                code: "pull_request_closed",
                message: "Pull request is closed.",
            }
        });
    }

    if current_draft {
        blockers.push(MergeReadinessReason {
            code: "draft",
            message: "Pull request is still marked as draft.",
        });
    }

    match review_status.as_deref() {
        Some("changes_requested") => blockers.push(MergeReadinessReason {
            code: "changes_requested",
            message: "Review changes have been requested.",
        }),
        Some("review_unknown") => warnings.push(MergeReadinessReason {
            code: "review_coverage_unknown",
            message: "GitHub returned an unrecognized review decision.",
        }),
        _ => {}
    }

    match ci_status.as_deref() {
        Some("pending" | "queued" | "in_progress") => blockers.push(MergeReadinessReason {
            code: "checks_pending",
            message: "Required checks are still running.",
        }),
        Some("failure" | "error" | "cancelled" | "timed_out" | "action_required") => {
            blockers.push(MergeReadinessReason {
                code: "checks_failed",
                message: "Required checks are failing.",
            });
        }
        _ => {}
    }

    match mergeable_state_lower.as_deref() {
        Some("unstable") => blockers.push(MergeReadinessReason {
            code: "checks_failed",
            message: "GitHub reports failing or unstable required checks.",
        }),
        Some("dirty" | "conflicting") => blockers.push(MergeReadinessReason {
            code: "merge_conflict",
            message: "Pull request has merge conflicts.",
        }),
        Some("blocked") => blockers.push(MergeReadinessReason {
            code: "mergeability_blocked",
            message: "GitHub reports that mergeability is blocked.",
        }),
        Some("behind") => {
            if requires_up_to_date_branch {
                blockers.push(MergeReadinessReason {
                    code: "branch_behind",
                    message: "Branch must be updated with the base branch before merging.",
                });
            } else {
                warnings.push(MergeReadinessReason {
                    code: "branch_behind",
                    message: "Branch is behind the base branch.",
                });
            }
        }
        _ => {}
    }

    if conversations_blocking {
        blockers.push(MergeReadinessReason {
            code: "unresolved_conversations",
            message: "Pull request has unresolved conversations.",
        });
    } else if pr.unaddressed_comment_count > 0 {
        warnings.push(MergeReadinessReason {
            code: "unresolved_conversations",
            message: "Pull request has unresolved conversations.",
        });
    }

    if !required_checks_policy_known || !required_reviews_policy_known {
        warnings.push(MergeReadinessReason {
            code: "policy_coverage_unknown",
            message: "Some repository policy facts could not be verified from GitHub.",
        });
    }

    let merge_queue_required = if is_queued || mergeable_state_lower.as_deref() == Some("queued") {
        Some(true)
    } else {
        None
    };
    let merge_queue_state =
        merge_queue_state_from_details(details, is_queued, merge_queue_required);

    let has_unknown_policy = !required_checks_policy_known || !required_reviews_policy_known;

    let (status, action) = if !blockers.is_empty() {
        (Some("blocked"), Some("resolve_blockers"))
    } else if is_queued {
        (Some("queued_pull_request"), Some("wait_for_queue"))
    } else if merge_queue_required == Some(true) {
        (Some("ready_to_enqueue"), Some("enqueue"))
    } else if review_status.as_deref() == Some("review_unknown") || has_unknown_policy {
        (Some("readiness_unknown"), Some("wait_for_github"))
    } else if matches!(mergeable_state_lower.as_deref(), Some("clean" | "behind"))
        || (mergeable == Some(true)
            && mergeable_state_lower.is_none()
            && matches!(ci_status.as_deref(), None | Some("none"))
            && matches!(review_status.as_deref(), None | Some("none")))
    {
        (Some("ready_to_merge"), Some("merge"))
    } else if mergeable_state_lower.as_deref() == Some("unknown") || mergeable.is_none() {
        warnings.push(MergeReadinessReason {
            code: "mergeability_unknown",
            message: "GitHub has not reported definitive mergeability yet.",
        });
        (Some("readiness_unknown"), Some("wait_for_github"))
    } else {
        blockers.push(MergeReadinessReason {
            code: "mergeability_blocked",
            message: "Pull request is not mergeable.",
        });
        (Some("blocked"), Some("resolve_blockers"))
    };

    PrMergeReadinessFacts {
        status: status.map(ToOwned::to_owned),
        action: action.map(ToOwned::to_owned),
        blockers_json: readiness_reason_json(&blockers),
        warnings_json: readiness_reason_json(&warnings),
        source_head_sha: details
            .map(|details| details.head.sha.clone())
            .or_else(|| Some(pr.head_sha.clone())),
        merge_group_sha: details.and_then(merge_group_sha_from_details),
        required_checks_policy_known: Some(required_checks_policy_known),
        required_reviews_policy_known: Some(required_reviews_policy_known),
        merge_queue_required,
        merge_queue_state,
        updated_at: updated_at.unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_client::{
        CheckRun, GitHubHead, GitHubUser, PolicyValue, PullRequest, RepositoryPolicyFacts,
    };

    #[test]
    fn test_add_readiness_warning_deduplicates_unresolved_conversations() {
        let warnings = add_readiness_warning(
            Some(r#"[{"code":"branch_behind","message":"Branch is behind."}]"#.to_string()),
            MergeReadinessReason {
                code: "unresolved_conversations",
                message: "Pull request has unresolved conversations.",
            },
        )
        .expect("warnings should serialize");

        let warnings = add_readiness_warning(
            Some(warnings),
            MergeReadinessReason {
                code: "unresolved_conversations",
                message: "Pull request has unresolved conversations.",
            },
        )
        .expect("warnings should serialize");

        assert_eq!(warnings.matches("unresolved_conversations").count(), 1);
        assert!(warnings.contains("branch_behind"));
    }

    fn make_github_readiness_pr() -> PrRow {
        PrRow {
            id: 42,
            pr_number: 7,
            ticket_id: "T-42".to_string(),
            repo_owner: "acme".to_string(),
            repo_name: "repo".to_string(),
            title: "Readiness".to_string(),
            url: "https://github.com/acme/repo/pull/7".to_string(),
            state: "open".to_string(),
            head_sha: "head-sha".to_string(),
            ci_status: None,
            ci_check_runs: None,
            review_status: None,
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            merged_at: None,
            created_at: 1,
            updated_at: 2,
            draft: false,
            is_queued: false,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            unaddressed_comment_count: 0,
        }
    }

    #[test]
    fn github_readiness_snapshot_keeps_ci_data_scoped_to_source_sha() {
        let pr = make_github_readiness_pr();
        let snapshot = GitHubReadinessSnapshot {
            source_head_sha: Some("new-head-sha".to_string()),
            status_check_rollup_sha: Some("new-head-sha".to_string()),
            check_runs: CheckRunsResponse {
                total_count: 1,
                check_runs: vec![CheckRun {
                    id: 1,
                    name: "ci".to_string(),
                    status: "completed".to_string(),
                    conclusion: Some("success".to_string()),
                    html_url: "https://example.com/ci".to_string(),
                }],
            },
            combined_status: CombinedStatusResponse {
                state: "success".to_string(),
                statuses: vec![],
                sha: "new-head-sha".to_string(),
                total_count: 0,
                extra: serde_json::json!({}),
            },
            merge_state_status: Some("CLEAN".to_string()),
            mergeable_state: Some("clean".to_string()),
            review_decision: Some("APPROVED".to_string()),
            review_status: Some("approved".to_string()),
            auto_merge_requested: false,
            merge_queue_required: Some(false),
            merge_queue_state: None,
            merge_group_sha: None,
            unresolved_conversations: Some(false),
            policy: RepositoryPolicyFacts::known_empty(),
            warnings: vec![],
        };

        assert!(!needs_rest_ci_for_snapshot(Some(&snapshot)));
        let inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot)).unwrap();
        assert_eq!(inputs.source_head_sha.as_deref(), Some("new-head-sha"));
        assert_eq!(inputs.review_status.as_deref(), Some("approved"));
        assert_eq!(inputs.mergeable_state.as_deref(), Some("clean"));
    }

    #[test]
    fn github_readiness_snapshot_mismatched_rollup_sha_requires_rest_fallback() {
        let pr = make_github_readiness_pr();
        let snapshot = GitHubReadinessSnapshot {
            source_head_sha: Some("new-head-sha".to_string()),
            status_check_rollup_sha: Some("old-head-sha".to_string()),
            check_runs: CheckRunsResponse {
                total_count: 0,
                check_runs: vec![],
            },
            combined_status: CombinedStatusResponse {
                state: "success".to_string(),
                statuses: vec![],
                sha: "old-head-sha".to_string(),
                total_count: 0,
                extra: serde_json::json!({}),
            },
            merge_state_status: Some("CLEAN".to_string()),
            mergeable_state: Some("clean".to_string()),
            review_decision: None,
            review_status: None,
            auto_merge_requested: false,
            merge_queue_required: None,
            merge_queue_state: None,
            merge_group_sha: None,
            unresolved_conversations: None,
            policy: RepositoryPolicyFacts::unknown("missing statusCheckRollup for head SHA"),
            warnings: vec![],
        };

        assert!(needs_rest_ci_for_snapshot(Some(&snapshot)));
        assert!(select_snapshot_readiness_inputs(&pr, Some(&snapshot)).is_none());
    }

    #[test]
    fn github_readiness_unknown_policy_adds_warning_instead_of_known_false() {
        let pr = make_github_readiness_pr();
        let facts = build_merge_readiness_facts(
            &pr,
            None,
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            false,
            false,
            false,
            false,
            None,
        );

        assert_eq!(facts.required_checks_policy_known, Some(false));
        assert_eq!(facts.required_reviews_policy_known, Some(false));
        let warnings = facts.merge_readiness_warnings_or_default();
        assert!(warnings.contains("policy_coverage_unknown"));
    }

    #[test]
    fn github_readiness_strict_policy_blocks_behind_branch() {
        let pr = make_github_readiness_pr();
        let facts = build_merge_readiness_facts(
            &pr,
            None,
            Some(true),
            Some("behind"),
            Some("success"),
            Some("approved"),
            false,
            true,
            true,
            true,
            false,
            None,
        );

        assert_eq!(facts.status.as_deref(), Some("blocked"));
        assert!(facts
            .blockers_json
            .as_deref()
            .unwrap_or_default()
            .contains("branch_behind"));
    }

    #[test]
    fn github_readiness_conversation_resolution_policy_blocks_unresolved_threads() {
        let mut pr = make_github_readiness_pr();
        pr.unaddressed_comment_count = 1;
        let facts = build_merge_readiness_facts(
            &pr,
            None,
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            true,
            true,
            false,
            true,
            None,
        );

        assert_eq!(facts.status.as_deref(), Some("blocked"));
        assert!(facts
            .blockers_json
            .as_deref()
            .unwrap_or_default()
            .contains("unresolved_conversations"));
    }

    fn actor_scoped_pr_details(author: &str) -> PullRequest {
        PullRequest {
            number: 7,
            title: "Readiness".to_string(),
            state: "open".to_string(),
            html_url: "https://github.com/acme/repo/pull/7".to_string(),
            user: GitHubUser {
                login: author.to_string(),
                extra: serde_json::json!({}),
            },
            head: GitHubHead {
                ref_name: "feature/T-42".to_string(),
                sha: "head-sha".to_string(),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: Some(true),
            mergeable_state: Some("clean".to_string()),
            extra: serde_json::json!({}),
        }
    }

    #[test]
    fn github_readiness_actor_scope_prevents_non_actor_ready_handoff() {
        let pr = make_github_readiness_pr();
        let details = actor_scoped_pr_details("other-user");
        let facts = build_merge_readiness_facts(
            &pr,
            Some(&details),
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            true,
            true,
            false,
            false,
            None,
        );

        let facts = enforce_actor_scoped_readiness(facts, Some(&details), Some("octocat"));

        assert_eq!(facts.status.as_deref(), Some("readiness_unknown"));
        assert_eq!(facts.action.as_deref(), Some("wait_for_github"));
        assert!(facts
            .merge_readiness_warnings_or_default()
            .contains("actor_scope_mismatch"));
    }

    #[test]
    fn github_readiness_actor_scope_allows_configured_actor_ready_handoff() {
        let pr = make_github_readiness_pr();
        let details = actor_scoped_pr_details("octocat");
        let facts = build_merge_readiness_facts(
            &pr,
            Some(&details),
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            true,
            true,
            false,
            false,
            None,
        );

        let facts = enforce_actor_scoped_readiness(facts, Some(&details), Some("octocat"));

        assert_eq!(facts.status.as_deref(), Some("ready_to_merge"));
        assert_eq!(facts.action.as_deref(), Some("merge"));
    }

    #[test]
    fn github_readiness_uses_current_polled_draft_state_as_blocker() {
        let pr = make_github_readiness_pr();
        let mut details = actor_scoped_pr_details("octocat");
        details.draft = Some(true);
        let facts = build_merge_readiness_facts(
            &pr,
            Some(&details),
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            true,
            true,
            false,
            false,
            None,
        );

        assert_eq!(facts.status.as_deref(), Some("blocked"));
        assert_eq!(facts.action.as_deref(), Some("resolve_blockers"));
        assert!(facts
            .blockers_json
            .as_deref()
            .unwrap_or_default()
            .contains("draft"));
    }

    #[test]
    fn github_readiness_unknown_policy_does_not_produce_ready_handoff() {
        let pr = make_github_readiness_pr();
        let facts = build_merge_readiness_facts(
            &pr,
            None,
            Some(true),
            Some("clean"),
            Some("success"),
            Some("approved"),
            false,
            false,
            false,
            false,
            false,
            None,
        );

        assert_eq!(facts.status.as_deref(), Some("readiness_unknown"));
        assert_eq!(facts.action.as_deref(), Some("wait_for_github"));
        assert!(facts
            .merge_readiness_warnings_or_default()
            .contains("policy_coverage_unknown"));
    }

    fn known_readiness_policy(
        required_checks: Vec<&str>,
        required_reviews: Option<usize>,
        requires_up_to_date_branch: Option<bool>,
        requires_conversation_resolution: Option<bool>,
        merge_queue_required: Option<bool>,
    ) -> RepositoryPolicyFacts {
        RepositoryPolicyFacts {
            required_checks: PolicyValue::known(
                required_checks.into_iter().map(str::to_string).collect(),
            ),
            required_reviews: PolicyValue::known(required_reviews),
            requires_up_to_date_branch: PolicyValue::known(requires_up_to_date_branch),
            requires_conversation_resolution: PolicyValue::known(requires_conversation_resolution),
            merge_queue_required: PolicyValue::known(merge_queue_required),
            required_deployments: PolicyValue::known(Vec::new()),
            unknown_reasons: Vec::new(),
        }
    }

    fn readiness_snapshot_with_policy(
        source_head_sha: Option<&str>,
        status_check_rollup_sha: Option<&str>,
        policy: RepositoryPolicyFacts,
    ) -> GitHubReadinessSnapshot {
        GitHubReadinessSnapshot {
            source_head_sha: source_head_sha.map(str::to_string),
            status_check_rollup_sha: status_check_rollup_sha.map(str::to_string),
            check_runs: CheckRunsResponse {
                total_count: 1,
                check_runs: vec![CheckRun {
                    id: 10,
                    name: "graphql-ci".to_string(),
                    status: "completed".to_string(),
                    conclusion: Some("success".to_string()),
                    html_url: "https://example.com/graphql-ci".to_string(),
                }],
            },
            combined_status: CombinedStatusResponse {
                state: "success".to_string(),
                statuses: vec![],
                sha: source_head_sha.unwrap_or_default().to_string(),
                total_count: 0,
                extra: serde_json::json!({}),
            },
            merge_state_status: Some("CLEAN".to_string()),
            mergeable_state: Some("clean".to_string()),
            review_decision: Some("APPROVED".to_string()),
            review_status: Some("approved".to_string()),
            auto_merge_requested: false,
            merge_queue_required: None,
            merge_queue_state: None,
            merge_group_sha: Some("merge-group-sha".to_string()),
            unresolved_conversations: Some(true),
            policy,
            warnings: Vec::new(),
        }
    }

    fn ready_to_merge_facts() -> PrMergeReadinessFacts {
        PrMergeReadinessFacts {
            status: Some("ready_to_merge".to_string()),
            action: Some("merge".to_string()),
            blockers_json: None,
            warnings_json: None,
            source_head_sha: Some("old-head-sha".to_string()),
            merge_group_sha: None,
            required_checks_policy_known: Some(true),
            required_reviews_policy_known: Some(true),
            merge_queue_required: None,
            merge_queue_state: None,
            updated_at: 0,
        }
    }

    #[test]
    fn select_snapshot_readiness_inputs_accepts_fresh_graphql_head_data() {
        let pr = make_github_readiness_pr();
        let snapshot = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("graphql-head-sha"),
            RepositoryPolicyFacts::known_empty(),
        );

        let inputs = select_snapshot_readiness_inputs(&pr, Some(&snapshot))
            .expect("fresh GraphQL readiness should be usable");

        assert_eq!(inputs.source_head_sha.as_deref(), Some("graphql-head-sha"));
        assert_eq!(inputs.review_status.as_deref(), Some("approved"));
        assert_eq!(inputs.mergeable_state.as_deref(), Some("clean"));
        assert_eq!(inputs.check_runs.check_runs[0].name, "graphql-ci");
        assert_eq!(inputs.combined_status.sha, "graphql-head-sha");
    }

    #[test]
    fn select_snapshot_readiness_inputs_rejects_missing_or_stale_head_data() {
        let pr = make_github_readiness_pr();
        let missing_head = readiness_snapshot_with_policy(
            None,
            Some("graphql-head-sha"),
            RepositoryPolicyFacts::known_empty(),
        );
        let stale_rollup = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("old-head-sha"),
            RepositoryPolicyFacts::known_empty(),
        );

        assert!(select_snapshot_readiness_inputs(&pr, Some(&missing_head)).is_none());
        assert!(select_snapshot_readiness_inputs(&pr, Some(&stale_rollup)).is_none());
        assert!(select_snapshot_readiness_inputs(&pr, None).is_none());
    }

    #[test]
    fn finalize_readiness_facts_for_poll_preserves_snapshot_queue_facts() {
        let mut snapshot = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("graphql-head-sha"),
            known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(true)),
        );
        snapshot.merge_queue_required = Some(true);
        snapshot.merge_queue_state = None;
        snapshot.merge_group_sha = Some("merge-group-sha".to_string());

        let facts = finalize_readiness_facts_for_poll(
            ready_to_merge_facts(),
            Some(&snapshot),
            "graphql-head-sha",
            false,
            true,
            0,
            1234,
        );

        assert_eq!(facts.status.as_deref(), Some("ready_to_enqueue"));
        assert_eq!(facts.action.as_deref(), Some("enqueue"));
        assert_eq!(facts.source_head_sha.as_deref(), Some("graphql-head-sha"));
        assert_eq!(facts.merge_group_sha.as_deref(), Some("merge-group-sha"));
        assert_eq!(facts.merge_queue_required, Some(true));
        assert_eq!(facts.merge_queue_state.as_deref(), Some("not_queued"));
        assert_eq!(facts.updated_at, 1234);
    }

    #[test]
    fn github_readiness_finalize_uses_merge_group_sha_for_queued_validation() {
        let mut snapshot = readiness_snapshot_with_policy(
            Some("pr-head-sha"),
            Some("pr-head-sha"),
            known_readiness_policy(vec![], Some(0), Some(false), Some(false), Some(true)),
        );
        snapshot.merge_queue_state = Some("QUEUED".to_string());
        snapshot.merge_group_sha = Some("merge-group-sha".to_string());

        let mut queued_facts = ready_to_merge_facts();
        queued_facts.status = Some("queued_pull_request".to_string());
        queued_facts.action = Some("wait_for_queue".to_string());

        let facts = finalize_readiness_facts_for_poll(
            queued_facts,
            Some(&snapshot),
            "pr-head-sha",
            true,
            true,
            0,
            1234,
        );

        assert_eq!(facts.status.as_deref(), Some("queued_pull_request"));
        assert_eq!(facts.action.as_deref(), Some("wait_for_queue"));
        assert_eq!(facts.source_head_sha.as_deref(), Some("merge-group-sha"));
        assert_eq!(facts.merge_group_sha.as_deref(), Some("merge-group-sha"));
        assert_eq!(facts.merge_queue_state.as_deref(), Some("QUEUED"));
    }

    #[test]
    fn finalize_readiness_facts_for_poll_adds_warnings_for_unknown_policy_and_new_comments() {
        let mut snapshot = readiness_snapshot_with_policy(
            Some("graphql-head-sha"),
            Some("graphql-head-sha"),
            RepositoryPolicyFacts::unknown("GraphQL policy unavailable"),
        );
        snapshot.unresolved_conversations = Some(false);

        let facts = finalize_readiness_facts_for_poll(
            ready_to_merge_facts(),
            Some(&snapshot),
            "graphql-head-sha",
            false,
            false,
            1,
            5678,
        );
        let warnings = facts.merge_readiness_warnings_or_default();

        assert_eq!(facts.status.as_deref(), Some("readiness_unknown"));
        assert_eq!(facts.action.as_deref(), Some("wait_for_github"));
        assert!(warnings.contains("policy_coverage_unknown"));
        assert!(warnings.contains("unresolved_conversations"));
        assert_eq!(warnings.matches("unresolved_conversations").count(), 1);
        assert_eq!(facts.updated_at, 5678);
    }
}
