use super::{
    pull_requests, run_app, task_lifecycle, CompanionActionPaletteError, CompanionProjectActionId,
    CompanionTaskActionId, DatabaseCompanionActionPaletteService,
};
use std::collections::HashSet;

fn hidden_project_ids(
    database: &crate::db::Database,
) -> Result<HashSet<String>, CompanionActionPaletteError> {
    database
        .get_config("project_sidebar_hidden")
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)
        .map(|stored| {
            stored
                .and_then(|value| serde_json::from_str::<HashSet<String>>(&value).ok())
                .unwrap_or_default()
        })
}

pub(super) fn visible_task(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(crate::db::TaskRow, String), CompanionActionPaletteError> {
    let database = crate::db::acquire_db(&service.database);
    let task = database
        .get_task(task_id)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .ok_or(CompanionActionPaletteError::NotFound)?;
    let project_id = task
        .project_id
        .clone()
        .ok_or(CompanionActionPaletteError::NotFound)?;
    database
        .get_project(&project_id)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .ok_or(CompanionActionPaletteError::NotFound)?;
    if hidden_project_ids(&database)?.contains(&project_id) || task.status == "done" {
        return Err(CompanionActionPaletteError::NotFound);
    }
    Ok((task, project_id))
}

fn visible_project(
    service: &DatabaseCompanionActionPaletteService,
    project_id: &str,
) -> Result<(), CompanionActionPaletteError> {
    let database = crate::db::acquire_db(&service.database);
    database
        .get_project(project_id)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .ok_or(CompanionActionPaletteError::NotFound)?;
    if hidden_project_ids(&database)?.contains(project_id) {
        Err(CompanionActionPaletteError::NotFound)
    } else {
        Ok(())
    }
}

pub(super) fn task_actions(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
    let (task, project_id) = visible_task(service, task_id)?;
    let database = crate::db::acquire_db(&service.database);
    let out_of_focus = task_lifecycle::is_out_of_focus(&database, &project_id, task_id)?;
    let pull_request_actions = pull_requests::available_actions(&database, task_id)?;
    let can_run_app = run_app::is_available(&database, &project_id, task_id)?;

    let mut actions = Vec::new();
    if task.status == "backlog" {
        actions.push(CompanionTaskActionId::StartTask);
    }
    actions.extend(pull_request_actions);
    if task.status == "doing" && out_of_focus {
        actions.push(CompanionTaskActionId::ReturnToBoard);
    }
    actions.push(if task.status == "backlog" {
        CompanionTaskActionId::DeleteTask
    } else {
        CompanionTaskActionId::CompleteTask
    });
    if task.status == "doing" && !out_of_focus {
        actions.push(CompanionTaskActionId::SetAsideTask);
    }
    if can_run_app {
        actions.push(CompanionTaskActionId::RunApp);
    }
    Ok(actions)
}

pub(super) fn project_actions(
    service: &DatabaseCompanionActionPaletteService,
    project_id: &str,
) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
    visible_project(service, project_id)?;
    Ok(vec![CompanionProjectActionId::RefreshGithub])
}

#[cfg(test)]
mod tests {
    use super::super::{CompanionActionPaletteService, DatabaseCompanionActionPaletteService};
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn service_advertises_task_actions_in_desktop_order() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("companion_action_palette_availability");
        let database = Arc::new(Mutex::new(database));
        let (project_id, backlog_id, doing_id) = {
            let database = crate::db::acquire_db(&database);
            let project = database
                .create_project("OpenForge", "/tmp/openforge")
                .expect("create Project");
            let backlog = database
                .create_task("Backlog", "backlog", Some(&project.id), None, None)
                .expect("create backlog Task");
            let doing = database
                .create_task("Doing", "doing", Some(&project.id), None, None)
                .expect("create doing Task");
            (project.id, backlog.id, doing.id)
        };
        let service = DatabaseCompanionActionPaletteService::new(database);

        assert_eq!(
            service
                .available_actions(&backlog_id)
                .expect("backlog actions"),
            vec![
                CompanionTaskActionId::StartTask,
                CompanionTaskActionId::DeleteTask,
            ]
        );
        assert_eq!(
            service.available_actions(&doing_id).expect("doing actions"),
            vec![
                CompanionTaskActionId::CompleteTask,
                CompanionTaskActionId::SetAsideTask,
            ]
        );
        assert_eq!(
            service
                .available_project_actions(&project_id)
                .expect("Project actions"),
            vec![CompanionProjectActionId::RefreshGithub]
        );
    }

    #[test]
    fn service_hides_actions_for_hidden_projects_and_done_tasks() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("companion_action_palette_visibility");
        let database = Arc::new(Mutex::new(database));
        let (hidden_project_id, hidden_task_id, visible_project_id, done_task_id) = {
            let database = crate::db::acquire_db(&database);
            let hidden_project = database
                .create_project("Hidden", "/tmp/hidden")
                .expect("create hidden Project");
            let hidden_task = database
                .create_task("Hidden task", "doing", Some(&hidden_project.id), None, None)
                .expect("create hidden Task");
            let visible_project = database
                .create_project("Visible", "/tmp/visible")
                .expect("create visible Project");
            let done_task = database
                .create_task("Done task", "done", Some(&visible_project.id), None, None)
                .expect("create done Task");
            database
                .set_config(
                    "project_sidebar_hidden",
                    &serde_json::json!([hidden_project.id]).to_string(),
                )
                .expect("hide Project");
            (
                hidden_project.id,
                hidden_task.id,
                visible_project.id,
                done_task.id,
            )
        };
        let service = DatabaseCompanionActionPaletteService::new(database);

        assert_eq!(
            service.available_actions(&hidden_task_id),
            Err(CompanionActionPaletteError::NotFound)
        );
        assert_eq!(
            service.available_project_actions(&hidden_project_id),
            Err(CompanionActionPaletteError::NotFound)
        );
        assert_eq!(
            service.available_actions(&done_task_id),
            Err(CompanionActionPaletteError::NotFound)
        );
        assert_eq!(
            service.available_project_actions(&visible_project_id),
            Ok(vec![CompanionProjectActionId::RefreshGithub])
        );
    }
}
