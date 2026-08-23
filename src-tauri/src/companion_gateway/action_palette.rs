use std::{
    collections::HashSet,
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

fn github_refresh_scope() -> crate::github_poller::PollScope {
    crate::github_poller::PollScope::Global
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

impl From<crate::github_poller::ManualGithubSyncError> for CompanionActionPaletteError {
    fn from(error: crate::github_poller::ManualGithubSyncError) -> Self {
        match error {
            crate::github_poller::ManualGithubSyncError::MissingToken => Self::GithubTokenMissing,
            crate::github_poller::ManualGithubSyncError::TokenUnavailable => {
                Self::GithubTokenUnavailable
            }
            crate::github_poller::ManualGithubSyncError::PollErrors { count } => {
                Self::GithubSyncFailed { errors: count }
            }
            crate::github_poller::ManualGithubSyncError::RateLimited { .. } => {
                Self::GithubRateLimited
            }
        }
    }
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

const OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY: &str = "low_fire_task_ids";
const RUN_COMMAND_CONFIG_KEY: &str = "run_command";

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

    fn visible_task(
        &self,
        task_id: &str,
    ) -> Result<(crate::db::TaskRow, String), CompanionActionPaletteError> {
        let database = crate::db::acquire_db(&self.database);
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
        let hidden = database
            .get_config("project_sidebar_hidden")
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .and_then(|value| serde_json::from_str::<HashSet<String>>(&value).ok())
            .unwrap_or_default();
        if hidden.contains(&project_id) || task.status == "done" {
            return Err(CompanionActionPaletteError::NotFound);
        }
        Ok((task, project_id))
    }

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

    fn set_out_of_focus(
        &self,
        task_id: &str,
        should_be_out_of_focus: bool,
    ) -> Result<(), CompanionActionPaletteError> {
        let (task, project_id) = self.visible_task(task_id)?;
        if task.status != "doing" {
            return Err(CompanionActionPaletteError::InvalidTaskState);
        }
        let database = crate::db::acquire_db(&self.database);
        let mut task_ids = Self::out_of_focus_ids(&database, &project_id)?;
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
            self.app.as_ref(),
            &self.app_event_tx,
            "task-changed",
            &serde_json::json!({
                "task_id": task_id,
                "project_id": project_id,
                "action": "updated",
            }),
        );
        Ok(())
    }

    pub(crate) fn refresh_target(
        &self,
        project_id: &str,
    ) -> Result<String, CompanionActionPaletteError> {
        let database = crate::db::acquire_db(&self.database);
        let project = database
            .get_project(project_id)
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .ok_or(CompanionActionPaletteError::NotFound)?;
        let hidden = database
            .get_config("project_sidebar_hidden")
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .and_then(|value| serde_json::from_str::<HashSet<String>>(&value).ok())
            .unwrap_or_default();
        if hidden.contains(project_id) {
            Err(CompanionActionPaletteError::NotFound)
        } else {
            Ok(project.id)
        }
    }

    fn run_app_target(
        &self,
        task_id: &str,
    ) -> Result<(String, String), CompanionActionPaletteError> {
        let (_, project_id) = self.visible_task(task_id)?;
        let database = crate::db::acquire_db(&self.database);
        let command = database
            .get_project_config(&project_id, RUN_COMMAND_CONFIG_KEY)
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .filter(|command| !command.trim().is_empty())
            .ok_or(CompanionActionPaletteError::InvalidTaskState)?;
        let workspace = database
            .get_task_workspace_for_task(task_id)
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .filter(|workspace| {
                workspace.status == "active"
                    && std::path::Path::new(&workspace.workspace_path).is_dir()
            })
            .ok_or(CompanionActionPaletteError::InvalidTaskState)?;
        Ok((workspace.workspace_path, command.trim().to_string()))
    }

    async fn run_app(&self, task_id: &str) -> Result<(), CompanionActionPaletteError> {
        let (workspace_path, command) = self.run_app_target(task_id)?;
        let pty_manager = self
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
                    cwd: std::path::Path::new(&workspace_path),
                    cols: 120,
                    rows: 30,
                    app_handle: self.app.clone(),
                    app_event_tx: self.app_event_tx.clone(),
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

    fn publish_pull_request_action(&self, task_id: &str, pr_id: i64, action: &str) {
        crate::app_events::publish_app_event_to_runtime(
            self.app.as_ref(),
            &self.app_event_tx,
            "task-pull-request-updated",
            &serde_json::json!({
                "task_id": task_id,
                "pr_id": pr_id,
                "action": action,
            }),
        );
    }

    fn unique_ready_pull_request(
        &self,
        task_id: &str,
        status: &str,
        action: &str,
    ) -> Result<crate::db::PrRow, CompanionActionPaletteError> {
        let pull_requests = crate::github_runtime::get_pull_requests(&self.database)
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .into_iter()
            .filter(|pr| {
                pr.ticket_id == task_id
                    && pr.state == "open"
                    && pr.merge_readiness_status.as_deref() == Some(status)
                    && pr.merge_readiness_action.as_deref() == Some(action)
            })
            .collect::<Vec<_>>();
        match pull_requests.as_slice() {
            [pull_request] => Ok(pull_request.clone()),
            _ => Err(CompanionActionPaletteError::InvalidTaskState),
        }
    }

    async fn merge_pull_request(&self, task_id: &str) -> Result<(), CompanionActionPaletteError> {
        let pull_request = self.unique_ready_pull_request(task_id, "ready_to_merge", "merge")?;
        crate::github_runtime::merge_task_pull_request(
            &self.database,
            &self.github_client,
            task_id,
            pull_request.id,
            &pull_request.head_sha,
        )
        .await
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
        self.publish_pull_request_action(task_id, pull_request.id, "merged");
        Ok(())
    }

    async fn enqueue_pull_request(&self, task_id: &str) -> Result<(), CompanionActionPaletteError> {
        let pull_request =
            self.unique_ready_pull_request(task_id, "ready_to_enqueue", "enqueue")?;
        crate::github_runtime::enqueue_task_pull_request(
            &self.database,
            &self.github_client,
            task_id,
            pull_request.id,
            &pull_request.head_sha,
        )
        .await
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
        self.publish_pull_request_action(task_id, pull_request.id, "enqueued");
        Ok(())
    }
}

impl CompanionActionPaletteService for DatabaseCompanionActionPaletteService {
    fn available_actions(
        &self,
        task_id: &str,
    ) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
        let (task, project_id) = self.visible_task(task_id)?;
        let database = crate::db::acquire_db(&self.database);
        let out_of_focus = Self::out_of_focus_ids(&database, &project_id)?.contains(task_id);
        let pull_requests = database
            .get_open_prs()
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .into_iter()
            .filter(|pr| pr.ticket_id == task_id)
            .collect::<Vec<_>>();
        let merge_count = pull_requests
            .iter()
            .filter(|pr| {
                pr.merge_readiness_status.as_deref() == Some("ready_to_merge")
                    && pr.merge_readiness_action.as_deref() == Some("merge")
            })
            .count();
        let enqueue_count = pull_requests
            .iter()
            .filter(|pr| {
                pr.merge_readiness_status.as_deref() == Some("ready_to_enqueue")
                    && pr.merge_readiness_action.as_deref() == Some("enqueue")
            })
            .count();
        let has_run_command = database
            .get_project_config(&project_id, RUN_COMMAND_CONFIG_KEY)
            .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
            .is_some_and(|command| !command.trim().is_empty());
        let can_run_app = has_run_command
            && database
                .get_task_workspace_for_task(task_id)
                .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
                .is_some_and(|workspace| {
                    workspace.status == "active"
                        && std::path::Path::new(&workspace.workspace_path).is_dir()
                });

        let mut actions = Vec::new();
        if task.status == "backlog" {
            actions.push(CompanionTaskActionId::StartTask);
        }
        if merge_count == 1 {
            actions.push(CompanionTaskActionId::MergePullRequest);
        }
        if enqueue_count == 1 {
            actions.push(CompanionTaskActionId::EnqueuePullRequest);
        }
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

    fn available_project_actions(
        &self,
        project_id: &str,
    ) -> Result<Vec<CompanionProjectActionId>, CompanionActionPaletteError> {
        self.refresh_target(project_id)?;
        Ok(vec![CompanionProjectActionId::RefreshGithub])
    }
    fn execute<'a>(
        &'a self,
        task_id: &'a str,
        action: CompanionTaskActionId,
    ) -> CompanionActionPaletteFuture<'a> {
        Box::pin(async move {
            match action {
                CompanionTaskActionId::SetAsideTask => self.set_out_of_focus(task_id, true),
                CompanionTaskActionId::ReturnToBoard => self.set_out_of_focus(task_id, false),
                CompanionTaskActionId::MergePullRequest => self.merge_pull_request(task_id).await,
                CompanionTaskActionId::EnqueuePullRequest => {
                    self.enqueue_pull_request(task_id).await
                }
                CompanionTaskActionId::RunApp => self.run_app(task_id).await,
                CompanionTaskActionId::StartTask
                | CompanionTaskActionId::DeleteTask
                | CompanionTaskActionId::CompleteTask => {
                    Err(CompanionActionPaletteError::InvalidTaskState)
                }
            }
        })
    }

    fn refresh_github(&self) -> CompanionActionPaletteFuture<'_> {
        Box::pin(async move {
            let result = crate::github_poller::poll_github_once_for_sidecar(
                Arc::clone(&self.database),
                &self.github_client,
                self.app_event_tx.clone(),
                github_refresh_scope(),
            )
            .await;
            if let Some(error) = result.manual_sync_error() {
                return Err(error.into());
            }
            Ok(())
        })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn mobile_github_refresh_uses_the_global_poll_scope() {
        assert_eq!(
            github_refresh_scope(),
            crate::github_poller::PollScope::Global
        );
    }

    #[test]
    fn database_service_advertises_only_current_task_actions_in_desktop_order() {
        let (database, path) =
            crate::db::test_helpers::make_test_db("companion_action_palette_availability");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
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
            database
                .set_project_config(
                    &project.id,
                    "low_fire_task_ids",
                    &format!(r#"["{}"]"#, doing.id),
                )
                .expect("set aside Task");
            database
                .set_project_config(&project.id, "run_command", "pnpm dev")
                .expect("save Run app command");
            database
                .create_task_workspace_record(
                    &doing.id,
                    &project.id,
                    workspace.path().to_str().expect("UTF-8 workspace"),
                    "/tmp/openforge",
                    "worktree",
                    Some("KVG-test"),
                    "pi",
                )
                .expect("create Task workspace");
            (project.id, backlog.id, doing.id)
        };
        let service = DatabaseCompanionActionPaletteService::new(database);

        assert_eq!(
            service
                .available_actions(&backlog_id)
                .expect("backlog actions"),
            vec![
                CompanionTaskActionId::StartTask,
                CompanionTaskActionId::DeleteTask
            ]
        );
        assert_eq!(
            service.available_actions(&doing_id).expect("doing actions"),
            vec![
                CompanionTaskActionId::ReturnToBoard,
                CompanionTaskActionId::CompleteTask,
                CompanionTaskActionId::RunApp,
            ]
        );
        assert_eq!(
            service
                .refresh_target(&project_id)
                .expect("visible Project"),
            project_id
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn focus_actions_revalidate_state_and_persist_the_authoritative_board_membership() {
        let (database, path) =
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
            .get_project_config(&project_id, "low_fire_task_ids")
            .expect("read out-of-focus config")
            .expect("stored config");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&stored).unwrap(),
            vec![doing_id.clone()]
        );

        service
            .execute(&doing_id, CompanionTaskActionId::ReturnToBoard)
            .await
            .expect("return to Board");
        assert_eq!(
            crate::db::acquire_db(&database)
                .get_project_config(&project_id, "low_fire_task_ids")
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

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn run_app_uses_the_active_task_workspace_and_shared_shell_session() {
        let (database, path) =
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

        service
            .execute(&task_id, CompanionTaskActionId::RunApp)
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

        let _ = std::fs::remove_file(path);
    }
}
