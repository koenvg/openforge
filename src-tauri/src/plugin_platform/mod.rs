mod asset_resolution;
mod backend_runtime;
mod enablement;
mod error;
mod lifecycle;
mod storage;

use crate::{db, plugin_host::PluginHost, scoped_workspace_service::ScopedWorkspaceService};
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
            scoped_workspaces,
        }
    }

    fn schedule_scoped_workspace_release(&self, plugin_id: &str, project_id: Option<&str>) {
        let Some(service) = self.scoped_workspaces.clone() else {
            return;
        };
        let plugin_id = plugin_id.to_string();
        let project_id = project_id.map(str::to_owned);
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            log::warn!(
                "[scoped_workspace] owner cleanup could not be scheduled outside a Tokio runtime"
            );
            return;
        };
        runtime.spawn(async move {
            match service
                .release_owner(&plugin_id, project_id.as_deref())
                .await
            {
                Ok(report) if report.deferred > 0 => log::warn!(
                    "[scoped_workspace] owner cleanup deferred for {} checkout(s)",
                    report.deferred
                ),
                Ok(_) => {}
                Err(error) => log::warn!("[scoped_workspace] owner cleanup failed: {error}"),
            }
        });
    }
}
