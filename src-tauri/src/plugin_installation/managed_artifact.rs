use crate::db;
use crate::plugin_installation::package_source::AcquiredPackage;
use sha1::{Digest, Sha1};
use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub(crate) struct PreparedPluginInstallation {
    pub(super) acquired: AcquiredPackage,
    pub(super) plugin: db::PluginRow,
    pub(super) destination: Option<PathBuf>,
}

impl PreparedPluginInstallation {
    pub(crate) fn plugin_id(&self) -> &str {
        &self.plugin.id
    }

    pub(crate) fn finalize(self) -> Result<db::PluginRow, String> {
        if let Some(destination) = self.destination.as_ref() {
            replace_directory(&self.acquired.package_dir, destination)?;
        }

        Ok(self.plugin)
    }
}

pub fn managed_plugins_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("plugins")
}

pub fn managed_plugin_dir(base_dir: &Path, plugin_id: &str) -> PathBuf {
    managed_plugins_dir(base_dir).join(plugin_id)
}

#[derive(Debug)]
pub(crate) enum ManagedPluginUninstall {
    NoPackage,
    Staged {
        install_path: PathBuf,
        staged_path: PathBuf,
    },
}

impl ManagedPluginUninstall {
    pub(crate) fn rollback(self) -> Result<(), String> {
        let Self::Staged {
            install_path,
            staged_path,
        } = self
        else {
            return Ok(());
        };

        if !managed_plugin_path_exists(&staged_path)? {
            return Ok(());
        }
        if managed_plugin_path_exists(&install_path)? {
            return Err(format!(
                "cannot restore staged managed plugin directory {} because {} already exists",
                staged_path.display(),
                install_path.display()
            ));
        }

        fs::rename(&staged_path, &install_path).map_err(|error| {
            format!(
                "failed to restore staged managed plugin directory {} to {}: {error}",
                staged_path.display(),
                install_path.display()
            )
        })
    }

    pub(crate) fn commit(self) -> Result<(), String> {
        let Self::Staged { staged_path, .. } = self else {
            return Ok(());
        };

        remove_staged_managed_plugin_directory(&staged_path)
    }
}

pub(crate) fn stage_managed_plugin_uninstall(
    plugin: &db::PluginRow,
    managed_base_dir: &Path,
) -> Result<ManagedPluginUninstall, String> {
    if plugin.is_builtin || plugin.source_kind == "local" {
        return Ok(ManagedPluginUninstall::NoPackage);
    }

    let install_path = PathBuf::from(&plugin.install_path);
    let expected_install_path = managed_plugin_dir(managed_base_dir, &plugin.id);
    if install_path != expected_install_path {
        return Ok(ManagedPluginUninstall::NoPackage);
    }

    let staged_path = managed_plugin_uninstall_staging_path(managed_base_dir, &plugin.id);
    if managed_plugin_path_exists(&staged_path)? {
        if !managed_plugin_path_exists(&install_path)? {
            return Ok(ManagedPluginUninstall::Staged {
                install_path,
                staged_path,
            });
        }
        remove_staged_managed_plugin_directory(&staged_path)?;
    }

    if !managed_plugin_path_exists(&install_path)? {
        return Ok(ManagedPluginUninstall::NoPackage);
    }

    fs::rename(&install_path, &staged_path).map_err(|error| {
        format!(
            "failed to stage managed plugin directory {} at {}: {error}",
            install_path.display(),
            staged_path.display()
        )
    })?;

    Ok(ManagedPluginUninstall::Staged {
        install_path,
        staged_path,
    })
}

pub(crate) fn cleanup_staged_managed_plugin_uninstall(
    plugin_id: &str,
    managed_base_dir: &Path,
) -> Result<(), String> {
    let staged_path = managed_plugin_uninstall_staging_path(managed_base_dir, plugin_id);
    remove_staged_managed_plugin_directory(&staged_path)
}

fn managed_plugin_uninstall_staging_path(managed_base_dir: &Path, plugin_id: &str) -> PathBuf {
    let plugin_id_digest = Sha1::digest(plugin_id.as_bytes());
    let mut staging_directory_name = String::from(".uninstalling-");
    for byte in plugin_id_digest {
        write!(&mut staging_directory_name, "{byte:02x}")
            .expect("writing a byte as hex to a String should not fail");
    }

    managed_plugins_dir(managed_base_dir).join(staging_directory_name)
}

fn managed_plugin_path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to inspect managed plugin path {}: {error}",
            path.display()
        )),
    }
}

pub(super) fn remove_staged_managed_plugin_directory(staged_path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(staged_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove staged managed plugin directory {}: {error}",
            staged_path.display()
        )),
    }
}

fn replace_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| {
            format!(
                "failed to clear existing plugin directory {}: {error}",
                destination.display()
            )
        })?;
    }

    copy_directory_recursive(source, destination)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create destination directory {}: {error}",
            destination.display()
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read directory {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to read file type {}: {error}",
                source_path.display()
            )
        })?;

        if file_type.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}
