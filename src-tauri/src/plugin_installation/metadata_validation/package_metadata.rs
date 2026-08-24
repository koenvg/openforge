use super::error::{PluginPackageValidationError, ValidationResult};
use crate::plugin_enablement::PluginEnablement;
use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub(in crate::plugin_installation) const OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON: &str =
    include_str!("../../../../packages/plugin-sdk/src/openforgePackageMetadataSchema.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::plugin_installation) struct PackageJsonFile {
    pub(in crate::plugin_installation) version: String,
    pub(in crate::plugin_installation) openforge: OpenForgePackageMetadata,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::plugin_installation) struct OpenForgePackageMetadata {
    pub(in crate::plugin_installation) id: String,
    pub(in crate::plugin_installation) api_version: i64,
    pub(in crate::plugin_installation) display_name: String,
    pub(in crate::plugin_installation) description: String,
    #[serde(default)]
    pub(in crate::plugin_installation) enablement: PluginEnablement,
    #[serde(default)]
    pub(in crate::plugin_installation) frontend: Option<String>,
    #[serde(default)]
    pub(in crate::plugin_installation) frontend_styles: Option<Vec<String>>,
    #[serde(default)]
    pub(in crate::plugin_installation) backend: Option<String>,
    #[serde(default, rename = "requires")]
    pub(in crate::plugin_installation) requires: Option<Vec<String>>,
}

#[derive(Debug)]
pub(in crate::plugin_installation) struct LoadedPluginPackage {
    package_json_path: PathBuf,
    raw_value: Value,
}

#[derive(Debug)]
pub(in crate::plugin_installation) struct ValidatedPluginPackage {
    pub(in crate::plugin_installation) package_json: PackageJsonFile,
    pub(in crate::plugin_installation) package_metadata_json: String,
}

#[derive(Debug)]
pub(in crate::plugin_installation) struct PluginPackageDiscoveryFields {
    pub(in crate::plugin_installation) id: String,
    pub(in crate::plugin_installation) name: String,
    pub(in crate::plugin_installation) version: String,
    pub(in crate::plugin_installation) description: String,
    pub(in crate::plugin_installation) declared_entries: Vec<String>,
}

#[derive(Debug)]
pub(in crate::plugin_installation) struct PackageMetadataSchemaRules {
    pub(in crate::plugin_installation) allowed_metadata_fields: Vec<String>,
    pub(in crate::plugin_installation) required_metadata_fields: Vec<String>,
    string_metadata_fields: Vec<String>,
    pub(in crate::plugin_installation) supported_api_versions: Vec<i64>,
    pub(in crate::plugin_installation) id_pattern: Regex,
    pub(in crate::plugin_installation) allowed_capabilities: Vec<String>,
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

pub(in crate::plugin_installation) fn load_package_from_dir(
    dir: &Path,
) -> ValidationResult<LoadedPluginPackage> {
    let package_json_path = dir.join("package.json");
    let raw = fs::read_to_string(&package_json_path).map_err(|error| {
        PluginPackageValidationError::ReadPackageJson {
            path: package_json_path.clone(),
            source: error,
        }
    })?;
    let raw_value = serde_json::from_str(&raw).map_err(|error| {
        PluginPackageValidationError::ParsePackageJson {
            path: package_json_path.clone(),
            source: error,
        }
    })?;

    Ok(LoadedPluginPackage {
        package_json_path,
        raw_value,
    })
}

impl LoadedPluginPackage {
    pub(in crate::plugin_installation) fn discovery_fields(
        &self,
        dir: &Path,
    ) -> Option<PluginPackageDiscoveryFields> {
        let object = self.raw_value.as_object()?;
        let openforge = object.get("openforge")?.as_object()?;
        let id = json_string_field(openforge, "id");
        let fallback_name = if id.is_empty() {
            dir.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string()
        } else {
            id.clone()
        };
        let display_name = json_string_field(openforge, "displayName");

        Some(PluginPackageDiscoveryFields {
            name: if display_name.is_empty() {
                fallback_name
            } else {
                display_name
            },
            id,
            version: json_string_field(object, "version"),
            description: json_string_field(openforge, "description"),
            declared_entries: declared_entries(openforge),
        })
    }

    pub(in crate::plugin_installation) fn validate(
        self,
    ) -> ValidationResult<ValidatedPluginPackage> {
        validate_package_json_shape(&self.raw_value)?;
        let package_json = serde_json::from_value(self.raw_value.clone()).map_err(|error| {
            PluginPackageValidationError::ParsePackageMetadata {
                path: self.package_json_path,
                source: error,
            }
        })?;
        let package_metadata_json = package_metadata_json(&self.raw_value)?;

        Ok(ValidatedPluginPackage {
            package_json,
            package_metadata_json,
        })
    }
}

fn json_string_field(object: &Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn declared_entries(openforge: &Map<String, Value>) -> Vec<String> {
    let mut entries = Vec::new();
    for key in ["frontend", "backend"] {
        if let Some(entry) = openforge.get(key).and_then(Value::as_str) {
            entries.push(entry.to_string());
        }
    }
    if let Some(stylesheets) = openforge.get("frontendStyles").and_then(Value::as_array) {
        entries.extend(
            stylesheets
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string),
        );
    }
    entries
}

fn validate_package_json_shape(value: &Value) -> ValidationResult<()> {
    let object = value
        .as_object()
        .ok_or(PluginPackageValidationError::PackageJsonMustBeObject)?;

    validate_non_empty_json_string(object, "name", "package.json name")?;
    validate_non_empty_json_string(object, "version", "package.json version")?;

    let openforge = object
        .get("openforge")
        .ok_or(PluginPackageValidationError::MissingOpenForgeMetadata)?
        .as_object()
        .ok_or(PluginPackageValidationError::OpenForgeMetadataMustBeObject)?;

    if openforge.contains_key("contributes") {
        return Err(PluginPackageValidationError::ContributionsUnsupported);
    }

    let schema_rules = package_metadata_schema_rules()?;

    for key in openforge.keys() {
        if !schema_rules.allows_metadata_field(key) {
            return Err(PluginPackageValidationError::UnsupportedMetadataField {
                field: key.clone(),
            });
        }
    }

    for key in &schema_rules.required_metadata_fields {
        if key == "apiVersion" {
            continue;
        }
        if !openforge.contains_key(key) {
            return Err(PluginPackageValidationError::MissingMetadataField { field: key.clone() });
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
        return Err(PluginPackageValidationError::InvalidEnablement);
    }

    if let Some(icon) = openforge.get("icon") {
        validate_plugin_icon(icon)?;
    }

    match openforge.get("apiVersion").and_then(Value::as_i64) {
        Some(version) if schema_rules.supports_api_version(version) => {}
        Some(version) => {
            return Err(PluginPackageValidationError::UnsupportedApiVersion {
                version,
                supported: schema_rules.supported_api_versions_label(),
            });
        }
        None if schema_rules.requires_metadata_field("apiVersion") => {
            return Err(PluginPackageValidationError::InvalidApiVersion {
                supported: schema_rules.supported_api_versions_label(),
            });
        }
        None => {}
    }

    if let Some(frontend_styles) = openforge.get("frontendStyles") {
        let frontend_styles = frontend_styles
            .as_array()
            .ok_or(PluginPackageValidationError::FrontendStylesMustBeArray)?;
        if frontend_styles.is_empty() {
            return Err(PluginPackageValidationError::EmptyFrontendStyles);
        }
        for (index, stylesheet) in frontend_styles.iter().enumerate() {
            let stylesheet = stylesheet
                .as_str()
                .filter(|stylesheet| !stylesheet.trim().is_empty())
                .ok_or(PluginPackageValidationError::InvalidFrontendStyle { index })?;
            if frontend_styles[..index]
                .iter()
                .any(|previous| previous.as_str() == Some(stylesheet))
            {
                return Err(PluginPackageValidationError::DuplicateFrontendStyle { index });
            }
        }
    }

    if let Some(requires) = openforge.get("requires") {
        let requires = requires
            .as_array()
            .ok_or(PluginPackageValidationError::RequiresMustBeArray)?;
        for (index, capability) in requires.iter().enumerate() {
            let capability = capability
                .as_str()
                .ok_or(PluginPackageValidationError::InvalidCapability { index })?;
            if !schema_rules.supports_capability(capability) {
                return Err(PluginPackageValidationError::UnknownCapability {
                    index,
                    capability: capability.to_string(),
                });
            }
        }
    }
    Ok(())
}

pub(in crate::plugin_installation) fn validate_package_metadata(
    package: &PackageJsonFile,
) -> ValidationResult<()> {
    let schema_rules = package_metadata_schema_rules()?;

    if !schema_rules.id_pattern.is_match(&package.openforge.id) {
        return Err(PluginPackageValidationError::InvalidPluginId {
            id: package.openforge.id.clone(),
        });
    }

    if !schema_rules.supports_api_version(package.openforge.api_version) {
        return Err(PluginPackageValidationError::UnsupportedApiVersion {
            version: package.openforge.api_version,
            supported: schema_rules.supported_api_versions_label(),
        });
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
        return Err(PluginPackageValidationError::AppEnablementCapabilityRequired);
    }

    if package.openforge.frontend.is_none() && package.openforge.backend.is_none() {
        return Err(PluginPackageValidationError::MissingRuntimeEntry);
    }

    if package.openforge.frontend.is_none() && package.openforge.frontend_styles.is_some() {
        return Err(PluginPackageValidationError::FrontendStylesRequireFrontend);
    }

    Ok(())
}

fn package_metadata_json(value: &Value) -> ValidationResult<String> {
    let object = value
        .as_object()
        .ok_or(PluginPackageValidationError::PackageJsonMustBeObject)?;
    let metadata = object
        .get("openforge")
        .ok_or(PluginPackageValidationError::MissingOpenForgeMetadata)?;
    serde_json::to_string(metadata)
        .map_err(|error| PluginPackageValidationError::SerializeMetadata { source: error })
}

fn validate_plugin_icon(value: &Value) -> ValidationResult<()> {
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

    Err(PluginPackageValidationError::InvalidIcon)
}

fn validate_non_empty_json_string(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> ValidationResult<()> {
    match object.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(()),
        _ => Err(PluginPackageValidationError::InvalidNonEmptyString {
            label: label.to_string(),
        }),
    }
}

pub(in crate::plugin_installation) fn package_metadata_schema_rules(
) -> ValidationResult<&'static PackageMetadataSchemaRules> {
    static RULES: OnceLock<PackageMetadataSchemaRules> = OnceLock::new();
    if let Some(rules) = RULES.get() {
        return Ok(rules);
    }

    let rules = parse_package_metadata_schema_rules()?;
    Ok(RULES.get_or_init(|| rules))
}

fn parse_package_metadata_schema_rules() -> ValidationResult<PackageMetadataSchemaRules> {
    let schema: Value = serde_json::from_str(OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON)
        .map_err(|error| PluginPackageValidationError::ParseMetadataSchema { source: error })?;
    let schema = schema.as_object().ok_or_else(|| {
        PluginPackageValidationError::InvalidMetadataSchemaField {
            label: "OpenForge package metadata schema".to_string(),
            expected: "an object",
        }
    })?;
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
        .ok_or_else(
            || PluginPackageValidationError::InvalidMetadataSchemaField {
                label: "OpenForge package metadata schema.properties.id.pattern".to_string(),
                expected: "a string",
            },
        )?;
    let id_pattern = Regex::new(id_pattern)
        .map_err(|error| PluginPackageValidationError::CompilePluginIdPattern { source: error })?;

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
) -> ValidationResult<&'a Map<String, Value>> {
    properties
        .get(property_name)
        .and_then(Value::as_object)
        .ok_or_else(
            || PluginPackageValidationError::InvalidMetadataSchemaField {
                label: format!("OpenForge package metadata schema.properties.{property_name}"),
                expected: "an object",
            },
        )
}

fn schema_object_field<'a>(
    object: &'a Map<String, Value>,
    field_name: &str,
    label: &str,
) -> ValidationResult<&'a Map<String, Value>> {
    object
        .get(field_name)
        .and_then(Value::as_object)
        .ok_or_else(
            || PluginPackageValidationError::InvalidMetadataSchemaField {
                label: label.to_string(),
                expected: "an object",
            },
        )
}

fn schema_string_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> ValidationResult<Vec<String>> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(
            || PluginPackageValidationError::InvalidMetadataSchemaField {
                label: label.to_string(),
                expected: "an array",
            },
        )?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_string).ok_or_else(|| {
                PluginPackageValidationError::InvalidMetadataSchemaEntry {
                    label: label.to_string(),
                    expected: "strings",
                }
            })
        })
        .collect()
}

fn schema_i64_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> ValidationResult<Vec<i64>> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(
            || PluginPackageValidationError::InvalidMetadataSchemaField {
                label: label.to_string(),
                expected: "an array",
            },
        )?
        .iter()
        .map(|value| {
            value.as_i64().ok_or_else(
                || PluginPackageValidationError::InvalidMetadataSchemaEntry {
                    label: label.to_string(),
                    expected: "integers",
                },
            )
        })
        .collect()
}
