use crate::{
    db::{self, Database, NewScopedWorkspace, ScopedWorkspaceRow},
    git_origin_fetch::{fetch_origin, ORIGIN_FETCH_TIMEOUT},
    git_worktree,
    pty_manager::{scoped_agent_session_key, SessionScope, SessionScopeError},
};
use std::{
    collections::HashMap,
    future::Future,
    io,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
};
use thiserror::Error;

pub(crate) const MAX_SCOPED_WORKSPACES: usize = 32;
pub(crate) const MAX_SCOPED_WORKSPACE_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub(crate) struct AcquireScopedWorkspace<'a> {
    pub owner_plugin_id: &'a str,
    pub scope: SessionScope<'a>,
    pub project_id: &'a str,
    pub checkout_revision: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScopedWorkspace {
    pub id: String,
    pub path: PathBuf,
    pub resolved_commit: String,
    pub measured_bytes: u64,
    pub reused: bool,
}

#[derive(Debug, Clone, Copy)]
enum CommitSelection<'a> {
    CheckoutRevision,
    ResolvedCommit(&'a str),
}

#[derive(Debug, Error)]
pub(crate) enum ScopedWorkspaceError {
    #[error(transparent)]
    InvalidScope(#[from] SessionScopeError),
    #[error("Scoped Workspace owner plugin id must not be empty")]
    EmptyOwner,
    #[error("OpenForge Project {project_id} does not exist")]
    ProjectNotFound { project_id: String },
    #[error("Session Scope is owned by plugin {owner_plugin_id}")]
    OwnershipConflict { owner_plugin_id: String },
    #[error(
        "Session Scope already uses Project {project_id} and checkout revision {checkout_revision}"
    )]
    RequestMismatch {
        project_id: String,
        checkout_revision: String,
    },
    #[error("git fetch origin failed or timed out while fetching revision '{revision}' for Project {project_id}; verify the origin remote, network access, and credentials")]
    FetchFailed {
        project_id: String,
        revision: String,
    },
    #[error("revision '{revision}' does not resolve to a commit in Project {project_id}")]
    RevisionNotFound {
        project_id: String,
        revision: String,
    },
    #[error("Scoped Workspace Git operation failed: {0}")]
    Git(String),
    #[error("Scoped Workspace storage failed: {0}")]
    Database(String),
    #[error("failed to measure Scoped Workspace at {path}: {source}")]
    Measurement { path: PathBuf, source: io::Error },
    #[error("Scoped Workspace filesystem task failed: {0}")]
    FilesystemTask(String),
    #[error("Scoped Workspace uses {measured_bytes} bytes, above the {limit_bytes}-byte limit")]
    WorkspaceTooLarge {
        measured_bytes: u64,
        limit_bytes: u64,
    },
    #[error("Scoped Workspace capacity is exhausted: limit is {max_workspaces} checkouts and {max_bytes} bytes")]
    CapacityExhausted {
        max_workspaces: usize,
        max_bytes: u64,
    },
    #[error("Scoped Workspace cleanup is pending and will be retried: {0}")]
    CleanupDeferred(String),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ScopedWorkspaceCleanupReport {
    pub removed: usize,
    pub deferred: usize,
}

trait WorkspaceRemover: Send + Sync {
    fn remove<'a>(
        &'a self,
        repo_path: &'a Path,
        workspace_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

trait WorkspacePublisher: Send + Sync {
    fn publish<'a>(
        &'a self,
        repo_path: &'a Path,
        staged_path: &'a Path,
        published_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

trait WorkspaceMeasurer: Send + Sync {
    fn measure(&self, root: &Path) -> io::Result<u64>;
}

struct GitWorkspaceRemover;
struct GitWorkspacePublisher;
struct LogicalWorkspaceMeasurer;

impl WorkspaceRemover for GitWorkspaceRemover {
    fn remove<'a>(
        &'a self,
        repo_path: &'a Path,
        workspace_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            git_worktree::remove_worktree(repo_path, workspace_path)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

impl WorkspacePublisher for GitWorkspacePublisher {
    fn publish<'a>(
        &'a self,
        repo_path: &'a Path,
        staged_path: &'a Path,
        published_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            git_worktree::move_worktree(repo_path, staged_path, published_path)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

impl WorkspaceMeasurer for LogicalWorkspaceMeasurer {
    fn measure(&self, root: &Path) -> io::Result<u64> {
        measure_workspace(root)
    }
}

#[derive(Clone)]
pub(crate) struct ScopedWorkspaceService {
    database: Arc<Mutex<Database>>,
    root: PathBuf,
    mutation_lock: Arc<tokio::sync::Mutex<()>>,
    protections: Arc<Mutex<HashMap<String, usize>>>,
    measurer: Arc<dyn WorkspaceMeasurer>,
    publisher: Arc<dyn WorkspacePublisher>,
    remover: Arc<dyn WorkspaceRemover>,
    max_workspaces: usize,
    max_bytes: u64,
}

pub(crate) struct ScopedWorkspaceLease {
    workspace_id: String,
    protections: Arc<Mutex<HashMap<String, usize>>>,
}

impl Drop for ScopedWorkspaceLease {
    fn drop(&mut self) {
        let mut protections = self
            .protections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(count) = protections.get_mut(&self.workspace_id) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            protections.remove(&self.workspace_id);
        }
    }
}

impl ScopedWorkspaceService {
    pub(crate) fn new(database: Arc<Mutex<Database>>, root: PathBuf) -> Self {
        Self {
            database,
            root,
            mutation_lock: Arc::new(tokio::sync::Mutex::new(())),
            protections: Arc::new(Mutex::new(HashMap::new())),
            measurer: Arc::new(LogicalWorkspaceMeasurer),
            publisher: Arc::new(GitWorkspacePublisher),
            remover: Arc::new(GitWorkspaceRemover),
            max_workspaces: MAX_SCOPED_WORKSPACES,
            max_bytes: MAX_SCOPED_WORKSPACE_BYTES,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_limits(mut self, max_workspaces: usize, max_bytes: u64) -> Self {
        self.max_workspaces = max_workspaces;
        self.max_bytes = max_bytes;
        self
    }

    #[cfg(test)]
    fn with_remover(mut self, remover: Arc<dyn WorkspaceRemover>) -> Self {
        self.remover = remover;
        self
    }

    #[cfg(test)]
    fn with_measurer(mut self, measurer: Arc<dyn WorkspaceMeasurer>) -> Self {
        self.measurer = measurer;
        self
    }

    #[cfg(test)]
    fn with_publisher(mut self, publisher: Arc<dyn WorkspacePublisher>) -> Self {
        self.publisher = publisher;
        self
    }

    pub(crate) async fn protect(
        &self,
        scope: SessionScope<'_>,
    ) -> Result<ScopedWorkspaceLease, ScopedWorkspaceError> {
        let workspace_id = scoped_agent_session_key(scope)?;
        let _mutation = self.mutation_lock.lock().await;
        let mut protections = self
            .protections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *protections.entry(workspace_id.clone()).or_insert(0) += 1;
        drop(protections);
        Ok(ScopedWorkspaceLease {
            workspace_id,
            protections: Arc::clone(&self.protections),
        })
    }

    pub(crate) fn is_available(
        &self,
        scope: SessionScope<'_>,
    ) -> Result<bool, ScopedWorkspaceError> {
        scoped_agent_session_key(scope)?;
        Ok(self.exact_workspace(scope)?.is_some_and(|workspace| {
            workspace.cleanup_state == "ready" && Path::new(&workspace.workspace_path).is_dir()
        }))
    }

    pub(crate) async fn acquire(
        &self,
        request: AcquireScopedWorkspace<'_>,
    ) -> Result<ScopedWorkspace, ScopedWorkspaceError> {
        self.acquire_with(request, CommitSelection::CheckoutRevision)
            .await
    }

    pub(crate) async fn release(
        &self,
        owner_plugin_id: &str,
        scope: SessionScope<'_>,
    ) -> Result<(), ScopedWorkspaceError> {
        scoped_agent_session_key(scope)?;
        let _mutation = self.mutation_lock.lock().await;
        let Some(workspace) = self.exact_workspace(scope)? else {
            return Ok(());
        };
        if workspace.owner_plugin_id != owner_plugin_id {
            return Err(ScopedWorkspaceError::OwnershipConflict {
                owner_plugin_id: workspace.owner_plugin_id,
            });
        }
        self.cleanup_row(&workspace).await
    }

    #[allow(
        dead_code,
        reason = "direct owner cleanup is exercised by lifecycle tests"
    )]
    pub(crate) async fn release_owner(
        &self,
        owner_plugin_id: &str,
        project_id: Option<&str>,
    ) -> Result<ScopedWorkspaceCleanupReport, ScopedWorkspaceError> {
        let workspaces = self.with_database(|database| {
            database.scoped_workspaces_for_owner(owner_plugin_id, project_id)
        })?;
        self.release_captured(owner_plugin_id, workspaces).await
    }

    pub(crate) async fn release_captured(
        &self,
        owner_plugin_id: &str,
        workspaces: Vec<ScopedWorkspaceRow>,
    ) -> Result<ScopedWorkspaceCleanupReport, ScopedWorkspaceError> {
        let _mutation = self.mutation_lock.lock().await;
        let mut current = Vec::new();
        for captured in workspaces {
            let workspace = self.exact_workspace(SessionScope {
                namespace: &captured.namespace,
                target_key: &captured.target_key,
                revision: &captured.revision,
            })?;
            if let Some(workspace) = workspace {
                if workspace.id == captured.id
                    && workspace.owner_plugin_id == owner_plugin_id
                    && !self.is_protected(&workspace.id)
                {
                    current.push(workspace);
                }
            }
        }
        Ok(self.cleanup_rows(current).await)
    }

    #[allow(
        dead_code,
        reason = "explicit cleanup retry remains available for the upcoming public session host"
    )]
    pub(crate) async fn retry_pending_cleanup(
        &self,
    ) -> Result<ScopedWorkspaceCleanupReport, ScopedWorkspaceError> {
        let _mutation = self.mutation_lock.lock().await;
        let pending = self.with_database(|database| {
            database.scoped_workspaces_in_states(&["reserved", "cleanup_pending"])
        })?;
        Ok(self.cleanup_rows(pending).await)
    }

    pub(crate) async fn reconcile_startup(
        &self,
    ) -> Result<ScopedWorkspaceCleanupReport, ScopedWorkspaceError> {
        let _mutation = self.mutation_lock.lock().await;
        let mut report = ScopedWorkspaceCleanupReport::default();

        let incomplete = self.with_database(|database| {
            database.scoped_workspaces_in_states(&["reserved", "cleanup_pending"])
        })?;
        add_cleanup_report(&mut report, self.cleanup_rows(incomplete).await);

        let missing = self
            .with_database(|database| database.scoped_workspaces_in_states(&["ready"]))?
            .into_iter()
            .filter(|workspace| !Path::new(&workspace.workspace_path).is_dir())
            .collect();
        add_cleanup_report(&mut report, self.cleanup_rows(missing).await);

        let orphans = self.with_database(Database::inactive_or_orphaned_scoped_workspaces)?;
        add_cleanup_report(&mut report, self.cleanup_rows(orphans).await);

        self.remove_untracked_directories("staging")?;
        self.remove_untracked_directories("ready")?;
        let projects = self.with_database(Database::get_all_projects)?;
        for project in projects {
            let repo_path = PathBuf::from(project.path);
            if repo_path.is_dir() {
                git_worktree::prune_worktrees(&repo_path)
                    .await
                    .map_err(|error| ScopedWorkspaceError::Git(error.to_string()))?;
            }
        }
        Ok(report)
    }

    pub(crate) async fn recreate_at_commit(
        &self,
        request: AcquireScopedWorkspace<'_>,
        resolved_commit: &str,
    ) -> Result<ScopedWorkspace, ScopedWorkspaceError> {
        self.acquire_with(request, CommitSelection::ResolvedCommit(resolved_commit))
            .await
    }

    async fn acquire_with(
        &self,
        request: AcquireScopedWorkspace<'_>,
        commit_selection: CommitSelection<'_>,
    ) -> Result<ScopedWorkspace, ScopedWorkspaceError> {
        let workspace_id = scoped_agent_session_key(request.scope)?;
        if request.owner_plugin_id.is_empty() {
            return Err(ScopedWorkspaceError::EmptyOwner);
        }
        let _mutation = self.mutation_lock.lock().await;
        if let Some(existing) = self.exact_workspace(request.scope)? {
            self.verify_reuse(&existing, &request)?;
            if existing.cleanup_state == "ready"
                && commit_selection.matches(&existing.resolved_commit)
                && Path::new(&existing.workspace_path).is_dir()
            {
                self.with_database(|database| database.touch_scoped_workspace(&existing.id))?;
                return Ok(workspace_result(existing, true));
            }
            self.cleanup_row(&existing).await?;
        }
        self.remove_previous_revisions(&request).await?;
        let project = self
            .with_database(|database| database.get_project(request.project_id))?
            .ok_or_else(|| ScopedWorkspaceError::ProjectNotFound {
                project_id: request.project_id.to_string(),
            })?;
        let repo_path = PathBuf::from(&project.path);
        let resolved_commit = match commit_selection {
            CommitSelection::CheckoutRevision => {
                self.resolve_requested_commit(
                    &repo_path,
                    request.project_id,
                    request.checkout_revision,
                )
                .await?
            }
            CommitSelection::ResolvedCommit(commit) => {
                let local_commit = self
                    .resolve_requested_commit(&repo_path, request.project_id, commit)
                    .await?;
                if local_commit != commit {
                    return Err(ScopedWorkspaceError::RevisionNotFound {
                        project_id: request.project_id.to_string(),
                        revision: commit.to_string(),
                    });
                }
                local_commit
            }
        };
        self.create_workspace(request, &workspace_id, &repo_path, &resolved_commit)
            .await
    }

    fn exact_workspace(
        &self,
        scope: SessionScope<'_>,
    ) -> Result<Option<ScopedWorkspaceRow>, ScopedWorkspaceError> {
        self.with_database(|database| {
            database.scoped_workspace(scope.namespace, scope.target_key, scope.revision)
        })
    }

    async fn remove_previous_revisions(
        &self,
        request: &AcquireScopedWorkspace<'_>,
    ) -> Result<(), ScopedWorkspaceError> {
        let previous_revisions = self.with_database(|database| {
            database.scoped_workspaces_for_logical_scope(
                request.scope.namespace,
                request.scope.target_key,
            )
        })?;
        for previous in previous_revisions {
            if previous.owner_plugin_id != request.owner_plugin_id {
                return Err(ScopedWorkspaceError::OwnershipConflict {
                    owner_plugin_id: previous.owner_plugin_id,
                });
            }
            self.cleanup_row(&previous).await?;
        }
        Ok(())
    }

    fn verify_reuse(
        &self,
        existing: &ScopedWorkspaceRow,
        request: &AcquireScopedWorkspace<'_>,
    ) -> Result<(), ScopedWorkspaceError> {
        if existing.owner_plugin_id != request.owner_plugin_id {
            return Err(ScopedWorkspaceError::OwnershipConflict {
                owner_plugin_id: existing.owner_plugin_id.clone(),
            });
        }
        if existing.project_id != request.project_id
            || existing.checkout_revision != request.checkout_revision
        {
            return Err(ScopedWorkspaceError::RequestMismatch {
                project_id: existing.project_id.clone(),
                checkout_revision: existing.checkout_revision.clone(),
            });
        }
        Ok(())
    }

    async fn resolve_requested_commit(
        &self,
        repo_path: &Path,
        project_id: &str,
        revision: &str,
    ) -> Result<String, ScopedWorkspaceError> {
        if let Some(commit) = git_worktree::resolve_commit(repo_path, revision)
            .await
            .map_err(|error| ScopedWorkspaceError::Git(error.to_string()))?
        {
            return Ok(commit);
        }
        if !fetch_origin(repo_path, ORIGIN_FETCH_TIMEOUT).await {
            return Err(ScopedWorkspaceError::FetchFailed {
                project_id: project_id.to_string(),
                revision: revision.to_string(),
            });
        }
        git_worktree::resolve_commit(repo_path, revision)
            .await
            .map_err(|error| ScopedWorkspaceError::Git(error.to_string()))?
            .ok_or_else(|| ScopedWorkspaceError::RevisionNotFound {
                project_id: project_id.to_string(),
                revision: revision.to_string(),
            })
    }

    async fn create_workspace(
        &self,
        request: AcquireScopedWorkspace<'_>,
        workspace_id: &str,
        repo_path: &Path,
        resolved_commit: &str,
    ) -> Result<ScopedWorkspace, ScopedWorkspaceError> {
        let staging_path = self
            .root
            .join("staging")
            .join(format!("{workspace_id}-{}", uuid::Uuid::new_v4().simple()));
        let published_path = self.root.join("ready").join(workspace_id);
        let repo_path_string = path_string(repo_path)?;
        let staging_path_string = path_string(&staging_path)?;
        self.with_database(|database| {
            database.reserve_scoped_workspace(&NewScopedWorkspace {
                id: workspace_id,
                owner_plugin_id: request.owner_plugin_id,
                namespace: request.scope.namespace,
                target_key: request.scope.target_key,
                revision: request.scope.revision,
                project_id: request.project_id,
                repo_path: &repo_path_string,
                checkout_revision: request.checkout_revision,
                resolved_commit,
                workspace_path: &staging_path_string,
            })
        })?;

        if let Err(error) =
            git_worktree::create_detached_worktree(repo_path, &staging_path, resolved_commit).await
        {
            let failure = ScopedWorkspaceError::Git(error.to_string());
            return Err(self
                .rollback_failure(workspace_id, repo_path, &staging_path, failure)
                .await);
        }

        let measured_bytes =
            match measure_workspace_async(staging_path.clone(), Arc::clone(&self.measurer)).await {
                Ok(bytes) => bytes,
                Err(error) => {
                    return Err(self
                        .rollback_failure(workspace_id, repo_path, &staging_path, error)
                        .await);
                }
            };
        if let Err(error) = self.with_database(|database| {
            database.record_scoped_workspace_measurement(workspace_id, measured_bytes)
        }) {
            return Err(self
                .rollback_failure(workspace_id, repo_path, &staging_path, error)
                .await);
        }

        if let Err(error) = self.enforce_capacity(measured_bytes).await {
            return Err(self
                .rollback_failure(workspace_id, repo_path, &staging_path, error)
                .await);
        }

        if let Err(error) = self
            .publisher
            .publish(repo_path, &staging_path, &published_path)
            .await
        {
            let failure = ScopedWorkspaceError::Git(error);
            return Err(self
                .rollback_failure(workspace_id, repo_path, &staging_path, failure)
                .await);
        }
        let published_path_string = match path_string(&published_path) {
            Ok(path) => path,
            Err(error) => {
                return Err(self
                    .rollback_failure(workspace_id, repo_path, &published_path, error)
                    .await);
            }
        };
        if let Err(error) = self.with_database(|database| {
            database.publish_scoped_workspace(workspace_id, &published_path_string, measured_bytes)
        }) {
            return Err(self
                .rollback_failure(workspace_id, repo_path, &published_path, error)
                .await);
        }

        Ok(ScopedWorkspace {
            id: workspace_id.to_string(),
            path: published_path,
            resolved_commit: resolved_commit.to_string(),
            measured_bytes,
            reused: false,
        })
    }

    async fn enforce_capacity(&self, candidate_bytes: u64) -> Result<(), ScopedWorkspaceError> {
        if candidate_bytes > self.max_bytes {
            return Err(ScopedWorkspaceError::WorkspaceTooLarge {
                measured_bytes: candidate_bytes,
                limit_bytes: self.max_bytes,
            });
        }

        loop {
            let retained = self.with_database(|database| {
                database.scoped_workspaces_in_states(&["ready", "cleanup_pending"])
            })?;
            let retained_bytes = retained.iter().try_fold(0_u64, |total, workspace| {
                total.checked_add(workspace.measured_bytes).ok_or_else(|| {
                    ScopedWorkspaceError::Database(
                        "Scoped Workspace byte accounting overflowed".to_string(),
                    )
                })
            })?;
            let within_count = retained.len().saturating_add(1) <= self.max_workspaces;
            let within_bytes = retained_bytes
                .checked_add(candidate_bytes)
                .is_some_and(|total| total <= self.max_bytes);
            if within_count && within_bytes {
                return Ok(());
            }

            let candidate = retained
                .iter()
                .find(|workspace| {
                    workspace.cleanup_state == "ready" && !self.is_protected(&workspace.id)
                })
                .cloned();
            let Some(candidate) = candidate else {
                return Err(ScopedWorkspaceError::CapacityExhausted {
                    max_workspaces: self.max_workspaces,
                    max_bytes: self.max_bytes,
                });
            };
            match self.cleanup_row(&candidate).await {
                Ok(()) => {}
                Err(error @ ScopedWorkspaceError::Database(_)) => return Err(error),
                Err(_) => {
                    let remaining_candidate = retained.iter().any(|workspace| {
                        workspace.id != candidate.id
                            && workspace.cleanup_state == "ready"
                            && !self.is_protected(&workspace.id)
                    });
                    if !remaining_candidate {
                        return Err(ScopedWorkspaceError::CapacityExhausted {
                            max_workspaces: self.max_workspaces,
                            max_bytes: self.max_bytes,
                        });
                    }
                }
            }
        }
    }

    fn is_protected(&self, id: &str) -> bool {
        self.protections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(id)
    }

    async fn rollback_failure(
        &self,
        id: &str,
        repo_path: &Path,
        path: &Path,
        failure: ScopedWorkspaceError,
    ) -> ScopedWorkspaceError {
        match self.rollback_reservation(id, repo_path, path).await {
            Ok(()) => failure,
            Err(cleanup) => ScopedWorkspaceError::CleanupDeferred(format!(
                "{failure}; rollback also failed: {cleanup}"
            )),
        }
    }

    async fn rollback_reservation(
        &self,
        id: &str,
        repo_path: &Path,
        path: &Path,
    ) -> Result<(), ScopedWorkspaceError> {
        let mark_error = self
            .with_database(|database| database.mark_scoped_workspace_cleanup_pending(id))
            .err();
        match self.remover.remove(repo_path, path).await {
            Ok(()) => {
                self.with_database(|database| database.delete_scoped_workspace(id))?;
                Ok(())
            }
            Err(error) => Err(ScopedWorkspaceError::CleanupDeferred(match mark_error {
                Some(mark_error) => {
                    format!("{error}; cleanup state could not be recorded: {mark_error}")
                }
                None => error,
            })),
        }
    }

    async fn cleanup_row(
        &self,
        workspace: &ScopedWorkspaceRow,
    ) -> Result<(), ScopedWorkspaceError> {
        self.with_database(|database| {
            database.mark_scoped_workspace_cleanup_pending(&workspace.id)
        })?;
        self.remover
            .remove(
                Path::new(&workspace.repo_path),
                Path::new(&workspace.workspace_path),
            )
            .await
            .map_err(ScopedWorkspaceError::CleanupDeferred)?;
        self.with_database(|database| database.delete_scoped_workspace(&workspace.id))
    }

    async fn cleanup_rows(
        &self,
        workspaces: Vec<ScopedWorkspaceRow>,
    ) -> ScopedWorkspaceCleanupReport {
        let mut report = ScopedWorkspaceCleanupReport::default();
        for workspace in workspaces {
            match self.cleanup_row(&workspace).await {
                Ok(()) => report.removed += 1,
                Err(error) => {
                    report.deferred += 1;
                    log::warn!(
                        "[scoped_workspace] cleanup deferred for {}: {}",
                        workspace.id,
                        error
                    );
                }
            }
        }
        report
    }

    fn remove_untracked_directories(&self, kind: &str) -> Result<(), ScopedWorkspaceError> {
        let directory = self.root.join(kind);
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(ScopedWorkspaceError::FilesystemTask(format!(
                    "failed to inspect {}: {error}",
                    directory.display()
                )))
            }
        };
        let tracked = self
            .with_database(|database| {
                database.scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
            })?
            .into_iter()
            .map(|workspace| PathBuf::from(workspace.workspace_path))
            .collect::<std::collections::HashSet<_>>();
        for entry in entries {
            let entry = entry.map_err(|error| {
                ScopedWorkspaceError::FilesystemTask(format!(
                    "failed to inspect {}: {error}",
                    directory.display()
                ))
            })?;
            if tracked.contains(&entry.path()) {
                continue;
            }
            let file_type = entry.file_type().map_err(|error| {
                ScopedWorkspaceError::FilesystemTask(format!(
                    "failed to inspect {}: {error}",
                    entry.path().display()
                ))
            })?;
            let result = if file_type.is_dir() && !file_type.is_symlink() {
                std::fs::remove_dir_all(entry.path())
            } else {
                std::fs::remove_file(entry.path())
            };
            result.map_err(|error| {
                ScopedWorkspaceError::FilesystemTask(format!(
                    "failed to remove untracked Scoped Workspace path {}: {error}",
                    entry.path().display()
                ))
            })?;
        }
        Ok(())
    }

    fn with_database<T>(
        &self,
        operation: impl FnOnce(&Database) -> rusqlite::Result<T>,
    ) -> Result<T, ScopedWorkspaceError> {
        let database = db::acquire_db(&self.database);
        operation(&database).map_err(|error| ScopedWorkspaceError::Database(error.to_string()))
    }
}

impl CommitSelection<'_> {
    fn matches(self, resolved_commit: &str) -> bool {
        match self {
            Self::CheckoutRevision => true,
            Self::ResolvedCommit(expected) => expected == resolved_commit,
        }
    }
}

fn add_cleanup_report(
    total: &mut ScopedWorkspaceCleanupReport,
    next: ScopedWorkspaceCleanupReport,
) {
    total.removed += next.removed;
    total.deferred += next.deferred;
}

fn workspace_result(row: ScopedWorkspaceRow, reused: bool) -> ScopedWorkspace {
    ScopedWorkspace {
        id: row.id,
        path: PathBuf::from(row.workspace_path),
        resolved_commit: row.resolved_commit,
        measured_bytes: row.measured_bytes,
        reused,
    }
}

fn path_string(path: &Path) -> Result<String, ScopedWorkspaceError> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        ScopedWorkspaceError::Git(format!("path is not valid UTF-8: {}", path.display()))
    })
}

async fn measure_workspace_async(
    path: PathBuf,
    measurer: Arc<dyn WorkspaceMeasurer>,
) -> Result<u64, ScopedWorkspaceError> {
    let display_path = path.clone();
    tokio::task::spawn_blocking(move || measurer.measure(&path))
        .await
        .map_err(|error| ScopedWorkspaceError::FilesystemTask(error.to_string()))?
        .map_err(|source| ScopedWorkspaceError::Measurement {
            path: display_path,
            source,
        })
}

fn measure_workspace(root: &Path) -> io::Result<u64> {
    let mut total = 0_u64;
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file() {
                total = total.checked_add(metadata.len()).ok_or_else(|| {
                    io::Error::other("Scoped Workspace logical byte count overflowed")
                })?;
            }
        }
    }
    Ok(total)
}

#[cfg(test)]
#[path = "scoped_workspace_service_failure_tests.rs"]
mod failure_tests;
#[cfg(test)]
#[path = "scoped_workspace_service_lifecycle_tests.rs"]
mod lifecycle_tests;
#[cfg(test)]
#[path = "scoped_workspace_service_test_support.rs"]
mod test_support;
