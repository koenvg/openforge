use crate::{
    agent_lifecycle::{self, StartPromptContribution},
    app_events::{publish_app_event_to_runtime, AppEventSender, RuntimeEventPublisher},
    backend_runtime::AppHandle,
    db::{self, Database, TaskRow, WorktreeRow},
    git_worktree::{self, DivergenceResolution, ExistingBranchRelation, GitWorktreeError},
    providers::{Provider, ProviderError, ProviderSessionResult, ProviderStartContext},
    pty_manager::{PtyManager, TerminalImageProtocol},
    task_claims::{TaskClaims, TaskOperation},
};
use log::error;
use std::{
    fmt,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopActionReason {
    ExistingBranchDiverged,
}

/// Safe lifecycle outcome suitable for a transport adapter to project without
/// leaking provider/session/workspace details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TaskStartOutcome {
    Started {
        task_id: String,
    },
    DesktopActionRequired {
        task_id: String,
        reason: DesktopActionReason,
    },
}

/// Desktop-only launch details retained for the existing IPC response. Companion
/// adapters should use [`TaskStartExecution::outcome`] and never serialize this.
#[derive(Debug, Clone)]
pub(crate) struct TaskStartReceipt {
    pub(crate) task_id: String,
    pub(crate) session_id: String,
    pub(crate) workspace_path: PathBuf,
    pub(crate) port: u16,
}

#[derive(Debug, Clone)]
pub(crate) struct TaskStartExecution {
    pub(crate) outcome: TaskStartOutcome,
    pub(crate) receipt: Option<TaskStartReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TaskStartError {
    NotFound,
    ProjectRequired,
    ProjectNotFound { project_id: String },
    InvalidState { status: String },
    StaleState,
    AlreadyInProgress,
    ActiveSession,
    DependencyBlocked { dependency_id: String },
    RuntimeUnavailable,
    InvalidConfiguration(String),
    Workspace(String),
    InvalidWorkspace(String),
    ProviderLaunch(String),
    Persistence(String),
}

impl fmt::Display for TaskStartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(f, "Task not found"),
            Self::ProjectRequired => write!(f, "task is not associated with a project"),
            Self::ProjectNotFound { project_id } => {
                write!(f, "Project {project_id} not found")
            }
            Self::InvalidState { status } => {
                write!(
                    f,
                    "Task must be in backlog to start; current state is {status}"
                )
            }
            Self::StaleState => write!(f, "Task changed while Start was in progress"),
            Self::AlreadyInProgress => {
                write!(f, "Task already has an implementation start in progress")
            }
            Self::ActiveSession => write!(f, "Task already has an active agent session"),
            Self::DependencyBlocked { dependency_id } => {
                write!(f, "Task dependency {dependency_id} is not done")
            }
            Self::RuntimeUnavailable => write!(f, "PTY manager is not available"),
            Self::InvalidConfiguration(message)
            | Self::Workspace(message)
            | Self::InvalidWorkspace(message)
            | Self::ProviderLaunch(message)
            | Self::Persistence(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for TaskStartError {}

#[derive(Debug, Clone, Copy)]
pub(crate) struct TaskStartRequest<'a> {
    task_id: &'a str,
    divergence_resolution: DivergenceResolution,
    refresh_branch_state: bool,
    terminal_image_protocol: Option<TerminalImageProtocol>,
    /// A one-off prefix for this start only, never persisted to the Task. The
    /// stored prompt still comes from Task and Project state; this is an extra
    /// instruction the user attached at the moment of starting.
    prompt_prefix: Option<&'a str>,
}

impl<'a> TaskStartRequest<'a> {
    /// The narrow request later Companion transports can use: a Task identifier
    /// and no caller-supplied execution configuration.
    pub(crate) fn safe(task_id: &'a str) -> Self {
        Self {
            task_id,
            divergence_resolution: DivergenceResolution::Auto,
            refresh_branch_state: false,
            terminal_image_protocol: None,
            prompt_prefix: None,
        }
    }

    /// Existing desktop UI choices are accepted only as typed branch/terminal
    /// presentation options. Repository, provider, prompt, and agent settings are
    /// always resolved from persisted Task and Project state.
    pub(crate) fn desktop(
        task_id: &'a str,
        divergence_resolution: DivergenceResolution,
        terminal_image_protocol: Option<TerminalImageProtocol>,
        prompt_prefix: Option<&'a str>,
    ) -> Self {
        Self {
            task_id,
            divergence_resolution,
            refresh_branch_state: true,
            terminal_image_protocol,
            prompt_prefix,
        }
    }
}

struct ProviderLaunchRequest<'a> {
    provider_name: &'a str,
    task_id: &'a str,
    workspace_path: &'a Path,
    prompt: &'a str,
    agent: Option<&'a str>,
    permission_mode: Option<&'a str>,
    model: Option<&'a crate::opencode_client::PromptModel>,
    start_context: &'a ProviderStartContext,
}

trait ProviderLauncher: Send + Sync {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>;

    fn abort<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

struct NativeProviderLauncher {
    pty_manager: PtyManager,
}

impl ProviderLauncher for NativeProviderLauncher {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async move {
            let provider = Provider::from_name(request.provider_name, self.pty_manager.clone())
                .map_err(TaskStartError::InvalidConfiguration)?;
            provider
                .start(
                    request.task_id,
                    request.workspace_path,
                    request.prompt,
                    request.agent,
                    request.permission_mode,
                    request.model,
                    request.start_context,
                )
                .await
                .map_err(provider_start_error)
        })
    }

    fn abort<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.pty_manager
                .kill_pty(task_id)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

#[derive(Clone)]
pub(crate) struct TaskStartService {
    app: Option<AppHandle>,
    db: Arc<Mutex<Database>>,
    provider_launcher: Option<Arc<dyn ProviderLauncher>>,
    worktree_root: Option<PathBuf>,
    app_event_tx: Option<AppEventSender>,
    task_claims: TaskClaims,
}

impl TaskStartService {
    pub(crate) fn new(
        app: Option<AppHandle>,
        db: Arc<Mutex<Database>>,
        pty_manager: Option<PtyManager>,
        app_event_tx: Option<AppEventSender>,
        task_claims: TaskClaims,
    ) -> Self {
        let provider_launcher = pty_manager.map(|pty_manager| {
            Arc::new(NativeProviderLauncher { pty_manager }) as Arc<dyn ProviderLauncher>
        });
        let worktree_root = dirs::home_dir().map(|home| home.join(".openforge").join("worktrees"));
        Self {
            app,
            db,
            provider_launcher,
            worktree_root,
            app_event_tx,
            task_claims,
        }
    }

    #[cfg(test)]
    fn with_provider_launcher(mut self, provider_launcher: Arc<dyn ProviderLauncher>) -> Self {
        self.provider_launcher = Some(provider_launcher);
        self
    }

    #[cfg(test)]
    fn with_worktree_root(mut self, worktree_root: PathBuf) -> Self {
        self.worktree_root = Some(worktree_root);
        self
    }
    pub(crate) async fn start(
        &self,
        request: TaskStartRequest<'_>,
    ) -> Result<TaskStartExecution, TaskStartError> {
        let _start_claim = self
            .task_claims
            .try_claim(request.task_id, TaskOperation::StartImplementation)
            .ok_or(TaskStartError::AlreadyInProgress)?;

        let context = self.load_context(request.task_id)?;
        if self
            .requires_desktop_action(
                &context,
                request.divergence_resolution,
                request.refresh_branch_state,
            )
            .await?
        {
            return Ok(TaskStartExecution {
                outcome: TaskStartOutcome::DesktopActionRequired {
                    task_id: request.task_id.to_string(),
                    reason: DesktopActionReason::ExistingBranchDiverged,
                },
                receipt: None,
            });
        }

        let provider_launcher = self
            .provider_launcher
            .as_ref()
            .ok_or(TaskStartError::RuntimeUnavailable)?;
        let prompt = self.materialize_prompt(&context, request.prompt_prefix)?;
        let workspace = self
            .prepare_workspace(&context, request.divergence_resolution)
            .await?;
        let workspace_path = workspace
            .working_dir
            .to_str()
            .ok_or_else(|| TaskStartError::Workspace("Invalid workspace path".to_string()))?;
        let repo_path = context
            .repo_path
            .to_str()
            .ok_or_else(|| TaskStartError::Workspace("Invalid repository path".to_string()))?;
        let provider_start_context = ProviderStartContext::new(RuntimeEventPublisher::new(
            self.app.clone(),
            self.app_event_tx.clone(),
        ))
        .with_terminal_image_protocol(request.terminal_image_protocol);
        let provider_options = ProviderRunOptions::for_task(&context.task);
        let provider_result = match provider_launcher
            .launch(ProviderLaunchRequest {
                provider_name: &context.provider_name,
                task_id: request.task_id,
                workspace_path: &workspace.working_dir,
                prompt: &prompt,
                agent: provider_options.agent,
                permission_mode: provider_options.permission_mode,
                model: provider_options.model,
                start_context: &provider_start_context,
            })
            .await
        {
            Ok(result) => result,
            Err(error) => {
                self.rollback_failed_workspace(&context, &workspace).await;
                return Err(error);
            }
        };

        let session_id = uuid::Uuid::new_v4().to_string();
        let finalization_result = {
            let db = db::acquire_db(&self.db);
            db.finalize_task_start(db::TaskStartFinalization {
                task_id: request.task_id,
                project_id: &context.project_id,
                workspace_path,
                repo_path,
                workspace_kind: workspace.kind,
                branch_name: workspace.branch_name.as_deref(),
                provider_name: &context.provider_name,
                agent_session_id: &session_id,
                opencode_session_id: provider_result.opencode_session_id.as_deref(),
                pi_session_id: provider_result.pi_session_id.as_deref(),
                pty_instance_id: provider_result.pty_instance_id,
            })
        };
        if let Err(error) = finalization_result {
            if let Err(abort_error) = provider_launcher.abort(request.task_id).await {
                error!(
                    "[task_start] Failed to abort provider after finalization failure for {} error_bytes={}",
                    request.task_id,
                    abort_error.len()
                );
            }
            self.rollback_failed_workspace(&context, &workspace).await;
            return Err(match error {
                db::FinalizeTaskStartError::StaleState => TaskStartError::StaleState,
                other => TaskStartError::Persistence(other.to_string()),
            });
        }
        self.publish_task_changed(request.task_id, &context.project_id);

        let receipt = TaskStartReceipt {
            task_id: request.task_id.to_string(),
            session_id,
            workspace_path: workspace.working_dir,
            port: provider_result.port,
        };
        Ok(TaskStartExecution {
            outcome: TaskStartOutcome::Started {
                task_id: request.task_id.to_string(),
            },
            receipt: Some(receipt),
        })
    }

    fn load_context(&self, task_id: &str) -> Result<StartContext, TaskStartError> {
        let db = db::acquire_db(&self.db);
        let task = db
            .get_task(task_id)
            .map_err(|error| TaskStartError::Persistence(format!("Failed to get Task: {error}")))?
            .ok_or(TaskStartError::NotFound)?;
        if db
            .get_latest_session_for_ticket(task_id)
            .map_err(|error| {
                TaskStartError::Persistence(format!("Failed to get latest Agent Session: {error}"))
            })?
            .is_some_and(|session| matches!(session.status.as_str(), "running" | "paused"))
        {
            return Err(TaskStartError::ActiveSession);
        }
        if task.status != "backlog" {
            return Err(TaskStartError::InvalidState {
                status: task.status,
            });
        }
        for dependency_id in &task.depends_on {
            let dependency = db.get_task(dependency_id).map_err(|error| {
                TaskStartError::Persistence(format!("Failed to get dependency Task: {error}"))
            })?;
            if !matches!(
                dependency
                    .as_ref()
                    .map(|dependency| dependency.status.as_str()),
                Some("done")
            ) {
                return Err(TaskStartError::DependencyBlocked {
                    dependency_id: dependency_id.clone(),
                });
            }
        }

        let project_id = task
            .project_id
            .clone()
            .ok_or(TaskStartError::ProjectRequired)?;
        let project = db
            .get_project(&project_id)
            .map_err(|error| {
                TaskStartError::Persistence(format!("Failed to get Project: {error}"))
            })?
            .ok_or_else(|| TaskStartError::ProjectNotFound {
                project_id: project_id.clone(),
            })?;
        let additional_instructions = db
            .get_project_config(&project_id, "additional_instructions")
            .map_err(|error| {
                TaskStartError::Persistence(format!(
                    "Failed to load additional_instructions config for Project {project_id}: {error}"
                ))
            })?;
        let start_prompt_contributions: Vec<StartPromptContribution> = db
            .get_project_config(
                &project_id,
                agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            )
            .map_err(|error| {
                TaskStartError::Persistence(format!(
                    "failed to load {} config for Project {project_id}: {error}",
                    agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY
                ))
            })?
            .map(|value| {
                serde_json::from_str::<Vec<StartPromptContribution>>(&value).map_err(|error| {
                    TaskStartError::InvalidConfiguration(format!(
                        "invalid {} config for Project {project_id}: {error}",
                        agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY
                    ))
                })
            })
            .transpose()?
            .unwrap_or_default();
        let mut active_start_prompt_contributions =
            Vec::with_capacity(start_prompt_contributions.len());
        for contribution in start_prompt_contributions {
            let is_active = match contribution.owner_plugin_id.as_deref() {
                Some(plugin_id) => db
                    .is_plugin_active_for_project(&project_id, plugin_id)
                    .map_err(|error| {
                        TaskStartError::Persistence(format!(
                            "Failed to resolve activity for Plugin {plugin_id} while loading Task start-prompt contributions for Project {project_id}: {error}"
                        ))
                    })?,
                None => true,
            };
            if is_active {
                active_start_prompt_contributions.push(contribution);
            }
        }
        let start_prompt_contributions = active_start_prompt_contributions;

        Ok(StartContext {
            code_cleanup_enabled: db.resolve_task_bool(
                &task.id,
                "code_cleanup_tasks_enabled",
                false,
            ),
            provider_name: db.resolve_ai_provider_for_task(&task.id),
            task,
            project_id,
            repo_path: PathBuf::from(project.path),
            additional_instructions,
            start_prompt_contributions,
        })
    }

    async fn requires_desktop_action(
        &self,
        context: &StartContext,
        resolution: DivergenceResolution,
        refresh_branch_state: bool,
    ) -> Result<bool, TaskStartError> {
        if resolution != DivergenceResolution::Auto
            || context.task.worktree_source.as_deref() != Some("existingBranch")
        {
            return Ok(false);
        }
        let branch = context
            .task
            .worktree_branch
            .as_deref()
            .map(str::trim)
            .filter(|branch| !branch.is_empty())
            .ok_or_else(|| {
                TaskStartError::Workspace("Existing branch worktrees require a branch".to_string())
            })?;
        let plan = if refresh_branch_state {
            git_worktree::inspect_existing_branch(&context.repo_path, branch).await
        } else {
            git_worktree::inspect_existing_branch_cached(&context.repo_path, branch).await
        }
        .map_err(workspace_error)?;
        Ok(plan.relation == ExistingBranchRelation::Diverged)
    }

    fn materialize_prompt(
        &self,
        context: &StartContext,
        prompt_prefix: Option<&str>,
    ) -> Result<String, TaskStartError> {
        let prompt = agent_lifecycle::build_task_prompt(
            &context.task,
            context.additional_instructions.as_deref(),
            context.code_cleanup_enabled,
            &context.start_prompt_contributions,
            prompt_prefix,
        );
        let image_attachment_root = self
            .app
            .as_ref()
            .map(|app| app.path().app_data_dir())
            .transpose()
            .map_err(|error| {
                TaskStartError::Persistence(format!(
                    "Failed to resolve app data directory: {error}"
                ))
            })?
            .unwrap_or_else(|| std::env::temp_dir().join("openforge"));
        let image_attachment_dir = agent_lifecycle::task_prompt_image_attachment_dir(
            &image_attachment_root,
            &context.task.id,
        );
        agent_lifecycle::materialize_task_prompt_images(
            &context.task.id,
            &prompt,
            &image_attachment_dir,
        )
        .map_err(TaskStartError::Persistence)
    }

    async fn prepare_workspace(
        &self,
        context: &StartContext,
        divergence_resolution: DivergenceResolution,
    ) -> Result<PreparedWorkspace, TaskStartError> {
        if context.task.worktree_source.as_deref() == Some("disabled") {
            return Ok(PreparedWorkspace {
                working_dir: context.repo_path.clone(),
                kind: "project_dir",
                owns_files: false,
                branch_name: None,
                previous_record: None,
            });
        }

        let worktree_root = self
            .worktree_root
            .as_ref()
            .ok_or_else(|| TaskStartError::Workspace("Failed to get home directory".to_string()))?;
        let repo_name = context
            .repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| TaskStartError::Workspace("Invalid repository path".to_string()))?;
        let working_dir = worktree_root.join(repo_name).join(&context.task.id);
        let repo_path = context
            .repo_path
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| TaskStartError::Workspace("Invalid repository path".to_string()))?;
        let worktree_path = working_dir
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| TaskStartError::Workspace("Invalid worktree path".to_string()))?;
        let owns_files = !working_dir.exists();
        let previous_record = {
            let db = db::acquire_db(&self.db);
            db.get_worktree_for_task(&context.task.id)
                .map_err(|error| TaskStartError::Persistence(error.to_string()))?
        };
        let branch = if context.task.worktree_source.as_deref() == Some("existingBranch") {
            let branch = context
                .task
                .worktree_branch
                .as_deref()
                .map(str::trim)
                .filter(|branch| !branch.is_empty())
                .ok_or_else(|| {
                    TaskStartError::Workspace(
                        "Existing branch worktrees require a branch".to_string(),
                    )
                })?;
            git_worktree::create_worktree_from_existing_branch(
                &context.repo_path,
                &working_dir,
                branch,
                divergence_resolution,
            )
            .await
            .map_err(workspace_error)?
        } else {
            let branch = git_worktree::task_branch_name(&context.task.id);
            git_worktree::create_worktree(&context.repo_path, &working_dir, &branch, "origin/main")
                .await
                .map_err(workspace_error)?;
            branch
        };

        let workspace = PreparedWorkspace {
            working_dir,
            kind: "git_worktree",
            owns_files,
            branch_name: Some(branch),
            previous_record,
        };
        let record_result = {
            let db = db::acquire_db(&self.db);
            db.create_worktree_record(
                &context.task.id,
                &context.project_id,
                &repo_path,
                &worktree_path,
                workspace
                    .branch_name
                    .as_deref()
                    .expect("prepared git worktree has a branch"),
            )
        };
        if let Err(error) = record_result {
            self.remove_workspace_files(context, &workspace).await;
            return Err(TaskStartError::Persistence(error.to_string()));
        }

        Ok(workspace)
    }

    async fn remove_workspace_files(&self, context: &StartContext, workspace: &PreparedWorkspace) {
        if workspace.kind != "git_worktree" || !workspace.owns_files {
            return;
        }
        let remove_result = if context.task.worktree_source.as_deref() == Some("existingBranch") {
            git_worktree::remove_worktree(&context.repo_path, &workspace.working_dir).await
        } else {
            git_worktree::remove_worktree_with_branch(
                &context.repo_path,
                &workspace.working_dir,
                workspace.branch_name.as_deref(),
            )
            .await
        };
        if let Err(error) = remove_result {
            error!(
                "[task_start] Failed to remove worktree during failed-start rollback for {} error_bytes={}",
                context.task.id,
                error.to_string().len()
            );
        }
    }

    async fn rollback_failed_workspace(
        &self,
        context: &StartContext,
        workspace: &PreparedWorkspace,
    ) {
        self.remove_workspace_files(context, workspace).await;
        if workspace.kind != "git_worktree" {
            return;
        }
        let db = db::acquire_db(&self.db);
        let rollback_result = match workspace.previous_record.as_ref() {
            Some(record) => db.restore_worktree_record(record),
            None => db.delete_worktree_record(&context.task.id),
        };
        if let Err(error) = rollback_result {
            error!(
                "[task_start] Failed to restore worktree state during failed-start rollback for {}: {}",
                context.task.id, error
            );
        }
    }

    fn publish_task_changed(&self, task_id: &str, project_id: &str) {
        publish_app_event_to_runtime(
            self.app.as_ref(),
            &self.app_event_tx,
            "task-changed",
            &serde_json::json!({
                "action": "updated",
                "task_id": task_id,
                "project_id": project_id,
            }),
        );
    }
}

struct StartContext {
    task: TaskRow,
    project_id: String,
    repo_path: PathBuf,
    additional_instructions: Option<String>,
    start_prompt_contributions: Vec<StartPromptContribution>,
    code_cleanup_enabled: bool,
    provider_name: String,
}

struct PreparedWorkspace {
    working_dir: PathBuf,
    kind: &'static str,
    owns_files: bool,
    branch_name: Option<String>,
    previous_record: Option<WorktreeRow>,
}

struct ProviderRunOptions<'a> {
    agent: Option<&'a str>,
    permission_mode: Option<&'a str>,
    model: Option<&'a crate::opencode_client::PromptModel>,
}

impl<'a> ProviderRunOptions<'a> {
    fn for_task(task: &'a TaskRow) -> Self {
        Self {
            agent: task.agent.as_deref(),
            permission_mode: task.permission_mode.as_deref(),
            model: None,
        }
    }
}

fn workspace_error(error: GitWorktreeError) -> TaskStartError {
    TaskStartError::Workspace(error.to_string())
}

fn provider_start_error(error: ProviderError) -> TaskStartError {
    if error.is_invalid_workspace_cwd() {
        TaskStartError::InvalidWorkspace(error.to_string())
    } else {
        TaskStartError::ProviderLaunch(error.to_string())
    }
}

#[cfg(test)]
mod tests;
