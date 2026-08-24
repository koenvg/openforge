use super::super::{
    inspect_plugin_package_dir, install_plugin_package_from_source_spec,
    package_metadata_schema_rules, OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON,
};
use super::write_package_json;
use serde_json::Value;
use std::fs;
use tempfile::tempdir;

#[test]
fn install_package_preserves_schema_validation_error() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    write_package_json(
        source.path(),
        r#"{"id":"acme.schema","apiVersion":1,"displayName":"Schema","description":"Schema","frontend":"dist/frontend.js","unexpected":true}"#,
    );

    let error =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("unknown metadata field should fail installation");

    assert_eq!(
        error,
        "package.json openforge.unexpected is not supported by the OpenForge package metadata schema"
    );
}

#[test]
fn install_package_preserves_artifact_path_validation_error() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    write_package_json(
        source.path(),
        r#"{"id":"acme.artifact","apiVersion":1,"displayName":"Artifact","description":"Artifact","frontend":"../frontend.js"}"#,
    );

    let error =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("escaping artifact path should fail installation");

    assert_eq!(
        error,
        "package.json openforge.frontend entry must stay within the plugin package directory"
    );
}

#[test]
fn inspect_plugin_package_preserves_discovery_details_and_installer_error() {
    let source = tempdir().expect("source tempdir should create");
    write_package_json(
        source.path(),
        r#"{"id":"acme.discovery","apiVersion":1,"displayName":"Discovery","description":"Needs build","frontend":"dist/frontend.js","frontendStyles":["dist/frontend.css"]}"#,
    );

    let inspected =
        inspect_plugin_package_dir(source.path()).expect("OpenForge package should be discovered");

    assert_eq!(inspected.id, "acme.discovery");
    assert_eq!(inspected.name, "Discovery");
    assert_eq!(inspected.version, "1.2.3");
    assert_eq!(inspected.description, "Needs build");
    assert_eq!(
        inspected.missing_entries,
        vec!["dist/frontend.js", "dist/frontend.css"]
    );
    assert_eq!(
        inspected.problem,
        Some(format!(
            "OpenForge plugin frontend entry is missing at {}; run the package build first",
            source.path().join("dist/frontend.js").display()
        ))
    );
}

#[test]
fn install_package_preserves_plugin_row_construction() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(
        source.path().join("dist/frontend.mjs"),
        "export default {};",
    )
    .expect("frontend should write");
    fs::write(
        source.path().join("dist/backend.cjs"),
        "module.exports = {};",
    )
    .expect("backend should write");
    fs::write(source.path().join("dist/frontend.css"), ".plugin {}")
        .expect("stylesheet should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.row","apiVersion":1,"displayName":"Row","description":"Mapped row","frontend":"dist/frontend.mjs","frontendStyles":["dist/frontend.css"],"backend":"dist/backend.cjs","requires":["views"]}"#,
    );

    let row =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect("valid package should install");

    assert_eq!(row.id, "acme.row");
    assert_eq!(row.name, "Row");
    assert_eq!(row.version, "1.2.3");
    assert_eq!(row.api_version, 1);
    assert_eq!(row.description, "Mapped row");
    assert_eq!(row.permissions, "[]");
    assert_eq!(row.contributes, "{}");
    assert_eq!(row.frontend_entry, "dist/frontend.mjs");
    assert_eq!(row.backend_entry.as_deref(), Some("dist/backend.cjs"));
    assert_eq!(
        row.install_path,
        source
            .path()
            .canonicalize()
            .expect("source path should canonicalize")
            .to_string_lossy()
    );
    assert_eq!(row.source_kind, "local");
    assert_eq!(row.source_spec, source.path().to_string_lossy());
    assert_eq!(
        row.package_metadata,
        r#"{"apiVersion":1,"backend":"dist/backend.cjs","description":"Mapped row","displayName":"Row","frontend":"dist/frontend.mjs","frontendStyles":["dist/frontend.css"],"id":"acme.row","requires":["views"]}"#
    );
    assert!(row.installed_at > 0);
    assert!(!row.is_builtin);
}

#[test]
fn package_metadata_schema_rules_match_embedded_schema() {
    let rules = package_metadata_schema_rules().expect("schema rules should parse");
    let schema: Value = serde_json::from_str(OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON)
        .expect("embedded schema should parse in test");
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .expect("schema properties should be an object");
    let mut expected_fields: Vec<String> = properties.keys().cloned().collect();
    expected_fields.sort();

    let mut actual_fields = rules.allowed_metadata_fields.clone();
    actual_fields.sort();
    assert_eq!(actual_fields, expected_fields);

    let expected_required: Vec<String> = schema
        .get("required")
        .and_then(Value::as_array)
        .expect("schema required should be an array")
        .iter()
        .map(|field| {
            field
                .as_str()
                .expect("required field should be a string")
                .to_string()
        })
        .collect();
    assert_eq!(rules.required_metadata_fields, expected_required);

    assert_eq!(
        rules.id_pattern.as_str(),
        properties
            .get("id")
            .and_then(|schema| schema.get("pattern"))
            .and_then(Value::as_str)
            .expect("id pattern should be in schema")
    );
    assert_eq!(
        rules.supported_api_versions,
        properties
            .get("apiVersion")
            .and_then(|schema| schema.get("enum"))
            .and_then(Value::as_array)
            .expect("apiVersion enum should be in schema")
            .iter()
            .map(|version| version.as_i64().expect("apiVersion enum must be integers"))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        rules.allowed_capabilities,
        properties
            .get("requires")
            .and_then(|schema| schema.get("items"))
            .and_then(|schema| schema.get("enum"))
            .and_then(Value::as_array)
            .expect("requires enum should be in schema")
            .iter()
            .map(|capability| {
                capability
                    .as_str()
                    .expect("requires enum values should be strings")
                    .to_string()
            })
            .collect::<Vec<_>>()
    );
}

#[test]
fn install_package_source_accepts_schema_declared_capabilities() {
    for (index, capability) in package_metadata_schema_rules()
        .expect("schema rules should parse")
        .allowed_capabilities
        .iter()
        .enumerate()
    {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.js"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            &format!(
                r#"{{"id":"acme.capability.{index}","apiVersion":1,"displayName":"Capability","description":"Capability","frontend":"dist/frontend.js","requires":["{capability}"]}}"#
            ),
        );

        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .unwrap_or_else(|error| panic!("capability {capability} should install: {error}"));
    }
}

#[test]
fn install_package_source_enforces_app_enablement_contract() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");

    let app_metadata = r#"{"id":"acme.app","apiVersion":1,"displayName":"App","description":"App","enablement":"app","frontend":"dist/frontend.js","requires":["appEnablement"]}"#;
    write_package_json(source.path(), app_metadata);
    let row =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect("app-enabled package should install with capability gating");
    assert_eq!(
        row.package_metadata,
        r#"{"apiVersion":1,"description":"App","displayName":"App","enablement":"app","frontend":"dist/frontend.js","id":"acme.app","requires":["appEnablement"]}"#
    );

    write_package_json(
        source.path(),
        r#"{"id":"acme.app","apiVersion":1,"displayName":"App","description":"App","enablement":"app","frontend":"dist/frontend.js"}"#,
    );
    let missing_capability =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("app enablement without capability should fail");
    assert!(missing_capability.contains("requires the appEnablement capability"));

    write_package_json(
        source.path(),
        r#"{"id":"acme.app","apiVersion":1,"displayName":"App","description":"App","enablement":"workspace","frontend":"dist/frontend.js"}"#,
    );
    let invalid =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("invalid enablement should fail");
    assert!(invalid.contains("enablement must be \"app\" or \"project\""));
}

#[test]
fn install_package_source_rejects_unknown_openforge_property() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.unknown","apiVersion":1,"displayName":"Unknown","description":"Unknown","frontend":"dist/frontend.js","unexpected":true}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("openforge.unexpected is not supported"));
}

#[test]
fn install_package_source_rejects_id_not_matching_schema_pattern() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"Acme Invalid","apiVersion":1,"displayName":"Invalid","description":"Invalid","frontend":"dist/frontend.js"}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("must match the OpenForge package metadata schema"));
}

#[test]
fn install_package_source_rejects_malformed_plugin_icon() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.bad-icon","apiVersion":1,"displayName":"Bad Icon","description":"Bad icon","icon":{"type":"svg","svg":""},"frontend":"dist/frontend.js"}"#,
    );

    let error =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("install should fail");

    assert!(error
        .contains("openforge.icon must be a non-empty Lucide icon name or { type: \"svg\", svg }"));
}

#[test]
fn install_package_source_rejects_missing_declared_frontend_stylesheet() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.missing-style","apiVersion":1,"displayName":"Missing Style","description":"Needs CSS build","frontend":"dist/frontend.js","frontendStyles":["dist/missing.css"]}"#,
    );

    let error =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect_err("install should fail");

    assert!(error.contains("frontendStyles[0] entry is missing"));
    assert!(error.contains("run the package build first"));
}

#[test]
fn install_package_source_rejects_missing_built_js_entry_with_clear_error() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    write_package_json(
        source.path(),
        r#"{"id":"acme.missing","apiVersion":1,"displayName":"Missing Build","description":"Needs build","frontend":"dist/frontend.js"}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("run the package build first"));
}

#[test]
fn install_package_source_rejects_legacy_contributes_metadata() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.legacy","apiVersion":1,"displayName":"Legacy","description":"Legacy","frontend":"dist/frontend.js","contributes":{}}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("register contributions at runtime"));
}

#[test]
fn install_package_source_rejects_path_traversal_entry() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    write_package_json(
        source.path(),
        r#"{"id":"acme.traversal","apiVersion":1,"displayName":"Traversal","description":"Traversal","frontend":"../frontend.js"}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("must stay within the plugin package directory"));
}

#[test]
fn install_package_source_rejects_non_js_entry() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.ts"), "export default {};")
        .expect("frontend should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.typescript","apiVersion":1,"displayName":"Typescript","description":"Typescript","frontend":"dist/frontend.ts"}"#,
    );

    let result =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path());

    assert!(result.is_err());
    assert!(result
        .expect_err("install should fail")
        .contains("built JavaScript artifact"));
}
