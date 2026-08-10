use crate::{app_events::AppEventBus, db::Database};
use log::warn;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionCreatedTask {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
}

pub(crate) trait CompanionTaskCreator: Send + Sync {
    fn create(
        &self,
        project_id: &str,
        initial_prompt: &str,
    ) -> Result<CompanionCreatedTask, String>;
}

pub(crate) struct DatabaseCompanionTaskCreator {
    database: Arc<Mutex<Database>>,
    events: AppEventBus,
}

impl DatabaseCompanionTaskCreator {
    pub(crate) fn new(database: Arc<Mutex<Database>>, events: AppEventBus) -> Self {
        Self { database, events }
    }
}

impl CompanionTaskCreator for DatabaseCompanionTaskCreator {
    fn create(
        &self,
        project_id: &str,
        initial_prompt: &str,
    ) -> Result<CompanionCreatedTask, String> {
        let task = crate::db::acquire_db(&self.database)
            .create_task(initial_prompt, "backlog", Some(project_id), None, None)
            .map_err(|error| format!("failed to create Companion Task: {error}"))?;

        if let Err(error) = self.events.tasks().created(&task.id, Some(project_id)) {
            warn!("failed to publish Companion Task creation event: {error:?}");
        }

        Ok(CompanionCreatedTask {
            task_id: task.id,
            project_id: project_id.to_string(),
        })
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionTaskCreator;

#[cfg(test)]
impl CompanionTaskCreator for UnavailableCompanionTaskCreator {
    fn create(
        &self,
        _project_id: &str,
        _initial_prompt: &str,
    ) -> Result<CompanionCreatedTask, String> {
        Err("Companion Task creation is unavailable".to_string())
    }
}
