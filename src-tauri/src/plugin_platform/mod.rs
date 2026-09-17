mod asset_resolution;
mod backend_runtime;
mod enablement;
mod error;
mod lifecycle;
mod storage;

use crate::{
    db, plugin_host::PluginHost, scoped_agent_session_service::ScopedAgentSessionService,
    scoped_workspace_service::ScopedWorkspaceService,
};
use std::{path::PathBuf, sync::Mutex};

#[allow(
    unused_imports,
    reason = "preserve the existing plugin_platform::PluginAssetRoot path"
)]
pub(crate) use asset_resolution::PluginAssetRoot;
pub(crate) use error::{PluginPlatformError, PluginPlatformResult};
pub(crate) use lifecycle::PluginLifecycleLocks;
pub(crate) use storage::PluginStorageScope;

pub(crate) struct PluginPlatform<'a> {
    db: &'a Mutex<db::Database>,
    app_data_dir: Option<PathBuf>,
    plugin_host: Option<&'a PluginHost>,
    lifecycle_locks: &'a PluginLifecycleLocks,
    scoped_agent_sessions: Option<ScopedAgentSessionService>,
    scoped_workspaces: Option<ScopedWorkspaceService>,
}

impl<'a> PluginPlatform<'a> {
    pub(crate) fn new(
        db: &'a Mutex<db::Database>,
        app_data_dir: Option<PathBuf>,
        plugin_host: Option<&'a PluginHost>,
        lifecycle_locks: &'a PluginLifecycleLocks,
        scoped_workspaces: Option<ScopedWorkspaceService>,
    ) -> Self {
        Self {
            db,
            app_data_dir,
            plugin_host,
            lifecycle_locks,
            scoped_agent_sessions: None,
            scoped_workspaces,
        }
    }

    pub(crate) fn with_scoped_agent_sessions(
        mut self,
        service: Option<ScopedAgentSessionService>,
    ) -> Self {
        self.scoped_agent_sessions = service;
        self
    }

    fn schedule_scoped_resource_release(&self, plugin_id: &str, project_id: Option<&str>) {
        let sessions = self.scoped_agent_sessions.clone();
        let workspaces = self.scoped_workspaces.clone();
        if sessions.is_none() && workspaces.is_none() {
            return;
        }
        let (session_ids, workspace_rows) = {
            let database = db::acquire_db(self.db);
            let session_ids = if sessions.is_some() {
                match database.scoped_agent_sessions_for_owner(plugin_id, project_id) {
                    Ok(rows) => rows.into_iter().map(|row| row.id).collect(),
                    Err(error) => {
                        log::warn!(
                            "[scoped_agent_session] failed to capture owner cleanup: {error}"
                        );
                        return;
                    }
                }
            } else {
                Vec::new()
            };
            let workspace_rows = if workspaces.is_some() {
                match database.scoped_workspaces_for_owner(plugin_id, project_id) {
                    Ok(rows) => rows,
                    Err(error) => {
                        log::warn!("[scoped_workspace] failed to capture owner cleanup: {error}");
                        return;
                    }
                }
            } else {
                Vec::new()
            };
            (session_ids, workspace_rows)
        };
        let plugin_id = plugin_id.to_string();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            log::warn!(
                "[scoped_workspace] owner cleanup could not be scheduled outside a Tokio runtime"
            );
            return;
        };
        runtime.spawn(async move {
            let mut sessions_released = true;
            if let Some(service) = sessions {
                if let Err(error) = service.release_captured(&plugin_id, session_ids).await {
                    sessions_released = false;
                    log::warn!("[scoped_agent_session] owner cleanup failed: {error}");
                }
            }
            if sessions_released {
                if let Some(service) = workspaces {
                    match service.release_captured(&plugin_id, workspace_rows).await {
                        Ok(report) if report.deferred > 0 => log::warn!(
                            "[scoped_workspace] owner cleanup deferred for {} checkout(s)",
                            report.deferred
                        ),
                        Ok(_) => {}
                        Err(error) => {
                            log::warn!("[scoped_workspace] owner cleanup failed: {error}")
                        }
                    }
                }
            } else {
                log::warn!("[scoped_workspace] owner cleanup skipped while scoped sessions remain");
            }
        });
    }
}
