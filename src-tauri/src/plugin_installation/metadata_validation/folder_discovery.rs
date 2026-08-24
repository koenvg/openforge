use super::{
    package_metadata::load_package_from_dir, validate_package, PluginPackageValidationError,
};
use std::path::Path;

/// One candidate plugin package directory as seen by folder discovery.
///
/// Carries whatever is needed to render a row even when the package is invalid, so a
/// broken package can be shown with an explanation instead of vanishing from the list.
#[derive(Debug)]
pub(crate) struct InspectedPluginPackage {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    /// Declared entry artifacts (frontend, backend, stylesheets) that are not on disk yet.
    pub missing_entries: Vec<String>,
    /// Why the local installer would reject this package, in the installer's own words.
    pub problem: Option<String>,
}

/// Inspect `dir` as a candidate OpenForge plugin package.
///
/// Returns `None` when the directory is not a plugin package at all: no readable
/// `package.json`, unparseable JSON, or no `openforge` block. Discovery keeps walking
/// instead of reporting a spurious row. A directory that is a plugin package but fails
/// validation returns `Some` with `problem` set, mirroring the local installer error.
pub(crate) fn inspect_plugin_package_dir(dir: &Path) -> Option<InspectedPluginPackage> {
    let loaded = load_package_from_dir(dir).ok()?;
    let fields = loaded.discovery_fields(dir)?;
    let missing_entries = fields
        .declared_entries
        .into_iter()
        .filter(|entry| !dir.join(entry).is_file())
        .collect();
    let problem = validate_package(loaded, dir)
        .err()
        .map(PluginPackageValidationError::into_installer_message);

    Some(InspectedPluginPackage {
        id: fields.id,
        name: fields.name,
        version: fields.version,
        description: fields.description,
        missing_entries,
        problem,
    })
}
