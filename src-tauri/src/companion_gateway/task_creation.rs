use crate::{
    app_events::AppEventBus,
    db::{Database, NewTaskOptions},
};
use log::warn;
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionTaskPromptSuggestionKind {
    Skill,
    Command,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskPromptSuggestion {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) kind: CompanionTaskPromptSuggestionKind,
    pub(crate) source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionTaskPromptCatalog {
    pub(crate) provider: String,
    pub(crate) trigger: &'static str,
    pub(crate) suggestions: Vec<CompanionTaskPromptSuggestion>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionCreatedTask {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
}

pub(crate) trait CompanionTaskCreationService: Send + Sync {
    fn prompt_catalog(&self, project_id: &str) -> Result<CompanionTaskPromptCatalog, String>;
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

impl CompanionTaskCreationService for DatabaseCompanionTaskCreator {
    fn prompt_catalog(&self, project_id: &str) -> Result<CompanionTaskPromptCatalog, String> {
        let context = {
            let database = crate::db::acquire_db(&self.database);
            crate::provider_runtime::load_project_runtime_context(&database, project_id)?
        };
        let trigger = if context.provider == "codex" {
            "$"
        } else {
            "/"
        };
        let suggestions = crate::provider_runtime::provider_commands(
            &context.provider,
            context.project_path.as_deref(),
        )
        .unwrap_or_default()
        .into_iter()
        .map(|command| {
            let kind = if command.source.as_deref() == Some("skill") {
                CompanionTaskPromptSuggestionKind::Skill
            } else {
                CompanionTaskPromptSuggestionKind::Command
            };
            CompanionTaskPromptSuggestion {
                name: command.name,
                description: command.description,
                kind,
                source: command.source,
            }
        })
        .collect();

        Ok(CompanionTaskPromptCatalog {
            provider: context.provider,
            trigger,
            suggestions,
        })
    }

    fn create(
        &self,
        project_id: &str,
        initial_prompt: &str,
    ) -> Result<CompanionCreatedTask, String> {
        let database = crate::db::acquire_db(&self.database);
        let provider = database
            .try_resolve_ai_provider(project_id)
            .map_err(|error| format!("failed to resolve Companion Task provider: {error}"))?;
        let task = database
            .create_task_with_options(NewTaskOptions {
                initial_prompt,
                status: "backlog",
                project_id: Some(project_id),
                prompt: None,
                permission_mode: None,
                worktree_source: None,
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                task_display_title_updates_enabled: None,
                ai_provider: Some(&provider),
            })
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
impl CompanionTaskCreationService for UnavailableCompanionTaskCreator {
    fn prompt_catalog(&self, _project_id: &str) -> Result<CompanionTaskPromptCatalog, String> {
        Err("Companion Task prompt catalog is unavailable".to_string())
    }

    fn create(
        &self,
        _project_id: &str,
        _initial_prompt: &str,
    ) -> Result<CompanionCreatedTask, String> {
        Err("Companion Task creation is unavailable".to_string())
    }
}
