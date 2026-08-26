use crate::db::{PullRequestReadinessInput, PullRequestReadinessStatus, PullRequestReadinessView};
use crate::task_prompt::parse_image_reference_definition;
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
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
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
    #[serde(default)]
    pub pr_number: Option<i64>,
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

fn readiness(pr: &TaskAttentionPullRequest) -> PullRequestReadinessView {
    let input = PullRequestReadinessInput {
        head_sha: &pr.head_sha,
        ci_status: pr.ci_status.as_deref(),
        review_status: pr.review_status.as_deref(),
        mergeable: pr.mergeable,
        mergeable_state: pr.mergeable_state.as_deref(),
        updated_at: pr.updated_at,
        draft: pr.draft,
        is_queued: pr.is_queued,
        unaddressed_comment_count: pr.unaddressed_comment_count,
        merge_readiness_status: pr.merge_readiness_status.as_deref(),
        merge_readiness_action: pr.merge_readiness_action.as_deref(),
        merge_readiness_blockers: pr.merge_readiness_blockers.as_deref(),
        merge_readiness_warnings: pr.merge_readiness_warnings.as_deref(),
        readiness_source_head_sha: pr.readiness_source_head_sha.as_deref(),
        readiness_updated_at: pr.readiness_updated_at,
    };
    PullRequestReadinessView::from(&input)
}

fn readiness_priority(pr: &TaskAttentionPullRequest) -> i32 {
    if pr.state != "open" {
        return if pr.state == "merged" { 100 } else { 90 };
    }

    let readiness = readiness(pr);
    match readiness.status() {
        PullRequestReadinessStatus::ReadyToMerge => 600,
        PullRequestReadinessStatus::ReadyToEnqueue => 590,
        PullRequestReadinessStatus::Blocked => {
            if readiness.blocker_count() == 1 && readiness.has_blocker("checks_pending") {
                350
            } else {
                500
            }
        }
        PullRequestReadinessStatus::ReadinessUnknown => 300,
        PullRequestReadinessStatus::QueuedPullRequest => 250,
    }
}

pub(crate) fn driving_pr<'a>(
    prs: &'a [&TaskAttentionPullRequest],
) -> Option<&'a TaskAttentionPullRequest> {
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
    match readiness.status() {
        PullRequestReadinessStatus::ReadyToMerge => Some("ready-to-merge"),
        PullRequestReadinessStatus::ReadyToEnqueue => Some("ready-to-enqueue"),
        PullRequestReadinessStatus::QueuedPullRequest => Some("pr-queued"),
        PullRequestReadinessStatus::Blocked if readiness.has_blocker("checks_failed") => {
            Some("ci-failed")
        }
        PullRequestReadinessStatus::Blocked if readiness.has_blocker("changes_requested") => {
            Some("changes-requested")
        }
        PullRequestReadinessStatus::Blocked if readiness.has_blocker("merge_conflict") => {
            Some("merge-conflict")
        }
        PullRequestReadinessStatus::Blocked
            if readiness.has_blocker("unresolved_conversations")
                || readiness.has_warning("unresolved_conversations") =>
        {
            Some("unaddressed-comments")
        }
        PullRequestReadinessStatus::Blocked if readiness.has_blocker("draft") => Some("pr-draft"),
        PullRequestReadinessStatus::Blocked if readiness.has_blocker("checks_pending") => {
            Some("ci-running")
        }
        _ if readiness.has_warning("unresolved_conversations") => Some("unaddressed-comments"),
        _ if pr.review_status.as_deref() == Some("review_required") => Some("review-pending"),
        _ => Some("pr-open"),
    }
}

pub(crate) fn task_state(
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

pub(crate) fn task_reason(state: &str, prs: &[&TaskAttentionPullRequest]) -> String {
    if state == "unaddressed-comments" {
        let count = driving_pr(prs)
            .map(|pr| pr.unaddressed_comment_count)
            .unwrap_or(0);
        if count > 0 {
            return format!("{count} unaddressed comment(s) on the pull request.");
        }
    }

    match state {
        "backlog" => "In backlog — not started yet.",
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

pub(crate) fn task_display_title(
    task_id: &str,
    title: Option<&str>,
    initial_prompt: &str,
) -> String {
    if let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) {
        return title.to_string();
    }
    initial_prompt
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            (!trimmed.is_empty() && parse_image_reference_definition(line).is_none())
                .then_some(trimmed)
        })
        .unwrap_or(task_id)
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

            rows.push(attention_row(project, task, session, prs, state));
        }

        rows[project_row_start..].sort_by_key(|row| std::cmp::Reverse(row.activity_at));
    }

    rows
}

fn attention_row(
    project: &TaskAttentionProject,
    task: &TaskAttentionTask,
    session: Option<&TaskAttentionSession>,
    prs: &[&TaskAttentionPullRequest],
    state: &str,
) -> TaskAttentionRow {
    TaskAttentionRow {
        task_id: task.id.clone(),
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        title: task_display_title(&task.id, task.title.as_deref(), &task.initial_prompt),
        state: state.to_string(),
        reason: task_reason(state, prs),
        activity_at: session.map_or(task.updated_at, |session| session.updated_at),
    }
}

/// The four Board lanes, projected across every Project.
///
/// Every lane holds attention-shaped rows, so the desktop overview can swap one lane's list
/// for another's without a second row type.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TaskLaneRows {
    pub focus: Vec<TaskAttentionRow>,
    pub in_flight: Vec<TaskAttentionRow>,
    pub out_of_focus: Vec<TaskAttentionRow>,
    pub backlog: Vec<TaskAttentionRow>,
}

/// Partition every startable Task across all Projects into the Board's four lanes.
///
/// `focus` is the attention projection itself. The other three lanes cover what it leaves
/// behind, using the Board's rules (see `project_board`): a parked Task is Out of Focus
/// whatever its state, an unstarted Task is Backlog, and everything else is In Flight —
/// running agents included, which is why In Flight applies no focus-state filter. A Task
/// lands in exactly one lane.
pub(crate) fn project_task_lanes(input: TaskAttentionInput) -> TaskLaneRows {
    let focus = project_task_attention(input.clone());
    let focus_ids: HashSet<&str> = focus.iter().map(|row| row.task_id.as_str()).collect();

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

    let mut in_flight = Vec::new();
    let mut out_of_focus = Vec::new();
    let mut backlog = Vec::new();

    for project in &input.projects {
        let set_aside: HashSet<&str> = input
            .out_of_focus_by_project
            .get(&project.id)
            .into_iter()
            .flatten()
            .map(String::as_str)
            .collect();
        let lane_starts = [in_flight.len(), out_of_focus.len(), backlog.len()];

        for task in &input.tasks {
            if task.project_id.as_deref() != Some(project.id.as_str())
                || !matches!(task.status.as_str(), "backlog" | "doing")
                || focus_ids.contains(task.id.as_str())
            {
                continue;
            }

            let session = sessions.get(task.id.as_str()).copied();
            let prs = pull_requests
                .get(task.id.as_str())
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            // An unstarted Task has no agent and no pull request to read a state from, so
            // "backlog" is its state, matching the Board.
            let (state, lane) = if task.status == "backlog" {
                ("backlog", &mut backlog)
            } else if set_aside.contains(task.id.as_str()) {
                (task_state(session, prs), &mut out_of_focus)
            } else {
                (task_state(session, prs), &mut in_flight)
            };
            lane.push(attention_row(project, task, session, prs, state));
        }

        // Sort within the Project's own slice so lanes stay grouped in sidebar order.
        for (lane, start) in [
            (&mut in_flight, lane_starts[0]),
            (&mut out_of_focus, lane_starts[1]),
            (&mut backlog, lane_starts[2]),
        ] {
            lane[start..].sort_by_key(|row: &TaskAttentionRow| std::cmp::Reverse(row.activity_at));
        }
    }

    TaskLaneRows {
        focus,
        in_flight,
        out_of_focus,
        backlog,
    }
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

    fn set_aside_task(id: &str, project_id: &str, updated_at: i64) -> TaskAttentionTask {
        TaskAttentionTask {
            id: id.to_string(),
            project_id: Some(project_id.to_string()),
            status: "doing".to_string(),
            title: Some(format!("Title {id}")),
            initial_prompt: String::new(),
            updated_at,
            depends_on: Vec::new(),
            labels: Vec::new(),
        }
    }

    fn lane_ids(rows: &[TaskAttentionRow]) -> Vec<&str> {
        rows.iter().map(|row| row.task_id.as_str()).collect()
    }

    #[test]
    fn lane_projection_partitions_every_startable_task_once() {
        let mut backlog_task = set_aside_task("t-backlog", "p1", 40);
        backlog_task.status = "backlog".to_string();
        let mut deleted = set_aside_task("t-deleted", "p1", 50);
        deleted.status = "done".to_string();

        let lanes = project_task_lanes(TaskAttentionInput {
            projects: vec![TaskAttentionProject {
                id: "p1".to_string(),
                name: "Project One".to_string(),
            }],
            tasks: vec![
                set_aside_task("t-focus", "p1", 30),
                set_aside_task("t-parked-old", "p1", 10),
                set_aside_task("t-parked-new", "p1", 20),
                set_aside_task("t-running", "p1", 15),
                backlog_task,
                deleted,
            ],
            sessions: vec![TaskAttentionSession {
                ticket_id: "t-running".to_string(),
                status: "running".to_string(),
                checkpoint_data: None,
                updated_at: 60,
            }],
            pull_requests: Vec::new(),
            out_of_focus_by_project: HashMap::from([(
                "p1".to_string(),
                vec!["t-parked-old".to_string(), "t-parked-new".to_string()],
            )]),
            focus_states_by_project: HashMap::new(),
        });

        // Idle and unparked, so it needs the user.
        assert_eq!(lane_ids(&lanes.focus), vec!["t-focus"]);
        // A running agent needs nothing from the user, so it flies rather than sitting in focus.
        assert_eq!(lane_ids(&lanes.in_flight), vec!["t-running"]);
        assert_eq!(lanes.in_flight[0].state, "active");
        // Parked rows come newest-activity first, like every other lane.
        assert_eq!(
            lane_ids(&lanes.out_of_focus),
            vec!["t-parked-new", "t-parked-old"],
        );
        assert_eq!(lane_ids(&lanes.backlog), vec!["t-backlog"]);
        assert_eq!(lanes.backlog[0].state, "backlog");
        assert_eq!(lanes.backlog[0].reason, "In backlog — not started yet.");
        assert_eq!(lanes.focus[0].project_name, "Project One");
    }

    #[test]
    fn lane_projection_keeps_parked_and_in_flight_tasks_out_of_the_focus_state_filter() {
        // Neither lane applies the focus-state rule: a parked Task stays where the user put
        // it, and a Task the filter rejected is exactly what In Flight is for.
        let lanes = project_task_lanes(TaskAttentionInput {
            projects: vec![TaskAttentionProject {
                id: "p1".to_string(),
                name: "Project One".to_string(),
            }],
            tasks: vec![
                set_aside_task("t-parked-running", "p1", 10),
                set_aside_task("t-idle", "p1", 10),
            ],
            sessions: vec![TaskAttentionSession {
                ticket_id: "t-parked-running".to_string(),
                status: "running".to_string(),
                checkpoint_data: None,
                updated_at: 50,
            }],
            pull_requests: Vec::new(),
            out_of_focus_by_project: HashMap::from([(
                "p1".to_string(),
                vec!["t-parked-running".to_string()],
            )]),
            // "idle" is not a focus state here, so the idle Task drops out of focus.
            focus_states_by_project: HashMap::from([(
                "p1".to_string(),
                vec!["failed".to_string()],
            )]),
        });

        assert!(lanes.focus.is_empty());
        assert_eq!(lane_ids(&lanes.in_flight), vec!["t-idle"]);
        assert_eq!(lane_ids(&lanes.out_of_focus), vec!["t-parked-running"]);
        assert_eq!(lanes.out_of_focus[0].state, "active");
        // The row ages off the last recorded state change, so the dialog can show how long
        // a Task has been sitting in its lane.
        assert_eq!(lanes.out_of_focus[0].activity_at, 50);
    }

    #[test]
    fn lane_projection_groups_lanes_by_project_in_sidebar_order() {
        let lanes = project_task_lanes(TaskAttentionInput {
            projects: vec![
                TaskAttentionProject {
                    id: "p1".to_string(),
                    name: "Project One".to_string(),
                },
                TaskAttentionProject {
                    id: "p2".to_string(),
                    name: "Project Two".to_string(),
                },
            ],
            tasks: vec![
                set_aside_task("p2-old", "p2", 10),
                set_aside_task("p1-new", "p1", 99),
                set_aside_task("p2-new", "p2", 20),
                set_aside_task("p1-old", "p1", 1),
            ],
            sessions: Vec::new(),
            pull_requests: Vec::new(),
            out_of_focus_by_project: HashMap::from([
                (
                    "p1".to_string(),
                    vec!["p1-new".to_string(), "p1-old".to_string()],
                ),
                (
                    "p2".to_string(),
                    vec!["p2-new".to_string(), "p2-old".to_string()],
                ),
            ]),
            focus_states_by_project: HashMap::new(),
        });

        // Each Project's rows sort among themselves. A global sort would pull p1-old (activity
        // 1) below both Project Two rows and interleave the two Projects.
        assert_eq!(
            lane_ids(&lanes.out_of_focus),
            vec!["p1-new", "p1-old", "p2-new", "p2-old"],
        );
    }

    fn pull_request() -> TaskAttentionPullRequest {
        TaskAttentionPullRequest {
            ticket_id: "T-1".to_string(),
            pr_number: Some(1),
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

    #[test]
    fn display_title_fallback_skips_image_definitions_and_uses_first_text_line() {
        assert_eq!(
            task_display_title(
                "T-42",
                None,
                "\n[image#1]: data:image/png;base64,c2VjcmV0\n  Review the generated changes  ",
            ),
            "Review the generated changes"
        );
        assert_eq!(
            task_display_title("T-42", None, "[image#1]: data:image/png;base64,c2VjcmV0",),
            "T-42"
        );
        assert_eq!(task_display_title("T-42", None, "\n\r\n"), "T-42");
    }

    #[test]
    fn display_title_fallback_keeps_noncanonical_image_like_lines() {
        assert_eq!(
            task_display_title(
                "T-42",
                None,
                "[image#1]: data:image/png;base64,   \nReview the generated changes",
            ),
            "[image#1]: data:image/png;base64,"
        );
        assert_eq!(
            task_display_title(
                "T-42",
                None,
                "[image#1]: data:image/svg_xml;base64,YQ==\nReview the generated changes",
            ),
            "[image#1]: data:image/svg_xml;base64,YQ=="
        );
    }
}
