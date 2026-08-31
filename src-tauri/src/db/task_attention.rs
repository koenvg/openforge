use rusqlite::Result;
use std::collections::HashMap;

use crate::{
    project_board::{project_task_board, ProjectBoardProjection},
    task_attention::{
        project_task_attention, project_task_lanes, TaskAttentionInput, TaskAttentionProject,
        TaskAttentionPullRequest, TaskAttentionRow, TaskAttentionSession, TaskAttentionTask,
        TaskLaneRows,
    },
};

const FOCUS_FILTER_CONFIG_KEY: &str = "focus_filter_states";
const OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY: &str = "low_fire_task_ids";
const ALL_TASK_STATES: &[&str] = &[
    "idle",
    "active",
    "needs-input",
    "paused",
    "agent-done",
    "failed",
    "interrupted",
    "pr-draft",
    "pr-open",
    "ci-running",
    "review-pending",
    "ci-failed",
    "changes-requested",
    "unaddressed-comments",
    "ready-to-merge",
    "ready-to-enqueue",
    "pr-queued",
    "pr-merged",
    "pr-closed",
    "merge-conflict",
];
const LEGACY_DEFAULT_FOCUS_STATE_SETS: &[&[&str]] = &[
    &[
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
        "pr-merged",
    ],
    &[
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
        "pr-merged",
        "merge-conflict",
    ],
    &[
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
        "pr-merged",
        "pr-closed",
        "merge-conflict",
    ],
];

fn parse_string_list(raw: Option<String>) -> Option<Vec<String>> {
    serde_json::from_str::<Vec<String>>(raw.as_deref()?).ok()
}

fn parse_focus_states(raw: Option<String>) -> Option<Vec<String>> {
    let states = parse_string_list(raw)?;
    if !states
        .iter()
        .all(|state| ALL_TASK_STATES.contains(&state.as_str()))
        || LEGACY_DEFAULT_FOCUS_STATE_SETS
            .iter()
            .any(|legacy| states.iter().map(String::as_str).eq(legacy.iter().copied()))
    {
        return None;
    }

    Some(
        states
            .into_iter()
            .filter(|state| state != "active")
            .collect(),
    )
}

impl super::Database {
    /// Returns the backend-authoritative, Task-only attention projection.
    ///
    /// Standalone review-request pull requests intentionally remain outside this seam.
    pub(crate) fn get_task_attention_rows(&self) -> Result<Vec<TaskAttentionRow>> {
        Ok(project_task_attention(self.get_task_projection_input()?))
    }

    /// Returns every startable Task across all Projects, split into the four Board lanes.
    pub(crate) fn get_task_lane_rows(&self) -> Result<TaskLaneRows> {
        Ok(project_task_lanes(self.get_task_projection_input()?))
    }

    /// Returns the backend-authoritative four-lane Board projection for a Project.
    pub(crate) fn get_project_board(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectBoardProjection>> {
        Ok(project_task_board(
            self.get_task_projection_input()?,
            project_id,
        ))
    }

    fn get_task_projection_input(&self) -> Result<TaskAttentionInput> {
        let projects = self.get_all_projects()?;
        let active_tasks = self.get_active_task_details(None)?;
        let active_task_ids: Vec<String> =
            active_tasks.iter().map(|task| task.id.clone()).collect();
        let relationship_references = self.get_active_task_relationship_references()?;
        let sessions = self.get_latest_sessions_for_tickets(&active_task_ids)?;
        let pull_requests = self.get_all_pull_requests()?;
        let mut out_of_focus_by_project = HashMap::new();
        let mut focus_states_by_project = HashMap::new();

        for project in &projects {
            if let Some(task_ids) = parse_string_list(
                self.get_project_config(&project.id, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY)?,
            ) {
                if !task_ids.is_empty() {
                    out_of_focus_by_project.insert(project.id.clone(), task_ids);
                }
            }
            if let Some(states) =
                parse_focus_states(self.get_project_config(&project.id, FOCUS_FILTER_CONFIG_KEY)?)
            {
                focus_states_by_project.insert(project.id.clone(), states);
            }
        }

        Ok(TaskAttentionInput {
            projects: projects
                .into_iter()
                .map(|project| TaskAttentionProject {
                    id: project.id,
                    name: project.name,
                })
                .collect(),
            tasks: active_tasks
                .into_iter()
                .map(|task| TaskAttentionTask {
                    id: task.id,
                    project_id: task.project_id,
                    status: task.status,
                    title: Some(task.title),
                    initial_prompt: task.prompt,
                    updated_at: task.updated_at,
                    depends_on: task.depends_on,
                    labels: task.labels.into_iter().map(|label| label.name).collect(),
                })
                .chain(relationship_references.into_iter().map(|task| {
                    let title = task.title;
                    TaskAttentionTask {
                        id: task.id,
                        project_id: task.project_id,
                        status: task.status,
                        title: Some(title.clone()),
                        initial_prompt: title,
                        updated_at: 0,
                        depends_on: task.depends_on,
                        labels: Vec::new(),
                    }
                }))
                .collect(),
            sessions: sessions
                .into_iter()
                .map(|session| TaskAttentionSession {
                    ticket_id: session.ticket_id,
                    status: session.status,
                    checkpoint_data: session.checkpoint_data,
                    updated_at: session.updated_at,
                })
                .collect(),
            pull_requests: pull_requests
                .into_iter()
                .map(|pr| TaskAttentionPullRequest {
                    ticket_id: pr.ticket_id,
                    pr_number: Some(pr.pr_number),
                    state: pr.state,
                    head_sha: pr.head_sha,
                    ci_status: pr.ci_status,
                    review_status: pr.review_status,
                    mergeable: pr.mergeable,
                    mergeable_state: pr.mergeable_state,
                    merged_at: pr.merged_at,
                    updated_at: pr.updated_at,
                    draft: pr.draft,
                    is_queued: pr.is_queued,
                    merge_queue_required: pr.merge_queue_required,
                    unaddressed_comment_count: pr.unaddressed_comment_count,
                    merge_readiness_status: pr.merge_readiness_status,
                    merge_readiness_action: pr.merge_readiness_action,
                    merge_readiness_blockers: pr.merge_readiness_blockers,
                    merge_readiness_warnings: pr.merge_readiness_warnings,
                    readiness_source_head_sha: pr.readiness_source_head_sha,
                    readiness_updated_at: pr.readiness_updated_at,
                })
                .collect(),
            out_of_focus_by_project,
            focus_states_by_project,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_config_keeps_custom_states_and_removes_active() {
        assert_eq!(
            parse_focus_states(Some(r#"["failed","active"]"#.to_string())),
            Some(vec!["failed".to_string()])
        );
    }

    #[test]
    fn invalid_and_legacy_focus_configs_fall_back_to_current_defaults() {
        assert_eq!(parse_focus_states(Some(r#"["unknown"]"#.to_string())), None);
        assert_eq!(
            parse_focus_states(Some(
                serde_json::to_string(LEGACY_DEFAULT_FOCUS_STATE_SETS[0])
                    .expect("legacy states should serialize")
            )),
            None
        );
    }

    #[test]
    fn board_projection_ignores_unrelated_completed_history_and_resolves_dependencies() {
        let (db, _temp_dir) =
            crate::db::test_helpers::make_test_db("task_attention_bounded_history");
        let project = db
            .create_project("Project", "/tmp/task-attention-bounded-history")
            .expect("create project");
        let dependency = db
            .create_task(
                "Completed dependency",
                "done",
                Some(&project.id),
                None,
                None,
            )
            .expect("create dependency");
        let active = db
            .create_task(
                "Active backlog task",
                "backlog",
                Some(&project.id),
                None,
                None,
            )
            .expect("create active task");
        db.add_task_dependency(&active.id, &dependency.id)
            .expect("link dependency");
        db.add_task_label(&active.id, "feature")
            .expect("label active task");
        let large_prompt = "x".repeat(16 * 1024);
        for index in 0..256 {
            db.create_task(
                &format!("unrelated completed {index} {large_prompt}"),
                "done",
                Some(&project.id),
                None,
                None,
            )
            .expect("create unrelated completed task");
        }

        let board = db
            .get_project_board(&project.id)
            .expect("project board")
            .expect("project exists");
        assert_eq!(board.backlog.len(), 1);
        assert_eq!(board.backlog[0].task_id, active.id);
        assert_eq!(board.backlog[0].dependency_count, 1);
        assert_eq!(board.backlog[0].waiting_dependency_count, 0);
        assert_eq!(board.backlog[0].labels, vec!["feature".to_string()]);
        assert!(board.focus.is_empty());
        assert!(board.in_flight.is_empty());
        assert!(board.out_of_focus.is_empty());
    }
}
