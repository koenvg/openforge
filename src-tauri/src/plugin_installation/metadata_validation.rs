use crate::db;
use crate::plugin_enablement::PluginEnablement;
use crate::plugin_installation::package_source::PackageSourceSpec;
use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Component, Path},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON: &str =
    include_str!("../../../packages/plugin-sdk/src/openforgePackageMetadataSchema.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PackageJsonFile {
    #[serde(rename = "name")]
    _name: String,
    pub(super) version: String,
    #[serde(default, rename = "peerDependencies")]
    _peer_dependencies: Option<Value>,
    pub(super) openforge: OpenForgePackageMetadata,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OpenForgePackageMetadata {
    pub(super) id: String,
    api_version: i64,
    display_name: String,
    description: String,
    #[serde(default)]
    enablement: PluginEnablement,
    #[serde(default)]
    frontend: Option<String>,
    #[serde(default)]
    frontend_styles: Option<Vec<String>>,
    #[serde(default)]
    backend: Option<String>,
    #[serde(default, rename = "requires")]
    requires: Option<Vec<String>>,
}

#[derive(Debug)]
pub(super) struct LoadedPluginPackage {
    pub(super) package_json: PackageJsonFile,
    pub(super) package_metadata_json: String,
}

#[derive(Debug)]
pub(super) struct PackageMetadataSchemaRules {
    pub(super) allowed_metadata_fields: Vec<String>,
    pub(super) required_metadata_fields: Vec<String>,
    string_metadata_fields: Vec<String>,
    pub(super) supported_api_versions: Vec<i64>,
    pub(super) id_pattern: Regex,
    pub(super) allowed_capabilities: Vec<String>,
}

impl PackageMetadataSchemaRules {
    fn allows_metadata_field(&self, field: &str) -> bool {
        self.allowed_metadata_fields
            .iter()
            .any(|allowed_field| allowed_field == field)
    }

    fn requires_metadata_field(&self, field: &str) -> bool {
        self.required_metadata_fields
            .iter()
            .any(|required_field| required_field == field)
    }

    fn supports_api_version(&self, api_version: i64) -> bool {
        self.supported_api_versions.contains(&api_version)
    }

    fn supports_capability(&self, capability: &str) -> bool {
        self.allowed_capabilities
            .iter()
            .any(|allowed_capability| allowed_capability == capability)
    }

    fn supported_api_versions_label(&self) -> String {
        self.supported_api_versions
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

pub(super) fn load_package_from_dir(dir: &Path) -> Result<LoadedPluginPackage, String> {
    let package_json_path = dir.join("package.json");
    let raw = fs::read_to_string(&package_json_path).map_err(|error| {
        format!(
            "failed to read OpenForge plugin package.json {}: {error}",
            package_json_path.display()
        )
    })?;
    let raw_value: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "failed to parse OpenForge plugin package.json {}: {error}",
            package_json_path.display()
        )
    })?;
    validate_package_json_shape(&raw_value)?;

    let package_json: PackageJsonFile =
        serde_json::from_value(raw_value.clone()).map_err(|error| {
            format!(
                "failed to parse OpenForge plugin package metadata {}: {error}",
                package_json_path.display()
            )
        })?;

    let package_metadata_json = package_metadata_json(&raw_value)?;

    Ok(LoadedPluginPackage {
        package_json,
        package_metadata_json,
    })
}

fn validate_package_json_shape(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "OpenForge plugin package.json must be an object".to_string())?;

    validate_non_empty_json_string(object, "name", "package.json name")?;
    validate_non_empty_json_string(object, "version", "package.json version")?;

    let openforge = object
        .get("openforge")
        .ok_or_else(|| "OpenForge plugin package.json must include openforge metadata".to_string())?
        .as_object()
        .ok_or_else(|| "package.json openforge metadata must be an object".to_string())?;

    if openforge.contains_key("contributes") {
        return Err("package.json openforge.contributes is not supported; register contributions at runtime".to_string());
    }

    let schema_rules = package_metadata_schema_rules()?;

    for key in openforge.keys() {
        if !schema_rules.allows_metadata_field(key) {
            return Err(format!(
                "package.json openforge.{key} is not supported by the OpenForge package metadata schema"
            ));
        }
    }

    for key in &schema_rules.required_metadata_fields {
        if key == "apiVersion" {
            continue;
        }
        if !openforge.contains_key(key) {
            return Err(format!(
                "package.json openforge.{key} is required by the OpenForge package metadata schema"
            ));
        }
    }

    for key in &schema_rules.string_metadata_fields {
        if openforge.get(key).is_some() {
            validate_non_empty_json_string(
                openforge,
                key,
                &format!("package.json openforge.{key}"),
            )?;
        }
    }

    if openforge
        .get("enablement")
        .is_some_and(|value| !matches!(value.as_str(), Some("app" | "project")))
    {
        return Err("package.json openforge.enablement must be \"app\" or \"project\"".to_string());
    }

    if let Some(icon) = openforge.get("icon") {
        validate_plugin_icon(icon)?;
    }

    match openforge.get("apiVersion").and_then(Value::as_i64) {
        Some(version) if schema_rules.supports_api_version(version) => {}
        Some(version) => {
            return Err(format!(
                "package.json openforge.apiVersion {version} is not supported (supported: {})",
                schema_rules.supported_api_versions_label()
            ));
        }
        None if schema_rules.requires_metadata_field("apiVersion") => {
            return Err(format!(
                "package.json openforge.apiVersion must be {}",
                schema_rules.supported_api_versions_label()
            ));
        }
        None => {}
    }

    if let Some(frontend_styles) = openforge.get("frontendStyles") {
        let frontend_styles = frontend_styles
            .as_array()
            .ok_or_else(|| "package.json openforge.frontendStyles must be an array".to_string())?;
        if frontend_styles.is_empty() {
            return Err(
                "package.json openforge.frontendStyles must contain at least one stylesheet path"
                    .to_string(),
            );
        }
        for (index, stylesheet) in frontend_styles.iter().enumerate() {
            let stylesheet = stylesheet
                .as_str()
                .filter(|stylesheet| !stylesheet.trim().is_empty())
                .ok_or_else(|| {
                    format!(
                        "package.json openforge.frontendStyles[{index}] must be a non-empty string"
                    )
                })?;
            if frontend_styles[..index]
                .iter()
                .any(|previous| previous.as_str() == Some(stylesheet))
            {
                return Err(format!(
                    "package.json openforge.frontendStyles[{index}] duplicates an earlier stylesheet path"
                ));
            }
        }
    }

    if let Some(requires) = openforge.get("requires") {
        let requires = requires
            .as_array()
            .ok_or_else(|| "package.json openforge.requires must be an array".to_string())?;
        for (index, capability) in requires.iter().enumerate() {
            let capability = capability.as_str().ok_or_else(|| {
                format!("package.json openforge.requires[{index}] must be a string")
            })?;
            if !schema_rules.supports_capability(capability) {
                return Err(format!(
                    "package.json openforge.requires[{index}] has unknown capability \"{capability}\""
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_package(package: &PackageJsonFile, dir: &Path) -> Result<(), String> {
    let schema_rules = package_metadata_schema_rules()?;

    if !schema_rules.id_pattern.is_match(&package.openforge.id) {
        return Err(format!(
            "package.json openforge.id \"{}\" must match the OpenForge package metadata schema",
            package.openforge.id
        ));
    }

    if !schema_rules.supports_api_version(package.openforge.api_version) {
        return Err(format!(
            "package.json openforge.apiVersion {} is not supported (supported: {})",
            package.openforge.api_version,
            schema_rules.supported_api_versions_label()
        ));
    }

    if package.openforge.enablement == PluginEnablement::App
        && !package
            .openforge
            .requires
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|capability| capability == "appEnablement")
    {
        return Err(
            "package.json openforge.enablement \"app\" requires the appEnablement capability"
                .to_string(),
        );
    }

    if package.openforge.frontend.is_none() && package.openforge.backend.is_none() {
        return Err(
            "package.json openforge metadata requires a frontend or backend built JavaScript entry"
                .to_string(),
        );
    }

    if package.openforge.frontend.is_none() && package.openforge.frontend_styles.is_some() {
        return Err("package.json openforge.frontendStyles requires a frontend entry".to_string());
    }

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
/// Returns `None` when the directory is not a plugin package at all — no readable
/// `package.json`, unparseable JSON, or no `openforge` block — so discovery keeps walking
/// instead of reporting a spurious row. A directory that *is* a plugin package but fails
/// validation returns `Some` with `problem` set, deliberately mirroring the error the local
/// installer would raise for it.
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

pub(super) fn build_plugin_row(
    loaded: &LoadedPluginPackage,
    install_path: &Path,
    source: &PackageSourceSpec,
    is_builtin: bool,
) -> Result<db::PluginRow, String> {
    let openforge = &loaded.package_json.openforge;
    Ok(db::PluginRow {
        id: openforge.id.clone(),
        name: openforge.display_name.clone(),
        version: loaded.package_json.version.clone(),
        api_version: openforge.api_version,
        description: openforge.description.clone(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: openforge.frontend.clone().unwrap_or_default(),
        backend_entry: openforge.backend.clone(),
        install_path: install_path.to_string_lossy().into_owned(),
        source_kind: source.kind().to_string(),
        source_spec: source.spec().to_string(),
        package_metadata: loaded.package_metadata_json.clone(),
        installed_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("failed to compute install timestamp: {error}"))?
            .as_millis() as i64,
        is_builtin,
    })
}

fn package_metadata_json(value: &Value) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "OpenForge plugin package.json must be an object".to_string())?;
    let metadata = object.get("openforge").ok_or_else(|| {
        "OpenForge plugin package.json must include openforge metadata".to_string()
    })?;
    serde_json::to_string(metadata)
        .map_err(|error| format!("failed to serialize OpenForge package metadata: {error}"))
}

fn validate_plugin_icon(value: &Value) -> Result<(), String> {
    let valid_name = value.as_str().is_some_and(|name| !name.trim().is_empty());
    let valid_svg = value.as_object().is_some_and(|icon| {
        icon.len() == 2
            && icon.get("type").and_then(Value::as_str) == Some("svg")
            && icon
                .get("svg")
                .and_then(Value::as_str)
                .is_some_and(|svg| !svg.trim().is_empty())
    });

    if valid_name || valid_svg {
        return Ok(());
    }

    Err("package.json openforge.icon must be a non-empty Lucide icon name or { type: \"svg\", svg }".to_string())
}

fn validate_non_empty_json_string(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<(), String> {
    match object.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(()),
        _ => Err(format!("{label} must be a non-empty string")),
    }
}

pub(super) fn package_metadata_schema_rules() -> Result<&'static PackageMetadataSchemaRules, String>
{
    static RULES: OnceLock<Result<PackageMetadataSchemaRules, String>> = OnceLock::new();
    match RULES.get_or_init(parse_package_metadata_schema_rules) {
        Ok(rules) => Ok(rules),
        Err(error) => Err(error.clone()),
    }
}

fn parse_package_metadata_schema_rules() -> Result<PackageMetadataSchemaRules, String> {
    let schema: Value = serde_json::from_str(OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON)
        .map_err(|error| format!("failed to parse OpenForge package metadata schema: {error}"))?;
    let schema = schema
        .as_object()
        .ok_or_else(|| "OpenForge package metadata schema must be an object".to_string())?;
    let properties = schema_object_field(
        schema,
        "properties",
        "OpenForge package metadata schema.properties",
    )?;

    let allowed_metadata_fields = properties.keys().cloned().collect::<Vec<_>>();
    let required_metadata_fields = schema_string_array_field(
        schema,
        "required",
        "OpenForge package metadata schema.required",
    )?;
    let string_metadata_fields = properties
        .iter()
        .filter_map(|(key, property)| {
            if property.get("type").and_then(Value::as_str) == Some("string") {
                Some(key.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let id_schema = schema_property(properties, "id")?;
    let id_pattern = id_schema
        .get("pattern")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "OpenForge package metadata schema.properties.id.pattern must be a string".to_string()
        })?;
    let id_pattern = Regex::new(id_pattern).map_err(|error| {
        format!("failed to compile OpenForge package id schema pattern: {error}")
    })?;

    let api_version_schema = schema_property(properties, "apiVersion")?;
    let supported_api_versions = schema_i64_array_field(
        api_version_schema,
        "enum",
        "OpenForge package metadata schema.properties.apiVersion.enum",
    )?;

    let requires_schema = schema_property(properties, "requires")?;
    let requires_items_schema = schema_object_field(
        requires_schema,
        "items",
        "OpenForge package metadata schema.properties.requires.items",
    )?;
    let allowed_capabilities = schema_string_array_field(
        requires_items_schema,
        "enum",
        "OpenForge package metadata schema.properties.requires.items.enum",
    )?;

    Ok(PackageMetadataSchemaRules {
        allowed_metadata_fields,
        required_metadata_fields,
        string_metadata_fields,
        supported_api_versions,
        id_pattern,
        allowed_capabilities,
    })
}

fn schema_property<'a>(
    properties: &'a Map<String, Value>,
    property_name: &str,
) -> Result<&'a Map<String, Value>, String> {
    properties
        .get(property_name)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "OpenForge package metadata schema.properties.{property_name} must be an object"
            )
        })
}

fn schema_object_field<'a>(
    object: &'a Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<&'a Map<String, Value>, String> {
    object
        .get(field_name)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{label} must be an object"))
}

fn schema_string_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<Vec<String>, String> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{label} must be an array"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{label} entries must be strings"))
        })
        .collect()
}

fn schema_i64_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<Vec<i64>, String> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{label} must be an array"))?
        .iter()
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("{label} entries must be integers"))
        })
        .collect()
}

#[allow(dead_code)]
fn _package_metadata_schema_json() -> &'static str {
    OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON
}
