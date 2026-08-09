use crate::app_events::{publish_app_event_to_runtime, AppEventBus, AppEventSender};
use crate::backend_runtime::AppHandle;
use crate::db::{BoardStatus, CompleteTaskWriteOutcome, Database};
use crate::pty_manager::PtyManager;
use crate::task_claims::{TaskClaim, TaskClaims, TaskOperation};
use log::error;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

pub type RuntimeShutdownFuture<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

/// Transport-independent boundary for stopping the runtime owned by a Task.
pub trait TerminalTaskRuntime: Clone + Send + Sync + 'static {
    fn stop_agent<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a>;
    fn stop_task_shells<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a>;
}

#[derive(Clone)]
pub struct PtyTerminalTaskRuntime {
    manager: Option<PtyManager>,
}

impl PtyTerminalTaskRuntime {
    pub fn new(manager: Option<PtyManager>) -> Self {
        Self { manager }
    }
}

impl TerminalTaskRuntime for PtyTerminalTaskRuntime {
    fn stop_agent<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            if let Some(manager) = &self.manager {
                manager
                    .kill_pty(task_id)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    fn stop_task_shells<'a>(&'a self, task_id: &'a str) -> RuntimeShutdownFuture<'a> {
        Box::pin(async move {
            if let Some(manager) = &self.manager {
                manager
                    .kill_shells_for_task(task_id)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalTaskAction {
    Delete,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalTaskCompletionRequest {
    /// Compatibility request for the existing desktop command. The service
    /// resolves backlog to Delete and doing to Complete from authoritative state.
    Desktop(String),
    Delete(String),
    #[allow(dead_code)] // Reserved for the distinct Companion Complete route.
    Complete(String),
}

impl TerminalTaskCompletionRequest {
    pub fn desktop(task_id: &str) -> Self {
        Self::Desktop(task_id.to_string())
    }

    pub fn delete(task_id: &str) -> Self {
        Self::Delete(task_id.to_string())
    }

    #[allow(dead_code)] // Reserved for the distinct Companion Complete route.
    pub fn complete(task_id: &str) -> Self {
        Self::Complete(task_id.to_string())
    }

    fn task_id(&self) -> &str {
        match self {
            Self::Desktop(task_id) | Self::Delete(task_id) | Self::Complete(task_id) => task_id,
        }
    }

    fn requested_action(&self) -> Option<TerminalTaskAction> {
        match self {
            Self::Desktop(_) => None,
            Self::Delete(_) => Some(TerminalTaskAction::Delete),
            Self::Complete(_) => Some(TerminalTaskAction::Complete),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalTaskCompletionOutcome {
    Deleted {
        task_id: String,
        cleanup_scheduled: bool,
    },
    Completed {
        task_id: String,
        cleanup_scheduled: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalTaskCompletionError {
    NotFound,
    AlreadyClaimed,
    InvalidState {
        requested_action: Option<TerminalTaskAction>,
        current_state: String,
    },
    RuntimeShutdown(String),
    Persistence(String),
}

impl fmt::Display for TerminalTaskCompletionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("Task not found"),
            Self::AlreadyClaimed => {
                formatter.write_str("Task already has a completion in progress")
            }
            Self::InvalidState {
                requested_action,
                current_state,
            } => match requested_action {
                Some(action) => write!(
                    formatter,
                    "{action:?} is not valid for a Task in state {current_state}"
                ),
                None => write!(
                    formatter,
                    "Task state {current_state} cannot be completed from the desktop"
                ),
            },
            Self::RuntimeShutdown(message) => {
                write!(formatter, "Failed to clean up Task runtime: {message}")
            }
            Self::Persistence(message) => write!(formatter, "Failed to complete Task: {message}"),
        }
    }
}

impl std::error::Error for TerminalTaskCompletionError {}

#[derive(Debug)]
struct TaskRuntimeCleanup {
    repo_path: PathBuf,
    worktree_path: PathBuf,
    branch_to_delete: Option<String>,
}

struct CompletionContext {
    action: TerminalTaskAction,
    project_id: Option<String>,
    expected_status: String,
    cleanup: Option<TaskRuntimeCleanup>,
}

pub struct TerminalTaskCompletionService<R> {
    db: Arc<Mutex<Database>>,
    runtime: R,
    claims: TaskClaims,
    app: Option<AppHandle>,
    app_event_bus: Option<AppEventBus>,
    app_event_tx: Option<AppEventSender>,
}

impl<R: TerminalTaskRuntime> TerminalTaskCompletionService<R> {
    pub fn new(
        db: Arc<Mutex<Database>>,
        runtime: R,
        claims: TaskClaims,
        app: Option<AppHandle>,
        app_event_bus: Option<AppEventBus>,
        app_event_tx: Option<AppEventSender>,
    ) -> Self {
        Self {
            db,
            runtime,
            claims,
            app,
            app_event_bus,
            app_event_tx,
        }
    }

    pub async fn complete(
        &self,
        request: TerminalTaskCompletionRequest,
    ) -> Result<TerminalTaskCompletionOutcome, TerminalTaskCompletionError> {
        let task_id = request.task_id().to_string();
        let claim = self
            .claims
            .try_claim(&task_id, TaskOperation::TerminalCompletion)
            .ok_or(TerminalTaskCompletionError::AlreadyClaimed)?;
        let context = self.load_context(&request)?;

        self.stop_runtime(&task_id).await?;
        self.complete_reference_data(&task_id, &context.expected_status, context.action)?;
        self.publish_completed_event(&task_id, context.project_id.as_deref());

        let cleanup_scheduled = self.schedule_cleanup(&task_id, context.cleanup, claim);
        Ok(match context.action {
            TerminalTaskAction::Delete => TerminalTaskCompletionOutcome::Deleted {
                task_id,
                cleanup_scheduled,
            },
            TerminalTaskAction::Complete => TerminalTaskCompletionOutcome::Completed {
                task_id,
                cleanup_scheduled,
            },
        })
    }

    fn load_context(
        &self,
        request: &TerminalTaskCompletionRequest,
    ) -> Result<CompletionContext, TerminalTaskCompletionError> {
        let task_id = request.task_id();
        let db = crate::db::acquire_db(&self.db);
        let task = db
            .get_task(task_id)
            .map_err(|error| TerminalTaskCompletionError::Persistence(error.to_string()))?
            .ok_or(TerminalTaskCompletionError::NotFound)?;
        let state = BoardStatus::from_str(&task.status).map_err(|_| {
            TerminalTaskCompletionError::InvalidState {
                requested_action: request.requested_action(),
                current_state: task.status.clone(),
            }
        })?;
        let action = resolve_action(request, state)?;
        let worktree = db
            .get_worktree_for_task(task_id)
            .map_err(|error| TerminalTaskCompletionError::Persistence(error.to_string()))?;
        let uses_existing_branch = task.worktree_source.as_deref() == Some("existingBranch");
        let cleanup = worktree.map(|worktree| TaskRuntimeCleanup {
            repo_path: PathBuf::from(worktree.repo_path),
            worktree_path: PathBuf::from(worktree.worktree_path),
            branch_to_delete: (!uses_existing_branch).then_some(worktree.branch_name),
        });

        Ok(CompletionContext {
            action,
            project_id: task.project_id,
            expected_status: task.status,
            cleanup,
        })
    }

    async fn stop_runtime(&self, task_id: &str) -> Result<(), TerminalTaskCompletionError> {
        let mut failures = Vec::new();
        if let Err(error) = self.runtime.stop_agent(task_id).await {
            failures.push(format!("Agent PTY: {error}"));
        }
        if let Err(error) = self.runtime.stop_task_shells(task_id).await {
            failures.push(format!("Task shell PTYs: {error}"));
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(TerminalTaskCompletionError::RuntimeShutdown(
                failures.join("; "),
            ))
        }
    }

    fn complete_reference_data(
        &self,
        task_id: &str,
        expected_status: &str,
        action: TerminalTaskAction,
    ) -> Result<(), TerminalTaskCompletionError> {
        let db = crate::db::acquire_db(&self.db);
        match db
            .complete_task_if_status(task_id, expected_status)
            .map_err(|error| TerminalTaskCompletionError::Persistence(error.to_string()))?
        {
            CompleteTaskWriteOutcome::Completed => Ok(()),
            CompleteTaskWriteOutcome::NotFound => Err(TerminalTaskCompletionError::NotFound),
            CompleteTaskWriteOutcome::StaleState { current_status } => {
                Err(TerminalTaskCompletionError::InvalidState {
                    requested_action: Some(action),
                    current_state: current_status,
                })
            }
        }
    }

    fn publish_completed_event(&self, task_id: &str, project_id: Option<&str>) {
        if let Some(events) = &self.app_event_bus {
            match events.tasks().completed(task_id, project_id) {
                Ok(_) => return,
                Err(error) => error!(
                    "[terminal_task_completion] Failed to publish canonical Task completion event: {:?}",
                    error
                ),
            }
        }

        let mut payload = serde_json::json!({
            "action": "deleted",
            "task_id": task_id,
        });
        if let Some(project_id) = project_id {
            payload["project_id"] = serde_json::json!(project_id);
        }
        publish_app_event_to_runtime(
            self.app.as_ref(),
            &self.app_event_tx,
            "task-changed",
            &payload,
        );
    }

    fn schedule_cleanup(
        &self,
        task_id: &str,
        cleanup: Option<TaskRuntimeCleanup>,
        claim: TaskClaim,
    ) -> bool {
        let Some(cleanup) = cleanup else {
            drop(claim);
            return false;
        };
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let _claim = claim;
            run_task_runtime_cleanup(&task_id, cleanup).await;
        });
        true
    }
}

fn resolve_action(
    request: &TerminalTaskCompletionRequest,
    state: BoardStatus,
) -> Result<TerminalTaskAction, TerminalTaskCompletionError> {
    let action = match (request, state) {
        (TerminalTaskCompletionRequest::Desktop(_), BoardStatus::Backlog)
        | (TerminalTaskCompletionRequest::Delete(_), BoardStatus::Backlog) => {
            TerminalTaskAction::Delete
        }
        (TerminalTaskCompletionRequest::Desktop(_), BoardStatus::Doing)
        | (TerminalTaskCompletionRequest::Complete(_), BoardStatus::Doing) => {
            TerminalTaskAction::Complete
        }
        _ => {
            return Err(TerminalTaskCompletionError::InvalidState {
                requested_action: request.requested_action(),
                current_state: state.as_str().to_string(),
            });
        }
    };
    Ok(action)
}

async fn run_task_runtime_cleanup(task_id: &str, cleanup: TaskRuntimeCleanup) {
    let result = crate::git_worktree::remove_worktree_with_branch(
        &cleanup.repo_path,
        &cleanup.worktree_path,
        cleanup.branch_to_delete.as_deref(),
    )
    .await;
    if let Err(error) = result {
        error!(
            "[terminal_task_completion] Failed to remove worktree for completed Task {} error_bytes={}",
            task_id,
            error.to_string().len()
        );
    }
}
