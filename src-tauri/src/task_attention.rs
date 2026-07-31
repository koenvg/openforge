use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const DEFAULT_FOCUS_STATES: &[&str] = &[
    "idle",
    "needs-input",
    "paused",
    "agent-done",
    "failed",
    "interrupted",
    "pr-draft",
    "pr-open",
    "ci-failed",
    "changes-requested",
    "unaddressed-comments",
    "ready-to-merge",
    "ready-to-enqueue",
    "pr-merged",
    "pr-closed",
    "merge-conflict",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionTask {
    pub id: String,
    pub project_id: Option<String>,
    pub status: String,
    pub title: Option<String>,
    pub initial_prompt: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionSession {
    pub ticket_id: String,
    pub status: String,
    pub checkpoint_data: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionPullRequest {
    pub ticket_id: String,
    pub state: String,
    pub head_sha: String,
    pub ci_status: Option<String>,
    pub review_status: Option<String>,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub merged_at: Option<i64>,
    pub updated_at: i64,
    pub draft: bool,
    pub is_queued: bool,
    pub unaddressed_comment_count: i64,
    pub merge_readiness_status: Option<String>,
    pub merge_readiness_action: Option<String>,
    pub merge_readiness_blockers: Option<String>,
    pub merge_readiness_warnings: Option<String>,
    pub readiness_source_head_sha: Option<String>,
    pub readiness_updated_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionInput {
    pub projects: Vec<TaskAttentionProject>,
    pub tasks: Vec<TaskAttentionTask>,
    pub sessions: Vec<TaskAttentionSession>,
    pub pull_requests: Vec<TaskAttentionPullRequest>,
    pub out_of_focus_by_project: HashMap<String, Vec<String>>,
    pub focus_states_by_project: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TaskAttentionRow {
    pub task_id: String,
    pub project_id: String,
    pub project_name: String,
    pub title: String,
    pub state: String,
    pub reason: String,
    pub activity_at: i64,
}

#[derive(Debug)]
struct Readiness {
    status: String,
    blockers: HashSet<String>,
    warnings: HashSet<String>,
}

fn parse_detail_codes(raw: Option<&str>) -> HashSet<String> {
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

fn persisted_readiness(pr: &TaskAttentionPullRequest) -> Option<Readiness> {
    let status = pr.merge_readiness_status.as_deref()?;
    let action = pr.merge_readiness_action.as_deref()?;
    if !matches!(
        status,
        "ready_to_merge"
            | "ready_to_enqueue"
            | "queued_pull_request"
            | "readiness_unknown"
            | "blocked"
    ) || !matches!(
        action,
        "merge" | "enqueue" | "wait_for_queue" | "wait_for_github" | "resolve_blockers"
    ) {
        return None;
    }
    if pr.readiness_source_head_sha.as_deref() != Some(pr.head_sha.as_str())
        || pr.readiness_updated_at.is_none()
        || pr.readiness_updated_at < Some(pr.updated_at)
    {
        return None;
    }

    let mut blockers = parse_detail_codes(pr.merge_readiness_blockers.as_deref());
    let mut warnings = parse_detail_codes(pr.merge_readiness_warnings.as_deref());
    let no_published_checks = matches!(pr.ci_status.as_deref(), None | Some("none"));
    if pr.mergeable_state.as_deref() == Some("unstable")
        && no_published_checks
        && blockers.remove("checks_failed")
    {
        blockers.insert("checks_pending".to_string());
    }
    if pr.unaddressed_comment_count == 0
        && (blockers.contains("unresolved_conversations")
            || warnings.contains("unresolved_conversations"))
    {
        blockers.remove("unresolved_conversations");
        warnings.remove("unresolved_conversations");
        if status == "blocked" && blockers.is_empty() {
            return None;
        }
    }

    Some(Readiness {
        status: status.to_string(),
        blockers,
        warnings,
    })
}

fn fallback_readiness(pr: &TaskAttentionPullRequest) -> Readiness {
    let mergeable_state = pr.mergeable_state.as_deref().map(str::to_ascii_lowercase);
    let ci_status = pr.ci_status.as_deref().map(str::to_ascii_lowercase);
    let review_status = pr.review_status.as_deref().map(str::to_ascii_lowercase);
    let mut blockers = HashSet::new();
    let mut warnings = HashSet::new();

    if pr.draft {
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
    if pr.unaddressed_comment_count > 0 {
        warnings.insert("unresolved_conversations".to_string());
    }

    let status = if !blockers.is_empty() {
        "blocked"
    } else if pr.is_queued {
        "queued_pull_request"
    } else if matches!(mergeable_state.as_deref(), Some("clean" | "behind"))
        || (mergeable_state.is_none()
            && pr.mergeable == Some(true)
            && matches!(ci_status.as_deref(), None | Some("none"))
            && matches!(review_status.as_deref(), None | Some("none")))
    {
        "ready_to_merge"
    } else if mergeable_state.as_deref() == Some("unknown")
        || pr.mergeable.is_none()
        || (mergeable_state.is_none() && pr.mergeable != Some(false))
    {
        "readiness_unknown"
    } else {
        blockers.insert("mergeability_blocked".to_string());
        "blocked"
    };

    Readiness {
        status: status.to_string(),
        blockers,
        warnings,
    }
}

fn readiness(pr: &TaskAttentionPullRequest) -> Readiness {
    persisted_readiness(pr).unwrap_or_else(|| fallback_readiness(pr))
}

fn readiness_priority(pr: &TaskAttentionPullRequest) -> i32 {
    if pr.state != "open" {
        return if pr.state == "merged" { 100 } else { 90 };
    }

    let readiness = readiness(pr);
    match readiness.status.as_str() {
        "ready_to_merge" => 600,
        "ready_to_enqueue" => 590,
        "blocked" => {
            if readiness.blockers.len() == 1 && readiness.blockers.contains("checks_pending") {
                350
            } else {
                500
            }
        }
        "readiness_unknown" => 300,
        "queued_pull_request" => 250,
        _ => 0,
    }
}

fn driving_pr<'a>(prs: &'a [&TaskAttentionPullRequest]) -> Option<&'a TaskAttentionPullRequest> {
    let mut best = None;
    let mut best_priority = i32::MIN;
    for pr in prs.iter().copied().filter(|pr| pr.state == "open") {
        let priority = readiness_priority(pr);
        if priority > best_priority {
            best = Some(pr);
            best_priority = priority;
        }
    }

    best.or_else(|| {
        prs.iter()
            .copied()
            .find(|pr| matches!(pr.state.as_str(), "closed" | "merged"))
    })
}

fn pr_state(prs: &[&TaskAttentionPullRequest]) -> Option<&'static str> {
    let pr = driving_pr(prs)?;
    if pr.state == "merged" || pr.merged_at.is_some() {
        return Some("pr-merged");
    }
    if pr.state == "closed" {
        return Some("pr-closed");
    }

    let readiness = readiness(pr);
    match readiness.status.as_str() {
        "ready_to_merge" => Some("ready-to-merge"),
        "ready_to_enqueue" => Some("ready-to-enqueue"),
        "queued_pull_request" => Some("pr-queued"),
        "blocked" if readiness.blockers.contains("checks_failed") => Some("ci-failed"),
        "blocked" if readiness.blockers.contains("changes_requested") => Some("changes-requested"),
        "blocked" if readiness.blockers.contains("merge_conflict") => Some("merge-conflict"),
        "blocked"
            if readiness.blockers.contains("unresolved_conversations")
                || readiness.warnings.contains("unresolved_conversations") =>
        {
            Some("unaddressed-comments")
        }
        "blocked" if readiness.blockers.contains("draft") => Some("pr-draft"),
        "blocked" if readiness.blockers.contains("checks_pending") => Some("ci-running"),
        _ if readiness.warnings.contains("unresolved_conversations") => {
            Some("unaddressed-comments")
        }
        _ if pr.review_status.as_deref() == Some("review_required") => Some("review-pending"),
        _ => Some("pr-open"),
    }
}

fn task_state(
    session: Option<&TaskAttentionSession>,
    prs: &[&TaskAttentionPullRequest],
) -> &'static str {
    if let Some(session) = session {
        match session.status.as_str() {
            "running" => return "active",
            "paused" if session.checkpoint_data.is_some() => return "needs-input",
            "paused" => return "paused",
            "failed" => return "failed",
            "interrupted" => return "interrupted",
            _ => {}
        }
    }

    if let Some(state) = pr_state(prs) {
        return state;
    }
    if session.is_some_and(|session| session.status == "completed") {
        return "agent-done";
    }
    "idle"
}

fn task_reason(state: &str, prs: &[&TaskAttentionPullRequest]) -> String {
    if state == "unaddressed-comments" {
        let count = driving_pr(prs)
            .map(|pr| pr.unaddressed_comment_count)
            .unwrap_or(0);
        if count > 0 {
            return format!("{count} unaddressed comment(s) on the pull request.");
        }
    }

    match state {
        "idle" => "No agent running. Start when ready.",
        "active" => "Agent is running — no action needed right now.",
        "needs-input" => "Agent needs your input to continue.",
        "paused" => "Agent paused.",
        "agent-done" => "Agent completed — review the changes.",
        "failed" => "Agent failed — check the error log.",
        "interrupted" => "Agent was interrupted.",
        "pr-draft" => "Pull request is a draft.",
        "pr-open" => "Pull request is open — awaiting review.",
        "ci-running" => "CI pipeline is running.",
        "review-pending" => "Waiting on code review.",
        "ci-failed" => "CI pipeline failed — check the logs.",
        "changes-requested" => "Changes requested on the pull request.",
        "unaddressed-comments" => "Unaddressed comments on the pull request.",
        "ready-to-merge" => "Ready to merge — all checks passed.",
        "ready-to-enqueue" => "Ready to enqueue — all requirements passed.",
        "pr-queued" => "Pull request is queued for merge.",
        "pr-merged" => "Pull request merged.",
        "pr-closed" => "Pull request closed without merge.",
        "merge-conflict" => "Pull request has merge conflicts that must be resolved.",
        other => return format!("Status: {other}"),
    }
    .to_string()
}

pub(crate) fn project_task_attention(input: TaskAttentionInput) -> Vec<TaskAttentionRow> {
    let sessions: HashMap<&str, &TaskAttentionSession> = input
        .sessions
        .iter()
        .map(|session| (session.ticket_id.as_str(), session))
        .collect();
    let mut pull_requests: HashMap<&str, Vec<&TaskAttentionPullRequest>> = HashMap::new();
    for pr in &input.pull_requests {
        pull_requests
            .entry(pr.ticket_id.as_str())
            .or_default()
            .push(pr);
    }

    let mut rows = Vec::new();
    for project in &input.projects {
        let set_aside: HashSet<&str> = input
            .out_of_focus_by_project
            .get(&project.id)
            .into_iter()
            .flatten()
            .map(String::as_str)
            .collect();
        let focus_states: HashSet<&str> = input
            .focus_states_by_project
            .get(&project.id)
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(String::as_str)
            .collect();
        let uses_default_focus_states = !input.focus_states_by_project.contains_key(&project.id);
        let project_row_start = rows.len();

        for task in &input.tasks {
            if task.project_id.as_deref() != Some(project.id.as_str())
                || task.status != "doing"
                || set_aside.contains(task.id.as_str())
            {
                continue;
            }

            let session = sessions.get(task.id.as_str()).copied();
            let prs = pull_requests
                .get(task.id.as_str())
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let state = task_state(session, prs);
            let has_unaddressed_comments = prs.iter().any(|pr| pr.unaddressed_comment_count > 0);
            let is_focus_state = if uses_default_focus_states {
                DEFAULT_FOCUS_STATES.contains(&state)
            } else {
                focus_states.contains(state)
            };
            if matches!(state, "active" | "done") || (!is_focus_state && !has_unaddressed_comments)
            {
                continue;
            }

            let trimmed_title = task.title.as_deref().map(str::trim).unwrap_or_default();
            let title = if trimmed_title.is_empty() {
                if task.initial_prompt.is_empty() {
                    "Untitled task".to_string()
                } else {
                    task.initial_prompt.clone()
                }
            } else {
                trimmed_title.to_string()
            };
            rows.push(TaskAttentionRow {
                task_id: task.id.clone(),
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                title,
                state: state.to_string(),
                reason: task_reason(state, prs),
                activity_at: session.map_or(task.updated_at, |session| session.updated_at),
            });
        }

        rows[project_row_start..].sort_by_key(|row| std::cmp::Reverse(row.activity_at));
    }

    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize)]
    struct CharacterizationFixture {
        projects: Vec<TaskAttentionProject>,
        tasks: Vec<TaskAttentionTask>,
        sessions: Vec<TaskAttentionSession>,
        pull_requests: Vec<TaskAttentionPullRequest>,
        out_of_focus_by_project: HashMap<String, Vec<String>>,
        focus_states_by_project: HashMap<String, Vec<String>>,
        expected: Vec<TaskAttentionRow>,
    }

    #[test]
    fn characterization_fixture_matches_desktop_attention_projection() {
        let fixture: CharacterizationFixture = serde_json::from_str(include_str!(
            "../../fixtures/task_attention_characterization.json"
        ))
        .expect("characterization fixture should deserialize");

        let actual = project_task_attention(TaskAttentionInput {
            projects: fixture.projects,
            tasks: fixture.tasks,
            sessions: fixture.sessions,
            pull_requests: fixture.pull_requests,
            out_of_focus_by_project: fixture.out_of_focus_by_project,
            focus_states_by_project: fixture.focus_states_by_project,
        });

        assert_eq!(actual, fixture.expected);
    }

    #[test]
    fn persisted_readiness_details_require_code_and_message_like_desktop() {
        assert!(parse_detail_codes(Some(r#"[{"code":"checks_failed"}]"#)).is_empty());
        assert_eq!(
            parse_detail_codes(Some(
                r#"[{"code":"checks_failed","message":"Required checks are failing."}]"#
            )),
            HashSet::from(["checks_failed".to_string()])
        );
    }

    fn pull_request() -> TaskAttentionPullRequest {
        TaskAttentionPullRequest {
            ticket_id: "T-1".to_string(),
            state: "open".to_string(),
            head_sha: "sha".to_string(),
            ci_status: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            updated_at: 10,
            draft: false,
            is_queued: false,
            unaddressed_comment_count: 0,
            merge_readiness_status: None,
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            readiness_updated_at: None,
        }
    }

    #[test]
    fn agent_lifecycle_state_boundaries_match_desktop() {
        let cases = [
            ("running", None, "active"),
            ("paused", Some("checkpoint"), "needs-input"),
            ("paused", None, "paused"),
            ("failed", None, "failed"),
            ("interrupted", None, "interrupted"),
            ("completed", None, "agent-done"),
        ];

        for (status, checkpoint_data, expected) in cases {
            let session = TaskAttentionSession {
                ticket_id: "T-1".to_string(),
                status: status.to_string(),
                checkpoint_data: checkpoint_data.map(ToOwned::to_owned),
                updated_at: 10,
            };
            assert_eq!(task_state(Some(&session), &[]), expected, "status {status}");
        }
    }

    #[test]
    fn pull_request_state_boundaries_match_desktop() {
        let mut draft = pull_request();
        draft.draft = true;
        let mut ci_failed = pull_request();
        ci_failed.ci_status = Some("failure".to_string());
        let mut changes_requested = pull_request();
        changes_requested.review_status = Some("changes_requested".to_string());
        let mut conflict = pull_request();
        conflict.mergeable_state = Some("dirty".to_string());
        let mut ci_running = pull_request();
        ci_running.ci_status = Some("pending".to_string());
        let mut review_pending = pull_request();
        review_pending.review_status = Some("review_required".to_string());
        let mut comments = pull_request();
        comments.unaddressed_comment_count = 2;
        let mut ready = pull_request();
        ready.mergeable = Some(true);
        ready.mergeable_state = Some("clean".to_string());
        ready.ci_status = Some("success".to_string());
        ready.review_status = Some("approved".to_string());
        let mut queued = pull_request();
        queued.is_queued = true;
        let mut merged = pull_request();
        merged.state = "merged".to_string();
        let mut closed = pull_request();
        closed.state = "closed".to_string();
        let mut enqueue = pull_request();
        enqueue.merge_readiness_status = Some("ready_to_enqueue".to_string());
        enqueue.merge_readiness_action = Some("enqueue".to_string());
        enqueue.readiness_source_head_sha = Some("sha".to_string());
        enqueue.readiness_updated_at = Some(10);

        let cases = [
            ("draft", draft, "pr-draft"),
            ("ci failed", ci_failed, "ci-failed"),
            ("changes requested", changes_requested, "changes-requested"),
            ("merge conflict", conflict, "merge-conflict"),
            ("ci running", ci_running, "ci-running"),
            ("review pending", review_pending, "review-pending"),
            ("comments", comments, "unaddressed-comments"),
            ("ready", ready, "ready-to-merge"),
            ("queued", queued, "pr-queued"),
            ("merged", merged, "pr-merged"),
            ("closed", closed, "pr-closed"),
            ("enqueue", enqueue, "ready-to-enqueue"),
        ];

        for (name, pr, expected) in cases {
            assert_eq!(pr_state(&[&pr]), Some(expected), "case {name}");
        }
    }

    #[test]
    fn persisted_readiness_freshness_and_invalidation_match_desktop() {
        let blocker = r#"[{"code":"checks_failed","message":"Checks failed."}]"#;
        let mut stale = pull_request();
        stale.mergeable = Some(true);
        stale.mergeable_state = Some("clean".to_string());
        stale.ci_status = Some("success".to_string());
        stale.review_status = Some("approved".to_string());
        stale.merge_readiness_status = Some("blocked".to_string());
        stale.merge_readiness_action = Some("resolve_blockers".to_string());
        stale.merge_readiness_blockers = Some(blocker.to_string());
        stale.readiness_source_head_sha = Some("old-sha".to_string());
        stale.readiness_updated_at = Some(10);
        assert_eq!(pr_state(&[&stale]), Some("ready-to-merge"));

        let mut no_checks = pull_request();
        no_checks.mergeable_state = Some("unstable".to_string());
        no_checks.merge_readiness_status = Some("blocked".to_string());
        no_checks.merge_readiness_action = Some("resolve_blockers".to_string());
        no_checks.merge_readiness_blockers = Some(blocker.to_string());
        no_checks.readiness_source_head_sha = Some("sha".to_string());
        no_checks.readiness_updated_at = Some(10);
        assert_eq!(pr_state(&[&no_checks]), Some("ci-running"));

        let mut resolved = stale.clone();
        resolved.readiness_source_head_sha = Some("sha".to_string());
        resolved.merge_readiness_blockers = Some(
            r#"[{"code":"unresolved_conversations","message":"Resolve comments."}]"#.to_string(),
        );
        assert_eq!(pr_state(&[&resolved]), Some("ready-to-merge"));
    }

    #[test]
    fn pull_request_priority_prefers_more_actionable_readiness() {
        let mut ready = pull_request();
        ready.mergeable = Some(true);
        ready.mergeable_state = Some("clean".to_string());
        ready.ci_status = Some("success".to_string());
        ready.review_status = Some("approved".to_string());
        let mut ci_failed = pull_request();
        ci_failed.ci_status = Some("failure".to_string());

        assert_eq!(pr_state(&[&ci_failed, &ready]), Some("ready-to-merge"));
        assert_eq!(pr_state(&[&ready, &ci_failed]), Some("ready-to-merge"));
    }

    #[test]
    fn pull_request_priority_keeps_the_first_equally_actionable_row() {
        let mut ci_failed = pull_request();
        ci_failed.ci_status = Some("failure".to_string());
        let mut draft = pull_request();
        draft.draft = true;

        assert_eq!(pr_state(&[&ci_failed, &draft]), Some("ci-failed"));
        assert_eq!(pr_state(&[&draft, &ci_failed]), Some("pr-draft"));
    }
}
