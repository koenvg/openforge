use super::{package_metadata::load_package_from_dir, validate_package};
use serde_json::{Map, Value};
use std::{fs, path::Path};

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
    let raw = fs::read_to_string(dir.join("package.json")).ok()?;
    let raw_value: Value = serde_json::from_str(&raw).ok()?;
    let object = raw_value.as_object()?;
    let openforge = object.get("openforge")?.as_object()?;

    let id = json_string_field(openforge, "id");
    let name = if id.is_empty() {
        dir.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string()
    } else {
        id.clone()
    };

    let problem = load_package_from_dir(dir)
        .and_then(|loaded| validate_package(&loaded.package_json, dir))
        .err();

    Some(InspectedPluginPackage {
        name: {
            let display_name = json_string_field(openforge, "displayName");
            if display_name.is_empty() {
                name
            } else {
                display_name
            }
        },
        id,
        version: json_string_field(object, "version"),
        description: json_string_field(openforge, "description"),
        missing_entries: declared_entries(openforge)
            .into_iter()
            .filter(|entry| !dir.join(entry).is_file())
            .collect(),
        problem,
    })
}

fn json_string_field(object: &Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Every build artifact path the package claims to ship, in declaration order.
fn declared_entries(openforge: &Map<String, Value>) -> Vec<String> {
    let mut entries = Vec::new();
    for key in ["frontend", "backend"] {
        if let Some(entry) = openforge.get(key).and_then(Value::as_str) {
            entries.push(entry.to_string());
        }
    }
    for stylesheet in openforge
        .get("frontendStyles")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
    {
        if let Some(stylesheet) = stylesheet.as_str() {
            entries.push(stylesheet.to_string());
        }
    }
    entries
}
