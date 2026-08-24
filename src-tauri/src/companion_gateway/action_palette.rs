mod availability;
mod github_refresh;
mod pull_requests;
mod run_app;
mod task_lifecycle;

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionTaskActionId {
    StartTask,
    MergePullRequest,
    EnqueuePullRequest,
    ReturnToBoard,
    DeleteTask,
    CompleteTask,
    SetAsideTask,
    RunApp,
}

impl CompanionTaskActionId {
    #[cfg(test)]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::StartTask => "start_task",
            Self::MergePullRequest => "merge_pull_request",
            Self::EnqueuePullRequest => "enqueue_pull_request",
            Self::ReturnToBoard => "return_to_board",
            Self::DeleteTask => "delete_task",
            Self::CompleteTask => "complete_task",
            Self::SetAsideTask => "set_aside_task",
            Self::RunApp => "run_app",
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionProjectActionId {
    RefreshGithub,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionActionPaletteError {
    NotFound,
    InvalidTaskState,
    TemporarilyUnavailable,
    GithubTokenMissing,
    GithubTokenUnavailable,
    GithubSyncFailed { errors: usize },
    GithubRateLimited,
}

pub(crate) type CompanionActionPaletteFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), CompanionActionPaletteError>> + Send + 'a>>;

pub(crate) trait CompanionActionPaletteService: Send + Sync {
    fn available_actions(
        &self,
        task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError>;

    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError>;

    fn execute<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionTaskActionId,
    ) -> CompanionActionPaletteFuture<'a>;

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_>;
}

#[derive(Clone)]
pub(crate) struct DatabaseCompanionActionPaletteService {
    database: Arc<Mutex<crate::db::Database>>,
    github_client: crate::github_client::GitHubClient,
    pty_manager: Option<crate::pty_manager::PtyManager>,
    app: Option<crate::backend_runtime::AppHandle>,
    app_event_tx: Option<crate::app_events::AppEventSender>,
}

impl DatabaseCompanionActionPaletteService {
    #[cfg(test)]
    pub(crate) fn new(database: Arc<Mutex<crate::db::Database>>) -> Self {
        Self::production(
            database,
            crate::github_client::GitHubClient::new(),
            crate::pty_manager::PtyManager::new(),
            None,
            None,
        )
    }

    pub(crate) fn production(
        database: Arc<Mutex<crate::db::Database>>,
        github_client: crate::github_client::GitHubClient,
        pty_manager: crate::pty_manager::PtyManager,
        app: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<crate::app_events::AppEventSender>,
    ) -> Self {
        Self {
            database,
            github_client,
            pty_manager: Some(pty_manager),
            app,
            app_event_tx,
        }
    }
}

impl CompanionActionPaletteService for DatabaseCompanionActionPaletteService {
    fn available_actions(
        &self,
        task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
        availability::task_actions(self, task_id)
    }

    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        availability::project_actions(self, project_id)
    }

    fn execute<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionTaskActionId,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            match action {
                CompanionTaskActionId::MergePullRequest => {
                    pull_requests::merge(self, task_id).await
                }
                CompanionTaskActionId::EnqueuePullRequest => {
                    pull_requests::enqueue(self, task_id).await
                }
                CompanionTaskActionId::RunApp => run_app::execute(self, task_id).await,
                CompanionTaskActionId::SetAsideTask => task_lifecycle::set_aside(self, task_id),
                CompanionTaskActionId::ReturnToBoard => {
                    task_lifecycle::return_to_board(self, task_id)
                }
                CompanionTaskActionId::StartTask
                | CompanionTaskActionId::DeleteTask
                | CompanionTaskActionId::CompleteTask => {
                    Err(CompanionActionPaletteError::InvalidTaskState)
                }
            }
        })
    }

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_> {
        Box::pin(github_refresh::execute(self))
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionActionPaletteService;

#[cfg(test)]
impl CompanionActionPaletteService for UnavailableCompanionActionPaletteService {
    fn available_actions(
        &self,
        _task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
        Err(CompanionActionPaletteError::TemporarilyUnavailable)
    }

    fn available_project_actions(
        &self,
        _project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        Err(CompanionActionPaletteError::TemporarilyUnavailable)
    }

    fn execute<'a>(
        &'a self,
        _task_id: &'a str,
        _action: CompanionTaskActionId,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async { Err(CompanionActionPaletteError::TemporarilyUnavailable) })
    }

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_> {
        Box::pin(async { Err(CompanionActionPaletteError::TemporarilyUnavailable) })
    }
}
