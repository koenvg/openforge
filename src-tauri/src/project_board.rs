use crate::task_attention::{
    project_task_attention, task_display_title, task_reason, task_state, TaskAttentionInput,
    TaskAttentionPullRequest, TaskAttentionSession,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProjectBoardLane {
    Focus,
    InFlight,
    OutOfFocus,
    Backlog,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct ProjectBoardTask {
    pub task_id: String,
    pub title: String,
    pub lane: ProjectBoardLane,
    pub state: String,
    pub reason: String,
    pub activity_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct ProjectBoardProjection {
    pub project_id: String,
    pub project_name: String,
    pub focus: Vec<ProjectBoardTask>,
    pub in_flight: Vec<ProjectBoardTask>,
    pub out_of_focus: Vec<ProjectBoardTask>,
    pub backlog: Vec<ProjectBoardTask>,
}

pub(crate) fn project_task_board(
    input: TaskAttentionInput,
    project_id: &str,
) -> Option<ProjectBoardProjection> {
    let project = input
        .projects
        .iter()
        .find(|project| project.id == project_id)?
        .clone();
    let focus = project_task_attention(input.clone())
        .into_iter()
        .filter(|row| row.project_id == project_id)
        .map(|row| ProjectBoardTask {
            task_id: row.task_id,
            title: row.title,
            lane: ProjectBoardLane::Focus,
            state: row.state,
            reason: row.reason,
            activity_at: row.activity_at,
        })
        .collect::<Vec<_>>();
    let focus_task_ids = focus
        .iter()
        .map(|row| row.task_id.as_str())
        .collect::<HashSet<_>>();
    let sessions = input
        .sessions
        .iter()
        .map(|session| (session.ticket_id.as_str(), session))
        .collect::<HashMap<&str, &TaskAttentionSession>>();
    let mut pull_requests = HashMap::<&str, Vec<&TaskAttentionPullRequest>>::new();
    for pull_request in &input.pull_requests {
        pull_requests
            .entry(pull_request.ticket_id.as_str())
            .or_default()
            .push(pull_request);
    }
    let out_of_focus = input
        .out_of_focus_by_project
        .get(project_id)
        .into_iter()
        .flatten()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut in_flight = Vec::new();
    let mut out_of_focus_rows = Vec::new();
    let mut backlog = Vec::new();

    for task in input
        .tasks
        .iter()
        .filter(|task| task.project_id.as_deref() == Some(project_id))
        .filter(|task| matches!(task.status.as_str(), "backlog" | "doing"))
    {
        if focus_task_ids.contains(task.id.as_str()) {
            continue;
        }
        let session = sessions.get(task.id.as_str()).copied();
        let task_pull_requests = pull_requests
            .get(task.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        let state = if task.status == "backlog" {
            "egg"
        } else {
            task_state(session, task_pull_requests)
        };
        let lane = if task.status == "backlog" {
            ProjectBoardLane::Backlog
        } else if out_of_focus.contains(task.id.as_str()) {
            ProjectBoardLane::OutOfFocus
        } else {
            ProjectBoardLane::InFlight
        };
        let row = ProjectBoardTask {
            task_id: task.id.clone(),
            title: task_display_title(&task.id, task.title.as_deref(), &task.initial_prompt),
            lane,
            state: state.to_string(),
            reason: task_reason(state, task_pull_requests),
            activity_at: session.map_or(task.updated_at, |session| session.updated_at),
        };
        match lane {
            ProjectBoardLane::Focus => unreachable!("Focus rows are projected separately"),
            ProjectBoardLane::InFlight => in_flight.push(row),
            ProjectBoardLane::OutOfFocus => out_of_focus_rows.push(row),
            ProjectBoardLane::Backlog => backlog.push(row),
        }
    }

    for lane in [&mut in_flight, &mut out_of_focus_rows, &mut backlog] {
        lane.sort_by_key(|row| std::cmp::Reverse(row.activity_at));
    }

    Some(ProjectBoardProjection {
        project_id: project.id,
        project_name: project.name,
        focus,
        in_flight,
        out_of_focus: out_of_focus_rows,
        backlog,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_attention::{
        TaskAttentionProject, TaskAttentionPullRequest, TaskAttentionSession, TaskAttentionTask,
    };
    use std::collections::HashMap;

    #[derive(Debug, Deserialize)]
    struct CharacterizationFixture {
        projects: Vec<TaskAttentionProject>,
        tasks: Vec<TaskAttentionTask>,
        sessions: Vec<TaskAttentionSession>,
        pull_requests: Vec<TaskAttentionPullRequest>,
        out_of_focus_by_project: HashMap<String, Vec<String>>,
        focus_states_by_project: HashMap<String, Vec<String>>,
        expected_boards: HashMap<String, ProjectBoardProjection>,
    }

    #[test]
    fn characterization_fixture_partitions_every_active_task_once() {
        let fixture: CharacterizationFixture = serde_json::from_str(include_str!(
            "../../fixtures/task_attention_characterization.json"
        ))
        .expect("characterization fixture should deserialize");
        let expected = fixture
            .expected_boards
            .get("P-alpha")
            .expect("alpha board fixture");
        let actual = project_task_board(
            TaskAttentionInput {
                projects: fixture.projects,
                tasks: fixture.tasks,
                sessions: fixture.sessions,
                pull_requests: fixture.pull_requests,
                out_of_focus_by_project: fixture.out_of_focus_by_project,
                focus_states_by_project: fixture.focus_states_by_project,
            },
            "P-alpha",
        )
        .expect("alpha project should exist");

        assert_eq!(&actual, expected);
        let task_ids = actual
            .focus
            .iter()
            .chain(&actual.in_flight)
            .chain(&actual.out_of_focus)
            .chain(&actual.backlog)
            .map(|task| task.task_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(task_ids.len(), 8);
        assert_eq!(
            task_ids
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            8
        );
        assert!(!task_ids.contains(&"T-done"));
    }

    #[test]
    fn custom_focus_states_move_non_focus_doing_tasks_to_in_flight() {
        let fixture: CharacterizationFixture = serde_json::from_str(include_str!(
            "../../fixtures/task_attention_characterization.json"
        ))
        .expect("characterization fixture should deserialize");
        let expected = fixture
            .expected_boards
            .get("P-beta")
            .expect("beta board fixture");
        let actual = project_task_board(
            TaskAttentionInput {
                projects: fixture.projects,
                tasks: fixture.tasks,
                sessions: fixture.sessions,
                pull_requests: fixture.pull_requests,
                out_of_focus_by_project: fixture.out_of_focus_by_project,
                focus_states_by_project: fixture.focus_states_by_project,
            },
            "P-beta",
        )
        .expect("beta project should exist");

        assert_eq!(&actual, expected);
    }

    #[test]
    fn missing_project_has_no_board() {
        assert_eq!(
            project_task_board(
                TaskAttentionInput {
                    projects: Vec::new(),
                    tasks: Vec::new(),
                    sessions: Vec::new(),
                    pull_requests: Vec::new(),
                    out_of_focus_by_project: HashMap::new(),
                    focus_states_by_project: HashMap::new(),
                },
                "P-missing",
            ),
            None,
        );
    }
}
