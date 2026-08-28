use crate::github_client::{
    aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required,
    CheckRunsResponse, CombinedStatusResponse, GitHubReadinessSnapshot, PrReview, PullRequest,
};
use serde::Serialize;

use super::super::PrRow;
use super::storage::PrMergeReadinessFacts;

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
    last_known_merge_queue_required: Option<bool>,
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
    }

    readiness_facts.merge_queue_required = readiness_facts
        .merge_queue_required
        .or_else(|| graphql_snapshot.and_then(|snapshot| snapshot.merge_queue_enabled))
        .or(last_known_merge_queue_required);

    if readiness_facts.merge_queue_required == Some(true)
        && !readiness_is_queued
        && readiness_facts.status.as_deref() == Some("ready_to_merge")
    {
        readiness_facts.status = Some("ready_to_enqueue".to_string());
        readiness_facts.action = Some("enqueue".to_string());
        readiness_facts.merge_queue_state = Some("not_queued".to_string());
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
    let has_failed_checks = blockers
        .iter()
        .any(|blocker| blocker.code == "checks_failed");
    let has_pending_checks = blockers
        .iter()
        .any(|blocker| blocker.code == "checks_pending");

    match mergeable_state_lower.as_deref() {
        Some("unstable") if !has_failed_checks && !has_pending_checks => {
            let no_published_checks = matches!(ci_status.as_deref(), None | Some("none"));
            blockers.push(if no_published_checks {
                MergeReadinessReason {
                    code: "checks_pending",
                    message: "Required checks are still running.",
                }
            } else {
                MergeReadinessReason {
                    code: "checks_failed",
                    message: "GitHub reports failing or unstable required checks.",
                }
            });
        }
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

    let (status, action) = if !blockers.is_empty() {
        (Some("blocked"), Some("resolve_blockers"))
    } else if is_queued {
        (Some("queued_pull_request"), Some("wait_for_queue"))
    } else if merge_queue_required == Some(true) {
        (Some("ready_to_enqueue"), Some("enqueue"))
    } else if review_status.as_deref() == Some("review_unknown") {
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
mod tests;
