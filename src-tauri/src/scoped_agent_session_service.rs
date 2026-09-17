//! Host-owned lifecycle for Agent Sessions addressed by a Session Scope.

use crate::{
    db::{
        Database, NewScopedAgentSession, ScopedAgentSessionRow, ScopedAgentSessionStatus,
        ScopedAgentSessionStoreError,
    },
    pty_manager::{scoped_agent_session_key, SessionScope, SessionScopeError},
    scoped_workspace_service::{AcquireScopedWorkspace, ScopedWorkspaceService},
    session_tool_policy::{SessionToolPolicy, SessionToolPolicyError},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard, PoisonError, Weak},
};
use thiserror::Error;

pub(crate) const SCOPED_EXECUTION_LIMIT: usize = 4;
pub(crate) const SCOPED_QUEUE_LIMIT: usize = 32;
pub(crate) const SCOPED_INPUT_LIMIT_BYTES: usize = 64 * 1024;
pub(crate) type RuntimeFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
pub(crate) type ScopedCompletionObserver = Arc<dyn Fn(String, u64, bool) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OwnedSessionScope {
    pub namespace: String,
    pub target_key: String,
    pub revision: String,
}
impl OwnedSessionScope {
    fn borrowed(&self) -> SessionScope<'_> {
        SessionScope {
            namespace: &self.namespace,
            target_key: &self.target_key,
            revision: &self.revision,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StartScopedAgentSession {
    pub owner_plugin_id: String,
    pub scope: OwnedSessionScope,
    pub project_id: String,
    pub checkout_revision: String,
    pub initial_input: String,
    pub tool_policy: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScopedLaunchRequest {
    pub session_id: String,
    pub owner_plugin_id: String,
    pub scope: OwnedSessionScope,
    pub tool_policy: String,
    pub terminal_key: String,
    pub provider_session_id: String,
    pub workspace_path: PathBuf,
    pub input: String,
    pub resume: bool,
}

pub(crate) struct AcquiredSessionWorkspace {
    pub path: PathBuf,
    pub resolved_commit: String,
    lease: Box<dyn Send + Sync>,
}

pub(crate) trait ScopedSessionWorkspace: Send + Sync {
    fn acquire<'a>(
        &'a self,
        session: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace>;
    fn protect<'a>(
        &'a self,
        session: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>>;
    fn is_available(&self, session: &ScopedAgentSessionRow) -> Result<bool, String>;
    fn release<'a>(&'a self, session: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()>;
}

pub(crate) trait ScopedSessionRuntime: Send + Sync {
    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, u64>;
    fn input<'a>(&'a self, terminal_key: &'a str, input: &'a str) -> RuntimeFuture<'a, ()>;
    fn abort<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, ()>;
    fn output<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, String>;
    fn dispose<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, ()>;
}

impl ScopedSessionWorkspace for ScopedWorkspaceService {
    fn acquire<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace> {
        Box::pin(async move {
            let lease = self
                .protect(SessionScope {
                    namespace: &row.namespace,
                    target_key: &row.target_key,
                    revision: &row.revision,
                })
                .await
                .map_err(|error| error.to_string())?;
            let request = AcquireScopedWorkspace {
                owner_plugin_id: &row.owner_plugin_id,
                scope: SessionScope {
                    namespace: &row.namespace,
                    target_key: &row.target_key,
                    revision: &row.revision,
                },
                project_id: &row.project_id,
                checkout_revision: &row.checkout_revision,
            };
            let workspace = if let Some(resolved_commit) = row.resolved_commit.as_deref() {
                self.recreate_at_commit(request, resolved_commit).await
            } else {
                self.acquire(request).await
            }
            .map_err(|error| error.to_string())?;
            Ok(AcquiredSessionWorkspace {
                path: workspace.path,
                resolved_commit: workspace.resolved_commit,
                lease: Box::new(lease),
            })
        })
    }

    fn protect<'a>(
        &'a self,
        row: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>> {
        Box::pin(async move {
            self.protect(SessionScope {
                namespace: &row.namespace,
                target_key: &row.target_key,
                revision: &row.revision,
            })
            .await
            .map(|lease| Box::new(lease) as Box<dyn Send + Sync>)
            .map_err(|error| error.to_string())
        })
    }

    fn is_available(&self, row: &ScopedAgentSessionRow) -> Result<bool, String> {
        self.is_available(SessionScope {
            namespace: &row.namespace,
            target_key: &row.target_key,
            revision: &row.revision,
        })
        .map_err(|error| error.to_string())
    }

    fn release<'a>(&'a self, row: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            self.release(
                &row.owner_plugin_id,
                SessionScope {
                    namespace: &row.namespace,
                    target_key: &row.target_key,
                    revision: &row.revision,
                },
            )
            .await
            .map_err(|error| error.to_string())
        })
    }
}

pub(crate) use crate::scoped_agent_session_runtime::ScopedClaudeRuntime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScopedAgentSessionState {
    pub id: String,
    pub status: ScopedAgentSessionStatus,
    pub queue_position: Option<usize>,
    pub accepts_input: bool,
    pub workspace_available: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Error)]
pub(crate) enum ScopedAgentSessionError {
    #[error(transparent)]
    InvalidScope(#[from] SessionScopeError),
    #[error(transparent)]
    Storage(#[from] ScopedAgentSessionStoreError),
    #[error(transparent)]
    ToolPolicy(#[from] SessionToolPolicyError),
    #[error("Scoped Agent Session input exceeds the {SCOPED_INPUT_LIMIT_BYTES}-byte limit")]
    InputTooLarge,
    #[error("OpenForge Project {0} does not exist")]
    ProjectNotFound(String),
    #[error("Scoped Agent Session belongs to another plugin")]
    Forbidden,
    #[error("Scoped Agent Session is not ready for input in status {0}")]
    NotReady(String),
    #[error("Scoped Agent Session runtime failed: {0}")]
    Runtime(String),
}

#[derive(Debug, Clone)]
struct PendingLaunch {
    input: String,
    resume: bool,
}

#[derive(Clone, Default)]
struct SessionOperationLocks {
    entries: Arc<Mutex<HashMap<SessionOperationKey, Weak<tokio::sync::Mutex<()>>>>>,
}

#[derive(Clone, Hash, PartialEq, Eq)]
enum SessionOperationKey {
    Session(String),
    LogicalScope {
        namespace: String,
        target_key: String,
    },
}

impl SessionOperationLocks {
    fn lock_for(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.lock_for_key(SessionOperationKey::Session(session_id.to_string()))
    }

    fn lock_for_logical_scope(
        &self,
        namespace: &str,
        target_key: &str,
    ) -> Arc<tokio::sync::Mutex<()>> {
        self.lock_for_key(SessionOperationKey::LogicalScope {
            namespace: namespace.to_string(),
            target_key: target_key.to_string(),
        })
    }

    fn lock_for_key(&self, key: SessionOperationKey) -> Arc<tokio::sync::Mutex<()>> {
        let mut entries = lock(&self.entries);
        entries.retain(|_, entry| entry.strong_count() > 0);
        entries
            .get(&key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let operation = Arc::new(tokio::sync::Mutex::new(()));
                entries.insert(key, Arc::downgrade(&operation));
                operation
            })
    }
}

#[derive(Clone)]
pub(crate) struct ScopedAgentSessionService {
    database: Arc<Mutex<Database>>,
    workspaces: Arc<dyn ScopedSessionWorkspace>,
    runtime: Arc<dyn ScopedSessionRuntime>,
    pending: Arc<Mutex<HashMap<String, PendingLaunch>>>,
    workspace_leases: Arc<Mutex<HashMap<String, Box<dyn Send + Sync>>>>,
    session_operations: SessionOperationLocks,
}

impl ScopedAgentSessionService {
    pub(crate) fn new(
        database: Arc<Mutex<Database>>,
        workspaces: Arc<dyn ScopedSessionWorkspace>,
        runtime: Arc<dyn ScopedSessionRuntime>,
    ) -> Self {
        Self {
            database,
            workspaces,
            runtime,
            pending: Arc::new(Mutex::new(HashMap::new())),
            workspace_leases: Arc::new(Mutex::new(HashMap::new())),
            session_operations: SessionOperationLocks::default(),
        }
    }

    pub(crate) async fn start(
        &self,
        request: StartScopedAgentSession,
    ) -> Result<ScopedAgentSessionState, ScopedAgentSessionError> {
        validate_input(&request.initial_input)?;
        let terminal_key = scoped_agent_session_key(request.scope.borrowed())?;
        let logical_operation = self
            .session_operations
            .lock_for_logical_scope(&request.scope.namespace, &request.scope.target_key);
        let operation = logical_operation.lock().await;
        let provider = {
            let database = lock(&self.database);
            if database
                .get_project(&request.project_id)
                .map_err(|e| ScopedAgentSessionError::Runtime(e.to_string()))?
                .is_none()
            {
                return Err(ScopedAgentSessionError::ProjectNotFound(request.project_id));
            }
            database
                .try_resolve_ai_provider(&request.project_id)
                .map_err(|e| ScopedAgentSessionError::Runtime(e.to_string()))?
        };
        SessionToolPolicy::resolve(&request.tool_policy, &provider)?;
        let promoted = self.release_previous_revision(&request).await?;
        let id = format!("sas-{}", uuid::Uuid::new_v4());
        let row = lock(&self.database).admit_scoped_agent_session(
            &NewScopedAgentSession {
                id: &id,
                owner_plugin_id: &request.owner_plugin_id,
                namespace: &request.scope.namespace,
                target_key: &request.scope.target_key,
                revision: &request.scope.revision,
                project_id: &request.project_id,
                checkout_revision: &request.checkout_revision,
                provider: &provider,
                tool_policy: &request.tool_policy,
                terminal_key: &terminal_key,
                status: ScopedAgentSessionStatus::Starting,
                queue_sequence: None,
            },
            SCOPED_EXECUTION_LIMIT,
            SCOPED_QUEUE_LIMIT,
        )?;
        lock(&self.pending).insert(
            row.id.clone(),
            PendingLaunch {
                input: request.initial_input,
                resume: false,
            },
        );
        let should_launch = row.status == ScopedAgentSessionStatus::Starting;
        drop(operation);
        for promoted in promoted {
            self.launch_promoted(Some(promoted)).await;
        }
        if should_launch {
            self.launch_starting(row.clone()).await?;
        }
        self.state_for_row(&self.require_owned_by_id(&row.id, &request.owner_plugin_id)?)
    }

    pub(crate) fn status(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
    ) -> Result<Option<ScopedAgentSessionState>, ScopedAgentSessionError> {
        scoped_agent_session_key(scope.borrowed())?;
        let row = lock(&self.database).scoped_agent_session(
            &scope.namespace,
            &scope.target_key,
            &scope.revision,
        )?;
        match row {
            None => Ok(None),
            Some(row) if row.owner_plugin_id != owner => Err(ScopedAgentSessionError::Forbidden),
            Some(row) => self.state_for_row(&row).map(Some),
        }
    }

    pub(crate) async fn input(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
        input: &str,
    ) -> Result<ScopedAgentSessionState, ScopedAgentSessionError> {
        validate_input(input)?;
        let row = self.require_owned_scope(owner, scope)?;
        let session_operation = self.session_operations.lock_for(&row.id);
        let session_guard = session_operation.lock().await;
        let row = self.require_owned_by_id(&row.id, owner)?;
        let mut launch = None;
        match row.status {
            ScopedAgentSessionStatus::Running | ScopedAgentSessionStatus::Paused => self
                .runtime
                .input(&row.terminal_key, input)
                .await
                .map_err(ScopedAgentSessionError::Runtime)?,
            ScopedAgentSessionStatus::Completed => {
                let lease = self
                    .workspaces
                    .protect(&row)
                    .await
                    .map_err(ScopedAgentSessionError::Runtime)?;
                let scheduled = lock(&self.database).schedule_scoped_agent_continuation(
                    &row.id,
                    SCOPED_EXECUTION_LIMIT,
                    SCOPED_QUEUE_LIMIT,
                )?;
                lock(&self.pending).insert(
                    row.id.clone(),
                    PendingLaunch {
                        input: input.to_string(),
                        resume: true,
                    },
                );
                lock(&self.workspace_leases).insert(row.id.clone(), lease);
                if scheduled.status == ScopedAgentSessionStatus::Starting {
                    launch = Some(scheduled);
                }
            }
            status => {
                return Err(ScopedAgentSessionError::NotReady(
                    status.as_str().to_string(),
                ))
            }
        }
        drop(session_guard);
        if let Some(row) = launch {
            self.launch_starting(row).await?;
        }
        self.state_for_row(&self.require_owned_by_id(&row.id, owner)?)
    }

    pub(crate) async fn abort(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
    ) -> Result<ScopedAgentSessionState, ScopedAgentSessionError> {
        let row = self.require_owned_scope(owner, scope)?;
        let session_operation = self.session_operations.lock_for(&row.id);
        let session_guard = session_operation.lock().await;
        let row = self.require_owned_by_id(&row.id, owner)?;
        if matches!(
            row.status,
            ScopedAgentSessionStatus::Starting
                | ScopedAgentSessionStatus::Running
                | ScopedAgentSessionStatus::Paused
        ) {
            self.runtime
                .abort(&row.terminal_key)
                .await
                .map_err(ScopedAgentSessionError::Runtime)?;
        }
        lock(&self.pending).remove(&row.id);
        lock(&self.workspace_leases).remove(&row.id);
        let promoted =
            lock(&self.database).abort_scoped_agent_session(&row.id, SCOPED_EXECUTION_LIMIT)?;
        drop(session_guard);
        self.launch_promoted(promoted).await;
        self.state_for_row(&self.require_owned_by_id(&row.id, owner)?)
    }

    pub(crate) async fn complete(
        &self,
        id: &str,
        instance: u64,
        succeeded: bool,
    ) -> Result<bool, ScopedAgentSessionError> {
        let session_operation = self.session_operations.lock_for(id);
        let session_guard = session_operation.lock().await;
        let status = if succeeded {
            ScopedAgentSessionStatus::Completed
        } else {
            ScopedAgentSessionStatus::Failed
        };
        let (changed, promoted) = lock(&self.database).finish_scoped_agent_session(
            id,
            instance,
            status,
            (!succeeded).then_some("PROVIDER_EXITED"),
            (!succeeded).then_some("Provider process exited unsuccessfully"),
            SCOPED_EXECUTION_LIMIT,
        )?;
        if !changed {
            return Ok(false);
        }
        lock(&self.pending).remove(id);
        lock(&self.workspace_leases).remove(id);
        drop(session_guard);
        self.launch_promoted(promoted).await;
        Ok(true)
    }

    pub(crate) async fn output(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
    ) -> Result<String, ScopedAgentSessionError> {
        let row = self.require_owned_scope(owner, scope)?;
        let session_operation = self.session_operations.lock_for(&row.id);
        let _session_guard = session_operation.lock().await;
        let row = self.require_owned_by_id(&row.id, owner)?;
        self.runtime
            .output(&row.terminal_key)
            .await
            .map_err(ScopedAgentSessionError::Runtime)
    }

    pub(crate) async fn release(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
    ) -> Result<(), ScopedAgentSessionError> {
        let row = self.require_owned_scope(owner, scope)?;
        self.release_by_id(owner, &row.id).await.map(|_| ())
    }

    pub(crate) async fn release_owner(
        &self,
        owner: &str,
        project_id: Option<&str>,
    ) -> Result<usize, ScopedAgentSessionError> {
        let rows = lock(&self.database).scoped_agent_sessions_for_owner(owner, project_id)?;
        self.release_captured(
            owner,
            rows.into_iter().map(|row| row.id).collect::<Vec<_>>(),
        )
        .await
    }

    pub(crate) async fn release_captured(
        &self,
        owner: &str,
        session_ids: Vec<String>,
    ) -> Result<usize, ScopedAgentSessionError> {
        let mut released = 0;
        let mut failures = Vec::new();
        for session_id in session_ids {
            match self.release_by_id(owner, &session_id).await {
                Ok(true) => released += 1,
                Ok(false) => {}
                Err(error) => failures.push(format!("{session_id}: {error}")),
            }
        }
        if !failures.is_empty() {
            return Err(ScopedAgentSessionError::Runtime(format!(
                "failed to release scoped sessions: {}",
                failures.join("; ")
            )));
        }
        Ok(released)
    }

    async fn release_by_id(
        &self,
        owner: &str,
        session_id: &str,
    ) -> Result<bool, ScopedAgentSessionError> {
        let Some(row) = lock(&self.database).scoped_agent_session_by_id(session_id)? else {
            return Ok(false);
        };
        if row.owner_plugin_id != owner {
            return Err(ScopedAgentSessionError::Forbidden);
        }
        let session_operation = self.session_operations.lock_for(session_id);
        let session_guard = session_operation.lock().await;
        let Some(row) = lock(&self.database).scoped_agent_session_by_id(session_id)? else {
            return Ok(false);
        };
        if row.owner_plugin_id != owner {
            return Err(ScopedAgentSessionError::Forbidden);
        }
        let (promoted, cleanup) = self.release_locked_row(&row).await?;
        drop(session_guard);
        self.launch_promoted(promoted).await;
        cleanup?;
        Ok(true)
    }

    async fn release_previous_revision(
        &self,
        request: &StartScopedAgentSession,
    ) -> Result<Vec<ScopedAgentSessionRow>, ScopedAgentSessionError> {
        let rows = lock(&self.database).scoped_agent_sessions_for_logical_scope(
            &request.scope.namespace,
            &request.scope.target_key,
        )?;
        let mut promoted_rows = Vec::new();
        for row in rows {
            if row.revision == request.scope.revision {
                continue;
            }
            if row.owner_plugin_id != request.owner_plugin_id {
                return Err(ScopedAgentSessionError::Forbidden);
            }
            let session_operation = self.session_operations.lock_for(&row.id);
            let session_guard = session_operation.lock().await;
            let Some(current) = lock(&self.database).scoped_agent_session_by_id(&row.id)? else {
                continue;
            };
            if current.owner_plugin_id != request.owner_plugin_id {
                return Err(ScopedAgentSessionError::Forbidden);
            }
            let (promoted, cleanup) = self.release_locked_row(&current).await?;
            drop(session_guard);
            if let Err(error) = cleanup {
                self.launch_promoted(promoted).await;
                return Err(error);
            }
            if let Some(promoted) = promoted {
                promoted_rows.push(promoted);
            }
        }
        Ok(promoted_rows)
    }

    async fn launch_starting(
        &self,
        row: ScopedAgentSessionRow,
    ) -> Result<(), ScopedAgentSessionError> {
        let session_operation = self.session_operations.lock_for(&row.id);
        let _session_guard = session_operation.lock().await;
        if lock(&self.database)
            .scoped_agent_session_by_id(&row.id)?
            .is_none_or(|current| current.status != ScopedAgentSessionStatus::Starting)
        {
            return Ok(());
        }
        let pending = lock(&self.pending).get(&row.id).cloned().ok_or_else(|| {
            ScopedAgentSessionError::Runtime("queued launch input was lost".into())
        })?;
        let launch = async {
            let workspace = self.workspaces.acquire(&row).await?;
            let AcquiredSessionWorkspace {
                path,
                resolved_commit,
                lease,
            } = workspace;
            lock(&self.workspace_leases).insert(row.id.clone(), lease);
            lock(&self.database)
                .set_scoped_agent_resolved_commit(&row.id, &resolved_commit)
                .map_err(|e| e.to_string())?;
            let provider_session_id = row
                .provider_session_id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let instance = self
                .runtime
                .launch(ScopedLaunchRequest {
                    session_id: row.id.clone(),
                    owner_plugin_id: row.owner_plugin_id.clone(),
                    scope: OwnedSessionScope {
                        namespace: row.namespace.clone(),
                        target_key: row.target_key.clone(),
                        revision: row.revision.clone(),
                    },
                    tool_policy: row.tool_policy.clone(),
                    terminal_key: row.terminal_key.clone(),
                    provider_session_id: provider_session_id.clone(),
                    workspace_path: path,
                    input: pending.input,
                    resume: pending.resume,
                })
                .await?;
            let persistence = {
                lock(&self.database).mark_scoped_agent_session_running(
                    &row.id,
                    &provider_session_id,
                    instance,
                )
            };
            if let Err(error) = persistence {
                let cleanup = self.runtime.abort(&row.terminal_key).await.err();
                return Err(match cleanup {
                    Some(cleanup) => format!(
                        "persist running session: {error}; abort spawned provider: {cleanup}"
                    ),
                    None => format!("persist running session: {error}"),
                });
            }
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = launch {
            lock(&self.pending).remove(&row.id);
            lock(&self.workspace_leases).remove(&row.id);
            let (_, promoted) = lock(&self.database).fail_starting_scoped_agent_session(
                &row.id,
                "START_FAILED",
                &error,
                SCOPED_EXECUTION_LIMIT,
            )?;
            Box::pin(self.launch_promoted(promoted)).await;
            return Err(ScopedAgentSessionError::Runtime(error));
        }
        Ok(())
    }

    async fn release_locked_row(
        &self,
        row: &ScopedAgentSessionRow,
    ) -> Result<
        (
            Option<ScopedAgentSessionRow>,
            Result<(), ScopedAgentSessionError>,
        ),
        ScopedAgentSessionError,
    > {
        let promoted = if row.status.is_live() {
            if row.status != ScopedAgentSessionStatus::Queued {
                self.runtime
                    .abort(&row.terminal_key)
                    .await
                    .map_err(ScopedAgentSessionError::Runtime)?;
            }
            lock(&self.workspace_leases).remove(&row.id);
            lock(&self.database).abort_scoped_agent_session(&row.id, SCOPED_EXECUTION_LIMIT)?
        } else {
            None
        };
        let cleanup = async {
            self.runtime
                .dispose(&row.terminal_key)
                .await
                .map_err(ScopedAgentSessionError::Runtime)?;
            let workspace_error = self.workspaces.release(row).await.err();
            lock(&self.pending).remove(&row.id);
            lock(&self.workspace_leases).remove(&row.id);
            if !lock(&self.database).delete_scoped_agent_session(&row.id, &row.owner_plugin_id)? {
                return Err(ScopedAgentSessionError::Forbidden);
            }
            if let Some(error) = workspace_error {
                log::warn!(
                    "[scoped-agent-session] workspace cleanup deferred for {}: {error}",
                    row.id
                );
            }
            Ok(())
        }
        .await;
        Ok((promoted, cleanup))
    }

    async fn launch_promoted(&self, promoted: Option<ScopedAgentSessionRow>) {
        if let Some(promoted) = promoted {
            if let Err(error) = self.launch_starting(promoted).await {
                log::warn!("[scoped-agent-session] promoted session failed to launch: {error}");
            }
        }
    }

    fn require_owned_scope(
        &self,
        owner: &str,
        scope: &OwnedSessionScope,
    ) -> Result<ScopedAgentSessionRow, ScopedAgentSessionError> {
        scoped_agent_session_key(scope.borrowed())?;
        let row = lock(&self.database)
            .scoped_agent_session(&scope.namespace, &scope.target_key, &scope.revision)?
            .ok_or_else(|| ScopedAgentSessionStoreError::NotFound {
                session_id: "scope".into(),
            })?;
        if row.owner_plugin_id != owner {
            return Err(ScopedAgentSessionError::Forbidden);
        }
        Ok(row)
    }

    fn require_owned_by_id(
        &self,
        id: &str,
        owner: &str,
    ) -> Result<ScopedAgentSessionRow, ScopedAgentSessionError> {
        let row = lock(&self.database)
            .scoped_agent_session_by_id(id)?
            .ok_or_else(|| ScopedAgentSessionStoreError::NotFound {
                session_id: id.into(),
            })?;
        if row.owner_plugin_id != owner {
            return Err(ScopedAgentSessionError::Forbidden);
        }
        Ok(row)
    }

    fn state_for_row(
        &self,
        row: &ScopedAgentSessionRow,
    ) -> Result<ScopedAgentSessionState, ScopedAgentSessionError> {
        Ok(ScopedAgentSessionState {
            id: row.id.clone(),
            status: row.status,
            queue_position: lock(&self.database).scoped_agent_queue_position(&row.id)?,
            accepts_input: matches!(
                row.status,
                ScopedAgentSessionStatus::Running
                    | ScopedAgentSessionStatus::Paused
                    | ScopedAgentSessionStatus::Completed
            ),
            workspace_available: self
                .workspaces
                .is_available(row)
                .map_err(ScopedAgentSessionError::Runtime)?,
            error_code: row.error_code.clone(),
            error_message: row.error_message.clone(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

fn validate_input(input: &str) -> Result<(), ScopedAgentSessionError> {
    if input.len() > SCOPED_INPUT_LIMIT_BYTES {
        Err(ScopedAgentSessionError::InputTooLarge)
    } else {
        Ok(())
    }
}
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
#[path = "scoped_agent_session_service_tests.rs"]
mod tests;
