use std::collections::HashSet;

use super::super::PrRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PullRequestReadinessStatus {
    ReadyToMerge,
    ReadyToEnqueue,
    QueuedPullRequest,
    ReadinessUnknown,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PullRequestReadinessAction {
    Merge,
    Enqueue,
    WaitForQueue,
    WaitForGithub,
    ResolveBlockers,
}

impl PullRequestReadinessAction {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "merge" => Some(Self::Merge),
            "enqueue" => Some(Self::Enqueue),
            "wait_for_queue" => Some(Self::WaitForQueue),
            "wait_for_github" => Some(Self::WaitForGithub),
            "resolve_blockers" => Some(Self::ResolveBlockers),
            _ => None,
        }
    }
}

impl PullRequestReadinessStatus {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "ready_to_merge" => Some(Self::ReadyToMerge),
            "ready_to_enqueue" => Some(Self::ReadyToEnqueue),
            "queued_pull_request" => Some(Self::QueuedPullRequest),
            "readiness_unknown" => Some(Self::ReadinessUnknown),
            "blocked" => Some(Self::Blocked),
            _ => None,
        }
    }

    fn matches_action(self, action: PullRequestReadinessAction) -> bool {
        matches!(
            (self, action),
            (Self::ReadyToMerge, PullRequestReadinessAction::Merge)
                | (Self::ReadyToEnqueue, PullRequestReadinessAction::Enqueue)
                | (
                    Self::QueuedPullRequest,
                    PullRequestReadinessAction::WaitForQueue
                )
                | (
                    Self::ReadinessUnknown,
                    PullRequestReadinessAction::WaitForGithub
                )
                | (Self::Blocked, PullRequestReadinessAction::ResolveBlockers)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PullRequestReadinessInput<'a> {
    pub(crate) head_sha: &'a str,
    pub(crate) ci_status: Option<&'a str>,
    pub(crate) review_status: Option<&'a str>,
    pub(crate) mergeable: Option<bool>,
    pub(crate) mergeable_state: Option<&'a str>,
    pub(crate) updated_at: i64,
    pub(crate) draft: bool,
    pub(crate) is_queued: bool,
    pub(crate) merge_queue_required: Option<bool>,
    pub(crate) unaddressed_comment_count: i64,
    pub(crate) merge_readiness_status: Option<&'a str>,
    pub(crate) merge_readiness_action: Option<&'a str>,
    pub(crate) merge_readiness_blockers: Option<&'a str>,
    pub(crate) merge_readiness_warnings: Option<&'a str>,
    pub(crate) readiness_source_head_sha: Option<&'a str>,
    pub(crate) readiness_updated_at: Option<i64>,
}

impl<'a> From<&'a PrRow> for PullRequestReadinessInput<'a> {
    fn from(pr: &'a PrRow) -> Self {
        Self {
            head_sha: &pr.head_sha,
            ci_status: pr.ci_status.as_deref(),
            review_status: pr.review_status.as_deref(),
            mergeable: pr.mergeable,
            mergeable_state: pr.mergeable_state.as_deref(),
            updated_at: pr.updated_at,
            draft: pr.draft,
            is_queued: pr.is_queued,
            merge_queue_required: pr.merge_queue_required,
            unaddressed_comment_count: pr.unaddressed_comment_count,
            merge_readiness_status: pr.merge_readiness_status.as_deref(),
            merge_readiness_action: pr.merge_readiness_action.as_deref(),
            merge_readiness_blockers: pr.merge_readiness_blockers.as_deref(),
            merge_readiness_warnings: pr.merge_readiness_warnings.as_deref(),
            readiness_source_head_sha: pr.readiness_source_head_sha.as_deref(),
            readiness_updated_at: pr.readiness_updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PullRequestReadinessView {
    status: PullRequestReadinessStatus,
    blockers: HashSet<String>,
    warnings: HashSet<String>,
}

impl PullRequestReadinessView {
    pub(crate) fn matches_current_persisted(
        pr: &PrRow,
        expected_status: PullRequestReadinessStatus,
    ) -> Option<bool> {
        let (status, action) =
            persisted_readiness_status_and_action(&PullRequestReadinessInput::from(pr))?;
        Some(status == expected_status && status.matches_action(action))
    }

    #[cfg(test)]
    pub(crate) fn current_persisted(pr: &PrRow) -> Option<Self> {
        persisted_readiness_view(&PullRequestReadinessInput::from(pr))
    }

    pub(crate) fn status(&self) -> PullRequestReadinessStatus {
        self.status
    }

    pub(crate) fn has_blocker(&self, code: &str) -> bool {
        self.blockers.contains(code)
    }

    pub(crate) fn has_warning(&self, code: &str) -> bool {
        self.warnings.contains(code)
    }

    pub(crate) fn blocker_count(&self) -> usize {
        self.blockers.len()
    }
}

impl From<&PullRequestReadinessInput<'_>> for PullRequestReadinessView {
    fn from(input: &PullRequestReadinessInput<'_>) -> Self {
        persisted_readiness_view(input).unwrap_or_else(|| fallback_readiness_view(input))
    }
}

impl From<&PrRow> for PullRequestReadinessView {
    fn from(pr: &PrRow) -> Self {
        Self::from(&PullRequestReadinessInput::from(pr))
    }
}

fn parse_readiness_codes(raw: Option<&str>) -> HashSet<String> {
    let Some(raw) = raw else {
        return HashSet::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return HashSet::new();
    };
    let Some(details) = value.as_array() else {
        return HashSet::new();
    };

    details
        .iter()
        .filter_map(|detail| {
            detail.get("message")?.as_str()?;
            detail.get("code")?.as_str().map(ToOwned::to_owned)
        })
        .collect()
}

fn persisted_readiness_status_and_action(
    input: &PullRequestReadinessInput<'_>,
) -> Option<(PullRequestReadinessStatus, PullRequestReadinessAction)> {
    let status = PullRequestReadinessStatus::parse(input.merge_readiness_status?)?;
    let action = PullRequestReadinessAction::parse(input.merge_readiness_action?)?;
    if input.readiness_source_head_sha != Some(input.head_sha)
        || input.readiness_updated_at.is_none()
        || input.readiness_updated_at < Some(input.updated_at)
    {
        return None;
    }
    Some((status, action))
}

fn persisted_readiness_view(
    input: &PullRequestReadinessInput<'_>,
) -> Option<PullRequestReadinessView> {
    let (status, action) = persisted_readiness_status_and_action(input)?;
    if !status.matches_action(action) {
        return None;
    }

    let mut blockers = parse_readiness_codes(input.merge_readiness_blockers);
    let mut warnings = parse_readiness_codes(input.merge_readiness_warnings);
    let no_published_checks = matches!(input.ci_status, None | Some("none"));
    if input.mergeable_state == Some("unstable")
        && no_published_checks
        && blockers.remove("checks_failed")
    {
        blockers.insert("checks_pending".to_string());
    }
    if input.unaddressed_comment_count == 0
        && (blockers.contains("unresolved_conversations")
            || warnings.contains("unresolved_conversations"))
    {
        blockers.remove("unresolved_conversations");
        warnings.remove("unresolved_conversations");
        if status == PullRequestReadinessStatus::Blocked && blockers.is_empty() {
            return None;
        }
    }

    Some(PullRequestReadinessView {
        status,
        blockers,
        warnings,
    })
}

fn fallback_readiness_view(input: &PullRequestReadinessInput<'_>) -> PullRequestReadinessView {
    let mergeable_state = input.mergeable_state.map(str::to_ascii_lowercase);
    let ci_status = input.ci_status.map(str::to_ascii_lowercase);
    let review_status = input.review_status.map(str::to_ascii_lowercase);
    let mut blockers = HashSet::new();
    let mut warnings = HashSet::new();

    if input.draft {
        blockers.insert("draft".to_string());
    }
    if review_status.as_deref() == Some("changes_requested") {
        blockers.insert("changes_requested".to_string());
    }
    match ci_status.as_deref() {
        Some("pending" | "queued" | "in_progress") => {
            blockers.insert("checks_pending".to_string());
        }
        Some("failure" | "error" | "cancelled" | "timed_out" | "action_required") => {
            blockers.insert("checks_failed".to_string());
        }
        _ => {}
    }
    if mergeable_state.as_deref() == Some("unstable")
        && !blockers.contains("checks_failed")
        && !blockers.contains("checks_pending")
    {
        blockers.insert(if matches!(ci_status.as_deref(), None | Some("none")) {
            "checks_pending".to_string()
        } else {
            "checks_failed".to_string()
        });
    }
    match mergeable_state.as_deref() {
        Some("dirty" | "conflicting") => {
            blockers.insert("merge_conflict".to_string());
        }
        Some("blocked") => {
            blockers.insert("mergeability_blocked".to_string());
        }
        Some("behind") => {
            warnings.insert("branch_behind".to_string());
        }
        _ => {}
    }
    if input.unaddressed_comment_count > 0 {
        warnings.insert("unresolved_conversations".to_string());
    }

    let status = if !blockers.is_empty() {
        PullRequestReadinessStatus::Blocked
    } else if input.is_queued {
        PullRequestReadinessStatus::QueuedPullRequest
    } else if matches!(mergeable_state.as_deref(), Some("clean" | "behind"))
        || (mergeable_state.is_none()
            && input.mergeable == Some(true)
            && matches!(ci_status.as_deref(), None | Some("none"))
            && matches!(review_status.as_deref(), None | Some("none")))
    {
        if input.merge_queue_required == Some(true) {
            PullRequestReadinessStatus::ReadyToEnqueue
        } else {
            PullRequestReadinessStatus::ReadyToMerge
        }
    } else if mergeable_state.as_deref() == Some("unknown")
        || input.mergeable.is_none()
        || (mergeable_state.is_none() && input.mergeable != Some(false))
    {
        PullRequestReadinessStatus::ReadinessUnknown
    } else {
        blockers.insert("mergeability_blocked".to_string());
        PullRequestReadinessStatus::Blocked
    };

    PullRequestReadinessView {
        status,
        blockers,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::make_github_readiness_pr;
    use super::*;

    #[test]
    fn readiness_view_uses_fresh_persisted_facts_and_falls_back_when_stale() {
        let mut pr = make_github_readiness_pr();
        pr.ci_status = Some("success".to_string());
        pr.review_status = Some("approved".to_string());
        pr.merge_readiness_status = Some("blocked".to_string());
        pr.merge_readiness_action = Some("resolve_blockers".to_string());
        pr.merge_readiness_blockers = Some(
            r#"[{"code":"checks_failed","message":"Required checks are failing."}]"#.to_string(),
        );
        pr.readiness_source_head_sha = Some("head-sha".to_string());
        pr.readiness_updated_at = Some(pr.updated_at);

        let persisted = PullRequestReadinessView::from(&pr);
        assert_eq!(persisted.status(), PullRequestReadinessStatus::Blocked);
        assert!(persisted.has_blocker("checks_failed"));

        pr.readiness_source_head_sha = Some("stale-head-sha".to_string());
        let fallback = PullRequestReadinessView::from(&pr);
        assert_eq!(fallback.status(), PullRequestReadinessStatus::ReadyToMerge);
        assert!(!fallback.has_blocker("checks_failed"));
    }

    #[test]
    fn current_persisted_readiness_rejects_mismatched_status_and_action() {
        let mut pr = make_github_readiness_pr();
        pr.merge_readiness_status = Some("ready_to_merge".to_string());
        pr.merge_readiness_action = Some("enqueue".to_string());
        pr.readiness_source_head_sha = Some("head-sha".to_string());
        pr.readiness_updated_at = Some(pr.updated_at);

        assert!(PullRequestReadinessView::current_persisted(&pr).is_none());
    }

    #[test]
    fn readiness_view_falls_back_from_mismatched_persisted_status_and_action() {
        let mut pr = make_github_readiness_pr();
        pr.merge_readiness_status = Some("ready_to_enqueue".to_string());
        pr.merge_readiness_action = Some("merge".to_string());
        pr.readiness_source_head_sha = Some("head-sha".to_string());
        pr.readiness_updated_at = Some(pr.updated_at);

        let readiness = PullRequestReadinessView::from(&pr);

        assert_eq!(readiness.status(), PullRequestReadinessStatus::ReadyToMerge);
    }

    fn stale_ready_to_merge_pr(merge_queue_required: Option<bool>) -> PrRow {
        let mut pr = make_github_readiness_pr();
        pr.merge_readiness_status = Some("ready_to_merge".to_string());
        pr.merge_readiness_action = Some("merge".to_string());
        pr.readiness_source_head_sha = Some("stale-head-sha".to_string());
        pr.readiness_updated_at = Some(pr.updated_at);
        pr.merge_queue_required = merge_queue_required;
        pr
    }

    #[test]
    fn fresh_persisted_ready_to_merge_outranks_the_merge_queue_requirement() {
        let mut pr = stale_ready_to_merge_pr(Some(true));
        pr.readiness_source_head_sha = Some(pr.head_sha.clone());

        let readiness = PullRequestReadinessView::from(&pr);

        assert_eq!(readiness.status(), PullRequestReadinessStatus::ReadyToMerge);
    }

    #[test]
    fn stale_ready_to_merge_falls_back_to_ready_to_enqueue_when_the_merge_queue_is_required() {
        let readiness = PullRequestReadinessView::from(&stale_ready_to_merge_pr(Some(true)));

        assert_eq!(
            readiness.status(),
            PullRequestReadinessStatus::ReadyToEnqueue
        );
    }

    #[test]
    fn stale_ready_to_merge_stays_ready_to_merge_when_the_merge_queue_is_not_required() {
        let readiness = PullRequestReadinessView::from(&stale_ready_to_merge_pr(Some(false)));

        assert_eq!(readiness.status(), PullRequestReadinessStatus::ReadyToMerge);
    }

    #[test]
    fn persisted_readiness_details_require_code_and_message() {
        assert!(parse_readiness_codes(Some(r#"[{"code":"checks_failed"}]"#)).is_empty());
        assert_eq!(
            parse_readiness_codes(Some(
                r#"[{"code":"draft"},{"code":"checks_failed","message":"Required checks are failing."}]"#
            )),
            HashSet::from(["checks_failed".to_string()])
        );
    }
}
