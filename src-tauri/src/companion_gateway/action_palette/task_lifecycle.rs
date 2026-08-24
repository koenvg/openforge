use super::{availability, CompanionActionPaletteError, DatabaseCompanionActionPaletteService};
use std::collections::HashSet;

const OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY: &str = "low_fire_task_ids";

fn out_of_focus_ids(
    database: &crate::db::Database,
    project_id: &str,
) -> Result<HashSet<String>, CompanionActionPaletteError> {
    let stored = database
        .get_project_config(project_id, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    Ok(stored
        .and_then(|value| serde_json::from_str::<HashSet<String>>(&value).ok())
        .unwrap_or_default())
}

pub(super) fn is_out_of_focus(
    database: &crate::db::Database,
    project_id: &str,
    task_id: &str,
) -> Result<bool, CompanionActionPaletteError> {
    Ok(out_of_focus_ids(database, project_id)?.contains(task_id))
}

fn set_out_of_focus(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
    should_be_out_of_focus: bool,
) -> Result<(), CompanionActionPaletteError> {
    let (task, project_id) = availability::visible_task(service, task_id)?;
    if task.status != "doing" {
        return Err(CompanionActionPaletteError::InvalidTaskState);
    }
    let database = crate::db::acquire_db(&service.database);
    let mut task_ids = out_of_focus_ids(&database, &project_id)?;
    let changed = if should_be_out_of_focus {
        task_ids.insert(task_id.to_string())
    } else {
        task_ids.remove(task_id)
    };
    if !changed {
        return Err(CompanionActionPaletteError::InvalidTaskState);
    }
    let mut ordered = task_ids.into_iter().collect::<Vec<_>>();
    ordered.sort();
    let serialized = serde_json::to_string(&ordered)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    database
        .set_project_config(&project_id, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY, &serialized)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    drop(database);
    crate::app_events::publish_app_event_to_runtime(
        service.app.as_ref(),
        &service.app_event_tx,
        "task-changed",
        &serde_json::json!({
            "task_id": task_id,
            "project_id": project_id,
            "action": "updated",
        }),
    );
    Ok(())
}

pub(super) fn set_aside(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(), CompanionActionPaletteError> {
    set_out_of_focus(service, task_id, true)
}

pub(super) fn return_to_board(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(), CompanionActionPaletteError> {
    set_out_of_focus(service, task_id, false)
}

#[cfg(test)]
mod tests {
    use super::super::{
        CompanionActionPaletteService, CompanionTaskActionId, DatabaseCompanionActionPaletteService,
    };
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn focus_actions_revalidate_and_persist_board_membership() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("companion_action_palette_focus");
        let database = Arc::new(Mutex::new(database));
        let (project_id, doing_id, backlog_id) = {
            let database = crate::db::acquire_db(&database);
            let project = database
                .create_project("OpenForge", "/tmp/openforge")
                .expect("create Project");
            let doing = database
                .create_task("Doing", "doing", Some(&project.id), None, None)
                .expect("create doing Task");
            let backlog = database
                .create_task("Backlog", "backlog", Some(&project.id), None, None)
                .expect("create backlog Task");
            (project.id, doing.id, backlog.id)
        };
        let events = crate::app_events::AppEventBus::new(16, 8);
        let mut subscription = events.subscribe(None).expect("event subscription");
        let service = DatabaseCompanionActionPaletteService::production(
            Arc::clone(&database),
            crate::github_client::GitHubClient::new(),
            crate::pty_manager::PtyManager::new(),
            None,
            Some(events.sender()),
        );

        service
            .execute(&doing_id, CompanionTaskActionId::SetAsideTask)
            .await
            .expect("set aside");
        let crate::app_events::AppEventFrame::Event(event) =
            subscription.recv().await.expect("Task invalidation event")
        else {
            panic!("expected Task invalidation event");
        };
        assert_eq!(event.event_name, "task-changed");
        assert_eq!(event.payload["task_id"], doing_id);
        assert_eq!(event.payload["project_id"], project_id);
        let stored = crate::db::acquire_db(&database)
            .get_project_config(&project_id, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY)
            .expect("read out-of-focus config")
            .expect("stored config");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&stored).expect("out-of-focus Task ids"),
            vec![doing_id.clone()]
        );

        service
            .execute(&doing_id, CompanionTaskActionId::ReturnToBoard)
            .await
            .expect("return to Board");
        assert_eq!(
            crate::db::acquire_db(&database)
                .get_project_config(&project_id, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY)
                .expect("read cleared config")
                .as_deref(),
            Some("[]")
        );
        assert_eq!(
            service
                .execute(&backlog_id, CompanionTaskActionId::SetAsideTask)
                .await,
            Err(CompanionActionPaletteError::InvalidTaskState)
        );
    }
}
