use serde::Deserialize;

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PluginEnablement {
    App,
    #[default]
    Project,
}

#[derive(Debug, Deserialize)]
struct PackageMetadataEnablement {
    #[serde(default)]
    enablement: PluginEnablement,
}

impl PluginEnablement {
    pub(crate) fn from_package_metadata(raw: &str) -> serde_json::Result<Self> {
        serde_json::from_str::<PackageMetadataEnablement>(raw).map(|metadata| metadata.enablement)
    }

    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Project => "project",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PluginEnablement;

    #[test]
    fn package_metadata_enablement_defaults_to_project() {
        let enablement =
            PluginEnablement::from_package_metadata("{}").expect("omitted enablement should parse");

        assert_eq!(enablement, PluginEnablement::Project);
    }

    #[test]
    fn enablement_labels_match_package_metadata_values() {
        assert_eq!(PluginEnablement::App.as_str(), "app");
        assert_eq!(PluginEnablement::Project.as_str(), "project");
    }

    #[test]
    fn package_metadata_enablement_parses_declared_scopes() {
        for (raw, expected) in [
            (r#"{"enablement":"app"}"#, PluginEnablement::App),
            (r#"{"enablement":"project"}"#, PluginEnablement::Project),
        ] {
            assert_eq!(
                PluginEnablement::from_package_metadata(raw)
                    .expect("declared enablement should parse"),
                expected
            );
        }
    }

    #[test]
    fn package_metadata_enablement_rejects_invalid_metadata() {
        for raw in [r#"{"#, r#"{"enablement":"workspace"}"#] {
            assert!(
                PluginEnablement::from_package_metadata(raw).is_err(),
                "invalid package metadata should fail: {raw}"
            );
        }
    }
}
