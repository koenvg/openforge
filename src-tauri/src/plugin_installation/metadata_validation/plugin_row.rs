use super::package_metadata::ValidatedPluginPackage;
use crate::{db, plugin_installation::package_source::PackageSourceSpec};
use std::path::Path;

pub(in crate::plugin_installation) fn build_plugin_row(
    loaded: &ValidatedPluginPackage,
    install_path: &Path,
    source: &PackageSourceSpec,
    is_builtin: bool,
) -> Result<db::PluginRow, String> {
    let openforge = &loaded.package_json.openforge;
    let installed_at = crate::unix_timestamp::milliseconds_i64(std::time::SystemTime::now())
        .map_err(|error| match error {
            crate::unix_timestamp::UnixTimestampError::BeforeEpoch(error) => {
                format!("failed to compute install timestamp: {error}")
            }
            crate::unix_timestamp::UnixTimestampError::OutOfRange(_) => {
                "failed to compute install timestamp: milliseconds since Unix epoch are out of range"
                    .to_string()
            }
        })?;
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
        installed_at,
        is_builtin,
    })
}
