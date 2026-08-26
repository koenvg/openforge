use super::{availability, CompanionActionPaletteError, DatabaseCompanionActionPaletteService};
use std::path::Path;

const RUN_COMMAND_CONFIG_KEY: &str = "run_command";

pub(super) fn is_available(
    database: &crate::db::Database,
    project_id: &str,
    task_id: &str,
) -> Result<bool, CompanionActionPaletteError> {
    let has_run_command = database
        .get_project_config(project_id, RUN_COMMAND_CONFIG_KEY)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .is_some_and(|command| !command.trim().is_empty());
    let has_active_workspace = database
        .get_task_workspace_for_task(task_id)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .is_some_and(|workspace| {
            workspace.status == "active" && Path::new(&workspace.workspace_path).is_dir()
        });
    Ok(has_run_command && has_active_workspace)
}

fn target(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(String, String), CompanionActionPaletteError> {
    let (_, project_id) = availability::visible_task(service, task_id)?;
    let database = crate::db::acquire_db(&service.database);
    let command = database
        .get_project_config(&project_id, RUN_COMMAND_CONFIG_KEY)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .filter(|command| !command.trim().is_empty())
        .ok_or(CompanionActionPaletteError::InvalidTaskState)?;
    let workspace = database
        .get_task_workspace_for_task(task_id)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .filter(|workspace| {
            workspace.status == "active" && Path::new(&workspace.workspace_path).is_dir()
        })
        .ok_or(CompanionActionPaletteError::InvalidTaskState)?;
    Ok((workspace.workspace_path, command.trim().to_string()))
}

pub(super) async fn execute(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(), CompanionActionPaletteError> {
    let (workspace_path, command) = target(service, task_id)?;
    let pty_manager = service
        .pty_manager
        .as_ref()
        .ok_or(CompanionActionPaletteError::TemporarilyUnavailable)?;
    let shell_key = format!("{task_id}-shell-0");
    let input = format!("{command}\r");
    if pty_manager
        .write_pty(&shell_key, input.as_bytes())
        .await
        .is_ok()
    {
        return Ok(());
    }
    pty_manager
        .spawn_shell_pty(
            crate::pty_manager::PtySpawnContext {
                task_id,
                cwd: Path::new(&workspace_path),
                cols: 120,
                rows: 30,
                event_publisher: crate::app_events::RuntimeEventPublisher::new(
                    service.app.clone(),
                    service.app_event_tx.clone(),
                ),
            },
            Some(0),
            None,
        )
        .await
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    pty_manager
        .write_pty(&shell_key, input.as_bytes())
        .await
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)
}

#[cfg(test)]
mod tests {
    use super::super::{
        execute_task_action, CompanionTaskActionId, DatabaseCompanionActionPaletteService,
    };
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn service_runs_the_project_command_in_the_shared_task_shell() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("companion_action_palette_run_app");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let database = Arc::new(Mutex::new(database));
        let task_id = {
            let database = crate::db::acquire_db(&database);
            let project = database
                .create_project("OpenForge", workspace.path().to_str().expect("UTF-8 path"))
                .expect("create Project");
            let task = database
                .create_task("Run app", "doing", Some(&project.id), None, None)
                .expect("create Task");
            database
                .set_project_config(
                    &project.id,
                    RUN_COMMAND_CONFIG_KEY,
                    "printf companion-run-app-marker",
                )
                .expect("save Run app command");
            database
                .create_task_workspace_record(
                    &task.id,
                    &project.id,
                    workspace.path().to_str().expect("UTF-8 workspace"),
                    workspace.path().to_str().expect("UTF-8 repository"),
                    "worktree",
                    Some("KVG-run-app"),
                    "pi",
                )
                .expect("create Task workspace");
            task.id
        };
        let mut pty_manager = crate::pty_manager::PtyManager::new();
        pty_manager.set_pid_dir(workspace.path().join("pids"));
        let service = DatabaseCompanionActionPaletteService::production(
            database,
            crate::github_client::GitHubClient::new(),
            pty_manager.clone(),
            None,
            None,
        );

        execute_task_action(&service, &task_id, CompanionTaskActionId::RunApp)
            .await
            .expect("Run app");
        let shell_key = format!("{task_id}-shell-0");
        let output = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Some(output) = pty_manager.get_pty_buffer(&shell_key).await {
                    if output.contains("companion-run-app-marker") {
                        break output;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Run app output");
        assert!(output.contains("companion-run-app-marker"));
        pty_manager
            .kill_pty(&shell_key)
            .await
            .expect("shell cleanup");
    }
}
