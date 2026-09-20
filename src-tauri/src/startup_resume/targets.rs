use crate::db;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub(super) struct ResumeTarget {
    pub(super) task_id: String,
    pub(super) project_id: String,
    pub(super) repo_path: String,
    pub(super) workspace_path: String,
    pub(super) kind: String,
    pub(super) branch_name: Option<String>,
}

impl ResumeTarget {
    fn from_task_workspace(workspace: db::TaskWorkspaceRow) -> Self {
        Self {
            task_id: workspace.task_id,
            project_id: workspace.project_id,
            repo_path: workspace.repo_path,
            workspace_path: workspace.workspace_path,
            kind: workspace.kind,
            branch_name: workspace.branch_name,
        }
    }

    fn from_worktree(worktree: db::WorktreeRow) -> Self {
        Self {
            task_id: worktree.task_id,
            project_id: worktree.project_id,
            repo_path: worktree.repo_path,
            workspace_path: worktree.worktree_path,
            kind: "git_worktree".to_string(),
            branch_name: Some(worktree.branch_name),
        }
    }
}

pub(super) fn load_resume_targets(db: &db::Database) -> rusqlite::Result<Vec<ResumeTarget>> {
    let mut targets: Vec<ResumeTarget> = db
        .get_resumable_task_workspaces()?
        .into_iter()
        .map(ResumeTarget::from_task_workspace)
        .collect();
    let existing_task_ids: HashSet<String> = targets
        .iter()
        .map(|target| target.task_id.clone())
        .collect();
    for worktree in db.get_resumable_worktrees()? {
        if existing_task_ids.contains(&worktree.task_id) {
            continue;
        }
        targets.push(ResumeTarget::from_worktree(worktree));
    }
    Ok(targets)
}
