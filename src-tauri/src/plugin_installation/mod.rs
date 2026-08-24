use std::path::Path;

mod managed_artifact;
mod metadata_validation;
mod package_source;

pub use managed_artifact::managed_plugin_dir;
pub(crate) use managed_artifact::{
    cleanup_staged_managed_plugin_uninstall, stage_managed_plugin_uninstall,
    PreparedPluginInstallation,
};
// Preserve the facade API even though production currently reaches this path indirectly.
#[allow(unused_imports)]
pub use managed_artifact::managed_plugins_dir;
use metadata_validation::{build_plugin_row, load_package_from_dir, validate_package};
pub(crate) use metadata_validation::{inspect_plugin_package_dir, InspectedPluginPackage};
use package_source::{
    acquire_git_package, acquire_local_package, acquire_npm_package, AcquiredPackage,
    PackageSourceSpec,
};

#[cfg(test)]
use managed_artifact::remove_staged_managed_plugin_directory;
#[cfg(test)]
use metadata_validation::{package_metadata_schema_rules, OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON};
#[cfg(test)]
use package_source::{
    command_output_details, resolve_requested_package_dir_name, GIT_PATH_ENV, NPM_PATH_ENV,
};

pub(crate) fn prepare_local_plugin_bundle(
    source_path: &Path,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    prepare_plugin_package_from_source_spec(&source_path.to_string_lossy(), managed_base_dir)
}

pub(crate) async fn prepare_npm_plugin_bundle(
    package_name: &str,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    prepare_plugin_package_from_source_spec_async(
        &format!("npm:{}", package_name.trim()),
        managed_base_dir,
    )
    .await
}

pub(crate) async fn prepare_git_plugin_bundle(
    git_spec: &str,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    let source_spec = if git_spec.trim().starts_with("git:") {
        git_spec.trim().to_string()
    } else {
        format!("git:{}", git_spec.trim())
    };
    prepare_plugin_package_from_source_spec_async(&source_spec, managed_base_dir).await
}

#[cfg(test)]
pub fn install_plugin_package_from_source_spec(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<crate::db::PluginRow, String> {
    prepare_plugin_package_from_source_spec(source_spec, managed_base_dir)?.finalize()
}

pub(crate) fn prepare_plugin_package_from_source_spec(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    let source = PackageSourceSpec::parse(source_spec)?;
    match source {
        PackageSourceSpec::Local { .. } => {
            let acquired = acquire_local_package(source)?;
            prepare_acquired_package(acquired, managed_base_dir)
        }
        PackageSourceSpec::Npm { .. } | PackageSourceSpec::Git { .. } => Err(
            "npm and git plugin package sources require the async package installer".to_string(),
        ),
    }
}

#[cfg(test)]
pub async fn install_plugin_package_from_source_spec_async(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<crate::db::PluginRow, String> {
    prepare_plugin_package_from_source_spec_async(source_spec, managed_base_dir)
        .await?
        .finalize()
}

pub(crate) async fn prepare_plugin_package_from_source_spec_async(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    let source = PackageSourceSpec::parse(source_spec)?;
    let acquired = match source {
        PackageSourceSpec::Local { .. } => acquire_local_package(source)?,
        PackageSourceSpec::Npm { .. } => acquire_npm_package(source, managed_base_dir).await?,
        PackageSourceSpec::Git { .. } => acquire_git_package(source, managed_base_dir).await?,
    };

    prepare_acquired_package(acquired, managed_base_dir)
}

#[cfg(test)]
pub(crate) fn prepare_managed_plugin_bundle_for_test(
    source_path: &Path,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    let package_dir = source_path.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize test plugin package {}: {error}",
            source_path.display()
        )
    })?;
    prepare_acquired_package(
        AcquiredPackage {
            source: PackageSourceSpec::Npm {
                package_spec: "@acme/managed@2.0.0".to_string(),
                spec: "npm:@acme/managed@2.0.0".to_string(),
            },
            install_path: package_dir.clone(),
            package_dir,
            staging_root: None,
        },
        managed_base_dir,
    )
}

fn prepare_acquired_package(
    mut acquired: AcquiredPackage,
    managed_base_dir: &Path,
) -> Result<PreparedPluginInstallation, String> {
    let loaded = load_package_from_dir(&acquired.package_dir)?;
    validate_package(&loaded.package_json, &acquired.package_dir)?;

    let destination = if acquired.source.kind() == "local" {
        None
    } else {
        let destination = managed_plugin_dir(managed_base_dir, &loaded.package_json.openforge.id);
        acquired.install_path = destination.clone();
        Some(destination)
    };
    let plugin = build_plugin_row(&loaded, &acquired.install_path, &acquired.source, false)?;

    Ok(PreparedPluginInstallation {
        acquired,
        plugin,
        destination,
    })
}

#[cfg(test)]
mod tests;
