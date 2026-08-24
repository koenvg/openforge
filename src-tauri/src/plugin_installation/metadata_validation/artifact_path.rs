use super::package_metadata::PackageJsonFile;
use std::path::{Component, Path};

pub(super) fn validate_artifact_paths(package: &PackageJsonFile, dir: &Path) -> Result<(), String> {
    if let Some(frontend) = package.openforge.frontend.as_deref() {
        validate_relative_entry_path(
            dir,
            frontend,
            "frontend",
            &["js", "mjs", "cjs"],
            "built JavaScript artifact",
        )?;
    }
    if let Some(backend) = package.openforge.backend.as_deref() {
        validate_relative_entry_path(
            dir,
            backend,
            "backend",
            &["js", "mjs", "cjs"],
            "built JavaScript artifact",
        )?;
    }
    for (index, stylesheet) in package
        .openforge
        .frontend_styles
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        validate_relative_entry_path(
            dir,
            stylesheet,
            &format!("frontendStyles[{index}]"),
            &["css"],
            "built CSS artifact",
        )?;
    }
    Ok(())
}

fn validate_relative_entry_path(
    dir: &Path,
    entry: &str,
    field_name: &str,
    allowed_extensions: &[&str],
    artifact_description: &str,
) -> Result<(), String> {
    let entry_path = Path::new(entry);
    if entry_path.is_absolute()
        || entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "package.json openforge.{field_name} entry must stay within the plugin package directory"
        ));
    }

    let candidate = dir.join(entry_path);
    if !candidate.is_file() {
        return Err(format!(
            "OpenForge plugin {field_name} entry is missing at {}; run the package build first",
            candidate.display()
        ));
    }

    let extension = candidate
        .extension()
        .and_then(|extension| extension.to_str());
    if !extension.is_some_and(|extension| allowed_extensions.contains(&extension)) {
        let extension_label = allowed_extensions
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "package.json openforge.{field_name} must point to a {artifact_description} ({extension_label})"
        ));
    }

    let canonical_dir = dir.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize plugin package directory {}: {error}",
            dir.display()
        )
    })?;
    let canonical_candidate = candidate.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize OpenForge plugin {field_name} entry {}: {error}",
            candidate.display()
        )
    })?;

    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err(format!(
            "package.json openforge.{field_name} entry must stay within the plugin package directory"
        ));
    }

    Ok(())
}
