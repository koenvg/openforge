mod artifact_path;
mod folder_discovery;
mod package_metadata;
mod plugin_row;

use package_metadata::PackageJsonFile;
use std::path::Path;

pub(crate) use folder_discovery::{inspect_plugin_package_dir, InspectedPluginPackage};
pub(super) use package_metadata::load_package_from_dir;
pub(super) use plugin_row::build_plugin_row;

#[cfg(test)]
pub(super) use package_metadata::{
    package_metadata_schema_rules, OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON,
};

pub(super) fn validate_package(package: &PackageJsonFile, dir: &Path) -> Result<(), String> {
    package_metadata::validate_package_metadata(package)?;
    artifact_path::validate_artifact_paths(package, dir)
}
