pub(crate) fn resolve_workspace_path(
    database: &crate::db::Database,
    task_id: &str,
) -> Result<String, String> {
    let worktree = database
        .get_worktree_for_task(task_id)
        .map_err(|error| format!("Failed to get worktree for task: {error}"))?;

    if let Some(worktree) = worktree {
        if std::path::Path::new(&worktree.worktree_path).is_dir() {
            return Ok(worktree.worktree_path);
        }
    }

    let workspace = database
        .get_task_workspace_for_task(task_id)
        .map_err(|error| format!("Failed to get task workspace for task: {error}"))?;

    workspace
        .filter(|workspace| std::path::Path::new(&workspace.workspace_path).is_dir())
        .map(|workspace| workspace.workspace_path)
        .ok_or_else(|| format!("No workspace found for task {task_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;
    use tempfile::tempdir;

    #[test]
    fn resolves_task_workspace_when_no_legacy_worktree_exists() {
        let (database, _database_dir) = make_test_db("task_workspace_service_task_workspace_only");
        let workspace_dir = tempdir().expect("create Task workspace directory");
        let workspace_path = workspace_dir.path().to_string_lossy().into_owned();
        let project = database
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project");
        let task = database
            .create_task("Task workspace", "doing", Some(&project.id), None, None)
            .expect("create Task");

        database
            .create_task_workspace_record(
                &task.id,
                &project.id,
                &workspace_path,
                "/tmp/test-repo",
                "project_dir",
                None,
                "opencode",
            )
            .expect("create Task workspace record");

        assert_eq!(
            resolve_workspace_path(&database, &task.id),
            Ok(workspace_path)
        );
    }

    #[test]
    fn prefers_live_legacy_worktree_over_task_workspace() {
        let (database, _database_dir) =
            make_test_db("task_workspace_service_prefers_legacy_worktree");
        let worktree_dir = tempdir().expect("create legacy worktree directory");
        let workspace_dir = tempdir().expect("create Task workspace directory");
        let project = database
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project");
        let task = database
            .create_task("Two workspaces", "doing", Some(&project.id), None, None)
            .expect("create Task");

        database
            .create_worktree_record(
                &task.id,
                &project.id,
                "/tmp/test-repo",
                &worktree_dir.path().to_string_lossy(),
                "task-branch",
            )
            .expect("create legacy worktree record");
        database
            .create_task_workspace_record(
                &task.id,
                &project.id,
                &workspace_dir.path().to_string_lossy(),
                "/tmp/test-repo",
                "project_dir",
                None,
                "opencode",
            )
            .expect("create Task workspace record");

        assert_eq!(
            resolve_workspace_path(&database, &task.id),
            Ok(worktree_dir.path().to_string_lossy().into_owned())
        );
    }

    #[test]
    fn falls_back_to_live_task_workspace_when_legacy_worktree_is_missing() {
        let (database, _database_dir) =
            make_test_db("task_workspace_service_stale_legacy_worktree");
        let workspace_dir = tempdir().expect("create Task workspace directory");
        let missing_worktree = workspace_dir.path().join("missing-worktree");
        let project = database
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project");
        let task = database
            .create_task("Stale worktree", "doing", Some(&project.id), None, None)
            .expect("create Task");

        database
            .create_worktree_record(
                &task.id,
                &project.id,
                "/tmp/test-repo",
                &missing_worktree.to_string_lossy(),
                "task-branch",
            )
            .expect("create legacy worktree record");
        database
            .create_task_workspace_record(
                &task.id,
                &project.id,
                &workspace_dir.path().to_string_lossy(),
                "/tmp/test-repo",
                "project_dir",
                None,
                "opencode",
            )
            .expect("create Task workspace record");

        assert_eq!(
            resolve_workspace_path(&database, &task.id),
            Ok(workspace_dir.path().to_string_lossy().into_owned())
        );
    }

    #[test]
    fn returns_explicit_error_when_no_live_workspace_exists() {
        let (database, _database_dir) = make_test_db("task_workspace_service_no_live_workspace");
        let missing_root = tempdir().expect("create missing workspace parent");
        let missing_worktree = missing_root.path().join("missing-worktree");
        let missing_workspace = missing_root.path().join("missing-workspace");
        let project = database
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project");
        let task = database
            .create_task("No workspace", "doing", Some(&project.id), None, None)
            .expect("create Task");

        database
            .create_worktree_record(
                &task.id,
                &project.id,
                "/tmp/test-repo",
                &missing_worktree.to_string_lossy(),
                "task-branch",
            )
            .expect("create legacy worktree record");
        database
            .create_task_workspace_record(
                &task.id,
                &project.id,
                &missing_workspace.to_string_lossy(),
                "/tmp/test-repo",
                "project_dir",
                None,
                "opencode",
            )
            .expect("create Task workspace record");

        assert_eq!(
            resolve_workspace_path(&database, &task.id),
            Err(format!("No workspace found for task {}", task.id))
        );
    }
}
