use super::{PluginPlatform, PluginPlatformError, PluginPlatformResult};
use crate::db;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PluginAssetRoot {
    pub(crate) plugin_id: String,
    pub(crate) asset_root: String,
    pub(crate) is_builtin: bool,
}

impl PluginPlatform<'_> {
    pub(crate) fn resolve_plugin_asset_root(
        &self,
        plugin_id: &str,
    ) -> PluginPlatformResult<PluginAssetRoot> {
        let plugin = self.plugin(plugin_id)?.ok_or_else(|| {
            PluginPlatformError::not_found(format!("Unknown plugin: {plugin_id}"))
        })?;
        let asset_root = resolve_plugin_install_root(&plugin)?;

        Ok(PluginAssetRoot {
            plugin_id: plugin.id,
            asset_root: asset_root.to_string_lossy().into_owned(),
            is_builtin: plugin.is_builtin,
        })
    }

    pub(super) fn resolve_installed_backend_path(
        &self,
        plugin_id: &str,
    ) -> PluginPlatformResult<PathBuf> {
        let plugin = self.plugin(plugin_id)?.ok_or_else(|| {
            PluginPlatformError::not_found(format!("Unknown plugin: {plugin_id}"))
        })?;
        let backend_entry = plugin.backend_entry.clone().ok_or_else(|| {
            PluginPlatformError::invalid_request(format!(
                "Plugin backend not configured for {plugin_id}"
            ))
        })?;
        let install_root = resolve_plugin_install_root(&plugin)?;
        resolve_backend_entry_path(&install_root, &backend_entry)
    }
}

fn resolve_plugin_install_root(plugin: &db::PluginRow) -> PluginPlatformResult<PathBuf> {
    if plugin.is_builtin
        && plugin.install_path == crate::builtin_plugins::sentinel_install_path(&plugin.id)
    {
        return crate::builtin_plugins::install_path(&plugin.id)
            .map_err(PluginPlatformError::internal);
    }

    Ok(PathBuf::from(&plugin.install_path))
}

fn resolve_backend_entry_path(
    install_root: &Path,
    backend_entry: &str,
) -> PluginPlatformResult<PathBuf> {
    let backend_entry_path = Path::new(backend_entry);
    if backend_entry_path.is_absolute()
        || backend_entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(PluginPlatformError::invalid_request(
            "plugin backend entry must stay within the plugin install root",
        ));
    }

    let backend_path = install_root.join(backend_entry_path);
    if !backend_path.is_file() {
        return Err(PluginPlatformError::invalid_request(format!(
            "Plugin backend entry does not exist: {}",
            backend_path.display()
        )));
    }

    let canonical_install_root = install_root.canonicalize().map_err(|error| {
        PluginPlatformError::invalid_request(format!(
            "Failed to canonicalize plugin install root {}: {error}",
            install_root.display()
        ))
    })?;
    let canonical_backend_path = backend_path.canonicalize().map_err(|error| {
        PluginPlatformError::invalid_request(format!(
            "Failed to canonicalize plugin backend entry {}: {error}",
            backend_path.display()
        ))
    })?;

    if !canonical_backend_path.starts_with(&canonical_install_root) {
        return Err(PluginPlatformError::invalid_request(
            "plugin backend entry must stay within the plugin install root",
        ));
    }

    Ok(canonical_backend_path)
}
