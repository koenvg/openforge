use rusqlite::{params, Connection, Result, Row};

pub(super) trait StartupResumeRow: Sized {
    const TABLE: &'static str;
    const SELECT_COLUMNS: &'static str;

    fn from_startup_resume_row(row: &Row<'_>) -> Result<Self>;
}

pub(super) fn query_startup_resumable_rows<R: StartupResumeRow>(
    conn: &Connection,
) -> Result<Vec<R>> {
    let sql = format!(
        "SELECT DISTINCT {}
           FROM {} workspace
           INNER JOIN tasks task ON workspace.task_id = task.id
           INNER JOIN agent_sessions latest_session
             ON latest_session.ticket_id = workspace.task_id
            AND latest_session.rowid = (
              SELECT candidate.rowid
                FROM agent_sessions candidate
               WHERE candidate.ticket_id = workspace.task_id
               ORDER BY candidate.created_at DESC, candidate.rowid DESC
               LIMIT 1
            )
          WHERE workspace.status = 'active'
            AND task.status = 'doing'
            AND latest_session.status IN (?1, ?2, ?3, 'completed')
          ORDER BY workspace.updated_at DESC",
        R::SELECT_COLUMNS,
        R::TABLE,
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(
        params![
            super::STARTUP_RESUMABLE_AGENT_SESSION_STATUSES[0],
            super::STARTUP_RESUMABLE_AGENT_SESSION_STATUSES[1],
            super::STARTUP_RESUMABLE_AGENT_SESSION_STATUSES[2],
        ],
        R::from_startup_resume_row,
    )?;

    rows.collect()
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;
    use crate::db::{TaskWorkspaceRow, WorktreeRow};

    struct EligibilityCase {
        name: &'static str,
        task_status: &'static str,
        workspace_status: &'static str,
        session_statuses: &'static [&'static str],
        terminal_replay: Option<&'static str>,
        eligible: bool,
    }

    #[test]
    fn startup_resume_eligibility_matches_for_task_workspaces_and_worktrees() {
        let (db, _temp_dir) = make_test_db("shared_startup_resume_eligibility");
        let project = db
            .create_project("Test Project", "/tmp/shared-resume")
            .expect("create project failed");
        let cases = [
            EligibilityCase {
                name: "running session",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["running"],
                terminal_replay: None,
                eligible: true,
            },
            EligibilityCase {
                name: "paused session",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["paused"],
                terminal_replay: None,
                eligible: true,
            },
            EligibilityCase {
                name: "interrupted session",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["interrupted"],
                terminal_replay: None,
                eligible: true,
            },
            EligibilityCase {
                name: "completed session without replay",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["completed"],
                terminal_replay: None,
                eligible: true,
            },
            EligibilityCase {
                name: "completed session with empty replay",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["completed"],
                terminal_replay: Some(""),
                eligible: true,
            },
            EligibilityCase {
                name: "completed session with captured replay",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["completed"],
                terminal_replay: Some("captured output"),
                eligible: true,
            },
            EligibilityCase {
                name: "failed session",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["failed"],
                terminal_replay: None,
                eligible: false,
            },
            EligibilityCase {
                name: "latest session failed",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["running", "failed"],
                terminal_replay: None,
                eligible: false,
            },
            EligibilityCase {
                name: "latest session running",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &["failed", "running"],
                terminal_replay: None,
                eligible: true,
            },
            EligibilityCase {
                name: "done task",
                task_status: "done",
                workspace_status: "active",
                session_statuses: &["running"],
                terminal_replay: None,
                eligible: false,
            },
            EligibilityCase {
                name: "inactive workspace",
                task_status: "doing",
                workspace_status: "completed",
                session_statuses: &["running"],
                terminal_replay: None,
                eligible: false,
            },
            EligibilityCase {
                name: "missing session",
                task_status: "doing",
                workspace_status: "active",
                session_statuses: &[],
                terminal_replay: None,
                eligible: false,
            },
        ];
        let mut expected_task_ids = Vec::new();

        for case in cases {
            let task = db
                .create_task(case.name, case.task_status, Some(&project.id), None, None)
                .expect("create task failed");
            db.create_task_workspace_record(
                &task.id,
                &project.id,
                &format!("/tmp/shared-resume/workspaces/{}", task.id),
                "/tmp/shared-resume",
                "project_dir",
                None,
                "pi",
            )
            .expect("create Task workspace failed");
            db.create_worktree_record(
                &task.id,
                &project.id,
                "/tmp/shared-resume",
                &format!("/tmp/shared-resume/worktrees/{}", task.id),
                &format!("branch-{}", task.id),
            )
            .expect("create worktree failed");

            if case.workspace_status != "active" {
                db.update_task_workspace_status(&task.id, case.workspace_status)
                    .expect("update Task workspace status failed");
                db.update_worktree_status(&task.id, case.workspace_status)
                    .expect("update worktree status failed");
            }

            for (index, status) in case.session_statuses.iter().enumerate() {
                db.create_agent_session(
                    &format!("session-{}-{index}", task.id),
                    &task.id,
                    None,
                    "implement",
                    status,
                    "pi",
                )
                .expect("create Agent Session failed");
            }
            if let Some(replay) = case.terminal_replay {
                assert!(
                    db.save_completed_agent_terminal_replay(&task.id, replay)
                        .expect("save Terminal Replay failed"),
                    "{} should have a completed latest Agent Session",
                    case.name
                );
            }
            if case.eligible {
                expected_task_ids.push(task.id);
            }
        }

        let task_workspaces: Vec<TaskWorkspaceRow> = db
            .get_resumable_task_workspaces()
            .expect("get resumable Task workspaces failed");
        let worktrees: Vec<WorktreeRow> = db
            .get_resumable_worktrees()
            .expect("get resumable worktrees failed");
        let mut task_workspace_ids: Vec<_> = task_workspaces
            .into_iter()
            .map(|workspace| workspace.task_id)
            .collect();
        let mut worktree_ids: Vec<_> = worktrees
            .into_iter()
            .map(|worktree| worktree.task_id)
            .collect();
        expected_task_ids.sort();
        task_workspace_ids.sort();
        worktree_ids.sort();

        assert_eq!(task_workspace_ids, expected_task_ids);
        assert_eq!(worktree_ids, expected_task_ids);

        drop(db);
    }
}
