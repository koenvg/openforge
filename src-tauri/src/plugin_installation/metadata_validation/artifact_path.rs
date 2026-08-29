use super::{
    error::ValidationResult, package_metadata::PackageJsonFile, PluginPackageValidationError,
};
use std::path::{Component, Path};

pub(super) fn validate_artifact_paths(
    package: &PackageJsonFile,
    dir: &Path,
) -> ValidationResult<()> {
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
            &["cjs"],
            "CommonJS backend artifact",
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
    artifact_description: &'static str,
) -> ValidationResult<()> {
    let entry_path = Path::new(entry);
    if entry_path.is_absolute()
        || entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(PluginPackageValidationError::ArtifactOutsidePackage {
            field: field_name.to_string(),
        });
    }

    let candidate = dir.join(entry_path);
    if !candidate.is_file() {
        return Err(PluginPackageValidationError::MissingArtifact {
            field: field_name.to_string(),
            path: candidate,
        });
    }

    let extension = candidate
        .extension()
        .and_then(|extension| extension.to_str());
    if !extension.is_some_and(|extension| allowed_extensions.contains(&extension)) {
        let extensions = allowed_extensions
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PluginPackageValidationError::InvalidArtifactType {
            field: field_name.to_string(),
            description: artifact_description,
            extensions,
        });
    }

    let canonical_dir = dir.canonicalize().map_err(|error| {
        PluginPackageValidationError::CanonicalizePackageDirectory {
            path: dir.to_path_buf(),
            source: error,
        }
    })?;
    let canonical_candidate = candidate.canonicalize().map_err(|error| {
        PluginPackageValidationError::CanonicalizeArtifact {
            field: field_name.to_string(),
            path: candidate.clone(),
            source: error,
        }
    })?;

    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err(PluginPackageValidationError::ArtifactOutsidePackage {
            field: field_name.to_string(),
        });
    }

    Ok(())
}
