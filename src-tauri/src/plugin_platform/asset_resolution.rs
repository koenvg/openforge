use super::PluginPlatform;
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
    ) -> Result<PluginAssetRoot, String> {
        let plugin = self
            .plugin(plugin_id)?
            .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
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
    ) -> Result<PathBuf, String> {
        let plugin = self
            .plugin(plugin_id)?
            .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
        let backend_entry = plugin
            .backend_entry
            .clone()
            .ok_or_else(|| format!("Plugin backend not configured for {plugin_id}"))?;
        let install_root = resolve_plugin_install_root(&plugin)?;
        resolve_backend_entry_path(&install_root, &backend_entry)
    }
}

fn resolve_plugin_install_root(plugin: &db::PluginRow) -> Result<PathBuf, String> {
    if plugin.is_builtin
        && plugin.install_path == crate::builtin_plugins::sentinel_install_path(&plugin.id)
    {
        return crate::builtin_plugins::install_path(&plugin.id);
    }

    Ok(PathBuf::from(&plugin.install_path))
}

fn resolve_backend_entry_path(install_root: &Path, backend_entry: &str) -> Result<PathBuf, String> {
    let backend_entry_path = Path::new(backend_entry);
    if backend_entry_path.is_absolute()
        || backend_entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    let backend_path = install_root.join(backend_entry_path);
    if !backend_path.is_file() {
        return Err(format!(
            "Plugin backend entry does not exist: {}",
            backend_path.display()
        ));
    }

    let canonical_install_root = install_root.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin install root {}: {error}",
            install_root.display()
        )
    })?;
    let canonical_backend_path = backend_path.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin backend entry {}: {error}",
            backend_path.display()
        )
    })?;

    if !canonical_backend_path.starts_with(&canonical_install_root) {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    Ok(canonical_backend_path)
}
