mod asset_resolution;
mod backend_runtime;
mod enablement;
mod lifecycle;
mod storage;

use crate::{db, plugin_host::PluginHost};
use std::{path::PathBuf, sync::Mutex};

#[allow(
    unused_imports,
    reason = "preserve the existing plugin_platform::PluginAssetRoot path"
)]
pub(crate) use asset_resolution::PluginAssetRoot;
pub(crate) use lifecycle::PluginLifecycleLocks;
pub(crate) use storage::validate_plugin_storage_scope;

pub(crate) struct PluginPlatform<'a> {
    db: &'a Mutex<db::Database>,
    app_data_dir: Option<PathBuf>,
    plugin_host: Option<&'a PluginHost>,
    lifecycle_locks: &'a PluginLifecycleLocks,
}

impl<'a> PluginPlatform<'a> {
    pub(crate) fn new(
        db: &'a Mutex<db::Database>,
        app_data_dir: Option<PathBuf>,
        plugin_host: Option<&'a PluginHost>,
        lifecycle_locks: &'a PluginLifecycleLocks,
    ) -> Self {
        Self {
            db,
            app_data_dir,
            plugin_host,
            lifecycle_locks,
        }
    }
}
