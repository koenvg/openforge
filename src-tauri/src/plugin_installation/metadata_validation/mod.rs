mod artifact_path;
mod error;
mod folder_discovery;
mod package_metadata;
mod plugin_row;

pub(super) use error::{PluginPackageValidationError, ValidationResult};
use package_metadata::{LoadedPluginPackage, ValidatedPluginPackage};
use std::path::Path;

pub(crate) use folder_discovery::{inspect_plugin_package_dir, InspectedPluginPackage};
pub(super) use package_metadata::load_package_from_dir;
pub(super) use plugin_row::build_plugin_row;

#[cfg(test)]
pub(super) use package_metadata::{
    package_metadata_schema_rules, OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON,
};

pub(super) fn validate_package(
    loaded: LoadedPluginPackage,
    dir: &Path,
) -> ValidationResult<ValidatedPluginPackage> {
    let package = loaded.validate()?;
    package_metadata::validate_package_metadata(&package.package_json)?;
    artifact_path::validate_artifact_paths(&package.package_json, dir)?;
    Ok(package)
}
