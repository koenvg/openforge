use std::{fmt, io, path::PathBuf};

#[derive(Debug)]
pub(in crate::plugin_installation) enum PluginPackageValidationError {
    ReadPackageJson {
        path: PathBuf,
        source: io::Error,
    },
    ParsePackageJson {
        path: PathBuf,
        source: serde_json::Error,
    },
    ParsePackageMetadata {
        path: PathBuf,
        source: serde_json::Error,
    },
    PackageJsonMustBeObject,
    InvalidNonEmptyString {
        label: String,
    },
    MissingOpenForgeMetadata,
    OpenForgeMetadataMustBeObject,
    ContributionsUnsupported,
    UnsupportedMetadataField {
        field: String,
    },
    MissingMetadataField {
        field: String,
    },
    InvalidEnablement,
    InvalidIcon,
    UnsupportedApiVersion {
        version: i64,
        supported: String,
    },
    InvalidApiVersion {
        supported: String,
    },
    FrontendStylesMustBeArray,
    EmptyFrontendStyles,
    InvalidFrontendStyle {
        index: usize,
    },
    DuplicateFrontendStyle {
        index: usize,
    },
    RequiresMustBeArray,
    InvalidCapability {
        index: usize,
    },
    UnknownCapability {
        index: usize,
        capability: String,
    },
    InvalidPluginId {
        id: String,
    },
    AppEnablementCapabilityRequired,
    MissingRuntimeEntry,
    FrontendStylesRequireFrontend,
    SerializeMetadata {
        source: serde_json::Error,
    },
    ParseMetadataSchema {
        source: serde_json::Error,
    },
    InvalidMetadataSchemaField {
        label: String,
        expected: &'static str,
    },
    InvalidMetadataSchemaEntry {
        label: String,
        expected: &'static str,
    },
    CompilePluginIdPattern {
        source: regex::Error,
    },
    ArtifactOutsidePackage {
        field: String,
    },
    MissingArtifact {
        field: String,
        path: PathBuf,
    },
    InvalidArtifactType {
        field: String,
        description: &'static str,
        extensions: String,
    },
    CanonicalizePackageDirectory {
        path: PathBuf,
        source: io::Error,
    },
    CanonicalizeArtifact {
        field: String,
        path: PathBuf,
        source: io::Error,
    },
}

impl PluginPackageValidationError {
    pub(in crate::plugin_installation) fn into_installer_message(self) -> String {
        self.to_string()
    }
}

impl fmt::Display for PluginPackageValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadPackageJson { path, source } => write!(
                formatter,
                "failed to read OpenForge plugin package.json {}: {source}",
                path.display()
            ),
            Self::ParsePackageJson { path, source } => write!(
                formatter,
                "failed to parse OpenForge plugin package.json {}: {source}",
                path.display()
            ),
            Self::ParsePackageMetadata { path, source } => write!(
                formatter,
                "failed to parse OpenForge plugin package metadata {}: {source}",
                path.display()
            ),
            Self::PackageJsonMustBeObject => {
                formatter.write_str("OpenForge plugin package.json must be an object")
            }
            Self::InvalidNonEmptyString { label } => {
                write!(formatter, "{label} must be a non-empty string")
            }
            Self::MissingOpenForgeMetadata => formatter.write_str(
                "OpenForge plugin package.json must include openforge metadata",
            ),
            Self::OpenForgeMetadataMustBeObject => {
                formatter.write_str("package.json openforge metadata must be an object")
            }
            Self::ContributionsUnsupported => formatter.write_str(
                "package.json openforge.contributes is not supported; register contributions at runtime",
            ),
            Self::UnsupportedMetadataField { field } => write!(
                formatter,
                "package.json openforge.{field} is not supported by the OpenForge package metadata schema"
            ),
            Self::MissingMetadataField { field } => write!(
                formatter,
                "package.json openforge.{field} is required by the OpenForge package metadata schema"
            ),
            Self::InvalidEnablement => formatter.write_str(
                "package.json openforge.enablement must be \"app\" or \"project\"",
            ),
            Self::InvalidIcon => formatter.write_str(
                "package.json openforge.icon must be a non-empty Lucide icon name or { type: \"svg\", svg }",
            ),
            Self::UnsupportedApiVersion { version, supported } => write!(
                formatter,
                "package.json openforge.apiVersion {version} is not supported (supported: {supported})"
            ),
            Self::InvalidApiVersion { supported } => write!(
                formatter,
                "package.json openforge.apiVersion must be {supported}"
            ),
            Self::FrontendStylesMustBeArray => {
                formatter.write_str("package.json openforge.frontendStyles must be an array")
            }
            Self::EmptyFrontendStyles => formatter.write_str(
                "package.json openforge.frontendStyles must contain at least one stylesheet path",
            ),
            Self::InvalidFrontendStyle { index } => write!(
                formatter,
                "package.json openforge.frontendStyles[{index}] must be a non-empty string"
            ),
            Self::DuplicateFrontendStyle { index } => write!(
                formatter,
                "package.json openforge.frontendStyles[{index}] duplicates an earlier stylesheet path"
            ),
            Self::RequiresMustBeArray => {
                formatter.write_str("package.json openforge.requires must be an array")
            }
            Self::InvalidCapability { index } => write!(
                formatter,
                "package.json openforge.requires[{index}] must be a string"
            ),
            Self::UnknownCapability { index, capability } => write!(
                formatter,
                "package.json openforge.requires[{index}] has unknown capability \"{capability}\""
            ),
            Self::InvalidPluginId { id } => write!(
                formatter,
                "package.json openforge.id \"{id}\" must match the OpenForge package metadata schema"
            ),
            Self::AppEnablementCapabilityRequired => formatter.write_str(
                "package.json openforge.enablement \"app\" requires the appEnablement capability",
            ),
            Self::MissingRuntimeEntry => formatter.write_str(
                "package.json openforge metadata requires a frontend or backend built JavaScript entry",
            ),
            Self::FrontendStylesRequireFrontend => formatter.write_str(
                "package.json openforge.frontendStyles requires a frontend entry",
            ),
            Self::SerializeMetadata { source } => write!(
                formatter,
                "failed to serialize OpenForge package metadata: {source}"
            ),
            Self::ParseMetadataSchema { source } => write!(
                formatter,
                "failed to parse OpenForge package metadata schema: {source}"
            ),
            Self::InvalidMetadataSchemaField { label, expected } => {
                write!(formatter, "{label} must be {expected}")
            }
            Self::InvalidMetadataSchemaEntry { label, expected } => {
                write!(formatter, "{label} entries must be {expected}")
            }
            Self::CompilePluginIdPattern { source } => write!(
                formatter,
                "failed to compile OpenForge package id schema pattern: {source}"
            ),
            Self::ArtifactOutsidePackage { field } => write!(
                formatter,
                "package.json openforge.{field} entry must stay within the plugin package directory"
            ),
            Self::MissingArtifact { field, path } => write!(
                formatter,
                "OpenForge plugin {field} entry is missing at {}; run the package build first",
                path.display()
            ),
            Self::InvalidArtifactType {
                field,
                description,
                extensions,
            } => write!(
                formatter,
                "package.json openforge.{field} must point to a {description} ({extensions})"
            ),
            Self::CanonicalizePackageDirectory { path, source } => write!(
                formatter,
                "failed to canonicalize plugin package directory {}: {source}",
                path.display()
            ),
            Self::CanonicalizeArtifact {
                field,
                path,
                source,
            } => write!(
                formatter,
                "failed to canonicalize OpenForge plugin {field} entry {}: {source}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for PluginPackageValidationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ReadPackageJson { source, .. }
            | Self::CanonicalizePackageDirectory { source, .. }
            | Self::CanonicalizeArtifact { source, .. } => Some(source),
            Self::ParsePackageJson { source, .. }
            | Self::ParsePackageMetadata { source, .. }
            | Self::SerializeMetadata { source }
            | Self::ParseMetadataSchema { source } => Some(source),
            Self::CompilePluginIdPattern { source } => Some(source),
            _ => None,
        }
    }
}

pub(in crate::plugin_installation) type ValidationResult<T> =
    Result<T, PluginPackageValidationError>;
