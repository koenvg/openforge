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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionMergeMethodPolicy {
    pub(crate) allowed: Vec<crate::github_client::PullRequestMergeMethod>,
    pub(crate) default: Option<crate::github_client::PullRequestMergeMethod>,
}
/// Task action that `CompanionActionPaletteService` is allowed to execute directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionActionPaletteTaskAction {
    MergePullRequest,
    EnqueuePullRequest,
    ReturnToBoard,
    SetAsideTask,
    RunApp,
}

impl CompanionActionPaletteTaskAction {
    #[cfg(test)]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MergePullRequest => "merge_pull_request",
            Self::EnqueuePullRequest => "enqueue_pull_request",
            Self::ReturnToBoard => "return_to_board",
            Self::SetAsideTask => "set_aside_task",
            Self::RunApp => "run_app",
        }
    }
}

/// Service boundary responsible for executing an advertised Companion Task action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionTaskActionExecutionOwner {
    ActionPalette(CompanionActionPaletteTaskAction),
    TaskStarter,
    TaskActions,
}

impl CompanionTaskActionId {
    pub(crate) const fn execution_owner(self) -> CompanionTaskActionExecutionOwner {
        match self {
            Self::StartTask => CompanionTaskActionExecutionOwner::TaskStarter,
            Self::MergePullRequest => CompanionTaskActionExecutionOwner::ActionPalette(
                CompanionActionPaletteTaskAction::MergePullRequest,
            ),
            Self::EnqueuePullRequest => CompanionTaskActionExecutionOwner::ActionPalette(
                CompanionActionPaletteTaskAction::EnqueuePullRequest,
            ),
            Self::ReturnToBoard => CompanionTaskActionExecutionOwner::ActionPalette(
                CompanionActionPaletteTaskAction::ReturnToBoard,
            ),
            Self::DeleteTask | Self::CompleteTask => CompanionTaskActionExecutionOwner::TaskActions,
            Self::SetAsideTask => CompanionTaskActionExecutionOwner::ActionPalette(
                CompanionActionPaletteTaskAction::SetAsideTask,
            ),
            Self::RunApp => CompanionTaskActionExecutionOwner::ActionPalette(
                CompanionActionPaletteTaskAction::RunApp,
            ),
        }
    }

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CompanionActionPaletteError {
    NotFound,
    InvalidTaskState,
    TemporarilyUnavailable,
    GithubTokenMissing,
    GithubTokenUnavailable,
    GithubSyncFailed { errors: usize },
    GithubRateLimited,
    MergeRejected(String),
}

pub(crate) type CompanionActionPaletteFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), CompanionActionPaletteError>> + Send + 'a>>;

/// Advertises the full Mobile Action Palette and executes palette-owned actions.
///
/// `available_actions` also returns actions owned by `CompanionTaskStarter` and
/// `CompanionTaskActionService`. `execute_task_action` rejects those actions so their
/// dedicated HTTP routes must dispatch to the owning service instead.
pub(crate) trait CompanionActionPaletteService: Send + Sync {
    fn available_actions(
        &self,
        task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError>;

    fn merge_method_policy(
        &self,
        task_id: &str,
    ) -> Result<Option<CompanionMergeMethodPolicy>, CompanionActionPaletteError>;

    fn merge_pull_request<'a>(
        &'a self,
        task_id: &'a str,
        merge_method: crate::github_client::PullRequestMergeMethod,
    ) -> CompanionActionPaletteFuture<'a>;
    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError>;

    fn execute_palette_action<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionActionPaletteTaskAction,
    ) -> CompanionActionPaletteFuture<'a>;

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_>;
}

pub(crate) fn execute_task_action<'a>(
    service: &'a dyn CompanionActionPaletteService,
    task_id: &'a str,
    action: CompanionTaskActionId,
) -> CompanionActionPaletteFuture<'a> {
    match action.execution_owner() {
        CompanionTaskActionExecutionOwner::ActionPalette(action) => {
            service.execute_palette_action(task_id, action)
        }
        CompanionTaskActionExecutionOwner::TaskStarter
        | CompanionTaskActionExecutionOwner::TaskActions => {
            Box::pin(async { Err(CompanionActionPaletteError::InvalidTaskState) })
        }
    }
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

    fn merge_method_policy(
        &self,
        task_id: &str,
    ) -> Result<Option<CompanionMergeMethodPolicy>, CompanionActionPaletteError> {
        pull_requests::merge_method_policy(self, task_id)
    }

    fn merge_pull_request<'a>(
        &'a self,
        task_id: &'a str,
        merge_method: crate::github_client::PullRequestMergeMethod,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(pull_requests::merge(self, task_id, merge_method))
    }

    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        availability::project_actions(self, project_id)
    }

    fn execute_palette_action<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionActionPaletteTaskAction,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            match action {
                CompanionActionPaletteTaskAction::MergePullRequest => {
                    Err(CompanionActionPaletteError::InvalidTaskState)
                }
                CompanionActionPaletteTaskAction::EnqueuePullRequest => {
                    pull_requests::enqueue(self, task_id).await
                }
                CompanionActionPaletteTaskAction::RunApp => run_app::execute(self, task_id).await,
                CompanionActionPaletteTaskAction::SetAsideTask => {
                    task_lifecycle::set_aside(self, task_id)
                }
                CompanionActionPaletteTaskAction::ReturnToBoard => {
                    task_lifecycle::return_to_board(self, task_id)
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

    fn merge_method_policy(
        &self,
        _task_id: &str,
    ) -> Result<Option<CompanionMergeMethodPolicy>, CompanionActionPaletteError> {
        Err(CompanionActionPaletteError::TemporarilyUnavailable)
    }

    fn merge_pull_request<'a>(
        &'a self,
        _task_id: &'a str,
        _merge_method: crate::github_client::PullRequestMergeMethod,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async { Err(CompanionActionPaletteError::TemporarilyUnavailable) })
    }

    fn available_project_actions(
        &self,
        _project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        Err(CompanionActionPaletteError::TemporarilyUnavailable)
    }

    fn execute_palette_action<'a>(
        &'a self,
        _task_id: &'a str,
        _action: CompanionActionPaletteTaskAction,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async { Err(CompanionActionPaletteError::TemporarilyUnavailable) })
    }

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_> {
        Box::pin(async { Err(CompanionActionPaletteError::TemporarilyUnavailable) })
    }
}
