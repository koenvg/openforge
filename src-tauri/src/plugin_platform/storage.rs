use super::PluginPlatform;
use crate::db;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PluginStorageScope<'a>(PluginStorageScopeKind<'a>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PluginStorageScopeKind<'a> {
    Global,
    Project(&'a str),
    Task(&'a str),
}

impl<'a> PluginStorageScope<'a> {
    pub(crate) fn parse(scope: &'a str, scope_id: Option<&'a str>) -> Result<Self, String> {
        match (scope, scope_id) {
            ("global", _) => Ok(Self(PluginStorageScopeKind::Global)),
            ("project", Some(scope_id)) if !scope_id.is_empty() => {
                Ok(Self(PluginStorageScopeKind::Project(scope_id)))
            }
            ("task", Some(scope_id)) if !scope_id.is_empty() => {
                Ok(Self(PluginStorageScopeKind::Task(scope_id)))
            }
            ("project" | "task", _) => {
                Err(format!("Plugin storage scope '{scope}' requires scopeId"))
            }
            _ => Err(format!("Unsupported plugin storage scope: {scope}")),
        }
    }

    pub(crate) fn as_db_parts(&self) -> (&'static str, Option<&str>) {
        match self.0 {
            PluginStorageScopeKind::Global => ("global", None),
            PluginStorageScopeKind::Project(scope_id) => ("project", Some(scope_id)),
            PluginStorageScopeKind::Task(scope_id) => ("task", Some(scope_id)),
        }
    }
}

impl PluginPlatform<'_> {
    pub(crate) fn plugin_storage(
        &self,
        plugin_id: &str,
        scope: &PluginStorageScope<'_>,
        key: &str,
    ) -> Result<Option<Value>, String> {
        let (scope, scope_id) = scope.as_db_parts();
        let db = db::acquire_db(self.db);
        let raw = db
            .get_plugin_storage(plugin_id, scope, scope_id, key)
            .map_err(|error| format!("Failed to get plugin storage: {error}"))?;
        Ok(raw.map(|value| serde_json::from_str(&value).unwrap_or(Value::String(value))))
    }

    pub(crate) fn set_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &PluginStorageScope<'_>,
        key: &str,
        value: &Value,
    ) -> Result<(), String> {
        let (scope, scope_id) = scope.as_db_parts();
        let serialized = serde_json::to_string(value)
            .map_err(|error| format!("Failed to serialize plugin storage value: {error}"))?;
        let db = db::acquire_db(self.db);
        db.set_plugin_storage(plugin_id, scope, scope_id, key, &serialized)
            .map_err(|error| format!("Failed to set plugin storage: {error}"))
    }

    pub(crate) fn delete_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &PluginStorageScope<'_>,
        key: &str,
    ) -> Result<(), String> {
        let (scope, scope_id) = scope.as_db_parts();
        let db = db::acquire_db(self.db);
        db.delete_plugin_storage(plugin_id, scope, scope_id, key)
            .map_err(|error| format!("Failed to delete plugin storage: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_global_storage_scope_without_an_id() {
        let scope =
            PluginStorageScope::parse("global", None).expect("global storage scope should parse");

        assert_eq!(scope.as_db_parts(), ("global", None));
    }

    #[test]
    fn global_storage_ignores_a_supplied_scope_id() {
        let scope = PluginStorageScope::parse("global", Some("ignored"))
            .expect("global storage scope should parse");

        assert_eq!(scope.as_db_parts(), ("global", None));
    }

    #[test]
    fn parses_project_and_task_storage_scopes_with_ids() {
        let cases = [
            ("project", "P-1", ("project", Some("P-1"))),
            ("task", "T-1", ("task", Some("T-1"))),
        ];

        for (kind, id, expected) in cases {
            let scope = PluginStorageScope::parse(kind, Some(id))
                .expect("scoped storage with an id should parse");
            assert_eq!(scope.as_db_parts(), expected);
        }
    }

    #[test]
    fn rejects_scoped_storage_without_a_non_empty_id() {
        for (kind, scope_id) in [
            ("project", None),
            ("project", Some("")),
            ("task", None),
            ("task", Some("")),
        ] {
            assert_eq!(
                PluginStorageScope::parse(kind, scope_id),
                Err(format!("Plugin storage scope '{kind}' requires scopeId"))
            );
        }
    }
}
